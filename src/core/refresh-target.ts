import { normalizeUrl } from "./url-normalizer";

const MAX_REFRESH_LENGTH = 16_384;

export function extractRefreshTarget(
  value: string | undefined,
  baseUrl: string
): string | undefined {
  if (!value || value.length > MAX_REFRESH_LENGTH) return undefined;
  const match = /(?:^|;)\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|(.+))\s*$/i.exec(value);
  const raw = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
  if (!raw) return undefined;
  try {
    return normalizeUrl(raw, baseUrl).canonicalUrl;
  } catch {
    return undefined;
  }
}
