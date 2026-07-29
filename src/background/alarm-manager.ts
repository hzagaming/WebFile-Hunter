import { getSession, purgeExpiredSessions } from "@/database/db";
import { getSettings } from "@/database/settings";
import { stopLiveMonitor } from "./session-lifecycle";

export function registerAlarmHandlers(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "maintenance") {
      void getSettings()
        .then((settings) => purgeExpiredSessions(settings.retentionDays))
        .catch(() => undefined);
      return;
    }
    if (!alarm.name.startsWith("monitor:")) return;
    const sessionId = alarm.name.slice("monitor:".length);
    void (async () => {
      const session = await getSession(sessionId);
      if (!session || session.status !== "running" || session.mode !== "live_monitor") return;
      await stopLiveMonitor(session, "completed");
    })();
  });
}
