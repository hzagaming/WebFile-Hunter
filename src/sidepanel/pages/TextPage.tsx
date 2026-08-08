import { useMemo, useState } from "react";
import { exportPageText } from "@/export/export-page-text";
import { saveExport } from "@/export/save-export";
import { sendMessage } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import type { ScanSession } from "@/types/models";
import { FeedbackNotice, type FeedbackKind } from "../components/FeedbackNotice";

interface Props {
  snapshot: AppSnapshot;
  refresh?: (sessionId?: string) => Promise<void>;
}

function matchCount(content: string, query: string): number {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  const haystack = content.toLocaleLowerCase();
  let count = 0;
  let position = 0;
  while ((position = haystack.indexOf(needle, position)) >= 0) {
    count += 1;
    position += needle.length;
  }
  return count;
}

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "page";
  }
}

function isSupportedPage(url?: string): boolean {
  try {
    return Boolean(url && ["http:", "https:"].includes(new URL(url).protocol));
  } catch {
    return false;
  }
}

export function TextPage({ snapshot, refresh }: Props) {
  const [selectedId, setSelectedId] = useState(snapshot.textDocuments[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string>();
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string }>();
  const documents = snapshot.textDocuments;
  const selected = documents.find((document) => document.id === selectedId) ?? documents[0];
  const totalCharacters = useMemo(
    () => documents.reduce((total, document) => total + document.characterCount, 0),
    [documents]
  );
  const matches = selected ? matchCount(selected.content, search) : 0;
  const canRecapture = Boolean(refresh && isSupportedPage(snapshot.activeTab?.url));

  const fail = (error: unknown, fallback: string): void =>
    setFeedback({ kind: "error", text: error instanceof Error ? error.message : fallback });
  const copy = async (all: boolean): Promise<void> => {
    if (!selected) return;
    setBusy(all ? "copy-all" : "copy-current");
    setFeedback(undefined);
    try {
      await navigator.clipboard.writeText(all ? exportPageText(documents) : selected.content);
      setFeedback({
        kind: "success",
        text: all ? `已复制 ${documents.length} 个网页的全部文字。` : "已复制当前网页文字。"
      });
    } catch (error) {
      fail(error, "无法写入剪贴板。");
    } finally {
      setBusy(undefined);
    }
  };
  const exportAll = async (): Promise<void> => {
    if (!documents.length) return;
    setBusy("export");
    setFeedback(undefined);
    try {
      await saveExport(
        exportPageText(documents),
        "txt",
        "text/plain;charset=utf-8",
        `webfile-hunter-text-${displayHost(documents[0]?.pageUrl ?? "")}`
      );
      setFeedback({ kind: "success", text: `已导出 ${documents.length} 个网页的文字。` });
    } catch (error) {
      fail(error, "无法导出网页文字。");
    } finally {
      setBusy(undefined);
    }
  };
  const recapture = async (): Promise<void> => {
    const tab = snapshot.activeTab;
    if (!tab || !refresh) return;
    setBusy("recapture");
    setFeedback(undefined);
    try {
      const url = new URL(tab.url);
      const granted = await chrome.permissions.request({
        origins: [`${url.protocol}//${url.hostname}/*`]
      });
      if (!granted) throw new Error("未授予当前网站权限，网页文字没有重新提取。");
      const session = await sendMessage<ScanSession>({
        type: "SCAN_CURRENT_PAGE",
        payload: { tabId: tab.id }
      });
      await refresh(session.id);
      setFeedback({ kind: "success", text: "已开始重新扫描并提取当前网页文字。" });
    } catch (error) {
      fail(error, "无法重新提取当前网页文字。");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="page text-page" aria-busy={Boolean(busy)}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">纯文本 · 仅保存在本地</p>
          <h2>网页文字</h2>
        </div>
        <span className="count" aria-label={`${documents.length} 个文本页面`}>
          {documents.length}
        </span>
      </div>
      <p className="section-copy">
        提取当前任务中公开可见的网页正文；不会读取输入框、密码、明确隐藏的内容或可编辑草稿，也不会执行
        OCR。
      </p>
      {feedback ? <FeedbackNotice kind={feedback.kind}>{feedback.text}</FeedbackNotice> : null}

      {!documents.length ? (
        <div className="text-empty-wrap">
          <div className="empty-state">当前任务还没有可提取的网页文字。</div>
          {canRecapture ? (
            <button
              className="primary full"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void recapture()}
            >
              重新扫描并提取当前网页
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="text-metrics" aria-label="文字提取统计">
            <div>
              <strong>{documents.length.toLocaleString("zh-CN")}</strong>
              <span>页面 / Frame</span>
            </div>
            <div>
              <strong>{totalCharacters.toLocaleString("zh-CN")}</strong>
              <span>总字符</span>
            </div>
            <div>
              <strong>{documents.filter((document) => document.truncated).length}</strong>
              <span>已截断</span>
            </div>
          </div>

          <div className="text-controls">
            <label>
              选择网页
              <select
                value={selected?.id ?? ""}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title || displayHost(document.pageUrl)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              搜索当前文字
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="输入关键词"
              />
            </label>
          </div>

          {selected ? (
            <article className="text-document">
              <div className="text-document-heading">
                <div>
                  <h3>{selected.title || "未命名网页"}</h3>
                  <p className="url" title={selected.pageUrl}>
                    {selected.pageUrl}
                  </p>
                </div>
                <span>
                  {search.trim()
                    ? `${matches} 处匹配`
                    : `${selected.characterCount.toLocaleString("zh-CN")} 字符`}
                </span>
              </div>
              {selected.truncated ? (
                <FeedbackNotice kind="warning">正文达到本地安全上限，已截断显示。</FeedbackNotice>
              ) : null}
              <pre className="text-content" tabIndex={0} aria-label="提取的网页文字">
                {selected.content}
              </pre>
            </article>
          ) : null}

          <div className="text-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => void copy(false)}>
              复制当前
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void copy(true)}>
              复制全部
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void exportAll()}>
              导出 TXT
            </button>
            {canRecapture ? (
              <button
                className="primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void recapture()}
              >
                重新提取
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
