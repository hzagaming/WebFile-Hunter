import { describe, expect, it } from "vitest";
import { createFileCandidate } from "@/core/candidate-factory";

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
});
