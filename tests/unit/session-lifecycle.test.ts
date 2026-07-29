import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCAN_CONFIG } from "@/utils/defaults";
import type { ScanSession } from "@/types/models";

const mocks = vi.hoisted(() => ({
  cancelCrawler: vi.fn(),
  clearHistoryData: vi.fn(),
  deleteSessionData: vi.fn(),
  finishSession: vi.fn(),
  getSession: vi.fn(),
  hasOriginPermission: vi.fn(),
  injectPageScanner: vi.fn(),
  listSessions: vi.fn(),
  liveSessionIdForTab: vi.fn(),
  patchSession: vi.fn()
}));

vi.mock("@/database/db", () => ({
  clearHistoryData: mocks.clearHistoryData,
  deleteSessionData: mocks.deleteSessionData,
  getSession: mocks.getSession,
  listSessions: mocks.listSessions
}));
vi.mock("@/background/crawler-engine", () => ({ cancelCrawler: mocks.cancelCrawler }));
vi.mock("@/background/page-scanner", () => ({ injectPageScanner: mocks.injectPageScanner }));
vi.mock("@/background/permission-manager", () => ({
  hasOriginPermission: mocks.hasOriginPermission,
  originPattern: (url: string) => `${new URL(url).origin}/*`
}));
vi.mock("@/background/session-manager", () => ({
  finishSession: mocks.finishSession,
  liveSessionIdForTab: mocks.liveSessionIdForTab,
  patchSession: mocks.patchSession
}));

import {
  deleteScanSession,
  handleLiveTabUpdated,
  stopLiveMonitor,
  stopSessionsForRemovedOrigins
} from "@/background/session-lifecycle";

function liveSession(overrides: Partial<ScanSession> = {}): ScanSession {
  return {
    id: "session-live",
    mode: "live_monitor",
    status: "running",
    tabId: 7,
    startUrl: "https://example.test/start",
    origin: "https://example.test",
    createdAt: 90_000,
    startedAt: 90_000,
    pagesQueued: 0,
    pagesProcessed: 1,
    filesDiscovered: 2,
    errors: 0,
    config: DEFAULT_SCAN_CONFIG,
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(100_000);
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      alarms: {
        clear: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue({ name: "monitor:session-live", scheduledTime: 108_000 })
      },
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 7, url: "https://example.test/next" }),
        sendMessage: vi.fn().mockResolvedValue(undefined)
      }
    }
  });
  mocks.getSession.mockResolvedValue(liveSession());
  mocks.liveSessionIdForTab.mockResolvedValue("session-live");
  mocks.hasOriginPermission.mockResolvedValue(true);
  mocks.listSessions.mockResolvedValue([]);
});

describe("scan session lifecycle", () => {
  it("同源页面加载完成后按 alarm 剩余时长重新注入监听", async () => {
    await handleLiveTabUpdated(7, {
      status: "complete",
      url: "https://example.test/next"
    });

    expect(mocks.patchSession).toHaveBeenCalledWith("session-live", {
      startUrl: "https://example.test/next"
    });
    expect(mocks.injectPageScanner).toHaveBeenCalledWith("session-live", 7);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: "START_CONTENT_MONITOR",
      payload: { durationMs: 8_000 }
    });
  });

  it("跨 origin 跳转时安全停止实时监听", async () => {
    await handleLiveTabUpdated(7, { url: "https://other.test/" });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "STOP_CONTENT_MONITOR" });
    expect(chrome.alarms.clear).toHaveBeenCalledWith("monitor:session-live");
    expect(mocks.finishSession).toHaveBeenCalledWith("session-live", "cancelled");
    expect(mocks.injectPageScanner).not.toHaveBeenCalled();
  });

  it("撤权时先通知内容脚本停止，再结束任务", async () => {
    const session = liveSession();
    mocks.listSessions.mockResolvedValue([session]);

    await stopSessionsForRemovedOrigins(["https://example.test/*"]);

    const stopOrder = vi.mocked(chrome.tabs.sendMessage).mock.invocationCallOrder[0];
    const finishOrder = mocks.finishSession.mock.invocationCallOrder[0];
    expect(stopOrder).toBeLessThan(finishOrder!);
  });

  it("删除运行中的任务前先停止任务", async () => {
    await deleteScanSession("session-live");

    const finishOrder = mocks.finishSession.mock.invocationCallOrder[0];
    const deleteOrder = mocks.deleteSessionData.mock.invocationCallOrder[0];
    expect(finishOrder).toBeLessThan(deleteOrder!);
  });

  it("停止监听会清理 alarm", async () => {
    await stopLiveMonitor(liveSession(), "completed");
    expect(chrome.alarms.clear).toHaveBeenCalledWith("monitor:session-live");
  });
});
