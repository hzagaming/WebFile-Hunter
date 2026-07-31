import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSnapshot } from "@/sidepanel/hooks/useAppSnapshot";
import { appSnapshot, scanSession } from "../helpers/fixtures";
import type { AppSnapshot, ExtensionEvent } from "@/messaging/message-types";

const mocks = vi.hoisted(() => ({
  queryTabs: vi.fn(),
  sendMessage: vi.fn(),
  subscribeEvents: vi.fn<(listener: (event: ExtensionEvent) => void) => () => void>(() => vi.fn())
}));

vi.mock("@/messaging/message-client", () => ({
  sendMessage: mocks.sendMessage,
  subscribeEvents: mocks.subscribeEvents
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.queryTabs.mockReset().mockResolvedValue([{ id: 17 }]);
  mocks.sendMessage.mockReset();
  mocks.subscribeEvents.mockReset().mockReturnValue(vi.fn());
  vi.stubGlobal("chrome", { tabs: { query: mocks.queryTabs } });
});

describe("useAppSnapshot", () => {
  it("并发刷新时忽略较晚返回的旧响应", async () => {
    const oldRequest = deferred<AppSnapshot>();
    const newRequest = deferred<AppSnapshot>();
    mocks.sendMessage
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const { result } = renderHook(() => useAppSnapshot());
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));

    let manualRefresh!: Promise<void>;
    act(() => {
      manualRefresh = result.current.refresh();
    });
    newRequest.resolve(appSnapshot({ sessions: [] }));
    await act(async () => manualRefresh);

    const latest = result.current.snapshot;
    oldRequest.resolve(appSnapshot({ sessions: [scanSession({ id: "stale-session" })] }));
    await act(async () => oldRequest.promise);

    expect(result.current.snapshot).toBe(latest);
    expect(result.current.loading).toBe(false);
  });

  it("活动标签页上下文变化时自动刷新完整快照", async () => {
    const first = appSnapshot({
      activeTab: {
        id: 1,
        url: "https://first.test/page",
        title: "First",
        origin: "https://first.test"
      }
    });
    const second = appSnapshot({
      activeTab: {
        id: 2,
        url: "https://second.test/page",
        title: "Second",
        origin: "https://second.test"
      }
    });
    mocks.sendMessage.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { result } = renderHook(() => useAppSnapshot());
    await waitFor(() => expect(result.current.snapshot).toBe(first));

    const listener = mocks.subscribeEvents.mock.calls[0]?.[0];
    act(() => listener?.({ type: "ACTIVE_CONTEXT_CHANGED" }));

    await waitFor(() => expect(result.current.snapshot).toBe(second));
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      type: "GET_SNAPSHOT",
      payload: { tabId: 17 }
    });
  });

  it("每个侧栏使用自身窗口的活动标签页生成快照", async () => {
    mocks.queryTabs.mockResolvedValue([{ id: 29 }]);
    mocks.sendMessage.mockResolvedValue(appSnapshot());

    renderHook(() => useAppSnapshot());

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        type: "GET_SNAPSHOT",
        payload: { tabId: 29 }
      })
    );
    expect(mocks.queryTabs).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it("其他标签页的任务事件不会成为当前标签页活动任务", async () => {
    const current = appSnapshot({
      activeTab: {
        id: 1,
        url: "https://current.test/page",
        title: "Current",
        origin: "https://current.test"
      }
    });
    mocks.sendMessage.mockResolvedValue(current);
    const { result } = renderHook(() => useAppSnapshot());
    await waitFor(() => expect(result.current.snapshot).toBe(current));

    const listener = mocks.subscribeEvents.mock.calls[0]?.[0];
    act(() =>
      listener?.({
        type: "SESSION_UPDATED",
        payload: scanSession({ tabId: 2, origin: "https://other.test" })
      })
    );

    expect(result.current.snapshot?.sessions).toHaveLength(1);
    expect(result.current.snapshot?.activeSession).toBeUndefined();
  });

  it("实时合并递归请求进度到活动会话和历史会话", async () => {
    const session = scanSession({
      id: "recursive-session",
      mode: "recursive_crawl",
      status: "running"
    });
    const current = appSnapshot({
      activeSession: session,
      sessions: [session],
      incompleteSessions: [session]
    });
    mocks.sendMessage.mockResolvedValue(current);
    const { result } = renderHook(() => useAppSnapshot());
    await waitFor(() => expect(result.current.snapshot).toBe(current));

    const listener = mocks.subscribeEvents.mock.calls[0]?.[0];
    act(() =>
      listener?.({
        type: "SCAN_PROGRESS",
        payload: {
          sessionId: session.id,
          status: "running",
          pagesQueued: 3,
          pagesProcessed: 1,
          filesDiscovered: 4,
          errors: 0,
          currentUrl: "https://example.test/page-2",
          requestsPerMinute: 5
        }
      })
    );

    expect(result.current.snapshot?.activeSession).toMatchObject({
      currentUrl: "https://example.test/page-2",
      requestsPerMinute: 5
    });
    expect(result.current.snapshot?.sessions[0]).toMatchObject({
      currentUrl: "https://example.test/page-2",
      requestsPerMinute: 5
    });
    expect(result.current.snapshot?.incompleteSessions).toHaveLength(1);

    act(() =>
      listener?.({
        type: "SCAN_PROGRESS",
        payload: {
          sessionId: session.id,
          status: "completed",
          pagesQueued: 3,
          pagesProcessed: 3,
          filesDiscovered: 4,
          errors: 0,
          currentUrl: "https://example.test/page-3",
          requestsPerMinute: 5
        }
      })
    );

    expect(result.current.snapshot?.incompleteSessions).toHaveLength(0);

    act(() => {
      listener?.({
        type: "SCAN_PROGRESS",
        payload: {
          sessionId: session.id,
          status: "running",
          pagesQueued: 2,
          pagesProcessed: 2,
          filesDiscovered: 3,
          errors: 0,
          currentUrl: "https://example.test/stale",
          requestsPerMinute: 4
        }
      });
      listener?.({
        type: "SESSION_UPDATED",
        payload: { ...session, status: "running" }
      });
    });

    expect(result.current.snapshot?.activeSession?.status).toBe("completed");
    expect(result.current.snapshot?.sessions[0]?.status).toBe("completed");
    expect(result.current.snapshot?.incompleteSessions).toHaveLength(0);
  });
});
