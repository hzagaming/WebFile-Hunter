import { getSettings, saveSettings } from "@/database/settings";
import { listSessions } from "@/database/db";
import { DownloadManager } from "./download-manager";
import { MessageRouter } from "./message-router";
import { NetworkMonitor } from "./network-monitor";
import { registerAlarmHandlers } from "./alarm-manager";
import { broadcast } from "./broadcast";
import { clearRuntimeSessionState } from "./session-manager";
import {
  handleLiveTabUpdated,
  reconcileInterruptedSessions,
  stopLiveMonitor,
  stopSessionsForRemovedOrigins,
  stopSessionsForTab
} from "./session-lifecycle";

const downloads = new DownloadManager();
new NetworkMonitor();
new MessageRouter(downloads);
registerAlarmHandlers();

async function ensureMaintenanceAlarm(): Promise<void> {
  if (await chrome.alarms.get("maintenance")) return;
  await chrome.alarms.create("maintenance", {
    delayInMinutes: 60,
    periodInMinutes: 1440
  });
}

void downloads.reconcile().catch(() => undefined);
void reconcileInterruptedSessions().catch(() => undefined);
void ensureMaintenanceAlarm().catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void getSettings()
    .then(saveSettings)
    .catch(() => undefined);
  void ensureMaintenanceAlarm().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await ensureMaintenanceAlarm();
    await clearRuntimeSessionState();
    for (const session of await listSessions()) {
      if (session.mode === "live_monitor" && session.status === "running") {
        await stopLiveMonitor(session);
      }
    }
  })().catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void stopSessionsForTab(tabId).catch(() => undefined);
});

chrome.tabs.onActivated.addListener(() => {
  broadcast({ type: "ACTIVE_CONTEXT_CHANGED" });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void handleLiveTabUpdated(tabId, changeInfo).catch(() => undefined);
  if (tab.active && (changeInfo.url !== undefined || changeInfo.status === "complete")) {
    broadcast({ type: "ACTIVE_CONTEXT_CHANGED" });
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  broadcast({ type: "ACTIVE_CONTEXT_CHANGED" });
});

chrome.permissions.onRemoved.addListener((permissions) => {
  const origins = permissions.origins ?? [];
  if (!origins.length) return;
  void stopSessionsForRemovedOrigins(origins).catch(() => undefined);
});
