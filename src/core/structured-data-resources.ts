export type StructuredDataResourceKind = "image" | "resource";

export interface StructuredDataResource {
  url: string;
  kind: StructuredDataResourceKind;
}

const MAX_JSON_LD_CHARS = 1_000_000;
const MAX_NODES = 20_000;
const MAX_RESOURCES = 1_000;
const MAX_URL_CHARS = 16_384;
const IMAGE_KEYS = new Set(["image", "thumbnail", "thumbnailurl"]);
const RESOURCE_KEYS = new Set([
  "audio",
  "associatedmedia",
  "contenturl",
  "downloadurl",
  "embedurl",
  "encoding",
  "fileurl",
  "video"
]);
const NESTED_URL_KEYS = new Set(["@id", "url"]);

interface PendingValue {
  value: unknown;
  kind?: StructuredDataResourceKind;
}

export function extractStructuredDataResources(raw: string): StructuredDataResource[] {
  if (!raw.trim() || raw.length > MAX_JSON_LD_CHARS) return [];
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return [];
  }

  const pending: PendingValue[] = [{ value: root }];
  const resources = new Map<string, StructuredDataResourceKind>();
  let nodes = 0;
  while (pending.length && nodes < MAX_NODES && resources.size < MAX_RESOURCES) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (typeof current.value === "string") {
      const url = current.value.trim();
      if (current.kind && url && url.length <= MAX_URL_CHARS) {
        const previous = resources.get(url);
        resources.set(url, previous === "resource" ? previous : current.kind);
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          ...(current.kind ? { kind: current.kind } : {})
        });
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const [rawKey, value] of Object.entries(current.value)) {
      const key = rawKey.toLowerCase();
      const kind = IMAGE_KEYS.has(key)
        ? "image"
        : RESOURCE_KEYS.has(key)
          ? (current.kind ?? "resource")
          : current.kind && NESTED_URL_KEYS.has(key)
            ? current.kind
            : undefined;
      pending.push({ value, ...(kind ? { kind } : {}) });
    }
  }
  return [...resources].map(([url, kind]) => ({ url, kind }));
}
