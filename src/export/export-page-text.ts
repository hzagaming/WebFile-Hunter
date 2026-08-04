import type { PageTextDocument } from "@/types/models";

export function exportPageText(documents: readonly PageTextDocument[]): string {
  return documents
    .map(
      (document) =>
        `${document.title || "未命名网页"}\n${document.pageUrl}\n${document.truncated ? "[正文已截断]\n" : ""}\n${document.content}`
    )
    .join(`\n\n${"—".repeat(32)}\n\n`);
}
