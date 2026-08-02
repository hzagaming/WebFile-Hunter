import { inspectUrlSafety } from "@/core/url-security";
import { getRetryDecision } from "./retry-policy";
import type { ScanConfig } from "@/types/models";

class NonRetryableProbeError extends Error {}

export interface ResourceMetadata {
  originalUrl: string;
  finalUrl: string;
  status: number;
  mimeType?: string;
  contentLength?: number;
  contentDisposition?: string;
  etag?: string;
  lastModified?: string;
  acceptRanges?: string;
}

export interface SafeFetchOptions {
  origin: string;
  config: ScanConfig;
  signal: AbortSignal;
  onRequestStart?: (url: string) => void;
}

export interface ReadLimitedTextOptions {
  decompressGzip?: boolean;
}

function combineSignals(
  signal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new DOMException("请求超时", "TimeoutError")),
    timeoutMs
  );
  const combined = AbortSignal.any([signal, timeoutController.signal]);
  return { signal: combined, cleanup: () => clearTimeout(timeout) };
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("任务已取消", "AbortError"));
  return new Promise((resolve, reject) => {
    const complete = (): void => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(complete, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("任务已取消", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit,
  options: SafeFetchOptions
): Promise<Response> {
  let currentUrl = rawUrl;
  for (let redirects = 0; ; redirects += 1) {
    const safety = inspectUrlSafety(currentUrl, {
      allowedOrigin: options.origin,
      excludeDangerousActions: options.config.excludeDangerousActions
    });
    if (!safety.safe) throw new NonRetryableProbeError(safety.message);
    const timed = combineSignals(options.signal, options.config.requestTimeoutMs);
    let response: Response;
    try {
      options.onRequestStart?.(currentUrl);
      response = await fetch(currentUrl, {
        ...init,
        method: init.method === "HEAD" ? "HEAD" : "GET",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: timed.signal
      });
    } finally {
      timed.cleanup();
    }
    if (response.status < 300 || response.status >= 400) return response;
    if (!options.config.followRedirects) return response;
    if (redirects >= options.config.maxRedirects) {
      await response.body?.cancel();
      throw new NonRetryableProbeError("重定向次数超过安全上限。");
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new NonRetryableProbeError("服务器返回重定向但未提供 Location。");
    currentUrl = new URL(location, currentUrl).href;
  }
}

export async function fetchWithRetries(
  url: string,
  init: RequestInit,
  options: SafeFetchOptions
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.config.retries; attempt += 1) {
    try {
      const response = await safeFetch(url, init, options);
      if (response.ok) return response;
      const retryAfter = response.headers.get("retry-after");
      const decision = getRetryDecision({
        attempt,
        status: response.status,
        ...(retryAfter ? { retryAfter } : {}),
        now: Date.now(),
        maxRetries: options.config.retries
      });
      if (!decision.retry) return response;
      await response.body?.cancel();
      await abortableDelay(decision.delayMs, options.signal);
    } catch (error) {
      if (options.signal.aborted || error instanceof NonRetryableProbeError) throw error;
      lastError = error;
      const decision = getRetryDecision({
        attempt,
        networkError: true,
        now: Date.now(),
        maxRetries: options.config.retries
      });
      if (!decision.retry) break;
      await abortableDelay(decision.delayMs, options.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new TypeError("请求重试失败。");
}

export function metadataFromResponse(originalUrl: string, response: Response): ResourceMetadata {
  const lengthHeader = response.headers.get("content-length");
  const length = lengthHeader === null ? undefined : Number(lengthHeader);
  const mimeType = response.headers.get("content-type");
  const contentDisposition = response.headers.get("content-disposition");
  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  const acceptRanges = response.headers.get("accept-ranges");
  return {
    originalUrl,
    finalUrl: response.url || originalUrl,
    status: response.status,
    ...(mimeType ? { mimeType } : {}),
    ...(length !== undefined && Number.isSafeInteger(length) && length >= 0
      ? { contentLength: length }
      : {}),
    ...(contentDisposition ? { contentDisposition } : {}),
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(acceptRanges ? { acceptRanges } : {})
  };
}

export async function probeUrlMetadata(
  url: string,
  options: SafeFetchOptions
): Promise<ResourceMetadata> {
  let response = await fetchWithRetries(url, { method: "HEAD" }, options);
  if (response.status === 405 || response.status === 501) {
    await response.body?.cancel();
    response = await fetchWithRetries(
      url,
      { method: "GET", headers: { Range: "bytes=0-0" } },
      options
    );
  }
  const metadata = metadataFromResponse(url, response);
  await response.body?.cancel();
  if (response.ok) return metadata;
  throw new NonRetryableProbeError(`服务器返回 HTTP ${response.status}。`);
}

function declaredCharset(response: Response): string | undefined {
  return /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i.exec(
    response.headers.get("content-type") ?? ""
  )?.[1];
}

function sniffCharset(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  const head = new TextDecoder("windows-1252").decode(bytes.slice(0, 2048));
  return (
    /<meta\b[^>]*\bcharset\s*=\s*["']?([^\s"'/>;]+)/i.exec(head)?.[1] ??
    /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([^\s"';]+)/i.exec(head)?.[1]
  );
}

function decodeText(bytes: Uint8Array, response: Response): string {
  const charset = declaredCharset(response) ?? sniffCharset(bytes) ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export async function readLimitedText(
  response: Response,
  maxBytes: number,
  options: ReadLimitedTextOptions = {}
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (!options.decompressGzip && Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new RangeError("HTML 页面超过大小限制。");
  }
  let body = response.body;
  if (!body) return "";
  if (options.decompressGzip) {
    try {
      body = body.pipeThrough(new DecompressionStream("gzip"));
    } catch {
      await body.cancel();
      throw new TypeError("无法解压 Sitemap gzip 内容。");
    }
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RangeError("HTML 页面超过大小限制。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeText(merged, response);
}
