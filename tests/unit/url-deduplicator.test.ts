import { describe, expect, it } from "vitest";
import { mergeCandidates } from "@/core/url-deduplicator";
import type { FileCandidate } from "@/types/models";

function candidate(overrides: Partial<FileCandidate> = {}): FileCandidate {
  return {
    id: "old",
    originalUrl: "https://e.test/file",
    canonicalUrl: "https://e.test/file",
    filename: "file",
    category: "unknown",
    source: "NETWORK_REQUEST",
    sources: ["NETWORK_REQUEST"],
    sourcePageUrl: "https://e.test",
    confidence: 0,
    discoveredAt: 1,
    updatedAt: 1,
    isExternal: false,
    isDownloadable: false,
    requiresPermission: false,
    metadataStatus: "not_requested",
    warnings: [],
    ...overrides
  };
}

describe("mergeCandidates", () => {
  it("保留原 ID，并用高置信度响应头补充请求记录", () => {
    const merged = mergeCandidates(
      candidate(),
      candidate({
        id: "new",
        filename: "report.pdf",
        extension: "pdf",
        category: "document",
        source: "NETWORK_HEADER",
        sources: ["NETWORK_HEADER"],
        confidence: 100,
        mimeType: "application/pdf",
        contentLength: 42,
        metadataStatus: "complete",
        warnings: ["temporary_url"],
        updatedAt: 2
      })
    );
    expect(merged).toMatchObject({
      id: "old",
      filename: "report.pdf",
      category: "document",
      confidence: 100,
      mimeType: "application/pdf",
      contentLength: 42,
      metadataStatus: "complete"
    });
    expect(merged.sources).toEqual(["NETWORK_REQUEST", "NETWORK_HEADER"]);
  });
});
