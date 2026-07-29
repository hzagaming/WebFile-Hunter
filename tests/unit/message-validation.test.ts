import { describe, expect, it } from "vitest";
import { validateExtensionRequest } from "@/messaging/message-validation";

describe("extension message validation", () => {
  it("接受已知且完整的消息", () => {
    expect(
      validateExtensionRequest({ type: "SCAN_CURRENT_PAGE", payload: { tabId: 7 } }).success
    ).toBe(true);
    expect(validateExtensionRequest({ type: "CLEAR_HISTORY" }).success).toBe(true);
    expect(validateExtensionRequest({ type: "GET_DOWNLOADS" }).success).toBe(true);
  });

  it.each([
    { type: "FETCH_ARBITRARY_URL", payload: { url: "https://other.test/private" } },
    { type: "SCAN_CURRENT_PAGE", payload: {} },
    { type: "SCAN_CURRENT_PAGE", payload: { tabId: -1 } },
    { type: "STOP_SCAN", payload: { sessionId: "x", extra: true } },
    { type: "START_RECURSIVE_CRAWL", payload: { tabId: 1, config: { maxDepth: 99 } } }
  ])("拒绝未知、缺字段或越界消息", (message) => {
    expect(validateExtensionRequest(message).success).toBe(false);
  });

  it("拒绝原型污染字段和超量结果", () => {
    const polluted = JSON.parse(
      '{"type":"SCAN_CURRENT_PAGE","payload":{"tabId":1,"__proto__":{"admin":true}}}'
    ) as unknown;
    const sanitized = validateExtensionRequest(polluted);
    expect(sanitized.success).toBe(true);
    expect(Object.prototype).not.toHaveProperty("admin");
    if (sanitized.success && "payload" in sanitized.data && sanitized.data.payload) {
      expect(Object.hasOwn(sanitized.data.payload, "__proto__")).toBe(false);
    }
    expect(
      validateExtensionRequest({
        type: "DELETE_RESULTS",
        payload: {
          sessionId: "session-1",
          candidateIds: Array.from({ length: 20_001 }, (_, i) => String(i))
        }
      }).success
    ).toBe(false);
  });
});
