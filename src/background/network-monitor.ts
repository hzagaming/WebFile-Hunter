import { createFileCandidate, shouldIncludeCandidate } from "@/core/candidate-factory";
import { looksLikeFileUrl } from "@/core/file-classifier";
import { categoryFromMime, isHtmlMime, normalizeMimeType } from "@/core/mime-map";
import { getSession, listFiles, putFiles } from "@/database/db";
import { getSettings } from "@/database/settings";
import { broadcast } from "./broadcast";
import { liveSessionIdForTab, patchSession } from "./session-manager";

interface PendingRequest {
  requestId: string;
  tabId: number;
  url: string;
  method: string;
  type: string;
  sourcePageUrl?: string;
  statusCode?: number;
  finalUrl?: string;
  mimeType?: string;
  contentLength?: number;
  contentDisposition?: string;
  etag?: string;
  lastModified?: string;
  acceptRanges?: string;
}

function headersMap(headers?: chrome.webRequest.HttpHeader[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers ?? []) {
    if (header.name && header.value !== undefined) map.set(header.name.toLowerCase(), header.value);
  }
  return map;
}

export class NetworkMonitor {
  readonly #requests = new Map<string, PendingRequest>();

  constructor() {
    chrome.webRequest.onBeforeRequest.addListener(this.#beforeRequest, { urls: ["<all_urls>"] });
    chrome.webRequest.onHeadersReceived.addListener(
      this.#headersReceived,
      { urls: ["<all_urls>"] },
      ["responseHeaders"]
    );
    chrome.webRequest.onResponseStarted.addListener(
      this.#responseStarted,
      { urls: ["<all_urls>"] },
      ["responseHeaders"]
    );
    chrome.webRequest.onCompleted.addListener(this.#completed, { urls: ["<all_urls>"] });
    chrome.webRequest.onErrorOccurred.addListener(this.#errored, { urls: ["<all_urls>"] });
  }

  readonly #beforeRequest = (
    details: chrome.webRequest.OnBeforeRequestDetails
  ): chrome.webRequest.BlockingResponse | undefined => {
    if (details.tabId < 0 || details.method !== "GET") return undefined;
    if (this.#requests.size >= 5000) {
      const oldest = this.#requests.keys().next().value;
      if (typeof oldest === "string") this.#requests.delete(oldest);
    }
    const request: PendingRequest = {
      requestId: details.requestId,
      tabId: details.tabId,
      url: details.url,
      method: details.method,
      type: details.type,
      ...(details.initiator ? { sourcePageUrl: details.initiator } : {})
    };
    this.#requests.set(details.requestId, request);
    if (looksLikeFileUrl(details.url)) {
      void this.#persist(request, "NETWORK_REQUEST").catch(() => undefined);
    }
    return undefined;
  };

  readonly #headersReceived = (
    details: chrome.webRequest.OnHeadersReceivedDetails
  ): chrome.webRequest.BlockingResponse | undefined => {
    if (details.tabId < 0) return undefined;
    const request: PendingRequest = this.#requests.get(details.requestId) ?? {
      requestId: details.requestId,
      tabId: details.tabId,
      url: details.url,
      method: "GET",
      type: details.type
    };
    const headers = headersMap(details.responseHeaders);
    const length = Number(headers.get("content-length"));
    Object.assign(request, {
      statusCode: details.statusCode,
      finalUrl: details.url,
      mimeType: normalizeMimeType(headers.get("content-type")),
      ...(Number.isSafeInteger(length) && length >= 0 ? { contentLength: length } : {}),
      ...(headers.get("content-disposition")
        ? { contentDisposition: headers.get("content-disposition") }
        : {}),
      ...(headers.get("etag") ? { etag: headers.get("etag") } : {}),
      ...(headers.get("last-modified") ? { lastModified: headers.get("last-modified") } : {}),
      ...(headers.get("accept-ranges") ? { acceptRanges: headers.get("accept-ranges") } : {})
    });
    this.#requests.set(details.requestId, request);
    const isCandidate =
      looksLikeFileUrl(request.url) ||
      Boolean(request.contentDisposition) ||
      (Boolean(categoryFromMime(request.mimeType)) && !isHtmlMime(request.mimeType)) ||
      request.mimeType === "application/octet-stream";
    if (isCandidate) void this.#persist(request, "NETWORK_HEADER").catch(() => undefined);
    return undefined;
  };

  readonly #responseStarted = (details: chrome.webRequest.OnResponseStartedDetails): void => {
    const request = this.#requests.get(details.requestId);
    if (request && details.url !== request.url) request.finalUrl = details.url;
  };

  readonly #completed = (details: chrome.webRequest.OnCompletedDetails): void => {
    this.#requests.delete(details.requestId);
  };

  readonly #errored = (details: chrome.webRequest.OnErrorOccurredDetails): void => {
    this.#requests.delete(details.requestId);
  };

  async #persist(
    request: PendingRequest,
    source: "NETWORK_REQUEST" | "NETWORK_HEADER"
  ): Promise<void> {
    const sessionId = await liveSessionIdForTab(request.tabId);
    if (!sessionId) return;
    const session = await getSession(sessionId);
    if (!session || session.status !== "running" || session.tabId !== request.tabId) return;
    const sourcePageUrl = request.sourcePageUrl ?? session.startUrl;
    try {
      if (new URL(sourcePageUrl).origin !== session.origin) return;
    } catch {
      return;
    }
    const settings = await getSettings();
    let candidate;
    try {
      candidate = createFileCandidate({
        url: request.url,
        source,
        sourcePageUrl,
        tabId: request.tabId,
        requestId: request.requestId,
        requestType: request.type,
        ...(request.finalUrl ? { finalUrl: request.finalUrl } : {}),
        ...(request.mimeType ? { mimeType: request.mimeType } : {}),
        ...(request.contentLength !== undefined ? { contentLength: request.contentLength } : {}),
        ...(request.contentDisposition ? { contentDisposition: request.contentDisposition } : {}),
        ...(request.etag ? { etag: request.etag } : {}),
        ...(request.lastModified ? { lastModified: request.lastModified } : {}),
        ...(request.acceptRanges ? { acceptRanges: request.acceptRanges } : {}),
        customExtensions: settings.customExtensions,
        customMimeTypes: settings.customMimeTypes
      });
    } catch {
      return;
    }
    if (!shouldIncludeCandidate(candidate, settings)) return;
    const [stored] = await putFiles(sessionId, [candidate]);
    if (!stored) return;
    broadcast({ type: "FILES_DISCOVERED", payload: { sessionId, files: [stored] } });
    await patchSession(sessionId, { filesDiscovered: (await listFiles(sessionId)).length });
  }
}
