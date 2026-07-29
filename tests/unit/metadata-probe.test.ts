import { afterEach, describe, expect, it, vi } from "vitest";
import { probeUrlMetadata, safeFetch } from "@/background/metadata-probe";
import { DEFAULT_SCAN_CONFIG } from "@/utils/defaults";

afterEach(() => vi.unstubAllGlobals());

describe("metadata probe", () => {
  it("HEAD 不支持时使用受限 Range GET 并解析响应头", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 206,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": "100",
            "Content-Disposition": 'attachment; filename="manual.pdf"'
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const metadata = await probeUrlMetadata("https://example.com/manual", {
      origin: "https://example.com",
      config: DEFAULT_SCAN_CONFIG,
      signal: new AbortController().signal
    });
    expect(metadata).toMatchObject({ mimeType: "application/pdf", contentLength: 100 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.com/manual",
      expect.objectContaining({ method: "GET", headers: { Range: "bytes=0-0" } })
    );
  });

  it("401 不重试", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      probeUrlMetadata("https://example.com/private", {
        origin: "https://example.com",
        config: DEFAULT_SCAN_CONFIG,
        signal: new AbortController().signal
      })
    ).rejects.toThrow("HTTP 401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("每次重定向都重新检查 origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: "https://outside.test/file.pdf" }
        })
      )
    );
    await expect(
      safeFetch(
        "https://example.com/start",
        { method: "HEAD" },
        {
          origin: "https://example.com",
          config: DEFAULT_SCAN_CONFIG,
          signal: new AbortController().signal
        }
      )
    ).rejects.toThrow("不属于当前授权站点");
  });
});
