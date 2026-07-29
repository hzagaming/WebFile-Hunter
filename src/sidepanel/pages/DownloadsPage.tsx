import { useEffect, useState } from "react";
import { sendMessage } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import { FeedbackNotice, type FeedbackKind } from "../components/FeedbackNotice";
import { StatusBadge } from "../components/StatusBadge";
import type { DownloadTask } from "@/types/models";

interface Props {
  snapshot: AppSnapshot;
  refresh: (sessionId?: string) => Promise<void>;
  updateDownloads?: (downloads: DownloadTask[]) => void;
}

function taskProgress(task: DownloadTask): number | undefined {
  if (!task.totalBytes || task.bytesReceived === undefined) return undefined;
  return Math.min(100, Math.round((task.bytesReceived / task.totalBytes) * 100));
}

export function DownloadsPage({ snapshot, refresh, updateDownloads }: Props) {
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string }>();
  const [working, setWorking] = useState(false);
  const hasActiveDownloads = snapshot.downloads.some((task) =>
    ["starting", "in_progress"].includes(task.status)
  );

  useEffect(() => {
    if (!hasActiveDownloads || !updateDownloads) return;
    let active = true;
    const sync = async () => {
      try {
        const downloads = await sendMessage<DownloadTask[]>({ type: "GET_DOWNLOADS" });
        if (active) updateDownloads(downloads);
      } catch {
        // A later event or manual refresh can recover transient worker wake-up failures.
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [hasActiveDownloads, updateDownloads]);

  const act = async (
    action: "start" | "pause" | "resume" | "cancel" | "retry" | "clear_completed" | "open" | "show",
    taskId?: string
  ): Promise<void> => {
    setWorking(true);
    setFeedback(undefined);
    try {
      await sendMessage({
        type: "DOWNLOAD_ACTION",
        payload: { action, ...(taskId ? { taskId } : {}) }
      });
      await refresh(snapshot.activeSession?.id);
      if (action === "clear_completed") {
        setFeedback({ kind: "success", text: "已清除完成和取消的下载记录。" });
      }
    } catch (value) {
      setFeedback({
        kind: "error",
        text: value instanceof Error ? value.message : "下载操作失败。"
      });
    } finally {
      setWorking(false);
    }
  };
  const counts = snapshot.downloads.reduce<Partial<Record<DownloadTask["status"], DownloadTask[]>>>(
    (groups, task) => {
      (groups[task.status] ??= []).push(task);
      return groups;
    },
    {}
  );
  const queued = counts.queued?.length ?? 0;
  const active = (counts.starting?.length ?? 0) + (counts.in_progress?.length ?? 0);
  const clearable = (counts.completed?.length ?? 0) + (counts.cancelled?.length ?? 0);

  return (
    <section className="page downloads-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">用户确认后执行</p>
          <h2>下载队列</h2>
        </div>
        <span className="count">{snapshot.downloads.length}</span>
      </div>
      <p className="section-copy">
        加入队列不会自动下载。点击“开始队列”后，浏览器才会按并发限制处理。
      </p>
      {feedback ? <FeedbackNotice kind={feedback.kind}>{feedback.text}</FeedbackNotice> : null}
      <div className="metrics download-metrics">
        <div>
          <strong>{queued}</strong>
          <span>排队中</span>
        </div>
        <div>
          <strong>{active}</strong>
          <span>下载中</span>
        </div>
        <div>
          <strong>{counts.completed?.length ?? 0}</strong>
          <span>已完成</span>
        </div>
        <div>
          <strong>{(counts.failed?.length ?? 0) + (counts.interrupted?.length ?? 0)}</strong>
          <span>失败/中断</span>
        </div>
      </div>
      <div className="button-row">
        <button
          className="primary"
          type="button"
          disabled={!queued || working}
          onClick={() => void act("start")}
        >
          开始队列
        </button>
        <button type="button" disabled={!active || working} onClick={() => void act("pause")}>
          暂停队列
        </button>
        <button type="button" disabled={!queued || working} onClick={() => void act("resume")}>
          继续队列
        </button>
        <button
          type="button"
          disabled={!clearable || working}
          onClick={() => void act("clear_completed")}
        >
          清除已完成/已取消
        </button>
      </div>
      <div className="download-list">
        {snapshot.downloads.map((task) => {
          const progress = taskProgress(task);
          return (
            <article className="download-card" key={task.id}>
              <div className="section-heading">
                <h3 title={task.filename}>{task.filename}</h3>
                <StatusBadge status={task.status} />
              </div>
              <p className="url" title={task.url}>
                {task.url}
              </p>
              {progress !== undefined ? (
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label={`${task.filename} 下载进度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
              ) : null}
              {task.error ? <FeedbackNotice kind="error">{task.error}</FeedbackNotice> : null}
              <div className="card-actions">
                {["failed", "interrupted", "cancelled"].includes(task.status) ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void act("retry", task.id)}
                  >
                    重试
                  </button>
                ) : null}
                {["queued", "starting", "in_progress"].includes(task.status) ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void act("cancel", task.id)}
                  >
                    取消
                  </button>
                ) : null}
                {task.status === "completed" ? (
                  <>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void act("open", task.id)}
                    >
                      打开文件
                    </button>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void act("show", task.id)}
                    >
                      在文件夹中显示
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
        {!snapshot.downloads.length ? (
          <div className="empty-state">下载队列为空。请在结果页选择文件后加入队列。</div>
        ) : null}
      </div>
    </section>
  );
}
