import { describe, expect, it } from "vitest";
import { extractHttpLinkHeader } from "@/core/http-link-header";

describe("extractHttpLinkHeader", () => {
  it("提取带逗号 URL、quoted rel、MIME 与页面关系", () => {
    const result = extractHttpLinkHeader(
      '</assets/report,final.pdf>; rel="preload"; as=document; type="application/pdf", </download>; rel=enclosure; type=audio/mpeg, </page-2>; rel="next alternate"',
      "https://example.test/article"
    );

    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.test/assets/report,final.pdf",
          mimeType: "application/pdf"
        }),
        expect.objectContaining({
          url: "https://example.test/download",
          mimeType: "audio/mpeg"
        })
      ])
    );
    expect(result.pages).toContainEqual(
      expect.objectContaining({ url: "https://example.test/page-2" })
    );
  });

  it("忽略无效、非 HTTP 地址与未知关系", () => {
    const result = extractHttpLinkHeader(
      "<javascript:alert(1)>; rel=next, <data:text/plain,x>; rel=preload, </ignored>; rel=author, broken",
      "https://example.test/article"
    );

    expect(result).toEqual({ resources: [], pages: [] });
  });

  it("限制单个响应头产生的候选数量", () => {
    const header = Array.from(
      { length: 1_100 },
      (_, index) => `</files/${index}.pdf>; rel=preload; type=application/pdf`
    ).join(",");

    expect(extractHttpLinkHeader(header, "https://example.test").resources).toHaveLength(1_000);
  });
});
