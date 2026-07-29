import type {
  AppSettings,
  DownloadTask,
  FileCandidate,
  ScanConfig,
  ScanProgress,
  ScanSession
} from "@/types/models";
import type { PageScanResult } from "@/types/scanner";

export type ExtensionRequest =
  | { type: "GET_ACTIVE_CONTEXT" }
  | { type: "GET_SNAPSHOT"; payload?: { sessionId?: string } }
  | { type: "SCAN_CURRENT_PAGE"; payload: { tabId: number } }
  | { type: "START_LIVE_MONITOR"; payload: { tabId: number; origin: string } }
  | { type: "START_RECURSIVE_CRAWL"; payload: { tabId: number; config: ScanConfig } }
  | { type: "STOP_SCAN"; payload: { sessionId: string } }
  | { type: "PAUSE_SCAN"; payload: { sessionId: string } }
  | { type: "RESUME_SCAN"; payload: { sessionId: string } }
  | { type: "CONTENT_SCAN_RESULT"; payload: { sessionId: string; result: PageScanResult } }
  | { type: "CONTENT_RESOURCE_BATCH"; payload: { sessionId: string; result: PageScanResult } }
  | { type: "PROBE_METADATA"; payload: { sessionId: string; candidateId: string } }
  | { type: "DELETE_RESULTS"; payload: { sessionId: string; candidateIds: string[] } }
  | { type: "QUEUE_DOWNLOADS"; payload: { candidateIds: string[] } }
  | {
      type: "DOWNLOAD_ACTION";
      payload: {
        taskId?: string;
        action:
          "start" | "pause" | "resume" | "cancel" | "retry" | "clear_completed" | "open" | "show";
      };
    }
  | { type: "DELETE_SESSION"; payload: { sessionId: string } }
  | { type: "CLEAR_HISTORY" }
  | { type: "CLEAR_ALL_DATA" }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; payload: { settings: AppSettings } }
  | { type: "GET_GRANTED_ORIGINS" }
  | { type: "REVOKE_ORIGIN"; payload: { originPattern: string } };

export type ExtensionEvent =
  | { type: "SCAN_PROGRESS"; payload: ScanProgress }
  | { type: "FILES_DISCOVERED"; payload: { sessionId: string; files: FileCandidate[] } }
  | { type: "DOWNLOADS_UPDATED"; payload: DownloadTask[] }
  | { type: "SESSION_UPDATED"; payload: ScanSession }
  | { type: "APP_ERROR"; payload: { code: string; message: string; sessionId?: string } };

export type ExtensionMessage = ExtensionRequest | ExtensionEvent;

export interface AppSnapshot {
  activeTab?: { id: number; url: string; title: string; origin: string };
  activeSession?: ScanSession;
  sessions: ScanSession[];
  files: FileCandidate[];
  downloads: DownloadTask[];
  settings: AppSettings;
  incompleteSessions: ScanSession[];
}

export type MessageResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
