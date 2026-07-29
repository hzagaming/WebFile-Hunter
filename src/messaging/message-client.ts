import type { ExtensionEvent, ExtensionRequest, MessageResponse } from "./message-types";

export async function sendMessage<T>(message: ExtensionRequest): Promise<T> {
  const response: MessageResponse<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error("扩展后台没有响应，请重新加载扩展。");
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

export function subscribeEvents(listener: (event: ExtensionEvent) => void): () => void {
  const handler = (message: unknown): void => {
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      [
        "ACTIVE_CONTEXT_CHANGED",
        "SCAN_PROGRESS",
        "FILES_DISCOVERED",
        "DOWNLOADS_UPDATED",
        "SESSION_UPDATED",
        "APP_ERROR"
      ].includes(String(message.type))
    ) {
      listener(message as ExtensionEvent);
    }
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}
