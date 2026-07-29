import { useState } from "react";
import { sendMessage } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import { exportCsv } from "@/export/export-csv";
import { exportJson } from "@/export/export-json";
import { exportTxt } from "@/export/export-txt";
import { saveExport } from "@/export/save-export";
import type { ScanSession } from "@/types/models";
import { FeedbackNotice, type FeedbackKind } from "../components/FeedbackNotice";
import { StatusBadge } from "../components/StatusBadge";

interface Props {
  snapshot: AppSnapshot;
  refresh: (sessionId?: string) => Promise<void>;
  openResults: () => void;
}

export function HistoryPage({ snapshot, refresh, openResults }: Props) {
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string }>();
  const [busy, setBusy] = useState<string>();
  const fail = (error: unknown, fallback: string): void =>
    setFeedback({ kind: "error", text: error instanceof Error ? error.message : fallback });
  const open = async (sessionId: string): Promise<void> => {
    setBusy(`open:${sessionId}`);
    setFeedback(undefined);
    try {
      await refresh(sessionId);
      openResults();
    } catch (error) {
      fail(error, "无法打开扫描结果。");
    } finally {
      setBusy(undefined);
    }
  };
  const remove = async (session: ScanSession): Promise<void> => {
    const isActive = ["running", "paused"].includes(session.status);
    const prompt = isActive
      ? "删除此任务会先停止正在运行的任务，再删除历史与结果。确定继续？"
      : "删除此扫描任务及其全部结果？此操作无法撤销。";
    if (!confirm(prompt)) return;
    setBusy(`remove:${session.id}`);
    setFeedback(undefined);
    try {
      await sendMessage({ type: "DELETE_SESSION", payload: { sessionId: session.id } });
      await refresh();
      setFeedback({ kind: "success", text: "扫描任务及其结果已删除。" });
    } catch (error) {
      fail(error, "无法删除扫描任务。");
    } finally {
      setBusy(undefined);
    }
  };
  const resume = async (sessionId: string): Promise<void> => {
    setBusy(`resume:${sessionId}`);
    setFeedback(undefined);
    try {
      await sendMessage({ type: "RESUME_SCAN", payload: { sessionId } });
      await refresh(sessionId);
      setFeedback({ kind: "success", text: "递归扫描任务已继续。" });
    } catch (error) {
      fail(error, "无法恢复任务。");
    } finally {
      setBusy(undefined);
    }
  };
  const exportSession = async (session: ScanSession): Promise<void> => {
    setBusy(`export:${session.id}`);
    setFeedback(undefined);
    try {
      const data = await sendMessage<AppSnapshot>({
        type: "GET_SNAPSHOT",
        payload: { sessionId: session.id }
      });
      const format = data.settings.exportFormat;
      const filename = `webfile-hunter-${displayHost(session.startUrl)}`;
      if (format === "txt") {
        await saveExport(exportTxt(data.files), "txt", "text/plain;charset=utf-8", filename);
      } else if (format === "csv") {
        await saveExport(
          exportCsv(data.files, { bom: true }),
          "csv",
          "text/csv;charset=utf-8",
          filename
        );
      } else {
        await saveExport(
          exportJson(data.files, session, data.settings),
          "json",
          "application/json;charset=utf-8",
          filename
        );
      }
      setFeedback({
        kind: "success",
        text: `已导出 ${data.files.length} 项 ${format.toUpperCase()} 结果。`
      });
    } catch (error) {
      fail(error, "无法导出历史结果。");
    } finally {
      setBusy(undefined);
    }
  };
  const clear = async (): Promise<void> => {
    if (
      !snapshot.sessions.length ||
      !confirm("清空全部扫描历史和结果？运行中任务会先停止，下载记录与设置会保留。")
    ) {
      return;
    }
    setBusy("clear");
    setFeedback(undefined);
    try {
      await sendMessage({ type: "CLEAR_HISTORY" });
      await refresh();
      setFeedback({ kind: "success", text: "扫描历史已清空，下载记录与设置已保留。" });
    } catch (error) {
      fail(error, "无法清空扫描历史。");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="page history-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">仅保存在本地</p>
          <h2>扫描历史</h2>
        </div>
        <div className="card-actions">
          <span className="count">{snapshot.sessions.length}</span>
          <button
            className="danger-text"
            type="button"
            disabled={!snapshot.sessions.length || busy !== undefined}
            onClick={() => void clear()}
          >
            清空历史
          </button>
        </div>
      </div>
      {snapshot.incompleteSessions.length ? (
        <FeedbackNotice kind="warning">
          {`检测到 ${snapshot.incompleteSessions.length} 个未完成递归任务。任务不会自动恢复，请手动确认继续。`}
        </FeedbackNotice>
      ) : null}
      {feedback ? <FeedbackNotice kind={feedback.kind}>{feedback.text}</FeedbackNotice> : null}
      <div className="history-list">
        {snapshot.sessions.map((session) => (
          <article className="history-card" key={session.id}>
            <div className="section-heading">
              <div>
                <h3>{displayHost(session.startUrl)}</h3>
                <p>{new Date(session.createdAt).toLocaleString("zh-CN")}</p>
              </div>
              <StatusBadge status={session.status} />
            </div>
            <p className="url" title={session.startUrl}>
              {session.startUrl}
            </p>
            <div className="metadata">
              <span>
                {session.mode === "current_page"
                  ? "当前页"
                  : session.mode === "live_monitor"
                    ? "实时监听"
                    : "递归扫描"}
              </span>
              <span>{session.pagesProcessed} 页</span>
              <span>{session.filesDiscovered} 文件</span>
              <span>{session.errors} 错误</span>
            </div>
            <div className="card-actions">
              <button
                type="button"
                disabled={busy !== undefined}
                onClick={() => void open(session.id)}
              >
                打开结果
              </button>
              <button
                type="button"
                disabled={busy !== undefined}
                onClick={() => void exportSession(session)}
              >
                导出
              </button>
              {session.mode === "recursive_crawl" && session.status === "paused" ? (
                <button
                  type="button"
                  disabled={busy !== undefined}
                  onClick={() => void resume(session.id)}
                >
                  继续任务
                </button>
              ) : null}
              <button
                className="danger-text"
                type="button"
                disabled={busy !== undefined}
                onClick={() => void remove(session)}
              >
                删除
              </button>
            </div>
          </article>
        ))}
        {!snapshot.sessions.length ? <div className="empty-state">暂无扫描历史。</div> : null}
      </div>
    </section>
  );
}

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "未知网站";
  }
}
