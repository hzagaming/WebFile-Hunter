import { putSession, getSession, listSessions } from "@/database/db";
import { broadcast } from "./broadcast";
import { createId } from "@/utils/id";
import { DEFAULT_SCAN_CONFIG } from "@/utils/defaults";
import type { ScanConfig, ScanMode, ScanSession, ScanStatus } from "@/types/models";

const ACTIVE_BY_TAB_KEY = "activeSessionByTab";
const LIVE_BY_TAB_KEY = "liveSessionByTab";

async function mapFromSessionStorage(key: string): Promise<Record<string, string>> {
  const result = await chrome.storage.session.get(key);
  return (result[key] as Record<string, string> | undefined) ?? {};
}

async function setMapValue(key: string, tabId: number, sessionId?: string): Promise<void> {
  const current = await mapFromSessionStorage(key);
  if (sessionId) current[String(tabId)] = sessionId;
  else delete current[String(tabId)];
  await chrome.storage.session.set({ [key]: current });
}

export async function activeSessionIdForTab(tabId: number): Promise<string | undefined> {
  return (await mapFromSessionStorage(ACTIVE_BY_TAB_KEY))[String(tabId)];
}

export async function liveSessionIdForTab(tabId: number): Promise<string | undefined> {
  return (await mapFromSessionStorage(LIVE_BY_TAB_KEY))[String(tabId)];
}

export async function createSession(
  tab: chrome.tabs.Tab,
  mode: ScanMode,
  config: ScanConfig = DEFAULT_SCAN_CONFIG
): Promise<ScanSession> {
  if (tab.id === undefined || !tab.url) throw new TypeError("无法读取当前标签页。");
  const url = new URL(tab.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("仅支持 HTTP 或 HTTPS 网页。");
  }
  const now = Date.now();
  const session: ScanSession = {
    id: createId("session"),
    mode,
    status: "running",
    tabId: tab.id,
    startUrl: url.href,
    origin: url.origin,
    createdAt: now,
    startedAt: now,
    pagesQueued: mode === "recursive_crawl" ? 1 : 0,
    pagesProcessed: 0,
    filesDiscovered: 0,
    errors: 0,
    config
  };
  await putSession(session);
  await setMapValue(ACTIVE_BY_TAB_KEY, tab.id, session.id);
  if (mode === "live_monitor") await setMapValue(LIVE_BY_TAB_KEY, tab.id, session.id);
  broadcast({ type: "SESSION_UPDATED", payload: session });
  return session;
}

export async function patchSession(
  sessionId: string,
  patch: Partial<Omit<ScanSession, "id" | "config">>
): Promise<ScanSession> {
  const session = await getSession(sessionId);
  if (!session) throw new TypeError("扫描任务不存在或已被删除。");
  const updated: ScanSession = { ...session, ...patch };
  await putSession(updated);
  broadcast({ type: "SESSION_UPDATED", payload: updated });
  broadcast({
    type: "SCAN_PROGRESS",
    payload: {
      sessionId: updated.id,
      status: updated.status,
      pagesQueued: updated.pagesQueued,
      pagesProcessed: updated.pagesProcessed,
      filesDiscovered: updated.filesDiscovered,
      errors: updated.errors
    }
  });
  return updated;
}

export async function finishSession(sessionId: string, status: ScanStatus): Promise<ScanSession> {
  const updated = await patchSession(sessionId, { status, completedAt: Date.now() });
  await setMapValue(ACTIVE_BY_TAB_KEY, updated.tabId);
  if (updated.mode === "live_monitor") await setMapValue(LIVE_BY_TAB_KEY, updated.tabId);
  return updated;
}

export async function incompleteSessions(): Promise<ScanSession[]> {
  return (await listSessions()).filter(
    (session) =>
      session.mode === "recursive_crawl" && ["running", "paused"].includes(session.status)
  );
}

export async function clearRuntimeSessionState(): Promise<void> {
  await chrome.storage.session.remove([ACTIVE_BY_TAB_KEY, LIVE_BY_TAB_KEY]);
}
