import { useCallback, useEffect, useRef, useState } from "react";
import { sendMessage, subscribeEvents } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import type { AppSettings, DownloadTask } from "@/types/models";

export function useAppSnapshot() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async (sessionId?: string) => {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const next = await sendMessage<AppSnapshot>({
        type: "GET_SNAPSHOT",
        ...(sessionId ? { payload: { sessionId } } : {})
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
        if (event.type === "SESSION_UPDATED") {
          const sessions = current.sessions.some((session) => session.id === event.payload.id)
            ? current.sessions.map((session) =>
                session.id === event.payload.id ? event.payload : session
              )
            : [event.payload, ...current.sessions];
          const belongsToActiveContext =
            !current.activeSession &&
            current.activeTab?.id === event.payload.tabId &&
            current.activeTab.origin === event.payload.origin;
          return {
            ...current,
            sessions,
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
