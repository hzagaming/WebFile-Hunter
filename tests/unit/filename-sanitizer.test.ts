import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "@/core/filename-sanitizer";

describe("sanitizeFilename", () => {
  it.each([
    ["../../secret.txt", "secret.txt"],
    ["C:\\temp\\report?.pdf", "report_.pdf"],
    ["/etc/passwd", "passwd"],
    ["a\u0000b.txt", "ab.txt"],
    ["CON", "_CON"]
  ])("清理 %s", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("为空和超长名称提供安全结果", () => {
    expect(sanitizeFilename("../")).toMatch(/^download-/);
    expect(sanitizeFilename(`${"x".repeat(300)}.pdf`).length).toBeLessThanOrEqual(180);
    expect(sanitizeFilename(`${"x".repeat(300)}.pdf`)).toMatch(/\.pdf$/);
  });
});
