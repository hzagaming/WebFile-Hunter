import type { FileCategory } from "@/types/models";

const exact: Record<string, FileCategory> = {
  "application/pdf": "document",
  "application/epub+zip": "ebook",
  "application/x-mobipocket-ebook": "ebook",
  "application/vnd.amazon.ebook": "ebook",
  "application/zip": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-rar-compressed": "archive",
  "application/gzip": "archive",
  "application/x-tar": "archive",
  "application/x-bzip2": "archive",
  "application/zstd": "archive",
  "application/vnd.rar": "archive",
  "application/json": "data",
  "application/ld+json": "data",
  "application/x-ndjson": "data",
  "application/xml": "data",
  "application/wasm": "code",
  "application/javascript": "code",
  "application/x-javascript": "code",
  "text/javascript": "code",
  "text/css": "code",
  "application/vnd.apple.mpegurl": "video",
  "application/x-mpegurl": "video",
  "application/dash+xml": "video",
  "font/otf": "font",
  "font/ttf": "font",
  "font/woff": "font",
  "font/woff2": "font",
  "application/vnd.ms-fontobject": "font",
  "application/font-woff": "font",
  "application/x-font-ttf": "font",
  "application/x-font-opentype": "font",
  "text/csv": "data",
  "text/vtt": "subtitle",
  "application/x-subrip": "subtitle",
  "application/msword": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "application/vnd.oasis.opendocument.text": "document",
  "application/vnd.oasis.opendocument.spreadsheet": "document",
  "application/vnd.oasis.opendocument.presentation": "document",
  "model/gltf+json": "model",
  "model/gltf-binary": "model",
  "model/obj": "model",
  "model/stl": "model"
};

const generic = new Set(["application/octet-stream", "binary/octet-stream", "text/plain"]);
const segmented = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/dash+xml"
]);

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
  if (mime.startsWith("model/")) return "model";
  if (isHtmlMime(mime)) return undefined;
  if (mime.endsWith("+json") || mime.endsWith("+xml")) return "data";
  if (mime.startsWith("text/")) return "text";
  if (mime === "application/octet-stream") return "unknown";
  return undefined;
}

export function isGenericMime(value?: string): boolean {
  const mime = normalizeMimeType(value);
  return Boolean(mime && generic.has(mime));
}

export function isSegmentedStreamMime(value?: string): boolean {
  const mime = normalizeMimeType(value);
  return Boolean(mime && segmented.has(mime));
}

export function isHtmlMime(value?: string): boolean {
  const mime = normalizeMimeType(value);
  return mime === "text/html" || mime === "application/xhtml+xml";
}
