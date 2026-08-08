import type { FileCategory } from "@/types/models";

const groups: Record<FileCategory, readonly string[]> = {
  audio: [
    "mp3",
    "wav",
    "flac",
    "m4a",
    "aac",
    "ogg",
    "oga",
    "opus",
    "wma",
    "aiff",
    "ac3",
    "ec3",
    "alac",
    "ape",
    "amr",
    "mid",
    "midi"
  ],
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
    "m4s",
    "3gp",
    "3g2",
    "flv",
    "f4v",
    "vob",
    "wmv",
    "asf"
  ],
  text: ["txt", "md", "log", "rtf"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "djvu"],
  ebook: ["epub", "mobi", "azw", "azw3", "cbz", "cbr", "fb2"],
  archive: ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz", "jar", "zst", "lz", "lz4", "cab"],
  image: [
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "svg",
    "avif",
    "bmp",
    "tiff",
    "tif",
    "ico",
    "heic",
    "heif",
    "jxl",
    "apng"
  ],
  subtitle: ["srt", "vtt", "ass", "ssa", "smi", "sub", "idx", "ttml", "dfxp", "lrc"],
  data: ["csv", "json", "xml", "yaml", "yml", "toml", "ini", "ndjson", "geojson", "webmanifest"],
  code: ["css", "scss", "sass", "less", "js", "mjs", "cjs", "ts", "tsx", "jsx", "wasm", "map"],
  font: ["woff", "woff2", "ttf", "otf", "ttc", "otc", "eot"],
  model: ["glb", "gltf", "obj", "stl", "fbx", "dae", "3ds", "ply", "usd", "usdz", "3mf"],
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
