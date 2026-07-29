import { sanitizeFilename } from "@/core/filename-sanitizer";
import { inspectUrlSafety } from "@/core/url-security";
import { deleteDownloads, getFile, listDownloads, putDownload } from "@/database/db";
import { getSettings } from "@/database/settings";
import { broadcast } from "./broadcast";
import { createId } from "@/utils/id";
import type { DownloadTask, FileCandidate } from "@/types/models";

export class DownloadManager {
  #running = false;
  #paused = true;

  constructor() {
    chrome.downloads.onChanged.addListener((delta) => void this.#handleChanged(delta));
  }

  async queue(candidateIds: readonly string[]): Promise<DownloadTask[]> {
    const settings = await getSettings();
    const tasks: DownloadTask[] = [];
    for (const candidateId of candidateIds) {
      const candidate = await getFile(candidateId);
      if (!candidate) continue;
      const safety = inspectUrlSafety(candidate.finalUrl ?? candidate.canonicalUrl, {
        excludeDangerousActions: false
      });
      if (!safety.safe || !candidate.isDownloadable) continue;
      if (settings.skipUnknownDownloads && candidate.category === "unknown") continue;
      if (
        candidate.contentLength !== undefined &&
        candidate.contentLength > settings.maxDownloadBytes
      )
        continue;
      const now = Date.now();
      const task: DownloadTask = {
        id: createId("download"),
        candidateId,
        url: candidate.finalUrl ?? candidate.canonicalUrl,
        filename: await this.#buildFilename(candidate),
        status: "queued",
        createdAt: now,
        updatedAt: now
      };
      await putDownload(task);
      tasks.push(task);
    }
    await this.#notify();
    return tasks;
  }

  async action(
    action: "start" | "pause" | "resume" | "cancel" | "retry" | "clear_completed" | "open" | "show",
    taskId?: string
  ): Promise<void> {
    if (action === "start" || action === "resume") {
      this.#paused = false;
      await this.#pump();
      return;
    }
    if (action === "pause") {
      this.#paused = true;
      return;
    }
    const task = taskId ? (await listDownloads()).find((item) => item.id === taskId) : undefined;
    if (action === "cancel" && task) {
      if (task.browserDownloadId !== undefined)
        await chrome.downloads.cancel(task.browserDownloadId);
      await putDownload({ ...task, status: "cancelled", updatedAt: Date.now() });
    } else if (action === "retry" && task) {
      const retryable: DownloadTask = { ...task };
      delete retryable.error;
      delete retryable.browserDownloadId;
      await putDownload({
        ...retryable,
        status: "queued",
        updatedAt: Date.now()
      });
      await this.#pump();
    } else if (action === "clear_completed") {
      const completed = (await listDownloads())
        .filter((item) => item.status === "completed" || item.status === "cancelled")
        .map((item) => item.id);
      await deleteDownloads(completed);
    } else if ((action === "open" || action === "show") && task?.browserDownloadId !== undefined) {
      if (action === "open") await chrome.downloads.open(task.browserDownloadId);
      else chrome.downloads.show(task.browserDownloadId);
    }
    await this.#notify();
  }

  async #pump(): Promise<void> {
    if (this.#running || this.#paused) return;
    this.#running = true;
    try {
      const settings = await getSettings();
      while (!this.#paused) {
        const tasks = await listDownloads();
        const active = tasks.filter((task) =>
          ["starting", "in_progress"].includes(task.status)
        ).length;
        const slots = settings.downloadConcurrency - active;
        if (slots <= 0) break;
        const queued = tasks.filter((task) => task.status === "queued").slice(0, slots);
        if (!queued.length) break;
        await Promise.all(queued.map((task) => this.#start(task, settings.askWhereToSave)));
      }
    } finally {
      this.#running = false;
      await this.#notify();
    }
  }

  async #start(task: DownloadTask, saveAs: boolean): Promise<void> {
    const starting: DownloadTask = { ...task, status: "starting", updatedAt: Date.now() };
    await putDownload(starting);
    try {
      const browserDownloadId = await chrome.downloads.download({
        url: task.url,
        filename: task.filename,
        conflictAction: "uniquify",
        saveAs
      });
      const current = (await listDownloads()).find((item) => item.id === task.id);
      if (!current || current.status === "cancelled") {
        await chrome.downloads.cancel(browserDownloadId);
        if (current) {
          await putDownload({ ...current, browserDownloadId, updatedAt: Date.now() });
        }
        return;
      }
      await putDownload({
        ...current,
        status: "in_progress",
        browserDownloadId,
        updatedAt: Date.now()
      });
    } catch (error) {
      const current = (await listDownloads()).find((item) => item.id === task.id);
      if (!current || current.status === "cancelled") return;
      await putDownload({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : "浏览器拒绝了下载任务。",
        updatedAt: Date.now()
      });
    }
  }

  async #handleChanged(delta: chrome.downloads.DownloadDelta): Promise<void> {
    const task = (await listDownloads()).find((item) => item.browserDownloadId === delta.id);
    if (!task) return;
    const state = delta.state?.current;
    let updated: DownloadTask = { ...task, updatedAt: Date.now() };
    if (state === "complete") updated = { ...updated, status: "completed" };
    if (state === "interrupted") {
      updated = {
        ...updated,
        status: "interrupted",
        error: delta.error?.current ?? "下载被中断。"
      };
    }
    await putDownload(updated);
    await this.#notify();
    if (state === "complete" || state === "interrupted") await this.#pump();
  }

  async #buildFilename(candidate: FileCandidate): Promise<string> {
    const settings = await getSettings();
    const segments: string[] = [];
    if (settings.groupByDomain)
      segments.push(sanitizeFilename(new URL(candidate.canonicalUrl).hostname));
    if (settings.groupByCategory) segments.push(candidate.category);
    segments.push(sanitizeFilename(candidate.filename));
    return segments.join("/");
  }

  async #notify(): Promise<void> {
    broadcast({ type: "DOWNLOADS_UPDATED", payload: await listDownloads() });
  }
}
