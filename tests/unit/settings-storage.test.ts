import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "@/database/settings";
import { DEFAULT_SETTINGS } from "@/utils/defaults";

beforeEach(() => {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            settings: {
              scan: { maxDepth: Number.NaN, requestTimeoutMs: 999_999 },
              monitorDurationSeconds: 0,
              downloadConcurrency: 99,
              maxDownloadBytes: Number.NaN,
              retentionDays: 99_999
            }
          })
        }
      }
    }
  });
});

describe("settings storage", () => {
  it("读取本地设置时也执行安全范围归一化", async () => {
    await expect(getSettings()).resolves.toMatchObject({
      scan: {
        maxDepth: DEFAULT_SETTINGS.scan.maxDepth,
        requestTimeoutMs: 120_000
      },
      monitorDurationSeconds: 10,
      downloadConcurrency: 6,
      maxDownloadBytes: DEFAULT_SETTINGS.maxDownloadBytes,
      retentionDays: 3650
    });
  });
});
