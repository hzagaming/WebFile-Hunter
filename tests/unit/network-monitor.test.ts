import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkMonitor } from "@/background/network-monitor";
import { scanSession } from "../helpers/fixtures";
import type { FileCandidate } from "@/types/models";

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  getSession: vi.fn(),
  getSettings: vi.fn(),
  listFiles: vi.fn(),
  liveSessionIdForTab: vi.fn(),
  patchSession: vi.fn(),
  putFiles:
    vi.fn<(sessionId: string, candidates: readonly FileCandidate[]) => Promise<FileCandidate[]>>()
}));

vi.mock("@/background/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@/database/db", () => ({
  getSession: mocks.getSession,
  listFiles: mocks.listFiles,
  putFiles: mocks.putFiles
}));
vi.mock("@/database/settings", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/background/session-manager", () => ({
  liveSessionIdForTab: mocks.liveSessionIdForTab,
  patchSession: mocks.patchSession
}));

let beforeRequest:
  | ((
      details: chrome.webRequest.OnBeforeRequestDetails
    ) => chrome.webRequest.BlockingResponse | undefined)
  | undefined;

function webRequestEvent(capture = false) {
  return {
    addListener: vi.fn((listener: typeof beforeRequest) => {
      if (capture) beforeRequest = listener;
    })
  };
}

beforeEach(() => {
  beforeRequest = undefined;
  vi.clearAllMocks();
  mocks.liveSessionIdForTab.mockResolvedValue("session-live");
  mocks.getSession.mockResolvedValue(
    scanSession({
      id: "session-live",
      mode: "live_monitor",
      status: "running",
      tabId: 7,
      origin: "https://example.test",
      startUrl: "https://example.test/page"
    })
  );
  mocks.getSettings.mockResolvedValue({ customExtensions: {}, customMimeTypes: {} });
  mocks.putFiles.mockImplementation((_sessionId, candidates) => Promise.resolve([...candidates]));
  mocks.listFiles.mockResolvedValue([]);
  mocks.patchSession.mockResolvedValue(undefined);
  globalThis.chrome = {
    webRequest: {
      onBeforeRequest: webRequestEvent(true),
      onHeadersReceived: webRequestEvent(),
      onResponseStarted: webRequestEvent(),
      onCompleted: webRequestEvent(),
      onErrorOccurred: webRequestEvent()
    }
  } as unknown as typeof chrome;
  new NetworkMonitor();
});

function request(initiator?: string): chrome.webRequest.OnBeforeRequestDetails {
  return {
    requestId: "request-1",
    url: "https://cdn.test/manual.pdf",
    method: "GET",
    frameId: 0,
    parentFrameId: -1,
    tabId: 7,
    type: "xmlhttprequest",
    timeStamp: 1,
    ...(initiator ? { initiator } : {})
  };
}

describe("NetworkMonitor", () => {
  it("忽略由其他 Origin 页面发起的迟到请求", async () => {
    beforeRequest?.(request("https://other.test"));

    await vi.waitFor(() => expect(mocks.getSession).toHaveBeenCalledWith("session-live"));
    await Promise.resolve();

    expect(mocks.putFiles).not.toHaveBeenCalled();
  });

  it("保存同 Origin 请求并在缺少 initiator 时回退到会话起始页", async () => {
    beforeRequest?.(request("https://example.test"));
    beforeRequest?.({ ...request(), requestId: "request-2" });

    await vi.waitFor(() => expect(mocks.putFiles).toHaveBeenCalledTimes(2));
    expect(mocks.putFiles.mock.calls[0]?.[1][0]?.sourcePageUrl).toBe("https://example.test");
    expect(mocks.putFiles.mock.calls[1]?.[1][0]?.sourcePageUrl).toBe("https://example.test/page");
  });
});
