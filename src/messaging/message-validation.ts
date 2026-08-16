import { z } from "zod";
import { MAX_PAGE_TEXT_CHARACTERS, MAX_TEXT_LANGUAGE_LENGTH } from "@/core/page-text-policy";

const sessionId = z.string().min(3).max(128);
const tabId = z.number().int().nonnegative();
const scanConfig = z
  .object({
    respectRobots: z.boolean(),
    maxDepth: z.number().int().min(0).max(5),
    maxPages: z.number().int().min(1).max(2000),
    maxQueryVariantsPerPath: z.number().int().min(1).max(50),
    maxStylesheets: z.number().int().min(1).max(500),
    maxConcurrency: z.number().int().min(1).max(6),
    minDelayMs: z.number().int().min(500),
    requestTimeoutMs: z.number().int().min(1000).max(120_000),
    maxHtmlBytes: z
      .number()
      .int()
      .min(1024)
      .max(5 * 1024 * 1024),
    discoverSitemaps: z.boolean(),
    capturePageText: z.boolean(),
    probeMetadata: z.boolean(),
    followRedirects: z.boolean(),
    maxRedirects: z.number().int().min(0).max(5),
    retries: z.number().int().min(0).max(3),
    excludeDangerousActions: z.boolean()
  })
  .strict();

const rawResource = z
  .object({
    url: z.string().max(16_384),
    source: z.enum([
      "DOM_ATTRIBUTE",
      "DOWNLOAD_ATTRIBUTE",
      "CSS_URL",
      "PERFORMANCE_ENTRY",
      "NETWORK_REQUEST",
      "NETWORK_HEADER",
      "CRAWLED_PAGE",
      "MANUAL_URL"
    ]),
    tagName: z.string().max(64).optional(),
    attribute: z.string().max(64).optional(),
    mimeType: z.string().max(256).optional(),
    hasDownload: z.boolean().optional(),
    resourceHint: z.enum(["image", "resource", "stylesheet"]).optional(),
    isExternal: z.boolean()
  })
  .strict();

const pageScanResult = z
  .object({
    pageUrl: z.string().max(16_384),
    baseUrl: z.string().max(16_384).optional(),
    title: z.string().max(2048),
    resources: z.array(rawResource).max(20_000),
    pages: z
      .array(
        z
          .object({
            url: z.string().max(16_384),
            tagName: z.string().max(64),
            noFollow: z.boolean()
          })
          .strict()
      )
      .max(20_000)
  })
  .strict();

const pageScanResultWithText = pageScanResult.extend({
  text: z
    .object({
      content: z.string().max(MAX_PAGE_TEXT_CHARACTERS),
      language: z.string().max(MAX_TEXT_LANGUAGE_LENGTH).optional(),
      truncated: z.boolean()
    })
    .strict()
    .optional()
});

const settings = z
  .object({
    scan: scanConfig,
    customExtensions: z.record(
      z.string(),
      z.enum([
        "audio",
        "video",
        "text",
        "document",
        "ebook",
        "archive",
        "image",
        "subtitle",
        "data",
        "code",
        "font",
        "model",
        "unknown"
      ])
    ),
    customMimeTypes: z.record(
      z.string(),
      z.enum([
        "audio",
        "video",
        "text",
        "document",
        "ebook",
        "archive",
        "image",
        "subtitle",
        "data",
        "code",
        "font",
        "model",
        "unknown"
      ])
    ),
    scanStylesheets: z.boolean(),
    scanImages: z.boolean(),
    showLowConfidence: z.boolean(),
    monitorDurationSeconds: z.number().int().min(10).max(3600),
    downloadConcurrency: z.number().int().min(1).max(6),
    askWhereToSave: z.boolean(),
    groupByDomain: z.boolean(),
    groupByCategory: z.boolean(),
    maxDownloadBytes: z.number().int().positive(),
    confirmBeforeDownload: z.boolean(),
    skipUnknownDownloads: z.boolean(),
    exportFormat: z.enum(["txt", "csv", "json"]),
    retentionDays: z.number().int().min(1).max(3650)
  })
  .strict();

export const extensionRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GET_ACTIVE_CONTEXT") }).strict(),
  z
    .object({
      type: z.literal("GET_SNAPSHOT"),
      payload: z
        .object({ sessionId: sessionId.optional(), tabId: tabId.optional() })
        .strict()
        .optional()
    })
    .strict(),
  z.object({ type: z.literal("GET_DOWNLOADS") }).strict(),
  z
    .object({ type: z.literal("SCAN_CURRENT_PAGE"), payload: z.object({ tabId }).strict() })
    .strict(),
  z
    .object({
      type: z.literal("START_LIVE_MONITOR"),
      payload: z.object({ tabId, origin: z.string().url() }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("START_RECURSIVE_CRAWL"),
      payload: z.object({ tabId, config: scanConfig }).strict()
    })
    .strict(),
  z.object({ type: z.literal("STOP_SCAN"), payload: z.object({ sessionId }).strict() }).strict(),
  z.object({ type: z.literal("PAUSE_SCAN"), payload: z.object({ sessionId }).strict() }).strict(),
  z.object({ type: z.literal("RESUME_SCAN"), payload: z.object({ sessionId }).strict() }).strict(),
  z
    .object({
      type: z.literal("CONTENT_SCAN_RESULT"),
      payload: z.object({ sessionId, result: pageScanResultWithText }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("CONTENT_RESOURCE_BATCH"),
      payload: z.object({ sessionId, result: pageScanResult }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("PROBE_METADATA"),
      payload: z.object({ sessionId, candidateId: z.string().min(3) }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("DELETE_RESULTS"),
      payload: z.object({ sessionId, candidateIds: z.array(z.string()).max(20_000) }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("QUEUE_DOWNLOADS"),
      payload: z.object({ candidateIds: z.array(z.string()).min(1).max(20_000) }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("DOWNLOAD_ACTION"),
      payload: z
        .object({
          taskId: z.string().optional(),
          action: z.enum([
            "start",
            "pause",
            "resume",
            "cancel",
            "retry",
            "clear_completed",
            "open",
            "show"
          ])
        })
        .strict()
    })
    .strict(),
  z
    .object({ type: z.literal("DELETE_SESSION"), payload: z.object({ sessionId }).strict() })
    .strict(),
  z.object({ type: z.literal("CLEAR_HISTORY") }).strict(),
  z.object({ type: z.literal("CLEAR_ALL_DATA") }).strict(),
  z.object({ type: z.literal("GET_SETTINGS") }).strict(),
  z.object({ type: z.literal("SAVE_SETTINGS"), payload: z.object({ settings }).strict() }).strict(),
  z.object({ type: z.literal("REVOKE_ALL_SITES") }).strict(),
  z
    .object({
      type: z.literal("REVOKE_ORIGIN"),
      payload: z.object({ originPattern: z.string().max(4096) }).strict()
    })
    .strict()
]);

export function validateExtensionRequest(value: unknown) {
  return extensionRequestSchema.safeParse(value);
}
