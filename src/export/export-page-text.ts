import type { PageTextDocument } from "@/types/models";
import { translate, type AppLanguage } from "@/i18n";

export function exportPageText(
  documents: readonly PageTextDocument[],
  language: AppLanguage = "zh-CN"
): string {
  return documents
    .map(
      (document) =>
        `${document.title || translate(language, "未命名网页")}\n${document.pageUrl}\n${document.truncated ? `[${translate(language, "正文已截断")}]\n` : ""}\n${document.content}`
    )
    .join(`\n\n${"—".repeat(32)}\n\n`);
}
