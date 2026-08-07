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
  #mutationTail: Promise<void> = Promise.resolve();

  constructor() {
    chrome.downloads.onChanged.addListener(
      (delta) => void this.#handleChanged(delta).catch(() => undefined)
    );
  }

  queue(candidateIds: readonly string[]): Promise<DownloadTask[]> {
    const requestedIds = [...candidateIds];
    return this.#serializeMutation(() => this.#queueCandidates(requestedIds));
  }

  #serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.#mutationTail.then(mutation);
    this.#mutationTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async #queueCandidates(candidateIds: readonly string[]): Promise<DownloadTask[]> {
    const settings = await getSettings();
    const activeCandidateIds = new Set(
      (await listDownloads())
        .filter((task) => ["queued", "starting", "in_progress"].includes(task.status))
        .map((task) => task.candidateId)
    );
    const tasks: DownloadTask[] = [];
    for (const candidateId of candidateIds) {
      if (activeCandidateIds.has(candidateId)) continue;
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
      activeCandidateIds.add(candidateId);
      tasks.push(task);
    }
    await this.#notify();
    return tasks;
  }

  async action(
    action: "start" | "pause" | "resume" | "cancel" | "retry" | "clear_completed" | "open" | "show",
    taskId?: string
  ): Promise<void> {
    if (action === "start" && taskId) {
      try {
        await this.#serializeMutation(() => this.#startOne(taskId));
      } finally {
        await this.#notify();
      }
      return;
    }
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
      await this.#serializeMutation(async () => {
        const downloads = await listDownloads();
        const current = downloads.find((item) => item.id === task.id);
        if (
          !current ||
          !["failed", "interrupted", "cancelled"].includes(current.status) ||
          downloads.some(
            (item) =>
              item.id !== current.id &&
              item.candidateId === current.candidateId &&
              ["queued", "starting", "in_progress"].includes(item.status)
          )
        )
          return;
        const retryable: DownloadTask = { ...current };
        delete retryable.error;
        delete retryable.browserDownloadId;
        await putDownload({
          ...retryable,
          status: "queued",
          updatedAt: Date.now()
        });
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

  async #startOne(taskId: string): Promise<void> {
    const tasks = await listDownloads();
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "queued") return;
    const settings = await getSettings();
    const active = tasks.filter((item) => ["starting", "in_progress"].includes(item.status)).length;
    if (active >= settings.downloadConcurrency) {
      throw new TypeError("下载并发已满，文件已保留在队列中。");
    }
    await this.#start(task, settings.askWhereToSave);
    const current = (await listDownloads()).find((item) => item.id === taskId);
    if (current?.status === "failed") {
      throw new TypeError(current.error ?? "浏览器拒绝了下载任务。");
    }
  }

  async getSnapshot(): Promise<DownloadTask[]> {
    const tasks = await listDownloads();
    return Promise.all(tasks.map((task) => this.#syncBrowserState(task)));
  }

  async reconcile(): Promise<void> {
    const tasks = await listDownloads();
    for (const task of tasks) {
      if (!["starting", "in_progress"].includes(task.status)) continue;
      if (task.browserDownloadId === undefined) {
        await putDownload({
          ...task,
          status: "failed",
          error: "后台已重启，下载任务尚未获得浏览器下载 ID。",
          updatedAt: Date.now()
        });
        continue;
      }
      await this.#syncBrowserState(task);
    }
    await this.#notify();
  }

  async clearAll(): Promise<void> {
    this.#paused = true;
    await this.#serializeMutation(async () => {
      const tasks = await listDownloads();
      if (
        tasks.some((task) => task.status === "starting" && task.browserDownloadId === undefined)
      ) {
        throw new TypeError("有下载任务正在启动，请稍后再清除本地数据。");
      }
      const activeBrowserIds = tasks
        .filter((task) => ["starting", "in_progress"].includes(task.status))
        .flatMap((task) => (task.browserDownloadId === undefined ? [] : [task.browserDownloadId]));
      await Promise.all(activeBrowserIds.map((id) => this.#cancelForClear(id)));
      await deleteDownloads(tasks.map((task) => task.id));
    });
    await this.#notify();
  }

  async #cancelForClear(browserDownloadId: number): Promise<void> {
    try {
      await chrome.downloads.cancel(browserDownloadId);
    } catch (error) {
      let browserTask: chrome.downloads.DownloadItem | undefined;
      try {
        [browserTask] = await chrome.downloads.search({ id: browserDownloadId });
      } catch {
        throw error;
      }
      if (browserTask?.state === "in_progress") throw error;
    }
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

  async #syncBrowserState(task: DownloadTask): Promise<DownloadTask> {
    if (
      task.browserDownloadId === undefined ||
      !["starting", "in_progress"].includes(task.status)
    ) {
      return task;
    }
    let browserTask: chrome.downloads.DownloadItem | undefined;
    try {
      [browserTask] = await chrome.downloads.search({ id: task.browserDownloadId });
    } catch {
      return task;
    }
    if (!browserTask) {
      const missing: DownloadTask = {
        ...task,
        status: "interrupted",
        error: "后台恢复时未找到对应的浏览器下载任务。",
        updatedAt: Date.now()
      };
      await putDownload(missing);
      return missing;
    }

    const status: DownloadTask["status"] =
      browserTask.state === "complete"
        ? "completed"
        : browserTask.state === "interrupted"
          ? "interrupted"
          : "in_progress";
    const totalBytes = browserTask.totalBytes > 0 ? browserTask.totalBytes : undefined;
    const error = status === "interrupted" ? (browserTask.error ?? "下载被中断。") : undefined;
    if (
      task.status === status &&
      task.bytesReceived === browserTask.bytesReceived &&
      task.totalBytes === totalBytes &&
      task.error === error
    ) {
      return task;
    }
    const updated: DownloadTask = {
      ...task,
      status,
      bytesReceived: browserTask.bytesReceived,
      updatedAt: Date.now()
    };
    if (totalBytes !== undefined) updated.totalBytes = totalBytes;
    else delete updated.totalBytes;
    if (error !== undefined) updated.error = error;
    else delete updated.error;
    await putDownload(updated);
    return updated;
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
