import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { mergeCandidates } from "@/core/url-deduplicator";
import type {
  CrawlQueueItem,
  DownloadTask,
  FileCandidate,
  ScanSession,
  StoredAppError
} from "@/types/models";

interface StoredFile extends FileCandidate {
  sessionId: string;
}

export interface StoredQueueItem extends CrawlQueueItem {
  id: string;
  sessionId: string;
  order: number;
}

export interface CrawlCheckpoint {
  sessionId: string;
  savedAt: number;
  queue: StoredQueueItem[];
  visitedUrls: string[];
}

interface WebFileHunterDb extends DBSchema {
  sessions: {
    key: string;
    value: ScanSession;
    indexes: { "by-created": number; "by-status": string };
  };
  files: {
    key: string;
    value: StoredFile;
    indexes: { "by-session": string; "by-session-url": [string, string] };
  };
  queue: {
    key: string;
    value: StoredQueueItem;
    indexes: { "by-session": string; "by-session-order": [string, number] };
  };
  visited: {
    key: string;
    value: { id: string; sessionId: string; url: string; visitedAt: number };
    indexes: { "by-session": string };
  };
  errors: {
    key: string;
    value: StoredAppError;
    indexes: { "by-session": string; "by-created": number };
  };
  downloads: {
    key: string;
    value: DownloadTask;
    indexes: { "by-status": string; "by-created": number };
  };
  checkpoints: {
    key: string;
    value: CrawlCheckpoint;
  };
}

let databasePromise: Promise<IDBPDatabase<WebFileHunterDb>> | undefined;

export function getDatabase(): Promise<IDBPDatabase<WebFileHunterDb>> {
  databasePromise ??= openDB<WebFileHunterDb>("webfile-hunter", 1, {
    upgrade(database) {
      const sessions = database.createObjectStore("sessions", { keyPath: "id" });
      sessions.createIndex("by-created", "createdAt");
      sessions.createIndex("by-status", "status");

      const files = database.createObjectStore("files", { keyPath: "id" });
      files.createIndex("by-session", "sessionId");
      files.createIndex("by-session-url", ["sessionId", "canonicalUrl"], { unique: true });

      const queue = database.createObjectStore("queue", { keyPath: "id" });
      queue.createIndex("by-session", "sessionId");
      queue.createIndex("by-session-order", ["sessionId", "order"]);

      const visited = database.createObjectStore("visited", { keyPath: "id" });
      visited.createIndex("by-session", "sessionId");

      const errors = database.createObjectStore("errors", { keyPath: "id" });
      errors.createIndex("by-session", "sessionId");
      errors.createIndex("by-created", "createdAt");

      const downloads = database.createObjectStore("downloads", { keyPath: "id" });
      downloads.createIndex("by-status", "status");
      downloads.createIndex("by-created", "createdAt");

      database.createObjectStore("checkpoints", { keyPath: "sessionId" });
    }
  });
  return databasePromise;
}

export async function putSession(session: ScanSession): Promise<void> {
  const database = await getDatabase();
  await database.put("sessions", session);
}

export async function getSession(id: string): Promise<ScanSession | undefined> {
  return (await getDatabase()).get("sessions", id);
}

export async function listSessions(): Promise<ScanSession[]> {
  const sessions = await (await getDatabase()).getAllFromIndex("sessions", "by-created");
  return sessions.reverse();
}

export async function putFiles(
  sessionId: string,
  candidates: readonly FileCandidate[]
): Promise<FileCandidate[]> {
  if (!candidates.length) return [];
  const database = await getDatabase();
  const transaction = database.transaction("files", "readwrite");
  const stored: FileCandidate[] = [];
  for (const candidate of candidates) {
    const existing = await transaction.store
      .index("by-session-url")
      .get([sessionId, candidate.canonicalUrl]);
    const merged = existing ? mergeCandidates(existing, candidate) : candidate;
    await transaction.store.put({ ...merged, sessionId });
    stored.push(merged);
  }
  await transaction.done;
  return stored;
}

export async function listFiles(sessionId: string): Promise<FileCandidate[]> {
  const rows = await (await getDatabase()).getAllFromIndex("files", "by-session", sessionId);
  return rows.map(({ sessionId: storedSessionId, ...candidate }) => {
    void storedSessionId;
    return candidate;
  });
}

export async function getFile(id: string): Promise<FileCandidate | undefined> {
  const row = await (await getDatabase()).get("files", id);
  if (!row) return undefined;
  const { sessionId: storedSessionId, ...candidate } = row;
  void storedSessionId;
  return candidate;
}

export async function deleteSessionFiles(
  sessionId: string,
  candidateIds: readonly string[]
): Promise<number> {
  const database = await getDatabase();
  const transaction = database.transaction("files", "readwrite");
  for (const id of candidateIds) {
    const row = await transaction.store.get(id);
    if (row?.sessionId === sessionId) await transaction.store.delete(id);
  }
  const remaining = await transaction.store.index("by-session").count(sessionId);
  await transaction.done;
  return remaining;
}

export async function saveCheckpoint(checkpoint: CrawlCheckpoint): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(["checkpoints", "queue", "visited"], "readwrite");
  const existingQueue = await transaction
    .objectStore("queue")
    .index("by-session")
    .getAllKeys(checkpoint.sessionId);
  const existingVisited = await transaction
    .objectStore("visited")
    .index("by-session")
    .getAllKeys(checkpoint.sessionId);
  await Promise.all(existingQueue.map((key) => transaction.objectStore("queue").delete(key)));
  await Promise.all(existingVisited.map((key) => transaction.objectStore("visited").delete(key)));
  await Promise.all(checkpoint.queue.map((item) => transaction.objectStore("queue").put(item)));
  await Promise.all(
    checkpoint.visitedUrls.map((url) =>
      transaction.objectStore("visited").put({
        id: `${checkpoint.sessionId}:${url}`,
        sessionId: checkpoint.sessionId,
        url,
        visitedAt: checkpoint.savedAt
      })
    )
  );
  await transaction.objectStore("checkpoints").put(checkpoint);
  await transaction.done;
}

export async function getCheckpoint(sessionId: string): Promise<CrawlCheckpoint | undefined> {
  return (await getDatabase()).get("checkpoints", sessionId);
}

export async function deleteCheckpoint(sessionId: string): Promise<void> {
  const database = await getDatabase();
  await database.delete("checkpoints", sessionId);
}

export async function putDownload(task: DownloadTask): Promise<void> {
  await (await getDatabase()).put("downloads", task);
}

export async function listDownloads(): Promise<DownloadTask[]> {
  const rows = await (await getDatabase()).getAllFromIndex("downloads", "by-created");
  return rows.reverse();
}

export async function deleteDownloads(ids: readonly string[]): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction("downloads", "readwrite");
  await Promise.all(ids.map((id) => transaction.store.delete(id)));
  await transaction.done;
}

export async function putAppError(error: StoredAppError): Promise<void> {
  await (await getDatabase()).put("errors", error);
}

export async function deleteSessionData(sessionId: string): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(
    ["sessions", "files", "queue", "visited", "errors", "checkpoints"],
    "readwrite"
  );
  const indexedStores = ["files", "queue", "visited", "errors"] as const;
  for (const storeName of indexedStores) {
    const store = transaction.objectStore(storeName);
    const keys = await store.index("by-session").getAllKeys(sessionId);
    await Promise.all(keys.map((key) => store.delete(key)));
  }
  await transaction.objectStore("sessions").delete(sessionId);
  await transaction.objectStore("checkpoints").delete(sessionId);
  await transaction.done;
}

export async function purgeExpiredSessions(retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const expired = (await listSessions()).filter(
    (session) =>
      session.createdAt < cutoff && ["completed", "cancelled", "failed"].includes(session.status)
  );
  for (const session of expired) await deleteSessionData(session.id);
  return expired.length;
}

export async function clearHistoryData(): Promise<void> {
  const database = await getDatabase();
  const names = ["sessions", "files", "queue", "visited", "errors", "checkpoints"] as const;
  const transaction = database.transaction(names, "readwrite");
  await Promise.all(names.map((name) => transaction.objectStore(name).clear()));
  await transaction.done;
}

export async function clearDatabase(): Promise<void> {
  const database = await getDatabase();
  const names = [
    "sessions",
    "files",
    "queue",
    "visited",
    "errors",
    "downloads",
    "checkpoints"
  ] as const;
  const transaction = database.transaction(names, "readwrite");
  await Promise.all(names.map((name) => transaction.objectStore(name).clear()));
  await transaction.done;
}
