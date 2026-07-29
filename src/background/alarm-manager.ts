import { getSession, purgeExpiredSessions } from "@/database/db";
import { getSettings } from "@/database/settings";
import { failScanSessionStart, stopLiveMonitor } from "./session-lifecycle";

export function registerAlarmHandlers(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "maintenance") {
      void getSettings()
        .then((settings) => purgeExpiredSessions(settings.retentionDays))
        .catch(() => undefined);
      return;
    }
    const alarmType = alarm.name.startsWith("monitor:")
      ? "monitor"
      : alarm.name.startsWith("scan:")
        ? "scan"
        : undefined;
    if (!alarmType) return;
    const sessionId = alarm.name.slice(alarmType.length + 1);
    void (async () => {
      const session = await getSession(sessionId);
      if (!session || session.status !== "running") return;
      if (alarmType === "monitor" && session.mode === "live_monitor") {
        await stopLiveMonitor(session, "completed");
      } else if (alarmType === "scan" && session.mode === "current_page") {
        await failScanSessionStart(session, new Error("页面扫描超时，请刷新页面后重试。"));
      }
    })().catch(() => undefined);
  });
}
