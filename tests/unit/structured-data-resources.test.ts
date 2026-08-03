import { describe, expect, it } from "vitest";
import { extractStructuredDataResources } from "@/core/structured-data-resources";

describe("extractStructuredDataResources", () => {
  it("只提取 JSON-LD 中明确声明的资源字段", () => {
    const resources = extractStructuredDataResources(
      JSON.stringify({
        "@context": "https://schema.org",
        url: "/article",
        sameAs: "https://social.test/account",
        contentUrl: "/media/opaque",
        thumbnailUrl: "/images/poster.webp",
        image: ["/images/cover.jpg", { url: "/images/nested.avif", caption: "封面" }],
        encoding: { "@type": "MediaObject", contentUrl: "/media/encoded" }
      })
    );

    expect(resources).toEqual(
      expect.arrayContaining([
        { url: "/media/opaque", kind: "resource" },
        { url: "/images/poster.webp", kind: "image" },
        { url: "/images/cover.jpg", kind: "image" },
        { url: "/images/nested.avif", kind: "image" },
        { url: "/media/encoded", kind: "resource" }
      ])
    );
    expect(resources.map((item) => item.url)).not.toEqual(
      expect.arrayContaining(["https://schema.org", "/article", "https://social.test/account"])
    );
  });

  it("拒绝无效或超大 JSON-LD", () => {
    expect(extractStructuredDataResources("{invalid")).toEqual([]);
    expect(extractStructuredDataResources(`{"contentUrl":"${"x".repeat(1_000_000)}"}`)).toEqual([]);
  });
});
