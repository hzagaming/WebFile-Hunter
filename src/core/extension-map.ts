import type { FileCategory } from "@/types/models";

const groups: Record<FileCategory, readonly string[]> = {
  audio: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma", "aiff"],
  video: ["mp4", "webm", "mov", "mkv", "avi", "m4v", "ts"],
  text: ["txt", "md", "log", "rtf", "css", "js", "mjs"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "djvu"],
  ebook: ["epub", "mobi", "azw", "azw3"],
  archive: ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz"],
  image: ["jpg", "jpeg", "png", "webp", "gif", "svg", "avif", "bmp", "tiff"],
  subtitle: ["srt", "vtt", "ass", "lrc"],
  data: ["csv", "json", "xml", "yaml", "yml", "wasm", "woff", "woff2", "ttf", "otf"],
  unknown: []
};

export const EXTENSION_CATEGORY = new Map<string, FileCategory>(
  Object.entries(groups).flatMap(([category, extensions]) =>
    extensions.map((extension) => [extension, category as FileCategory])
  )
);

export const STREAM_EXTENSIONS = new Set(["m3u8", "mpd", "m4s"]);

export function getExtension(filename: string): string | undefined {
  const clean = filename.split(/[?#]/, 1)[0] ?? "";
  const match = /\.([a-z0-9]{1,12})$/i.exec(clean);
  return match?.[1]?.toLowerCase();
}
