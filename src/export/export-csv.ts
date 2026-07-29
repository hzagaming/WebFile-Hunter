import type { FileCandidate } from "@/types/models";

const HEADERS = [
  "filename",
  "url",
  "final_url",
  "extension",
  "category",
  "mime_type",
  "content_length",
  "source",
  "source_page",
  "confidence",
  "discovered_at",
  "warnings"
] as const;

function cell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv(
  files: readonly FileCandidate[],
  options: { bom?: boolean } = {}
): string {
  const lines = [
    HEADERS.join(","),
    ...files.map((file) =>
      [
        file.filename,
        file.canonicalUrl,
        file.finalUrl,
        file.extension,
        file.category,
        file.mimeType,
        file.contentLength,
        file.source,
        file.sourcePageUrl,
        file.confidence,
        new Date(file.discoveredAt).toISOString(),
        file.warnings.join("|")
      ]
        .map(cell)
        .join(",")
    )
  ];
  return `${options.bom ? "\uFEFF" : ""}${lines.join("\r\n")}`;
}
