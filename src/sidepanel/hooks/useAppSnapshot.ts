import { useCallback, useEffect, useRef, useState } from "react";
import { sendMessage, subscribeEvents } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import type { AppSettings, DownloadTask, ScanStatus } from "@/types/models";

const TERMINAL_SCAN_STATUSES: readonly ScanStatus[] = ["completed", "cancelled", "failed"];

function isTerminalStatus(status: ScanStatus): boolean {
  return TERMINAL_SCAN_STATUSES.includes(status);
}

export function useAppSnapshot() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async (sessionId?: string) => {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const tabId = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      const payload = {
        ...(sessionId ? { sessionId } : {}),
        ...(tabId !== undefined ? { tabId } : {})
      };
      const next = await sendMessage<AppSnapshot>({
        type: "GET_SNAPSHOT",
        ...(Object.keys(payload).length ? { payload } : {})
      });
      if (generation !== refreshGeneration.current) return;
      setSnapshot(next);
      setError(undefined);
    } catch (value) {
      if (generation !== refreshGeneration.current) return;
      setError(value instanceof Error ? value.message : "无法读取扩展状态。");
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, []);

  const updateDownloads = useCallback((downloads: DownloadTask[]) => {
    setSnapshot((current) => (current ? { ...current, downloads } : current));
  }, []);

  const updateSettings = useCallback((settings: AppSettings) => {
    setSnapshot((current) => (current ? { ...current, settings } : current));
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeEvents((event) => {
      if (event.type === "ACTIVE_CONTEXT_CHANGED") {
        void refresh();
        return;
      }
      if (event.type === "APP_ERROR") {
        setError(event.payload.message);
        return;
      }
      setSnapshot((current) => {
        if (!current) return current;
        if (event.type === "DOWNLOADS_UPDATED") return { ...current, downloads: event.payload };
        if (event.type === "SCAN_PROGRESS") {
          const { sessionId, ...progress } = event.payload;
          const mergeProgress = (session: (typeof current.sessions)[number]) =>
            session.id !== sessionId ||
            (isTerminalStatus(session.status) && !isTerminalStatus(progress.status))
              ? session
              : { ...session, ...progress };
          return {
            ...current,
            sessions: current.sessions.map(mergeProgress),
            incompleteSessions: current.incompleteSessions
              .map(mergeProgress)
              .filter(
                (session) =>
                  session.mode === "recursive_crawl" &&
                  ["running", "paused"].includes(session.status)
              ),
            ...(current.activeSession?.id === sessionId
              ? { activeSession: mergeProgress(current.activeSession) }
              : {})
          };
        }
        if (event.type === "SESSION_UPDATED") {
          const knownSession =
            current.sessions.find((session) => session.id === event.payload.id) ??
            (current.activeSession?.id === event.payload.id ? current.activeSession : undefined);
          if (
            knownSession &&
            isTerminalStatus(knownSession.status) &&
            !isTerminalStatus(event.payload.status)
          ) {
            return current;
          }
          const sessions = current.sessions.some((session) => session.id === event.payload.id)
            ? current.sessions.map((session) =>
                session.id === event.payload.id ? event.payload : session
              )
            : [event.payload, ...current.sessions];
          const belongsToActiveContext =
            !current.activeSession &&
            current.activeTab?.id === event.payload.tabId &&
            current.activeTab.origin === event.payload.origin;
          const remainsIncomplete =
            event.payload.mode === "recursive_crawl" &&
            ["running", "paused"].includes(event.payload.status);
          const incompleteSessions = remainsIncomplete
            ? current.incompleteSessions.some((session) => session.id === event.payload.id)
              ? current.incompleteSessions.map((session) =>
                  session.id === event.payload.id ? event.payload : session
                )
              : [event.payload, ...current.incompleteSessions]
            : current.incompleteSessions.filter((session) => session.id !== event.payload.id);
          return {
            ...current,
            sessions,
            incompleteSessions,
            ...(current.activeSession?.id === event.payload.id || belongsToActiveContext
              ? { activeSession: event.payload }
              : {})
          };
        }
        if (
          event.type === "FILES_DISCOVERED" &&
          current.activeSession?.id === event.payload.sessionId
        ) {
          const files = new Map(current.files.map((file) => [file.id, file]));
          event.payload.files.forEach((file) => files.set(file.id, file));
          return { ...current, files: [...files.values()] };
        }
        return current;
      });
    });
    return () => {
      refreshGeneration.current += 1;
      clearTimeout(initialLoad);
      unsubscribe();
    };
  }, [refresh]);

  return {
    snapshot,
    setSnapshot,
    loading,
    error,
    setError,
    refresh,
    updateDownloads,
    updateSettings
  };
}
