import { describe, expect, it } from "vitest";
import { normalizeUrl, redactUrlForLog } from "@/core/url-normalizer";

describe("normalizeUrl", () => {
  it("解析相对地址并移除 hash 与跟踪参数", () => {
    const result = normalizeUrl(
      "../files/a%20b.txt?utm_source=test&id=7#part",
      "https://EXAMPLE.com/a/page"
    );
    expect(result).toEqual({
      originalUrl: "../files/a%20b.txt?utm_source=test&id=7#part",
      canonicalUrl: "https://example.com/files/a%20b.txt?id=7",
      warnings: []
    });
  });

  it.each([
    ["//EXAMPLE.com:443/a.mp3", "https://base.test", "https://example.com/a.mp3"],
    ["http://EXAMPLE.com:80/a", "https://base.test", "http://example.com/a"],
    [
      "https://例子.测试/资料 文本.txt",
      undefined,
      "https://xn--fsqu00a.xn--0zwm56d/%E8%B5%84%E6%96%99%20%E6%96%87%E6%9C%AC.txt"
    ]
  ])("规范化 %s", (raw, base, expected) => {
    expect(normalizeUrl(raw, base).canonicalUrl).toBe(expected);
  });

  it("保留签名、令牌和原始查询顺序", () => {
    const value = normalizeUrl(
      "https://a.test/file?signature=abc&expires=9&token=t&id=1&gclid=track"
    );
    expect(value.canonicalUrl).toBe("https://a.test/file?signature=abc&expires=9&token=t&id=1");
    expect(value.warnings).toContain("temporary_url");
  });

  it.each(["file:///tmp/a", "ftp://example.com/a", "data:text/plain,a", "blob:https://a.test/1"])(
    "拒绝非 HTTP(S) 协议 %s",
    (raw) => expect(() => normalizeUrl(raw)).toThrow("仅支持 HTTP 或 HTTPS 地址")
  );

  it("拒绝缺少基础地址的相对 URL", () => {
    expect(() => normalizeUrl("../a.txt")).toThrow("无法解析 URL");
  });

  it("错误日志 URL 移除凭据、查询和 hash", () => {
    expect(redactUrlForLog("https://user:pass@example.com/file?token=secret#part")).toBe(
      "https://example.com/file"
    );
  });
});
