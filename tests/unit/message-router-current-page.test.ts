import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRouter } from "@/background/message-router";
import type { DownloadManager } from "@/background/download-manager";
import type { MessageResponse } from "@/messaging/message-types";
import { scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  failScanSessionStart: vi.fn(),
  hasAllSitesPermission: vi.fn(),
  hasOriginPermission: vi.fn(),
  injectPageScanner: vi.fn(),
  startCrawler: vi.fn(),
  getSettings: vi.fn()
}));

vi.mock("@/background/crawler-engine", () => ({
  pauseCrawler: vi.fn(),
  resumeCrawler: vi.fn(),
  startCrawler: mocks.startCrawler
}));

vi.mock("@/background/session-manager", () => ({
  activeSessionIdForTab: vi.fn(),
  createSession: mocks.createSession,
  incompleteSessions: vi.fn(),
  patchSession: vi.fn()
}));
vi.mock("@/background/page-scanner", () => ({
  handlePageScanResult: vi.fn(),
  injectPageScanner: mocks.injectPageScanner
}));
vi.mock("@/background/session-lifecycle", () => ({
  clearScanHistory: vi.fn(),
  deleteScanSession: vi.fn(),
  failScanSessionStart: mocks.failScanSessionStart,
  stopScanSession: vi.fn(),
  stopSessionsForRemovedOrigins: vi.fn()
}));
vi.mock("@/background/permission-manager", () => ({
  getGrantedOrigins: vi.fn(),
  hasAllSitesPermission: mocks.hasAllSitesPermission,
  hasOriginPermission: mocks.hasOriginPermission,
  revokeAllSitesPermission: vi.fn(),
  revokeOrigin: vi.fn()
}));
vi.mock("@/database/settings", () => ({ getSettings: mocks.getSettings }));

type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
) => boolean;

let runtimeListener: RuntimeListener | undefined;
const createAlarm =
  vi.fn<(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) => Promise<void>>();

beforeEach(() => {
  vi.clearAllMocks();
  runtimeListener = undefined;
  createAlarm.mockResolvedValue(undefined);
  mocks.createSession.mockResolvedValue(scanSession({ status: "running" }));
  mocks.hasAllSitesPermission.mockResolvedValue(true);
  mocks.hasOriginPermission.mockResolvedValue(true);
  mocks.injectPageScanner.mockResolvedValue(undefined);
  mocks.getSettings.mockResolvedValue({
    scan: { ...scanSession().config, capturePageText: false }
  });
  globalThis.chrome = {
    alarms: { create: createAlarm },
    runtime: {
      id: "extension-id",
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListener = listener;
        })
      }
    },
    tabs: {
      get: vi.fn(() =>
        Promise.resolve({ id: 1, url: "https://example.test/page" } as chrome.tabs.Tab)
      )
    }
  } as unknown as typeof chrome;
});

describe("MessageRouter current page scan", () => {
  it("注入扫描器前创建超时看门狗", async () => {
    new MessageRouter({} as DownloadManager);
    const response = await new Promise<MessageResponse>((resolve) => {
      runtimeListener?.(
        { type: "SCAN_CURRENT_PAGE", payload: { tabId: 1 } },
        { id: "extension-id" },
        resolve
      );
    });

    expect(response.ok).toBe(true);
    expect(createAlarm).toHaveBeenCalledTimes(1);
    const [name, alarmInfo] = createAlarm.mock.calls[0]!;
    expect(name).toBe("scan:session-fixture");
    expect(alarmInfo.when).toBeGreaterThan(Date.now() + 25_000);
    expect(mocks.injectPageScanner).toHaveBeenCalledWith("session-fixture", 1);
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.anything(),
      "current_page",
      expect.objectContaining({ capturePageText: false })
    );
  });

  it("没有全站权限时拒绝启动完整实时嗅探", async () => {
    mocks.hasAllSitesPermission.mockResolvedValue(false);
    new MessageRouter({} as DownloadManager);
    const response = await new Promise<MessageResponse>((resolve) => {
      runtimeListener?.(
        {
          type: "START_LIVE_MONITOR",
          payload: { tabId: 1, origin: "https://example.test" }
        },
        { id: "extension-id" },
        resolve
      );
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toContain("完整嗅探");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("递归爬取启动后注入当前渲染 DOM 作为页面种子", async () => {
    const session = scanSession({ mode: "recursive_crawl", status: "running" });
    mocks.createSession.mockResolvedValue(session);
    new MessageRouter({} as DownloadManager);
    const response = await new Promise<MessageResponse>((resolve) => {
      runtimeListener?.(
        {
          type: "START_RECURSIVE_CRAWL",
          payload: { tabId: 1, config: session.config }
        },
        { id: "extension-id" },
        resolve
      );
    });

    expect(response.ok).toBe(true);
    expect(mocks.startCrawler).toHaveBeenCalledWith(session);
    expect(mocks.injectPageScanner).toHaveBeenCalledWith(session.id, session.tabId);
    expect(mocks.startCrawler.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.injectPageScanner.mock.invocationCallOrder[0]!
    );
  });
});
