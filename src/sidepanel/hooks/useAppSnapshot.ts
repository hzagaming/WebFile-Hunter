import { useCallback, useEffect, useState } from "react";
import { sendMessage, subscribeEvents } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";

export function useAppSnapshot() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (sessionId?: string) => {
    setLoading(true);
    try {
      setSnapshot(
        await sendMessage<AppSnapshot>({
          type: "GET_SNAPSHOT",
          ...(sessionId ? { payload: { sessionId } } : {})
        })
      );
      setError(undefined);
    } catch (value) {
      setError(value instanceof Error ? value.message : "无法读取扩展状态。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeEvents((event) => {
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
          return {
            ...current,
            sessions,
            ...(current.activeSession?.id === event.payload.id || !current.activeSession
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
      clearTimeout(initialLoad);
      unsubscribe();
    };
  }, [refresh]);

  return { snapshot, setSnapshot, loading, error, setError, refresh };
}
