import { getSettings, saveSettings } from "@/database/settings";
import { listSessions } from "@/database/db";
import { DownloadManager } from "./download-manager";
import { MessageRouter } from "./message-router";
import { NetworkMonitor } from "./network-monitor";
import { registerAlarmHandlers } from "./alarm-manager";
import { clearRuntimeSessionState } from "./session-manager";
import {
  handleLiveTabUpdated,
  stopLiveMonitor,
  stopSessionsForRemovedOrigins,
  stopSessionsForTab
} from "./session-lifecycle";

const downloads = new DownloadManager();
new NetworkMonitor();
new MessageRouter(downloads);
registerAlarmHandlers();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void getSettings()
    .then(saveSettings)
    .catch(() => undefined);
  void chrome.alarms.create("maintenance", { delayInMinutes: 60, periodInMinutes: 1440 });
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await chrome.alarms.create("maintenance", { delayInMinutes: 60, periodInMinutes: 1440 });
    await clearRuntimeSessionState();
    for (const session of await listSessions()) {
      if (session.mode === "live_monitor" && session.status === "running") {
        await stopLiveMonitor(session);
      }
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void stopSessionsForTab(tabId).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void handleLiveTabUpdated(tabId, changeInfo).catch(() => undefined);
});

chrome.permissions.onRemoved.addListener((permissions) => {
  const origins = permissions.origins ?? [];
  if (!origins.length) return;
  void stopSessionsForRemovedOrigins(origins).catch(() => undefined);
});
