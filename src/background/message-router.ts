import { createFileCandidate } from "@/core/candidate-factory";
import { inspectUrlSafety } from "@/core/url-security";
import {
  clearDatabase,
  deleteSessionFiles,
  getFile,
  getSession,
  listFiles,
  listSessions,
  putFiles
} from "@/database/db";
import { getSettings, saveSettings } from "@/database/settings";
import type { AppSnapshot, ExtensionRequest, MessageResponse } from "@/messaging/message-types";
import type { ScanSession } from "@/types/models";
import { validateExtensionRequest } from "@/messaging/message-validation";
import { clampScanConfig } from "@/utils/defaults";
import { broadcast } from "./broadcast";
import { pauseCrawler, resumeCrawler, startCrawler } from "./crawler-engine";
import type { DownloadManager } from "./download-manager";
import { probeUrlMetadata } from "./metadata-probe";
import { handlePageScanResult, injectPageScanner } from "./page-scanner";
import {
  ALL_SITES_ORIGINS,
  getGrantedOrigins,
  hasAllSitesPermission,
  hasOriginPermission,
  revokeAllSitesPermission,
  revokeOrigin
} from "./permission-manager";
import {
  clearScanHistory,
  deleteScanSession,
  failScanSessionStart,
  stopScanSession,
  stopSessionsForRemovedOrigins
} from "./session-lifecycle";
import {
  activeSessionIdForTab,
  createSession,
  incompleteSessions,
  patchSession
} from "./session-manager";

async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || tab.id === undefined) throw new TypeError("无法读取当前标签页。");
  return tab;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function getSnapshotTab(tabId?: number): Promise<chrome.tabs.Tab | undefined> {
  if (tabId === undefined) return getActiveTab();
  return chrome.tabs.get(tabId).catch(() => undefined);
}

export function selectSnapshotSession(
  sessions: readonly ScanSession[],
  activeTab: AppSnapshot["activeTab"],
  sessionId?: string,
  mappedSessionId?: string
): ScanSession | undefined {
  if (sessionId) return sessions.find((session) => session.id === sessionId);
  if (!activeTab) return undefined;
  if (mappedSessionId) {
    const mapped = sessions.find((session) => session.id === mappedSessionId);
    if (mapped?.tabId === activeTab.id && mapped.origin === activeTab.origin) return mapped;
  }
  return sessions.find(
    (session) => session.tabId === activeTab.id && session.origin === activeTab.origin
  );
}

async function snapshot(
  downloads: DownloadManager,
  sessionId?: string,
  tabId?: number
): Promise<AppSnapshot> {
  const tab = await getSnapshotTab(tabId);
  const sessions = await listSessions();
  let activeTab: AppSnapshot["activeTab"];
  if (tab?.id !== undefined && tab.url) {
    try {
      const url = new URL(tab.url);
      activeTab = { id: tab.id, url: tab.url, title: tab.title ?? "", origin: url.origin };
    } catch {
      activeTab = undefined;
    }
  }
  const mappedSessionId =
    !sessionId && activeTab ? await activeSessionIdForTab(activeTab.id) : undefined;
  const activeSession = selectSnapshotSession(sessions, activeTab, sessionId, mappedSessionId);
  const [files, downloadSnapshot, settings, allSitesAccess, grantedOrigins, incomplete] =
    await Promise.all([
      activeSession ? listFiles(activeSession.id) : Promise.resolve([]),
      downloads.getSnapshot(),
      getSettings(),
      hasAllSitesPermission(),
      getGrantedOrigins(),
      incompleteSessions()
    ]);
  return {
    ...(activeTab ? { activeTab } : {}),
    ...(activeSession ? { activeSession } : {}),
    sessions,
    files,
    downloads: downloadSnapshot,
    settings,
    allSitesAccess,
    grantedOrigins,
    incompleteSessions: incomplete
  };
}

export class MessageRouter {
  readonly #downloads: DownloadManager;

  constructor(downloads: DownloadManager) {
    this.#downloads = downloads;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      void this.#dispatch(message, sender)
        .then((data) => sendResponse({ ok: true, data } satisfies MessageResponse))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: {
              code: error instanceof TypeError ? "INVALID_REQUEST" : "UNKNOWN_ERROR",
              message: error instanceof Error ? error.message : "扩展处理请求失败。"
            }
          } satisfies MessageResponse)
        );
      return true;
    });
  }

  async #dispatch(raw: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
    if (sender.id !== chrome.runtime.id) throw new TypeError("拒绝非扩展上下文消息。");
    const parsed = validateExtensionRequest(raw);
    if (!parsed.success) throw new TypeError("消息格式无效或包含未允许的字段。");
    const message = parsed.data as ExtensionRequest;

    switch (message.type) {
      case "GET_ACTIVE_CONTEXT":
        return getActiveTab();
      case "GET_SNAPSHOT":
        return snapshot(this.#downloads, message.payload?.sessionId, message.payload?.tabId);
      case "GET_DOWNLOADS":
        return this.#downloads.getSnapshot();
      case "SCAN_CURRENT_PAGE": {
        const tab = await getTab(message.payload.tabId);
        if (!(await hasOriginPermission(tab.url ?? ""))) {
          throw new TypeError("当前网站权限尚未授予。");
        }
        const session = await createSession(tab, "current_page");
        try {
          await chrome.alarms.create(`scan:${session.id}`, { when: Date.now() + 30_000 });
          await injectPageScanner(session.id, session.tabId);
        } catch (error) {
          await failScanSessionStart(session, error).catch(() => undefined);
          throw error;
        }
        return session;
      }
      case "START_LIVE_MONITOR": {
        const tab = await getTab(message.payload.tabId);
        const tabUrl = new URL(tab.url ?? "");
        if (tabUrl.origin !== message.payload.origin)
          throw new TypeError("标签页 origin 已发生变化，请重试。");
        if (!(await hasAllSitesPermission())) {
          throw new TypeError("完整嗅探需要 HTTP 与 HTTPS 全站可选权限。");
        }
        const settings = await getSettings();
        const session = await createSession(tab, "live_monitor");
        try {
          await injectPageScanner(session.id, session.tabId);
          await chrome.tabs.sendMessage(session.tabId, {
            type: "START_CONTENT_MONITOR",
            payload: { durationMs: settings.monitorDurationSeconds * 1000 }
          });
          await chrome.alarms.create(`monitor:${session.id}`, {
            when: Date.now() + settings.monitorDurationSeconds * 1000
          });
        } catch (error) {
          await failScanSessionStart(session, error).catch(() => undefined);
          throw error;
        }
        return session;
      }
      case "START_RECURSIVE_CRAWL": {
        const tab = await getTab(message.payload.tabId);
        const tabUrl = new URL(tab.url ?? "");
        const safety = inspectUrlSafety(tabUrl.href, { allowedOrigin: tabUrl.origin });
        if (!safety.safe) throw new TypeError(safety.message);
        if (!(await hasOriginPermission(tabUrl.href)))
          throw new TypeError("当前网站权限尚未授予。");
        const session = await createSession(
          tab,
          "recursive_crawl",
          clampScanConfig(message.payload.config)
        );
        startCrawler(session);
        await injectPageScanner(session.id, session.tabId).catch(() => undefined);
        return session;
      }
      case "CONTENT_SCAN_RESULT":
      case "CONTENT_RESOURCE_BATCH": {
        const count = await handlePageScanResult(
          message.payload.sessionId,
          message.payload.result,
          sender,
          message.type === "CONTENT_RESOURCE_BATCH"
        );
        return { count };
      }
      case "STOP_SCAN": {
        const session = await getSession(message.payload.sessionId);
        if (!session) throw new TypeError("扫描任务不存在。");
        await stopScanSession(session);
        return undefined;
      }
      case "PAUSE_SCAN":
        await pauseCrawler(message.payload.sessionId);
        return undefined;
      case "RESUME_SCAN":
        await resumeCrawler(message.payload.sessionId);
        return undefined;
      case "PROBE_METADATA": {
        const session = await getSession(message.payload.sessionId);
        const file = await getFile(message.payload.candidateId);
        if (
          !session ||
          !file ||
          !(await listFiles(session.id)).some((candidate) => candidate.id === file.id)
        ) {
          throw new TypeError("文件或扫描任务无效。");
        }
        const resourceOrigin = new URL(file.canonicalUrl).origin;
        if (resourceOrigin !== session.origin && !(await hasOriginPermission(file.canonicalUrl))) {
          throw new TypeError("第三方资源需要完整嗅探或对应网站权限后才能探测。");
        }
        const controller = new AbortController();
        const metadata = await probeUrlMetadata(file.canonicalUrl, {
          origin: resourceOrigin,
          config: session.config,
          signal: controller.signal
        });
        const enriched = createFileCandidate({
          url: file.canonicalUrl,
          source: "MANUAL_URL",
          sourcePageUrl: file.sourcePageUrl,
          finalUrl: metadata.finalUrl,
          ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
          ...(metadata.contentLength !== undefined
            ? { contentLength: metadata.contentLength }
            : {}),
          ...(metadata.contentDisposition
            ? { contentDisposition: metadata.contentDisposition }
            : {}),
          ...(metadata.etag ? { etag: metadata.etag } : {}),
          ...(metadata.lastModified ? { lastModified: metadata.lastModified } : {}),
          ...(metadata.acceptRanges ? { acceptRanges: metadata.acceptRanges } : {})
        });
        const stored = await putFiles(session.id, [enriched]);
        broadcast({ type: "FILES_DISCOVERED", payload: { sessionId: session.id, files: stored } });
        return stored[0];
      }
      case "DELETE_RESULTS": {
        const session = await getSession(message.payload.sessionId);
        if (!session) throw new TypeError("扫描任务不存在。");
        const filesDiscovered = await deleteSessionFiles(session.id, message.payload.candidateIds);
        await patchSession(session.id, { filesDiscovered });
        return undefined;
      }
      case "QUEUE_DOWNLOADS":
        return this.#downloads.queue(message.payload.candidateIds);
      case "DOWNLOAD_ACTION":
        await this.#downloads.action(message.payload.action, message.payload.taskId);
        return undefined;
      case "DELETE_SESSION":
        await deleteScanSession(message.payload.sessionId);
        return undefined;
      case "CLEAR_HISTORY":
        await clearScanHistory();
        return undefined;
      case "CLEAR_ALL_DATA":
        for (const session of await listSessions()) await stopScanSession(session);
        await this.#downloads.clearAll();
        await clearDatabase();
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        return undefined;
      case "GET_SETTINGS":
        return getSettings();
      case "SAVE_SETTINGS":
        await saveSettings(message.payload.settings);
        return message.payload.settings;
      case "GET_GRANTED_ORIGINS":
        return getGrantedOrigins();
      case "REVOKE_ALL_SITES": {
        const removed = await revokeAllSitesPermission();
        if (removed) await stopSessionsForRemovedOrigins(ALL_SITES_ORIGINS);
        return removed;
      }
      case "REVOKE_ORIGIN": {
        const removed = await revokeOrigin(message.payload.originPattern);
        if (removed) await stopSessionsForRemovedOrigins([message.payload.originPattern]);
        return removed;
      }
    }
  }
}
