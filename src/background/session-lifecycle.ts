import {
  clearHistoryData,
  deleteSessionData,
  getCheckpoint,
  getSession,
  listSessions
} from "@/database/db";
import type { ScanSession, ScanStatus } from "@/types/models";
import { cancelCrawler } from "./crawler-engine";
import { injectPageScanner } from "./page-scanner";
import { hasOriginPermission, originPattern } from "./permission-manager";
import { finishSession, liveSessionIdForTab, patchSession } from "./session-manager";

interface LiveTabChange {
  status?: string;
  url?: string;
}

export async function stopLiveMonitor(
  session: ScanSession,
  status: ScanStatus = "cancelled"
): Promise<void> {
  await chrome.tabs
    .sendMessage(session.tabId, { type: "STOP_CONTENT_MONITOR" })
    .catch(() => undefined);
  await chrome.alarms.clear(`monitor:${session.id}`);
  await finishSession(session.id, status);
}

export async function stopScanSession(session: ScanSession): Promise<void> {
  if (!["running", "paused"].includes(session.status)) return;
  if (session.mode === "recursive_crawl") await cancelCrawler(session.id);
  else if (session.mode === "live_monitor") await stopLiveMonitor(session);
  else {
    await chrome.alarms.clear(`scan:${session.id}`);
    await finishSession(session.id, "cancelled");
  }
}

export async function failScanSessionStart(session: ScanSession, error: unknown): Promise<void> {
  if (session.mode === "live_monitor") {
    await chrome.tabs
      .sendMessage(session.tabId, { type: "STOP_CONTENT_MONITOR" })
      .catch(() => undefined);
    await chrome.alarms.clear(`monitor:${session.id}`);
  } else if (session.mode === "current_page") {
    await chrome.alarms.clear(`scan:${session.id}`);
  }
  await finishSession(session.id, "failed");
  await patchSession(session.id, {
    errorMessage: error instanceof Error ? error.message : "扫描任务启动失败。"
  });
}

export async function handleLiveTabUpdated(
  tabId: number,
  changeInfo: LiveTabChange
): Promise<void> {
  const sessionId = await liveSessionIdForTab(tabId);
  if (!sessionId) return;
  const session = await getSession(sessionId);
  if (!session || session.mode !== "live_monitor" || session.status !== "running") return;

  const rawUrl =
    changeInfo.url ??
    (changeInfo.status === "complete" ? (await chrome.tabs.get(tabId)).url : undefined);
  if (!rawUrl) return;

  let next: URL;
  try {
    next = new URL(rawUrl);
  } catch {
    await stopLiveMonitor(session);
    return;
  }
  if (next.origin !== session.origin) {
    await stopLiveMonitor(session);
    return;
  }
  if (changeInfo.url && next.href !== session.startUrl) {
    await patchSession(session.id, { startUrl: next.href });
  }
  if (changeInfo.status !== "complete") return;
  if (!(await hasOriginPermission(next.href))) {
    await stopLiveMonitor(session);
    return;
  }

  const alarm = await chrome.alarms.get(`monitor:${session.id}`);
  const remainingMs = alarm ? Math.max(0, alarm.scheduledTime - Date.now()) : 0;
  if (!remainingMs) {
    await stopLiveMonitor(session, "completed");
    return;
  }
  try {
    await injectPageScanner(session.id, session.tabId);
    await chrome.tabs.sendMessage(session.tabId, {
      type: "START_CONTENT_MONITOR",
      payload: { durationMs: remainingMs }
    });
  } catch {
    await stopLiveMonitor(session);
  }
}

export async function stopSessionsForRemovedOrigins(origins: readonly string[]): Promise<void> {
  const removed = new Set(origins);
  for (const session of await listSessions()) {
    if (removed.has(originPattern(session.startUrl))) await stopScanSession(session);
  }
}

export async function stopSessionsForTab(tabId: number): Promise<void> {
  for (const session of await listSessions()) {
    if (session.tabId === tabId) await stopScanSession(session);
  }
}

export async function reconcileInterruptedSessions(): Promise<void> {
  for (const session of await listSessions()) {
    if (session.mode !== "recursive_crawl" || session.status !== "running") continue;
    const checkpoint = await getCheckpoint(session.id);
    await patchSession(
      session.id,
      checkpoint
        ? { status: "paused" }
        : {
            status: "failed",
            completedAt: Date.now(),
            errorMessage: "后台已重启，且任务没有可恢复的检查点。"
          }
    );
  }
}

export async function deleteScanSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (session) await stopScanSession(session);
  await deleteSessionData(sessionId);
}

export async function clearScanHistory(): Promise<void> {
  for (const session of await listSessions()) await stopScanSession(session);
  await clearHistoryData();
}
