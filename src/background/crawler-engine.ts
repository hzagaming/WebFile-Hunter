import { createFileCandidate, shouldIncludeCandidate } from "@/core/candidate-factory";
import { extractLinksFromHtml } from "@/core/html-link-extractor";
import { isHtmlMime } from "@/core/mime-map";
import { inspectUrlSafety } from "@/core/url-security";
import { redactUrlForLog } from "@/core/url-normalizer";
import {
  deleteCheckpoint,
  getCheckpoint,
  getSession,
  listFiles,
  putAppError,
  putFiles
} from "@/database/db";
import { getSettings } from "@/database/settings";
import { createId } from "@/utils/id";
import { broadcast } from "./broadcast";
import { CrawlerQueue } from "./crawler-queue";
import { persistCrawlerCheckpoint } from "./checkpoint-manager";
import { probeUrlMetadata, readLimitedText, safeFetch } from "./metadata-probe";
import type { SafeFetchOptions } from "./metadata-probe";
import { OriginRateLimiter } from "./rate-limiter";
import { hasOriginPermission } from "./permission-manager";
import { parseRobotsTxt, type RobotsRules } from "./robots-parser";
import { finishSession, patchSession } from "./session-manager";
import type { CrawlQueueItem, ScanProgress, ScanSession } from "@/types/models";

interface ActiveCrawl {
  controller: AbortController;
  limiter: OriginRateLimiter;
  queue?: CrawlerQueue;
  visited?: Set<string>;
  inFlight: CrawlQueueItem[];
  currentUrl?: string;
  requestTimes: number[];
  progress: ScanProgress;
}

const activeCrawls = new Map<string, ActiveCrawl>();
const resumingCrawls = new Set<string>();

function recentRequestCount(active: ActiveCrawl, now = Date.now()): number {
  while (active.requestTimes[0] !== undefined && active.requestTimes[0] < now - 60_000) {
    active.requestTimes.shift();
  }
  return active.requestTimes.length;
}

function crawlerFetchOptions(session: ScanSession, active: ActiveCrawl): SafeFetchOptions {
  return {
    origin: session.origin,
    config: session.config,
    signal: active.controller.signal,
    onRequestStart: (url) => {
      const now = Date.now();
      active.currentUrl = url;
      active.requestTimes.push(now);
      active.progress = {
        ...active.progress,
        currentUrl: url,
        requestsPerMinute: recentRequestCount(active, now)
      };
      broadcast({ type: "SCAN_PROGRESS", payload: active.progress });
    }
  };
}

async function failCrawler(sessionId: string, error: unknown, fallback: string): Promise<void> {
  await finishSession(sessionId, "failed");
  await patchSession(sessionId, {
    errorMessage: error instanceof Error ? error.message : fallback
  });
}

async function loadRobots(session: ScanSession, active: ActiveCrawl): Promise<RobotsRules> {
  if (!session.config.respectRobots) return parseRobotsTxt("");
  const response = await active.limiter.run(
    () =>
      safeFetch(
        `${session.origin}/robots.txt`,
        { method: "GET" },
        crawlerFetchOptions(session, active)
      ),
    active.controller.signal
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return parseRobotsTxt("");
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new TypeError("网站拒绝读取 robots.txt，递归扫描已停止。");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new TypeError(`robots.txt 请求失败（HTTP ${response.status}），为安全起见已停止。`);
  }
  const text = await readLimitedText(response, 512 * 1024);
  const rules = parseRobotsTxt(text);
  if (rules.crawlDelayMs && rules.crawlDelayMs > session.config.minDelayMs) {
    active.limiter = new OriginRateLimiter(session.config.maxConcurrency, rules.crawlDelayMs);
  }
  return rules;
}

async function recordCandidates(
  session: ScanSession,
  pageUrl: string,
  pageTitle: string,
  resources: ReturnType<typeof extractLinksFromHtml>["resources"],
  active: ActiveCrawl
): Promise<void> {
  const settings = await getSettings();
  const candidates = [];
  for (const resource of resources) {
    let metadata;
    if (session.config.probeMetadata && !resource.isExternal) {
      try {
        metadata = await active.limiter.run(
          () =>
            probeUrlMetadata(resource.url, {
              ...crawlerFetchOptions(session, active)
            }),
          active.controller.signal
        );
      } catch {
        metadata = undefined;
      }
    }
    try {
      const candidate = createFileCandidate({
        url: resource.url,
        source: "CRAWLED_PAGE",
        sourcePageUrl: pageUrl,
        sourcePageTitle: pageTitle,
        parentUrl: pageUrl,
        ...(resource.tagName ? { tagName: resource.tagName } : {}),
        ...(resource.hasDownload ? { hasDownload: true } : {}),
        ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
        ...(metadata?.finalUrl ? { finalUrl: metadata.finalUrl } : {}),
        ...(metadata?.mimeType ? { mimeType: metadata.mimeType } : {}),
        ...(metadata?.contentLength !== undefined ? { contentLength: metadata.contentLength } : {}),
        ...(metadata?.contentDisposition
          ? { contentDisposition: metadata.contentDisposition }
          : {}),
        ...(metadata?.etag ? { etag: metadata.etag } : {}),
        ...(metadata?.lastModified ? { lastModified: metadata.lastModified } : {}),
        ...(metadata?.acceptRanges ? { acceptRanges: metadata.acceptRanges } : {}),
        customExtensions: settings.customExtensions,
        customMimeTypes: settings.customMimeTypes
      });
      if (shouldIncludeCandidate(candidate, settings)) candidates.push(candidate);
    } catch {
      // URL 已在统一校验层被拒绝。
    }
  }
  const stored = await putFiles(session.id, candidates);
  if (stored.length)
    broadcast({ type: "FILES_DISCOVERED", payload: { sessionId: session.id, files: stored } });
}

async function processPage(
  session: ScanSession,
  item: CrawlQueueItem,
  queue: CrawlerQueue,
  robots: RobotsRules,
  active: ActiveCrawl
): Promise<void> {
  const safety = inspectUrlSafety(item.url, {
    allowedOrigin: session.origin,
    excludeDangerousActions: session.config.excludeDangerousActions
  });
  if (!safety.safe) throw new TypeError(safety.message);
  if (!robots.isAllowed(item.url)) throw new TypeError("robots.txt 禁止访问该页面。");

  const metadata = await active.limiter.run(
    () =>
      probeUrlMetadata(item.url, {
        ...crawlerFetchOptions(session, active)
      }),
    active.controller.signal
  );
  if (!isHtmlMime(metadata.mimeType)) {
    const settings = await getSettings();
    const candidate = createFileCandidate({
      url: item.url,
      finalUrl: metadata.finalUrl,
      source: "CRAWLED_PAGE",
      sourcePageUrl: item.parentUrl ?? session.startUrl,
      parentUrl: item.parentUrl ?? session.startUrl,
      ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
      ...(metadata.contentLength !== undefined ? { contentLength: metadata.contentLength } : {}),
      ...(metadata.contentDisposition ? { contentDisposition: metadata.contentDisposition } : {}),
      customExtensions: settings.customExtensions,
      customMimeTypes: settings.customMimeTypes
    });
    if (!shouldIncludeCandidate(candidate, settings)) return;
    const stored = await putFiles(session.id, [candidate]);
    broadcast({ type: "FILES_DISCOVERED", payload: { sessionId: session.id, files: stored } });
    return;
  }

  const response = await active.limiter.run(
    () => safeFetch(item.url, { method: "GET" }, crawlerFetchOptions(session, active)),
    active.controller.signal
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new TypeError(`页面请求失败（HTTP ${response.status}）。`);
  }
  const html = await readLimitedText(response, session.config.maxHtmlBytes);
  const finalUrl = response.url || item.url;
  const extracted = extractLinksFromHtml(html, finalUrl);
  await recordCandidates(session, finalUrl, extracted.title, extracted.resources, active);
  if (!extracted.noFollow && item.depth < session.config.maxDepth) {
    for (const page of extracted.pages) {
      if (page.noFollow) continue;
      const pageSafety = inspectUrlSafety(page.url, {
        allowedOrigin: session.origin,
        excludeDangerousActions: session.config.excludeDangerousActions
      });
      if (pageSafety.safe && robots.isAllowed(page.url)) {
        queue.enqueue({
          url: page.url,
          depth: item.depth + 1,
          parentUrl: finalUrl,
          discoveredAt: Date.now()
        });
      }
    }
  }
}

async function run(
  session: ScanSession,
  restored?: { queue: CrawlerQueue; visited: Set<string> }
): Promise<void> {
  const controller = new AbortController();
  const active: ActiveCrawl = {
    controller,
    limiter: new OriginRateLimiter(session.config.maxConcurrency, session.config.minDelayMs),
    inFlight: [],
    requestTimes: [],
    progress: {
      sessionId: session.id,
      status: session.status,
      pagesQueued: session.pagesQueued,
      pagesProcessed: session.pagesProcessed,
      filesDiscovered: session.filesDiscovered,
      errors: session.errors
    }
  };
  activeCrawls.set(session.id, active);
  const queue =
    restored?.queue ?? new CrawlerQueue(session.config.maxDepth, session.config.maxPages);
  const visited = restored?.visited ?? new Set<string>();
  active.queue = queue;
  active.visited = visited;
  if (!restored)
    queue.enqueue({ url: session.startUrl, depth: 0, parentUrl: null, discoveredAt: Date.now() });
  let processed = visited.size;
  let errors = session.errors;
  let lastCheckpoint = Date.now();
  try {
    await persistCrawlerCheckpoint(session.id, queue.snapshot().items, visited);
    const robots = await loadRobots(session, active);
    while (queue.size && !controller.signal.aborted) {
      const batch: CrawlQueueItem[] = [];
      while (batch.length < session.config.maxConcurrency) {
        const item = queue.dequeue();
        if (!item) break;
        if (!visited.has(item.url)) batch.push(item);
      }
      if (!batch.length) break;
      active.inFlight = batch;
      await Promise.all(
        batch.map(async (item) => {
          try {
            await processPage(session, item, queue, robots, active);
          } catch (error) {
            if (controller.signal.aborted) return;
            errors += 1;
            await putAppError({
              id: createId("error"),
              sessionId: session.id,
              code: error instanceof RangeError ? "CONTENT_TOO_LARGE" : "UNKNOWN_ERROR",
              message: error instanceof Error ? error.message : "页面处理失败。",
              url: redactUrlForLog(item.url),
              createdAt: Date.now()
            });
          } finally {
            if (!controller.signal.aborted) {
              visited.add(item.url);
              processed += 1;
            }
          }
        })
      );
      active.inFlight = [];
      if (controller.signal.aborted) break;
      const fileCount = (await listFiles(session.id)).length;
      const progressPatch = {
        pagesProcessed: processed,
        pagesQueued: processed + queue.size,
        filesDiscovered: fileCount,
        errors,
        ...(active.currentUrl ? { currentUrl: active.currentUrl } : {}),
        requestsPerMinute: recentRequestCount(active),
        ...(processed % 10 === 0 || Date.now() - lastCheckpoint >= 5000
          ? { lastCheckpointAt: Date.now() }
          : {})
      };
      active.progress = { ...active.progress, ...progressPatch };
      await patchSession(session.id, progressPatch);
      if (processed % 10 === 0 || Date.now() - lastCheckpoint >= 5000) {
        const snapshot = queue.snapshot();
        await persistCrawlerCheckpoint(session.id, snapshot.items, visited);
        lastCheckpoint = Date.now();
      }
    }
    if (!controller.signal.aborted) {
      await deleteCheckpoint(session.id);
      await finishSession(session.id, "completed");
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      await failCrawler(session.id, error, "递归扫描失败。");
    }
  } finally {
    activeCrawls.delete(session.id);
  }
}

export function startCrawler(session: ScanSession): void {
  void run(session);
}

export async function pauseCrawler(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  const active = activeCrawls.get(sessionId);
  if (!session || session.mode !== "recursive_crawl" || session.status !== "running" || !active) {
    throw new TypeError("仅可暂停当前正在运行的递归任务。");
  }
  active.controller.abort();
  active.limiter.cancel();
  try {
    if (active.queue && active.visited) {
      const queued = active.queue.snapshot().items;
      const pending = [
        ...active.inFlight.filter((item) => !active.visited?.has(item.url)),
        ...queued
      ];
      await persistCrawlerCheckpoint(sessionId, pending, active.visited);
    }
    await patchSession(sessionId, { status: "paused" });
  } catch (error) {
    await failCrawler(sessionId, error, "暂停递归任务时无法保存检查点。");
    throw error;
  }
}

export async function resumeCrawler(sessionId: string): Promise<void> {
  if (resumingCrawls.has(sessionId) || activeCrawls.has(sessionId)) {
    throw new TypeError("递归任务正在恢复或运行中。");
  }
  resumingCrawls.add(sessionId);
  try {
    const session = await getSession(sessionId);
    if (!session || session.mode !== "recursive_crawl" || session.status !== "paused") {
      throw new TypeError("仅可恢复已暂停的递归任务。");
    }
    const checkpoint = await getCheckpoint(sessionId);
    if (!checkpoint) throw new TypeError("没有可恢复的递归任务检查点。");
    if (!(await hasOriginPermission(session.startUrl))) {
      throw new TypeError("当前网站权限已被撤销，无法恢复递归任务。");
    }
    const queue = new CrawlerQueue(
      session.config.maxDepth,
      session.config.maxPages,
      checkpoint.queue.sort((a, b) => a.order - b.order),
      [...checkpoint.visitedUrls, ...checkpoint.queue.map((item) => item.url)]
    );
    const updated = await patchSession(sessionId, { status: "running" });
    void run(updated, { queue, visited: new Set(checkpoint.visitedUrls) });
  } finally {
    resumingCrawls.delete(sessionId);
  }
}

export async function cancelCrawler(sessionId: string): Promise<void> {
  const active = activeCrawls.get(sessionId);
  active?.controller.abort();
  active?.limiter.cancel();
  await deleteCheckpoint(sessionId);
  await finishSession(sessionId, "cancelled");
}

export function cancelCrawlsForOrigin(origin: string): void {
  void (async () => {
    for (const session of await Promise.all([...activeCrawls.keys()].map(getSession))) {
      if (session?.origin === origin) await cancelCrawler(session.id);
    }
  })();
}
