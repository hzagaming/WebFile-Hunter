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
let headersReceived:
  | ((
      details: chrome.webRequest.OnHeadersReceivedDetails
    ) => chrome.webRequest.BlockingResponse | undefined)
  | undefined;

function webRequestEvent(capture?: "before" | "headers") {
  return {
    addListener: vi.fn((listener: typeof beforeRequest) => {
      if (capture === "before") beforeRequest = listener;
      if (capture === "headers") headersReceived = listener;
    })
  };
}

beforeEach(() => {
  beforeRequest = undefined;
  headersReceived = undefined;
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
  mocks.getSettings.mockResolvedValue({
    customExtensions: {},
    customMimeTypes: {},
    scanImages: true
  });
  mocks.putFiles.mockImplementation((_sessionId, candidates) => Promise.resolve([...candidates]));
  mocks.listFiles.mockResolvedValue([]);
  mocks.patchSession.mockResolvedValue(undefined);
  globalThis.chrome = {
    webRequest: {
      onBeforeRequest: webRequestEvent("before"),
      onHeadersReceived: webRequestEvent("headers"),
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
  it("保存当前标签页内由跨域 frame 发起的第三方资源", async () => {
    beforeRequest?.(request("https://other.test"));

    await vi.waitFor(() => expect(mocks.putFiles).toHaveBeenCalledTimes(1));
    expect(mocks.putFiles.mock.calls[0]?.[1][0]).toEqual(
      expect.objectContaining({
        canonicalUrl: "https://cdn.test/manual.pdf",
        sourcePageUrl: "https://example.test/page",
        isExternal: true
      })
    );
  });

  it("网络请求始终保留完整会话页面路径而不是 initiator Origin", async () => {
    beforeRequest?.(request("https://example.test"));
    beforeRequest?.({ ...request(), requestId: "request-2" });

    await vi.waitFor(() => expect(mocks.putFiles).toHaveBeenCalledTimes(2));
    expect(mocks.putFiles.mock.calls[0]?.[1][0]?.sourcePageUrl).toBe("https://example.test/page");
    expect(mocks.putFiles.mock.calls[1]?.[1][0]?.sourcePageUrl).toBe("https://example.test/page");
  });

  it("响应未声明 Content-Length 时不伪造 0 字节大小", async () => {
    headersReceived?.({
      requestId: "request-size",
      url: "https://cdn.test/file.pdf",
      method: "GET",
      frameId: 0,
      parentFrameId: -1,
      documentLifecycle: "active",
      frameType: "outermost_frame",
      tabId: 7,
      type: "xmlhttprequest",
      timeStamp: 1,
      statusCode: 200,
      statusLine: "HTTP/1.1 200 OK",
      initiator: "https://example.test",
      responseHeaders: [{ name: "Content-Type", value: "application/pdf" }]
    });

    await vi.waitFor(() => expect(mocks.putFiles).toHaveBeenCalledTimes(1));
    expect(mocks.putFiles.mock.calls[0]?.[1][0]).not.toHaveProperty("contentLength");
  });

  it("关闭图片扫描后不保存网络图片候选", async () => {
    mocks.getSettings.mockResolvedValue({
      customExtensions: {},
      customMimeTypes: {},
      scanImages: false
    });

    beforeRequest?.({
      ...request("https://example.test"),
      url: "https://cdn.test/cover.jpg"
    });

    await vi.waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    await Promise.resolve();
    expect(mocks.putFiles).not.toHaveBeenCalled();
  });

  it("保存无扩展名但返回非 HTML MIME 的资源响应", async () => {
    headersReceived?.({
      requestId: "request-mime",
      url: "https://cdn.test/api/resource",
      method: "GET",
      frameId: 0,
      parentFrameId: -1,
      documentLifecycle: "active",
      frameType: "outermost_frame",
      tabId: 7,
      type: "xmlhttprequest",
      timeStamp: 1,
      statusCode: 200,
      statusLine: "HTTP/1.1 200 OK",
      initiator: "https://example.test",
      responseHeaders: [{ name: "Content-Type", value: "application/vnd.demo.binary" }]
    });

    await vi.waitFor(() => expect(mocks.putFiles).toHaveBeenCalledTimes(1));
    expect(mocks.putFiles.mock.calls[0]?.[1][0]).toEqual(
      expect.objectContaining({
        canonicalUrl: "https://cdn.test/api/resource",
        mimeType: "application/vnd.demo.binary"
      })
    );
  });

  it("不把 POST 接口响应误标为可直接下载资源", async () => {
    headersReceived?.({
      requestId: "request-post",
      url: "https://cdn.test/api/export",
      method: "POST",
      frameId: 0,
      parentFrameId: -1,
      documentLifecycle: "active",
      frameType: "outermost_frame",
      tabId: 7,
      type: "xmlhttprequest",
      timeStamp: 1,
      statusCode: 200,
      statusLine: "HTTP/1.1 200 OK",
      initiator: "https://example.test",
      responseHeaders: [{ name: "Content-Type", value: "application/pdf" }]
    });

    await Promise.resolve();
    expect(mocks.putFiles).not.toHaveBeenCalled();
  });

  it("从 HTML 响应的 Link 头发现显式资源", async () => {
    headersReceived?.({
      requestId: "request-link-header",
      url: "https://example.test/page",
      method: "GET",
      frameId: 0,
      parentFrameId: -1,
      documentLifecycle: "active",
      frameType: "outermost_frame",
      tabId: 7,
      type: "main_frame",
      timeStamp: 1,
      statusCode: 200,
      statusLine: "HTTP/1.1 200 OK",
      initiator: "https://example.test",
      responseHeaders: [
        { name: "Content-Type", value: "text/html" },
        {
          name: "Link",
          value: '</assets/header-document>; rel=preload; type="application/pdf"'
        }
      ]
    });

    await vi.waitFor(() => expect(mocks.putFiles).toHaveBeenCalledTimes(1));
    expect(mocks.putFiles.mock.calls[0]?.[1][0]).toEqual(
      expect.objectContaining({
        canonicalUrl: "https://example.test/assets/header-document",
        mimeType: "application/pdf",
        source: "NETWORK_HEADER"
      })
    );
  });
});
