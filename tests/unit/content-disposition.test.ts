import { describe, expect, it } from "vitest";
import { parseContentDispositionFilename } from "@/core/content-disposition";

describe("parseContentDispositionFilename", () => {
  it.each([
    ['attachment; filename="report final.pdf"', "report final.pdf"],
    ["attachment; filename=report.txt", "report.txt"],
    ["attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.epub", "中文.epub"],
    ["attachment; filename=old.txt; filename*=UTF-8''new%20name.txt", "new name.txt"]
  ])("解析 %s", (header, expected) => {
    expect(parseContentDispositionFilename(header)).toBe(expected);
  });

  it("对无文件名或错误编码返回 undefined", () => {
    expect(parseContentDispositionFilename("inline")).toBeUndefined();
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''%ZZ")).toBeUndefined();
  });
});
