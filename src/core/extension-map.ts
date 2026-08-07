import type { FileCategory } from "@/types/models";

const groups: Record<FileCategory, readonly string[]> = {
  audio: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "oga", "opus", "wma", "aiff"],
  video: [
    "mp4",
    "webm",
    "mov",
    "mkv",
    "avi",
    "m4v",
    "mpg",
    "mpeg",
    "ogv",
    "mts",
    "m2ts",
    "m3u8",
    "mpd",
    "m4s"
  ],
  text: ["txt", "md", "log", "rtf"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "djvu"],
  ebook: ["epub", "mobi", "azw", "azw3", "cbz", "cbr"],
  archive: ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz", "jar"],
  image: ["jpg", "jpeg", "png", "webp", "gif", "svg", "avif", "bmp", "tiff"],
  subtitle: ["srt", "vtt", "ass", "lrc"],
  data: ["csv", "json", "xml", "yaml", "yml", "toml", "ini", "ndjson", "geojson", "webmanifest"],
  code: ["css", "scss", "sass", "less", "js", "mjs", "cjs", "ts", "tsx", "jsx", "wasm", "map"],
  font: ["woff", "woff2", "ttf", "otf", "eot"],
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
