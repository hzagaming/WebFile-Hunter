import { describe, expect, it } from "vitest";
import { getRetryDecision, parseRetryAfter } from "@/background/retry-policy";

describe("retry policy", () => {
  it("解析秒数和 HTTP 日期 Retry-After", () => {
    expect(parseRetryAfter("3", 1_000)).toBe(3_000);
    expect(parseRetryAfter(new Date(6_000).toUTCString(), 1_000)).toBe(5_000);
    expect(parseRetryAfter("bad", 1_000)).toBeUndefined();
  });

  it.each([401, 403, 404])("不重试 HTTP %i", (status) => {
    expect(getRetryDecision({ attempt: 0, status, now: 0 }).retry).toBe(false);
  });

  it("429 优先采用 Retry-After", () => {
    expect(getRetryDecision({ attempt: 0, status: 429, retryAfter: "4", now: 0 })).toEqual({
      retry: true,
      delayMs: 4000,
      reason: "rate_limited"
    });
  });

  it("限制 5xx 与网络错误重试次数", () => {
    expect(getRetryDecision({ attempt: 1, status: 503, now: 0 }).retry).toBe(true);
    expect(getRetryDecision({ attempt: 2, status: 503, now: 0 }).retry).toBe(false);
    expect(getRetryDecision({ attempt: 3, networkError: true, now: 0 }).retry).toBe(false);
  });
});
