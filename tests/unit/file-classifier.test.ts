import { describe, expect, it } from "vitest";
import { classifyFile } from "@/core/file-classifier";

describe("classifyFile", () => {
  it.each([
    ["A.MP3", "audio"],
    ["book.epub", "ebook"],
    ["archive.tar.gz", "archive"],
    ["caption.vtt", "subtitle"],
    ["image.avif", "image"],
    ["movie.mkv", "video"],
    ["data.yaml", "data"],
    ["notes.md", "text"],
    ["slides.pptx", "document"]
  ])("通过后缀识别 %s", (filename, category) => {
    expect(classifyFile({ url: `https://e.test/${filename}` }).category).toBe(category);
  });

  it.each([
    ["styles.css", "text"],
    ["app.js", "text"],
    ["worker.mjs", "text"],
    ["module.wasm", "data"],
    ["font.woff", "data"],
    ["font.woff2", "data"],
    ["font.ttf", "data"],
    ["font.otf", "data"]
  ])("识别网页静态资源 %s", (filename, category) => {
    expect(classifyFile({ url: `https://e.test/${filename}`, tagName: "script" })).toMatchObject({
      category,
      confidence: 90,
      isDownloadable: true
    });
  });

  it("通过 MIME 和 Content-Disposition 识别无后缀接口", () => {
    const result = classifyFile({
      url: "https://e.test/api/download?id=1",
      mimeType: "application/pdf; charset=binary",
      contentDisposition: 'attachment; filename="manual.pdf"'
    });
    expect(result).toMatchObject({
      filename: "manual.pdf",
      extension: "pdf",
      category: "document",
      confidence: 100,
      isDownloadable: true
    });
  });

  it("Content-Type 的高置信度覆盖冲突后缀并产生警告", () => {
    const result = classifyFile({ url: "https://e.test/fake.mp3", mimeType: "application/pdf" });
    expect(result.category).toBe("document");
    expect(result.warnings).toContain("mime_extension_conflict");
  });

  it("从查询参数文件名识别文件", () => {
    expect(classifyFile({ url: "https://e.test/get?filename=notes.txt" })).toMatchObject({
      filename: "notes.txt",
      category: "text",
      confidence: 60
    });
  });

  it.each(["https://e.test/live/index.m3u8", "https://e.test/dash/manifest.mpd"])(
    "仅标记流媒体清单 %s",
    (url) => {
      const result = classifyFile({ url });
      expect(result.warnings).toContain("segmented_stream");
      expect(result.isDownloadable).toBe(false);
    }
  );

  it("标记 blob 临时资源", () => {
    const result = classifyFile({ url: "blob:https://e.test/id" });
    expect(result.warnings).toContain("temporary_blob");
    expect(result.isDownloadable).toBe(false);
  });

  it("识别未知二进制文件", () => {
    expect(
      classifyFile({ url: "https://e.test/download", mimeType: "application/octet-stream" })
    ).toMatchObject({ category: "unknown", confidence: 95, isDownloadable: true });
  });

  it("通用二进制 MIME 不覆盖明确文件后缀", () => {
    expect(
      classifyFile({ url: "https://e.test/manual.pdf", mimeType: "application/octet-stream" })
    ).toMatchObject({ category: "document", extension: "pdf" });
  });
});
