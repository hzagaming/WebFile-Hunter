import { describe, expect, it, vi } from "vitest";
import { exportCsv } from "@/export/export-csv";
import { exportJson } from "@/export/export-json";
import { exportTxt } from "@/export/export-txt";
import { saveExport } from "@/export/save-export";
import type { FileCandidate, ScanSession } from "@/types/models";

const candidate: FileCandidate = {
  id: "f1",
  originalUrl: "https://e.test/a.txt",
  canonicalUrl: "https://e.test/a.txt",
  filename: 'a,"line\n2".txt',
  extension: "txt",
  category: "text",
  source: "DOM_ATTRIBUTE",
  sources: ["DOM_ATTRIBUTE"],
  sourcePageUrl: "https://e.test/",
  confidence: 85,
  discoveredAt: 1,
  updatedAt: 1,
  isExternal: false,
  isDownloadable: true,
  requiresPermission: false,
  metadataStatus: "not_requested",
  warnings: []
};

describe("export", () => {
  it("TXT 支持纯 URL 和文件名制表符格式", () => {
    expect(exportTxt([candidate])).toBe("https://e.test/a.txt");
    expect(exportTxt([candidate], { includeFilename: true })).toBe(
      'a,"line 2".txt\thttps://e.test/a.txt'
    );
  });

  it("CSV 正确转义并可带 UTF-8 BOM", () => {
    const csv = exportCsv([candidate], { bom: true });
    expect(csv.startsWith("\uFEFFfilename,url,")).toBe(true);
    expect(csv).toContain('"a,""line\n2"".txt"');
  });

  it("JSON 包含版本、会话、设置快照与文件", () => {
    const session = { id: "s1" } as ScanSession;
    const parsed = JSON.parse(exportJson([candidate], session, { maxDepth: 2 })) as Record<
      string,
      unknown
    >;
    expect(parsed.exportVersion).toBe(1);
    expect(parsed.scanSession).toEqual({ id: "s1" });
    expect(parsed.settingsSnapshot).toEqual({ maxDepth: 2 });
    expect(parsed.files).toHaveLength(1);
  });

  it("通过浏览器下载 API 保存导出并延迟释放 Blob URL", async () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn(() => "blob:export") },
      revokeObjectURL: { configurable: true, value: revokeObjectURL }
    });
    const download = vi
      .fn<(options: chrome.downloads.DownloadOptions) => Promise<number>>()
      .mockResolvedValue(1);
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { downloads: { download } }
    });

    await saveExport("result", "csv", "text/csv", "WebFile Hunter/example.test");

    const options = download.mock.calls[0]?.[0];
    expect(options?.url).toBe("blob:export");
    expect(options?.filename).toMatch(/^WebFile-Hunter-example\.test-\d{4}-\d{2}-\d{2}\.csv$/);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    vi.useRealTimers();
  });
});
