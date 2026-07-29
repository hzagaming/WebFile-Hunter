import { parseContentDispositionFilename } from "./content-disposition";
import { EXTENSION_CATEGORY, getExtension, STREAM_EXTENSIONS } from "./extension-map";
import { categoryFromMime, normalizeMimeType } from "./mime-map";
import { sanitizeFilename } from "./filename-sanitizer";
import type { FileCategory } from "@/types/models";

export interface ClassificationInput {
  url: string;
  mimeType?: string;
  contentDisposition?: string;
  tagName?: string;
  hasDownload?: boolean;
  requestType?: string;
  customExtensions?: Record<string, FileCategory>;
  customMimeTypes?: Record<string, FileCategory>;
}

export interface ClassificationResult {
  filename: string;
  extension?: string;
  category: FileCategory;
  confidence: number;
  isDownloadable: boolean;
  warnings: string[];
}

function filenameFromUrl(raw: string): { filename: string; queryFilename: boolean } {
  try {
    const url = new URL(raw);
    for (const key of ["filename", "file", "download", "name"]) {
      const value = url.searchParams.get(key);
      if (value && getExtension(value))
        return { filename: sanitizeFilename(value), queryFilename: true };
    }
    const pathName = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    return {
      filename: sanitizeFilename(pathName || `download-${Date.now()}`),
      queryFilename: false
    };
  } catch {
    return { filename: sanitizeFilename(raw), queryFilename: false };
  }
}

export function classifyFile(input: ClassificationInput): ClassificationResult {
  if (input.url.startsWith("blob:")) {
    return {
      filename: "临时浏览器资源",
      category: "unknown",
      confidence: 40,
      isDownloadable: false,
      warnings: ["temporary_blob"]
    };
  }

  const dispositionName = parseContentDispositionFilename(input.contentDisposition);
  const fromUrl = filenameFromUrl(input.url);
  const filename = sanitizeFilename(dispositionName ?? fromUrl.filename);
  const extension = getExtension(filename);
  const extensionCategory = extension
    ? (input.customExtensions?.[extension] ?? EXTENSION_CATEGORY.get(extension))
    : undefined;
  const mime = normalizeMimeType(input.mimeType);
  const resolvedMimeCategory = mime
    ? (input.customMimeTypes?.[mime] ?? categoryFromMime(mime))
    : undefined;
  const mimeCategory =
    resolvedMimeCategory === "unknown" && extensionCategory ? undefined : resolvedMimeCategory;
  const warnings: string[] = [];

  if (extension && STREAM_EXTENSIONS.has(extension)) warnings.push("segmented_stream");
  if (extension === "ts" && input.requestType === "media") warnings.push("segmented_stream");
  if (mimeCategory && extensionCategory && mimeCategory !== extensionCategory) {
    warnings.push("mime_extension_conflict");
  }

  const category = mimeCategory ?? extensionCategory ?? "unknown";
  let confidence = 0;
  if (dispositionName && mimeCategory) confidence = 100;
  else if (mimeCategory) confidence = 95;
  else if (fromUrl.queryFilename) confidence = 60;
  else if (extensionCategory && input.tagName) confidence = 90;
  else if (extensionCategory) confidence = 85;
  else if (input.hasDownload) confidence = 75;
  else if (input.tagName) confidence = 40;

  const segmented = warnings.includes("segmented_stream");
  return {
    filename,
    ...(extension ? { extension } : {}),
    category,
    confidence,
    isDownloadable: !segmented && (confidence >= 50 || mime === "application/octet-stream"),
    warnings
  };
}

export function looksLikeFileUrl(raw: string): boolean {
  if (raw.startsWith("blob:")) return true;
  try {
    const url = new URL(raw);
    const extension = getExtension(url.pathname);
    if (extension && (EXTENSION_CATEGORY.has(extension) || STREAM_EXTENSIONS.has(extension)))
      return true;
    return ["filename", "file", "download"].some((key) => {
      const value = url.searchParams.get(key);
      const queryExtension = value ? getExtension(value) : undefined;
      return Boolean(queryExtension && EXTENSION_CATEGORY.has(queryExtension));
    });
  } catch {
    return false;
  }
}
