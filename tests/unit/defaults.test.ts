import { describe, expect, it } from "vitest";
import { clampAppSettings, clampScanConfig, DEFAULT_SETTINGS } from "@/utils/defaults";

describe("clampScanConfig", () => {
  it("强制执行递归扫描硬限制", () => {
    expect(
      clampScanConfig({
        maxDepth: 99,
        maxPages: 99_999,
        maxConcurrency: 99,
        minDelayMs: 1,
        maxHtmlBytes: 99_999_999,
        retries: 99,
        maxQueryVariantsPerPath: 999,
        maxStylesheets: 9999
      })
    ).toMatchObject({
      maxDepth: 5,
      maxPages: 2000,
      maxConcurrency: 6,
      minDelayMs: 500,
      maxHtmlBytes: 5 * 1024 * 1024,
      retries: 3,
      maxQueryVariantsPerPath: 50,
      maxStylesheets: 500
    });
  });

  it("使用默认值替换非有限数字并限制请求超时", () => {
    expect(
      clampScanConfig({
        maxDepth: Number.NaN,
        requestTimeoutMs: 999_999
      })
    ).toMatchObject({
      maxDepth: DEFAULT_SETTINGS.scan.maxDepth,
      requestTimeoutMs: 120_000
    });
  });

  it("丢弃未生效的旧配置与未知字段", () => {
    const result = clampScanConfig({
      ...DEFAULT_SETTINGS.scan,
      sameOriginOnly: false,
      excludeLogout: false,
      obsolete: true
    } as typeof DEFAULT_SETTINGS.scan & { obsolete: boolean });

    expect(result).not.toHaveProperty("sameOriginOnly");
    expect(result).not.toHaveProperty("excludeLogout");
    expect(result).not.toHaveProperty("obsolete");
  });

  it("限制设置页的监听、下载与保留范围", () => {
    expect(
      clampAppSettings({
        ...DEFAULT_SETTINGS,
        monitorDurationSeconds: 0,
        downloadConcurrency: 99,
        maxDownloadBytes: Number.NaN,
        retentionDays: 99_999
      })
    ).toMatchObject({
      monitorDurationSeconds: 10,
      downloadConcurrency: 6,
      maxDownloadBytes: DEFAULT_SETTINGS.maxDownloadBytes,
      retentionDays: 3650
    });
  });
});
