import { scanDocument } from "./dom-scanner";
import { startContentMonitor, type ContentMonitor } from "./mutation-monitor";
import type { ExtensionRequest } from "@/messaging/message-types";

interface ContentState {
  sessionId: string;
  options: { includeStylesheets: boolean; includeImages: boolean };
  monitor?: ContentMonitor;
}

const STATE_KEY = "__webFileHunterContentState";
const scope = globalThis as typeof globalThis & {
  __webFileHunterContentState?: ContentState;
  __webFileHunterInjectedSessionId?: string;
  __webFileHunterInjectedOptions?: { includeStylesheets: boolean; includeImages: boolean };
};

async function sendResult(
  state: ContentState,
  type: "CONTENT_SCAN_RESULT" | "CONTENT_RESOURCE_BATCH"
): Promise<void> {
  const message: ExtensionRequest = {
    type,
    payload: { sessionId: state.sessionId, result: scanDocument(state.options) }
  };
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (!chrome.runtime.id) return;
    console.warn("WebFile Hunter 无法发送页面扫描结果", error);
  }
}

const injectedSessionId = scope.__webFileHunterInjectedSessionId;
if (typeof injectedSessionId === "string") {
  const existing = scope[STATE_KEY];
  const state: ContentState = existing ?? {
    sessionId: injectedSessionId,
    options: scope.__webFileHunterInjectedOptions ?? {
      includeStylesheets: true,
      includeImages: true
    }
  };
  state.sessionId = injectedSessionId;
  state.options = scope.__webFileHunterInjectedOptions ?? state.options;
  scope[STATE_KEY] = state;

  if (!existing) {
    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== "object" || !("type" in message)) return;
      if (message.type === "START_CONTENT_MONITOR") {
        const payload =
          "payload" in message && typeof message.payload === "object" ? message.payload : null;
        const durationMs = payload && "durationMs" in payload ? Number(payload.durationMs) : 60_000;
        state.monitor?.stop();
        state.monitor = startContentMonitor(
          () => void sendResult(state, "CONTENT_RESOURCE_BATCH"),
          Math.min(3_600_000, Math.max(10_000, durationMs))
        );
      } else if (message.type === "STOP_CONTENT_MONITOR") {
        state.monitor?.stop();
        delete state.monitor;
      }
    });
  }
  void sendResult(state, "CONTENT_SCAN_RESULT");
}
