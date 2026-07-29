import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAlarmHandlers } from "@/background/alarm-manager";
import { scanSession } from "../helpers/fixtures";

const mocks = vi.hoisted(() => ({
  failScanSessionStart: vi.fn(),
  getSession: vi.fn(),
  getSettings: vi.fn(),
  purgeExpiredSessions: vi.fn(),
  stopLiveMonitor: vi.fn()
}));

vi.mock("@/database/db", () => ({
  getSession: mocks.getSession,
  purgeExpiredSessions: mocks.purgeExpiredSessions
}));
vi.mock("@/database/settings", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/background/session-lifecycle", () => ({
  failScanSessionStart: mocks.failScanSessionStart,
  stopLiveMonitor: mocks.stopLiveMonitor
}));

let alarmListener: ((alarm: chrome.alarms.Alarm) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.chrome = {
    alarms: {
      onAlarm: {
        addListener: vi.fn((listener: typeof alarmListener) => {
          alarmListener = listener;
        })
      }
    }
  } as unknown as typeof chrome;
  registerAlarmHandlers();
});

describe("alarm manager", () => {
  it("当前页扫描未返回结果时结束悬挂任务", async () => {
    const session = scanSession({ status: "running" });
    mocks.getSession.mockResolvedValue(session);

    alarmListener?.({
      name: `scan:${session.id}`,
      scheduledTime: Date.now(),
      persistAcrossSessions: false
    });

    await vi.waitFor(() =>
      expect(mocks.failScanSessionStart).toHaveBeenCalledWith(session, expect.any(Error))
    );
  });
});
