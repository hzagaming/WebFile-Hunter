import { parseContentDispositionFilename } from "./content-disposition";
import { EXTENSION_CATEGORY, getExtension, STREAM_EXTENSIONS } from "./extension-map";
import {
  categoryFromMime,
  isGenericMime,
  isSegmentedStreamMime,
  normalizeMimeType
} from "./mime-map";
import { sanitizeFilename } from "./filename-sanitizer";
import type { FileCategory } from "@/types/models";

export interface ClassificationInput {
  url: string;
  mimeType?: string;
  contentDisposition?: string;
  tagName?: string;
  hasDownload?: boolean;
  explicitResource?: boolean;
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
    for (const key of ["response-content-disposition", "content-disposition"]) {
      const value = url.searchParams.get(key);
      const filename = parseContentDispositionFilename(value ?? undefined);
      if (filename && getExtension(filename)) {
        return { filename: sanitizeFilename(filename), queryFilename: true };
      }
    }
    for (const key of [
      "filename",
      "file",
      "file_name",
      "download",
      "download_name",
      "attachment",
      "name"
    ]) {
      const value = url.searchParams.get(key);
      if (value && getExtension(value))
        return { filename: sanitizeFilename(value), queryFilename: true };
    }
    const rawPathName = url.pathname.split("/").at(-1) ?? "";
    let pathName = rawPathName;
    try {
      pathName = decodeURIComponent(rawPathName);
    } catch {
      // 保留无法解码的原始路径段，仍可识别其文件扩展名。
    }
    return {
      filename: sanitizeFilename(pathName || `download-${Date.now()}`),
      queryFilename: false
    };
  } catch {
    return { filename: sanitizeFilename(raw), queryFilename: false };
  }
}

function customMimeCategory(
  mime: string | undefined,
  custom: Record<string, FileCategory> | undefined
): FileCategory | undefined {
  if (!mime || !custom) return undefined;
  return custom[mime] ?? custom[`${mime.split("/", 1)[0]}/*`];
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
  let extensionCategory = extension
    ? (input.customExtensions?.[extension] ?? EXTENSION_CATEGORY.get(extension))
    : input.requestType === "stylesheet"
      ? "code"
      : undefined;
  const mediaContext =
    input.requestType === "media" || ["audio", "video", "source"].includes(input.tagName ?? "");
  if (extension === "ts") extensionCategory = mediaContext ? "video" : "code";
  const mime = normalizeMimeType(input.mimeType);
  const customMime = customMimeCategory(mime, input.customMimeTypes);
  const resolvedMimeCategory = customMime ?? categoryFromMime(mime);
  const isGenericContainer =
    mime === "application/zip" &&
    extensionCategory !== undefined &&
    extensionCategory !== "archive";
  const mimeCategory =
    extensionCategory &&
    !customMime &&
    (resolvedMimeCategory === "unknown" || isGenericMime(mime) || isGenericContainer)
      ? undefined
      : resolvedMimeCategory;
  const warnings: string[] = [];

  if (extension && STREAM_EXTENSIONS.has(extension)) warnings.push("segmented_stream");
  if (extension === "ts" && mediaContext) warnings.push("segmented_stream");
  if (isSegmentedStreamMime(mime)) warnings.push("segmented_stream");
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
  else if (input.explicitResource) confidence = 70;
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

const EMPTY_CUSTOM_EXTENSIONS: ReadonlySet<string> = new Set();

export function looksLikeFileUrl(
  raw: string,
  customExtensions: ReadonlySet<string> = EMPTY_CUSTOM_EXTENSIONS
): boolean {
  if (raw.startsWith("blob:")) return true;
  try {
    const url = new URL(raw);
    const isRecognizedExtension = (extension: string | undefined): boolean =>
      Boolean(
        extension &&
        (EXTENSION_CATEGORY.has(extension) ||
          STREAM_EXTENSIONS.has(extension) ||
          customExtensions.has(extension))
      );
    const extension = getExtension(url.pathname);
    if (isRecognizedExtension(extension)) return true;
    for (const key of ["response-content-disposition", "content-disposition"]) {
      const filename = parseContentDispositionFilename(url.searchParams.get(key) ?? undefined);
      if (filename && isRecognizedExtension(getExtension(filename))) return true;
    }
    return [
      "filename",
      "file",
      "file_name",
      "download",
      "download_name",
      "attachment",
      "name"
    ].some((key) => {
      const value = url.searchParams.get(key);
      const queryExtension = value ? getExtension(value) : undefined;
      return isRecognizedExtension(queryExtension);
    });
  } catch {
    return false;
  }
}
