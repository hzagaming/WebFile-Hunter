import { describe, expect, it } from "vitest";
import { createFileCandidate, shouldIncludeCandidate } from "@/core/candidate-factory";

describe("createFileCandidate", () => {
  it("将同源 blob URL 保存为不可下载的临时资源", () => {
    const candidate = createFileCandidate({
      url: "blob:https://example.test/temporary-audio",
      source: "DOM_ATTRIBUTE",
      sourcePageUrl: "https://example.test/page"
    });

    expect(candidate).toMatchObject({
      canonicalUrl: "blob:https://example.test/temporary-audio",
      isExternal: false,
      isDownloadable: false,
      requiresPermission: false,
      confidence: 40,
      warnings: ["temporary_blob"]
    });
  });

  it("图片开关统一作用于所有发现管线", () => {
    const image = createFileCandidate({
      url: "https://example.test/cover.jpg",
      source: "NETWORK_REQUEST",
      sourcePageUrl: "https://example.test/page"
    });

    expect(shouldIncludeCandidate(image, { scanImages: true })).toBe(true);
    expect(shouldIncludeCandidate(image, { scanImages: false })).toBe(false);
  });
});
