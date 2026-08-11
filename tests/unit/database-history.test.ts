import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createFileCandidate } from "@/core/candidate-factory";
import {
  clearDatabase,
  clearHistoryData,
  deleteSessionFiles,
  listDownloads,
  listFiles,
  listSessions,
  putDownload,
  putFiles,
  putSession,
  setFileMetadataStatus
} from "@/database/db";
import { DEFAULT_SCAN_CONFIG } from "@/utils/defaults";
import type { ScanSession } from "@/types/models";

function session(id: string): ScanSession {
  return {
    id,
    mode: "current_page",
    status: "completed",
    tabId: 1,
    startUrl: "https://example.test/",
    origin: "https://example.test",
    createdAt: Date.now(),
    pagesQueued: 0,
    pagesProcessed: 1,
    filesDiscovered: 1,
    errors: 0,
    config: DEFAULT_SCAN_CONFIG
  };
}

function file(path: string) {
  return createFileCandidate({
    url: `https://example.test/${path}`,
    source: "DOM_ATTRIBUTE",
    sourcePageUrl: "https://example.test/"
  });
}

afterEach(clearDatabase);

describe("history database operations", () => {
  it("主动重探可覆盖已完成的元数据状态", async () => {
    const storedSession = session("session-metadata");
    const storedFile = {
      ...file("metadata.pdf"),
      metadataStatus: "complete" as const
    };
    await putSession(storedSession);
    await putFiles(storedSession.id, [storedFile]);

    await expect(
      setFileMetadataStatus(storedSession.id, storedFile.id, "pending")
    ).resolves.toEqual(expect.objectContaining({ metadataStatus: "pending" }));
    await expect(setFileMetadataStatus(storedSession.id, storedFile.id, "failed")).resolves.toEqual(
      expect.objectContaining({ metadataStatus: "failed" })
    );
    expect(await listFiles(storedSession.id)).toEqual([
      expect.objectContaining({ id: storedFile.id, metadataStatus: "failed" })
    ]);
  });

  it("只删除指定任务的结果并返回剩余数量", async () => {
    const first = session("session-first");
    const second = session("session-second");
    const firstA = file("first-a.txt");
    const firstB = file("first-b.txt");
    const secondFile = file("second.txt");
    await putSession(first);
    await putSession(second);
    await putFiles(first.id, [firstA, firstB]);
    await putFiles(second.id, [secondFile]);

    await expect(deleteSessionFiles(first.id, [firstA.id, secondFile.id])).resolves.toBe(1);
    expect(await listFiles(first.id)).toEqual([expect.objectContaining({ id: firstB.id })]);
    expect(await listFiles(second.id)).toEqual([expect.objectContaining({ id: secondFile.id })]);
  });

  it("清空扫描历史但保留下载记录", async () => {
    const storedSession = session("session-history");
    const storedFile = file("history.txt");
    await putSession(storedSession);
    await putFiles(storedSession.id, [storedFile]);
    await putDownload({
      id: "download-history",
      candidateId: storedFile.id,
      url: storedFile.canonicalUrl,
      filename: storedFile.filename,
      status: "completed",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    await clearHistoryData();

    expect(await listSessions()).toEqual([]);
    expect(await listFiles(storedSession.id)).toEqual([]);
    expect(await listDownloads()).toHaveLength(1);
  });
});
