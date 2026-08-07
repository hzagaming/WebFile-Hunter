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
    ["styles.css", "code"],
    ["app.js", "code"],
    ["worker.mjs", "code"],
    ["module.wasm", "code"],
    ["font.woff", "font"],
    ["font.woff2", "font"],
    ["font.ttf", "font"],
    ["font.otf", "font"]
  ])("识别网页静态资源 %s", (filename, category) => {
    expect(classifyFile({ url: `https://e.test/${filename}`, tagName: "script" })).toMatchObject({
      category,
      confidence: 90,
      isDownloadable: true
    });
  });

  it("依据请求语义区分 TypeScript 源码与 MPEG-TS 媒体", () => {
    expect(
      classifyFile({ url: "https://e.test/app.ts", tagName: "script", requestType: "script" })
    ).toMatchObject({ category: "code", isDownloadable: true });
    expect(
      classifyFile({
        url: "https://e.test/segment.ts",
        tagName: "video",
        requestType: "media"
      })
    ).toMatchObject({ category: "video", isDownloadable: false });
  });

  it.each([
    ["app.js", "application/javascript", "code"],
    ["theme.css", "text/css", "code"],
    ["site.woff2", "font/woff2", "font"]
  ])("严格区分源码与字体 %s", (filename, mimeType, category) => {
    expect(classifyFile({ url: `https://e.test/${filename}`, mimeType })).toMatchObject({
      category
    });
  });

  it("通用文本 MIME 不覆盖更具体的字幕后缀", () => {
    expect(
      classifyFile({ url: "https://e.test/captions.srt", mimeType: "text/plain" })
    ).toMatchObject({ category: "subtitle", extension: "srt" });
  });

  it("识别 HLS 与 DASH MIME 为不可直接下载的分段媒体", () => {
    for (const mimeType of ["application/vnd.apple.mpegurl", "application/dash+xml"]) {
      const result = classifyFile({ url: "https://e.test/manifest", mimeType });
      expect(result).toMatchObject({
        category: "video",
        isDownloadable: false
      });
      expect(result.warnings).toContain("segmented_stream");
    }
  });

  it("自定义 MIME 支持类型通配符", () => {
    expect(
      classifyFile({
        url: "https://e.test/custom",
        mimeType: "model/gltf-binary",
        customMimeTypes: { "model/*": "archive" }
      })
    ).toMatchObject({ category: "archive", confidence: 95 });
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

  it.each([
    ["book.epub", "ebook"],
    ["report.docx", "document"]
  ])("通用 ZIP 容器 MIME 保留 %s 的具体分类", (filename, category) => {
    expect(
      classifyFile({ url: `https://e.test/${filename}`, mimeType: "application/zip" })
    ).toMatchObject({ category, extension: filename.split(".").at(-1) });
  });
});
