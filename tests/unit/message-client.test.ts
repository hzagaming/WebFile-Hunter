import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeEvents } from "@/messaging/message-client";
import type { ExtensionEvent } from "@/messaging/message-types";

let runtimeListener: ((message: unknown) => void) | undefined;

beforeEach(() => {
  runtimeListener = undefined;
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListener = listener;
        }),
        removeListener: vi.fn()
      }
    }
  } as unknown as typeof chrome;
});

describe("subscribeEvents", () => {
  it("向侧栏转发活动上下文变化事件", () => {
    const listener = vi.fn<(event: ExtensionEvent) => void>();
    subscribeEvents(listener);

    runtimeListener?.({ type: "ACTIVE_CONTEXT_CHANGED" });

    expect(listener).toHaveBeenCalledWith({ type: "ACTIVE_CONTEXT_CHANGED" });
  });
});
