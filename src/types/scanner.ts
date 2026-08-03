import type { DiscoverySource } from "./models";

export interface RawResource {
  url: string;
  source: DiscoverySource;
  tagName?: string;
  attribute?: string;
  mimeType?: string;
  hasDownload?: boolean;
  resourceHint?: "image" | "resource";
  isExternal: boolean;
}

export interface PageCandidate {
  url: string;
  tagName: string;
  noFollow: boolean;
}

export interface PageScanResult {
  pageUrl: string;
  title: string;
  resources: RawResource[];
  pages: PageCandidate[];
}

export interface ExtractedHtmlLinks extends PageScanResult {
  baseUrl: string;
  canonicalUrl?: string;
  metaRefresh?: string;
  noFollow: boolean;
}
