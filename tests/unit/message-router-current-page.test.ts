import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRouter } from "@/background/message-router";
import type { DownloadManager } from "@/background/download-manager";
import type { MessageResponse } from "@/messaging/message-types";
import { scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  failScanSessionStart: vi.fn(),
  injectPageScanner: vi.fn()
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
  mocks.injectPageScanner.mockResolvedValue(undefined);
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
  });
});
