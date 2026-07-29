import type { ExtensionEvent } from "@/messaging/message-types";

export function broadcast(event: ExtensionEvent): void {
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}
