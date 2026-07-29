import { describe, expect, it } from "vitest";
import { inspectUrlSafety } from "@/core/url-security";

describe("inspectUrlSafety", () => {
  it.each([
    "http://localhost/a",
    "http://localhost.localdomain/a",
    "http://127.0.0.2/a",
    "http://0.0.0.0/a",
    "http://169.254.1.2/a",
    "http://10.1.2.3/a",
    "http://172.20.1.2/a",
    "http://192.168.1.2/a",
    "http://[::1]/a",
    "http://[fc00::1]/a",
    "http://[fe80::1]/a"
  ])("拒绝本地或私网地址 %s", (url) => {
    expect(inspectUrlSafety(url)).toMatchObject({ safe: false, code: "PRIVATE_NETWORK" });
  });

  it("拒绝 URL 用户名密码", () => {
    expect(inspectUrlSafety("https://user:pass@example.com/a")).toMatchObject({
      safe: false,
      code: "CREDENTIALS_IN_URL"
    });
  });

  it.each(["/logout", "/api/delete?id=1", "/checkout", "/admin/action/run", "/x/../remove/1"])(
    "拒绝危险操作路径 %s",
    (path) => expect(inspectUrlSafety(`https://example.com${path}`).safe).toBe(false)
  );

  it("拒绝非标准危险端口和越界 origin", () => {
    expect(inspectUrlSafety("https://example.com:444/a").code).toBe("DANGEROUS_PORT");
    expect(
      inspectUrlSafety("https://other.test/a", { allowedOrigin: "https://example.com" }).code
    ).toBe("OUTSIDE_ALLOWED_ORIGIN");
  });

  it("允许同源公开 HTTP(S) GET 资源", () => {
    expect(
      inspectUrlSafety("https://example.com/files/a.pdf", { allowedOrigin: "https://example.com" })
    ).toEqual({ safe: true });
  });

  it("拒绝无效百分号编码路径", () => {
    expect(inspectUrlSafety("https://example.com/%ZZ")).toMatchObject({
      safe: false,
      code: "INVALID_URL"
    });
  });
});
