export type FileCategory =
  | "audio"
  | "video"
  | "text"
  | "document"
  | "ebook"
  | "archive"
  | "image"
  | "subtitle"
  | "data"
  | "code"
  | "font"
  | "unknown";

export type DiscoverySource =
  | "DOM_ATTRIBUTE"
  | "DOWNLOAD_ATTRIBUTE"
  | "CSS_URL"
  | "PERFORMANCE_ENTRY"
  | "NETWORK_REQUEST"
  | "NETWORK_HEADER"
  | "CRAWLED_PAGE"
  | "MANUAL_URL";

export interface FileCandidate {
  id: string;
  originalUrl: string;
  canonicalUrl: string;
  finalUrl?: string;
  filename: string;
  extension?: string;
  category: FileCategory;
  mimeType?: string;
  contentLength?: number;
  contentDisposition?: string;
  etag?: string;
  lastModified?: string;
  acceptRanges?: string;
  source: DiscoverySource;
  sources: DiscoverySource[];
  sourcePageUrl: string;
  sourcePageTitle?: string;
  parentUrl?: string;
  tabId?: number;
  requestId?: string;
  confidence: number;
  discoveredAt: number;
  updatedAt: number;
  isExternal: boolean;
  isDownloadable: boolean;
  requiresPermission: boolean;
  metadataStatus: "not_requested" | "pending" | "complete" | "failed";
  warnings: string[];
}

export type ScanMode = "current_page" | "live_monitor" | "recursive_crawl";
export type ScanStatus =
  "created" | "requesting_permission" | "running" | "paused" | "completed" | "cancelled" | "failed";

export interface ScanConfig {
  respectRobots: boolean;
  maxDepth: number;
  maxPages: number;
  maxQueryVariantsPerPath: number;
  maxConcurrency: number;
  minDelayMs: number;
  requestTimeoutMs: number;
  maxHtmlBytes: number;
  discoverSitemaps: boolean;
  capturePageText: boolean;
  probeMetadata: boolean;
  followRedirects: boolean;
  maxRedirects: number;
  retries: number;
  excludeDangerousActions: boolean;
}

export interface ScanSession {
  id: string;
  mode: ScanMode;
  status: ScanStatus;
  tabId: number;
  startUrl: string;
  origin: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  pagesQueued: number;
  pagesProcessed: number;
  filesDiscovered: number;
  errors: number;
  config: ScanConfig;
  lastCheckpointAt?: number;
  errorMessage?: string;
  currentUrl?: string;
  requestsPerMinute?: number;
}

export interface CrawlQueueItem {
  url: string;
  depth: number;
  parentUrl: string | null;
  discoveredAt: number;
}

export interface DownloadTask {
  id: string;
  candidateId: string;
  url: string;
  filename: string;
  status:
    "queued" | "starting" | "in_progress" | "completed" | "interrupted" | "cancelled" | "failed";
  browserDownloadId?: number;
  bytesReceived?: number;
  totalBytes?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PageTextDocument {
  id: string;
  pageUrl: string;
  title: string;
  content: string;
  language?: string;
  characterCount: number;
  capturedAt: number;
  truncated: boolean;
}

export interface ScanProgress {
  sessionId: string;
  status: ScanStatus;
  pagesQueued: number;
  pagesProcessed: number;
  filesDiscovered: number;
  errors: number;
  currentUrl?: string;
  requestsPerMinute?: number;
}

export interface AppSettings {
  scan: ScanConfig;
  customExtensions: Record<string, FileCategory>;
  customMimeTypes: Record<string, FileCategory>;
  scanStylesheets: boolean;
  scanImages: boolean;
  showLowConfidence: boolean;
  monitorDurationSeconds: number;
  downloadConcurrency: number;
  askWhereToSave: boolean;
  groupByDomain: boolean;
  groupByCategory: boolean;
  maxDownloadBytes: number;
  confirmBeforeDownload: boolean;
  skipUnknownDownloads: boolean;
  exportFormat: "txt" | "csv" | "json";
  retentionDays: number;
}

export type AppErrorCode =
  | "PERMISSION_DENIED"
  | "UNSUPPORTED_URL"
  | "BLOCKED_URL"
  | "ROBOTS_DISALLOWED"
  | "NETWORK_TIMEOUT"
  | "HTTP_UNAUTHORIZED"
  | "HTTP_FORBIDDEN"
  | "HTTP_NOT_FOUND"
  | "HTTP_RATE_LIMITED"
  | "HTTP_SERVER_ERROR"
  | "CONTENT_TOO_LARGE"
  | "UNSUPPORTED_CONTENT"
  | "PARSE_FAILED"
  | "DOWNLOAD_FAILED"
  | "SESSION_CANCELLED"
  | "DATABASE_ERROR"
  | "UNKNOWN_ERROR";

export interface StoredAppError {
  id: string;
  sessionId?: string;
  code: AppErrorCode;
  message: string;
  url?: string;
  createdAt: number;
}
