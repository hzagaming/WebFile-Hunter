import type { FileCategory } from "@/types/models";

const exact: Record<string, FileCategory> = {
  "application/pdf": "document",
  "application/epub+zip": "ebook",
  "application/zip": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-rar-compressed": "archive",
  "application/gzip": "archive",
  "application/json": "data",
  "application/xml": "data",
  "application/wasm": "data",
  "font/otf": "data",
  "font/ttf": "data",
  "font/woff": "data",
  "font/woff2": "data",
  "text/csv": "data",
  "text/vtt": "subtitle",
  "application/x-subrip": "subtitle",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document"
};

export function normalizeMimeType(value?: string): string | undefined {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mime || undefined;
}

export function categoryFromMime(value?: string): FileCategory | undefined {
  const mime = normalizeMimeType(value);
  if (!mime) return undefined;
  if (exact[mime]) return exact[mime];
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  if (mime === "application/octet-stream") return "unknown";
  return undefined;
}

export function isHtmlMime(value?: string): boolean {
  const mime = normalizeMimeType(value);
  return mime === "text/html" || mime === "application/xhtml+xml";
}
