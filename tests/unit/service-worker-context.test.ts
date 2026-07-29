import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alarmState: { getCalls: 0, createCalls: 0 },
  broadcast: vi.fn(),
  handleLiveTabUpdated: vi.fn(() => Promise.resolve()),
  reconcileState: { calls: 0 },
  reconcileDownloads: vi.fn(() => Promise.resolve()),
  reconcileInterruptedSessions: vi.fn(() => Promise.resolve())
}));

vi.mock("@/background/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@/background/download-manager", () => ({
  DownloadManager: class {
    reconcile() {
      mocks.reconcileState.calls += 1;
      return mocks.reconcileDownloads();
    }
  }
}));
vi.mock("@/background/message-router", () => ({ MessageRouter: class {} }));
vi.mock("@/background/network-monitor", () => ({ NetworkMonitor: class {} }));
vi.mock("@/background/alarm-manager", () => ({ registerAlarmHandlers: vi.fn() }));
vi.mock("@/background/session-manager", () => ({ clearRuntimeSessionState: vi.fn() }));
vi.mock("@/background/session-lifecycle", () => ({
  handleLiveTabUpdated: mocks.handleLiveTabUpdated,
  reconcileInterruptedSessions: mocks.reconcileInterruptedSessions,
  stopLiveMonitor: vi.fn(),
  stopSessionsForRemovedOrigins: vi.fn(),
  stopSessionsForTab: vi.fn()
}));
vi.mock("@/database/settings", () => ({ getSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("@/database/db", () => ({ listSessions: vi.fn() }));

let activatedListener: ((activeInfo: { tabId: number; windowId: number }) => void) | undefined;
let updatedListener:
  | ((
      tabId: number,
      changeInfo: { status?: "loading" | "complete"; title?: string; url?: string },
      tab: { active: boolean; id?: number }
    ) => void)
  | undefined;
let focusChangedListener: ((windowId: number) => void) | undefined;

function event() {
  return { addListener: vi.fn() };
}

beforeAll(async () => {
  globalThis.chrome = {
    alarms: {
      get: vi.fn(() => {
        mocks.alarmState.getCalls += 1;
        return Promise.resolve(undefined);
      }),
      create: vi.fn(() => {
        mocks.alarmState.createCalls += 1;
        return Promise.resolve();
      })
    },
    runtime: {
      onInstalled: event(),
      onStartup: event()
    },
    tabs: {
      onActivated: {
        addListener: vi.fn((listener: typeof activatedListener) => {
          activatedListener = listener;
        })
      },
      onRemoved: event(),
      onUpdated: {
        addListener: vi.fn((listener: typeof updatedListener) => {
          updatedListener = listener;
        })
      }
    },
    permissions: { onRemoved: event() },
    windows: {
      onFocusChanged: {
        addListener: vi.fn((listener: typeof focusChangedListener) => {
          focusChangedListener = listener;
        })
      }
    }
  } as unknown as typeof chrome;
  await import("@/background/service-worker");
});

beforeEach(() => {
  mocks.broadcast.mockClear();
  mocks.handleLiveTabUpdated.mockClear();
});

describe("service worker active context events", () => {
  it("活动标签页切换时广播上下文变化", () => {
    activatedListener?.({ tabId: 2, windowId: 1 });

    expect(mocks.broadcast).toHaveBeenCalledWith({ type: "ACTIVE_CONTEXT_CHANGED" });
  });

  it("活动标签页完成导航或 URL 变化时广播，后台标签页不广播", () => {
    updatedListener?.(2, { title: "Only title" }, { id: 2, active: true });
    updatedListener?.(2, { url: "https://next.test" }, { id: 2, active: false });
    expect(mocks.broadcast).not.toHaveBeenCalled();

    updatedListener?.(2, { status: "complete" }, { id: 2, active: true });

    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).toHaveBeenCalledWith({ type: "ACTIVE_CONTEXT_CHANGED" });
    expect(mocks.handleLiveTabUpdated).toHaveBeenCalledTimes(3);
  });

  it("窗口重新获得焦点时刷新该窗口上下文", () => {
    focusChangedListener?.(3);

    expect(mocks.broadcast).toHaveBeenCalledWith({ type: "ACTIVE_CONTEXT_CHANGED" });
  });

  it("服务工作线程启动时校准持久下载状态", () => {
    expect(mocks.reconcileState.calls).toBe(1);
  });

  it("服务工作线程激活时确保维护 alarm 存在", async () => {
    await vi.waitFor(() => expect(mocks.alarmState.createCalls).toBe(1));
    expect(mocks.alarmState.getCalls).toBe(1);
  });
});
