import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeSessionState,
  createSession,
  finishSession
} from "@/background/session-manager";
import { clearDatabase } from "@/database/db";

let sessionStorage: Record<string, unknown>;
const setSessionStorage = vi.fn<(value: Record<string, unknown>) => Promise<void>>();

beforeEach(async () => {
  sessionStorage = {};
  setSessionStorage.mockReset().mockImplementation((value) => {
    Object.assign(sessionStorage, structuredClone(value));
    return Promise.resolve();
  });
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    storage: {
      session: {
        get: vi.fn((key: string) => {
          const value = sessionStorage[key];
          return Promise.resolve({
            [key]: value === undefined ? undefined : structuredClone(value)
          });
        }),
        set: setSessionStorage,
        remove: vi.fn((keys: string[]) => {
          keys.forEach((key) => delete sessionStorage[key]);
          return Promise.resolve();
        })
      }
    }
  } as unknown as typeof chrome;
  await clearDatabase();
});

describe("session manager", () => {
  it("拒绝同一标签页叠加运行任务", async () => {
    const tab = { id: 7, url: "https://example.test/page" } as chrome.tabs.Tab;
    await createSession(tab, "live_monitor");

    await expect(createSession(tab, "current_page")).rejects.toThrow("已有进行中的任务");
    await expect(
      createSession({ ...tab, url: "https://other.test/page" }, "current_page")
    ).rejects.toThrow("已有进行中的任务");
  });

  it("旧任务结束时不会清除较新任务的活动映射", async () => {
    const tab = { id: 7, url: "https://example.test/page" } as chrome.tabs.Tab;
    const old = await createSession(tab, "current_page");
    sessionStorage.activeSessionByTab = { "7": "session-newer" };

    await finishSession(old.id, "completed");

    expect(sessionStorage.activeSessionByTab).toEqual({ "7": "session-newer" });
  });

  it("任务结束与新建并发时保留新任务的活动映射", async () => {
    const tab = { id: 7, url: "https://example.test/page" } as chrome.tabs.Tab;
    const old = await createSession(tab, "current_page");
    let releaseClear: (() => void) | undefined;
    let markClearStarted: (() => void) | undefined;
    const clearStarted = new Promise<void>((resolve) => (markClearStarted = resolve));
    setSessionStorage.mockImplementation((value) => {
      const active = value.activeSessionByTab as Record<string, string> | undefined;
      if (active && !("7" in active) && !releaseClear) {
        markClearStarted?.();
        return new Promise<void>((resolve) => {
          releaseClear = () => {
            Object.assign(sessionStorage, structuredClone(value));
            resolve();
          };
        });
      }
      Object.assign(sessionStorage, structuredClone(value));
      return Promise.resolve();
    });

    const finishing = finishSession(old.id, "completed");
    await clearStarted;
    const creating = createSession({ ...tab, url: "https://other.test/page" }, "current_page");
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseClear?.();
    const [, created] = await Promise.all([finishing, creating]);

    expect(sessionStorage.activeSessionByTab).toEqual({ "7": created.id });
  });

  it("运行态清理等待在途映射写入后再删除", async () => {
    const tab = { id: 7, url: "https://example.test/page" } as chrome.tabs.Tab;
    let releaseWrite: (() => void) | undefined;
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => (markWriteStarted = resolve));
    setSessionStorage.mockImplementation((value) => {
      markWriteStarted?.();
      return new Promise<void>((resolve) => {
        releaseWrite = () => {
          Object.assign(sessionStorage, structuredClone(value));
          resolve();
        };
      });
    });

    const creating = createSession(tab, "current_page");
    await writeStarted;
    const clearing = clearRuntimeSessionState();
    releaseWrite?.();
    await Promise.all([creating, clearing]);

    expect(sessionStorage.activeSessionByTab).toBeUndefined();
    expect(sessionStorage.liveSessionByTab).toBeUndefined();
  });
});
