import type { AppSettings, ScanConfig } from "@/types/models";

export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  respectRobots: true,
  maxDepth: 2,
  maxPages: 200,
  maxConcurrency: 2,
  minDelayMs: 800,
  requestTimeoutMs: 15_000,
  maxHtmlBytes: 2 * 1024 * 1024,
  probeMetadata: true,
  followRedirects: true,
  maxRedirects: 5,
  retries: 2,
  excludeDangerousActions: true
};

export const DEFAULT_SETTINGS: AppSettings = {
  scan: DEFAULT_SCAN_CONFIG,
  customExtensions: {},
  customMimeTypes: {},
  scanStylesheets: true,
  scanImages: true,
  showLowConfidence: false,
  monitorDurationSeconds: 60,
  downloadConcurrency: 2,
  askWhereToSave: false,
  groupByDomain: false,
  groupByCategory: false,
  maxDownloadBytes: 2 * 1024 * 1024 * 1024,
  confirmBeforeDownload: true,
  skipUnknownDownloads: true,
  exportFormat: "csv",
  retentionDays: 30
};

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  const normalized = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(max, Math.max(min, normalized));
}

export function clampScanConfig(input: Partial<ScanConfig>): ScanConfig {
  return {
    respectRobots:
      typeof input.respectRobots === "boolean"
        ? input.respectRobots
        : DEFAULT_SCAN_CONFIG.respectRobots,
    maxDepth: boundedInteger(input.maxDepth, DEFAULT_SCAN_CONFIG.maxDepth, 0, 5),
    maxPages: boundedInteger(input.maxPages, DEFAULT_SCAN_CONFIG.maxPages, 1, 2000),
    maxConcurrency: boundedInteger(input.maxConcurrency, DEFAULT_SCAN_CONFIG.maxConcurrency, 1, 6),
    minDelayMs: boundedInteger(input.minDelayMs, DEFAULT_SCAN_CONFIG.minDelayMs, 500, 60_000),
    requestTimeoutMs: boundedInteger(
      input.requestTimeoutMs,
      DEFAULT_SCAN_CONFIG.requestTimeoutMs,
      1000,
      120_000
    ),
    maxHtmlBytes: boundedInteger(
      input.maxHtmlBytes,
      DEFAULT_SCAN_CONFIG.maxHtmlBytes,
      1024,
      5 * 1024 * 1024
    ),
    probeMetadata:
      typeof input.probeMetadata === "boolean"
        ? input.probeMetadata
        : DEFAULT_SCAN_CONFIG.probeMetadata,
    followRedirects:
      typeof input.followRedirects === "boolean"
        ? input.followRedirects
        : DEFAULT_SCAN_CONFIG.followRedirects,
    maxRedirects: boundedInteger(input.maxRedirects, DEFAULT_SCAN_CONFIG.maxRedirects, 0, 5),
    retries: boundedInteger(input.retries, DEFAULT_SCAN_CONFIG.retries, 0, 3),
    excludeDangerousActions:
      typeof input.excludeDangerousActions === "boolean"
        ? input.excludeDangerousActions
        : DEFAULT_SCAN_CONFIG.excludeDangerousActions
  };
}

type AppSettingsInput = Omit<Partial<AppSettings>, "scan"> & { scan?: Partial<ScanConfig> };

export function clampAppSettings(input: AppSettingsInput): AppSettings {
  const maxDownloadBytes = Number.isFinite(input.maxDownloadBytes)
    ? Math.max(1, Math.trunc(input.maxDownloadBytes as number))
    : DEFAULT_SETTINGS.maxDownloadBytes;
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    scan: clampScanConfig(input.scan ?? DEFAULT_SETTINGS.scan),
    monitorDurationSeconds: boundedInteger(
      input.monitorDurationSeconds,
      DEFAULT_SETTINGS.monitorDurationSeconds,
      10,
      3600
    ),
    downloadConcurrency: boundedInteger(
      input.downloadConcurrency,
      DEFAULT_SETTINGS.downloadConcurrency,
      1,
      6
    ),
    maxDownloadBytes,
    retentionDays: boundedInteger(input.retentionDays, DEFAULT_SETTINGS.retentionDays, 1, 3650)
  };
}
