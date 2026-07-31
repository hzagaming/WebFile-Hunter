import { createFileCandidate, shouldIncludeCandidate } from "@/core/candidate-factory";
import { looksLikeFileUrl } from "@/core/file-classifier";
import { putFiles, getSession, listFiles } from "@/database/db";
import { getSettings } from "@/database/settings";
import { broadcast } from "./broadcast";
import { finishSession, patchSession } from "./session-manager";
import type { PageScanResult, RawResource } from "@/types/scanner";

const RESOURCE_TAGS = new Set([
  "audio",
  "video",
  "source",
  "track",
  "embed",
  "object",
  "img",
  "link",
  "script",
  "input"
]);
const LATE_FRAME_WINDOW_MS = 30_000;

export function shouldKeepPageResource(resource: RawResource): boolean {
  return (
    looksLikeFileUrl(resource.url) ||
    Boolean(resource.mimeType) ||
    Boolean(resource.hasDownload) ||
    resource.source === "PERFORMANCE_ENTRY" ||
    RESOURCE_TAGS.has(resource.tagName ?? "")
  );
}

export async function injectPageScanner(sessionId: string, tabId: number): Promise<void> {
  const settings = await getSettings();
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "ISOLATED",
    func: (id: string, options: { includeStylesheets: boolean; includeImages: boolean }) => {
      const scope = globalThis as typeof globalThis & {
        __webFileHunterInjectedSessionId?: string;
        __webFileHunterInjectedOptions?: { includeStylesheets: boolean; includeImages: boolean };
      };
      scope.__webFileHunterInjectedSessionId = id;
      scope.__webFileHunterInjectedOptions = options;
    },
    args: [
      sessionId,
      { includeStylesheets: settings.scanStylesheets, includeImages: settings.scanImages }
    ]
  });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "ISOLATED",
    files: ["content-script.js"]
  });
}

export async function handlePageScanResult(
  sessionId: string,
  result: PageScanResult,
  sender: chrome.runtime.MessageSender,
  liveBatch: boolean
): Promise<number> {
  const session = await getSession(sessionId);
  const lateFrameAge =
    session?.completedAt === undefined ? undefined : Date.now() - session.completedAt;
  const acceptsLateFrame =
    session?.mode === "current_page" &&
    session.status === "completed" &&
    lateFrameAge !== undefined &&
    lateFrameAge >= 0 &&
    lateFrameAge <= LATE_FRAME_WINDOW_MS;
  if (!session || (session.status !== "running" && !acceptsLateFrame))
    throw new TypeError("扫描任务无效或已经停止。");
  if (sender.tab?.id !== session.tabId) throw new TypeError("页面扫描结果来自错误的标签页。");
  let pageUrl: URL;
  try {
    pageUrl = new URL(result.pageUrl);
  } catch {
    throw new TypeError("页面扫描结果包含无效页面地址。");
  }
  if (!["http:", "https:"].includes(pageUrl.protocol))
    throw new TypeError("页面扫描结果协议无效。");
  if (pageUrl.origin !== session.origin)
    throw new TypeError("页面扫描结果 origin 与扫描任务不一致。");

  const settings = await getSettings();
  const candidates = result.resources.filter(shouldKeepPageResource).flatMap((resource) => {
    try {
      const candidate = createFileCandidate({
        url: resource.url,
        source: resource.source,
        sourcePageUrl: result.pageUrl,
        sourcePageTitle: result.title,
        tabId: session.tabId,
        ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
        ...(resource.tagName ? { tagName: resource.tagName } : {}),
        ...(resource.hasDownload ? { hasDownload: true } : {}),
        customExtensions: settings.customExtensions,
        customMimeTypes: settings.customMimeTypes
      });
      return shouldIncludeCandidate(candidate, settings) ? [candidate] : [];
    } catch {
      return [];
    }
  });
  const stored = await putFiles(sessionId, candidates);
  if (stored.length) broadcast({ type: "FILES_DISCOVERED", payload: { sessionId, files: stored } });
  const current = await getSession(sessionId);
  if (current) {
    await patchSession(sessionId, {
      pagesProcessed: liveBatch ? current.pagesProcessed : current.pagesProcessed + 1,
      filesDiscovered: (await listFiles(sessionId)).length
    });
    if (current.mode === "current_page" && current.status === "running") {
      await chrome.alarms.clear(`scan:${sessionId}`);
      await finishSession(sessionId, "completed");
    }
  }
  return stored.length;
}
