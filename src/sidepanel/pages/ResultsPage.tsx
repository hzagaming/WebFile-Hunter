import { useMemo, useState } from "react";
import { sendMessage } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import { exportCsv } from "@/export/export-csv";
import { exportJson } from "@/export/export-json";
import { exportTxt } from "@/export/export-txt";
import { saveExport } from "@/export/save-export";
import { VirtualList } from "../components/VirtualList";
import { FeedbackNotice, type FeedbackKind } from "../components/FeedbackNotice";
import type { DiscoverySource, DownloadTask, FileCandidate, FileCategory } from "@/types/models";

interface Props {
  snapshot: AppSnapshot;
  refresh: (sessionId?: string) => Promise<void>;
}

const categoryLabels: Record<FileCategory | "all", string> = {
  all: "全部",
  audio: "音频",
  video: "视频",
  text: "文本",
  document: "文档",
  ebook: "电子书",
  archive: "压缩包",
  image: "图片",
  subtitle: "字幕",
  data: "数据",
  unknown: "未知"
};

const sourceLabels: Record<DiscoverySource, string> = {
  DOM_ATTRIBUTE: "页面元素",
  DOWNLOAD_ATTRIBUTE: "下载属性",
  CSS_URL: "样式资源",
  PERFORMANCE_ENTRY: "性能记录",
  NETWORK_REQUEST: "网络请求",
  NETWORK_HEADER: "响应头",
  CRAWLED_PAGE: "递归页面",
  MANUAL_URL: "元数据探测"
};

const warningLabels: Record<string, string> = {
  temporary_url: "临时签名链接，可能过期",
  temporary_blob: "临时浏览器资源，不能直接下载",
  segmented_stream: "分段流媒体，不能作为普通文件下载",
  mime_extension_conflict: "MIME 与扩展名不一致"
};

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "大小未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function ResultsPage({ snapshot, refresh }: Props) {
  const [category, setCategory] = useState<FileCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [extension, setExtension] = useState("");
  const [mime, setMime] = useState("");
  const [source, setSource] = useState("all");
  const [scope, setScope] = useState("all");
  const [minConfidence, setMinConfidence] = useState(0);
  const [minMb, setMinMb] = useState("");
  const [maxMb, setMaxMb] = useState("");
  const [regex, setRegex] = useState(false);
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string }>();
  const [busy, setBusy] = useState(false);
  const session = snapshot.activeSession;

  const { filtered, regexError } = useMemo(() => {
    let matcher: RegExp | undefined;
    if (regex && search) {
      try {
        matcher = new RegExp(search, "i");
      } catch {
        return { filtered: [], regexError: "正则表达式无效，请检查语法。" };
      }
    }
    const minBytes = minMb ? Number(minMb) * 1024 ** 2 : 0;
    const maxBytes = maxMb ? Number(maxMb) * 1024 ** 2 : Number.POSITIVE_INFINITY;
    const query = search.toLowerCase();
    const result = snapshot.files.filter((file) => {
      const matchesSearch =
        !search ||
        (matcher
          ? matcher.test(`${file.filename}\n${file.canonicalUrl}`)
          : `${file.filename}\n${file.canonicalUrl}`.toLowerCase().includes(query));
      return (
        matchesSearch &&
        (category === "all" || file.category === category) &&
        (!extension || file.extension?.includes(extension.toLowerCase())) &&
        (!mime || file.mimeType?.toLowerCase().includes(mime.toLowerCase())) &&
        (source === "all" || file.sources.includes(source as FileCandidate["source"])) &&
        (scope === "all" || (scope === "external") === file.isExternal) &&
        file.confidence >= minConfidence &&
        (file.contentLength ?? 0) >= minBytes &&
        (file.contentLength ?? Number.POSITIVE_INFINITY) <= maxBytes &&
        (snapshot.settings.showLowConfidence || file.confidence >= 50)
      );
    });
    return {
      filtered: result.sort((a, b) =>
        sort === "name"
          ? a.filename.localeCompare(b.filename)
          : sort === "confidence"
            ? b.confidence - a.confidence
            : sort === "size"
              ? (b.contentLength ?? -1) - (a.contentLength ?? -1)
              : b.discoveredAt - a.discoveredAt
      ),
      regexError: undefined
    };
  }, [
    category,
    extension,
    maxMb,
    mime,
    minConfidence,
    minMb,
    regex,
    scope,
    search,
    snapshot.files,
    snapshot.settings.showLowConfidence,
    sort,
    source
  ]);
  const selectedFiles = useMemo(
    () => snapshot.files.filter((file) => selected.has(file.id)),
    [selected, snapshot.files]
  );
  const visibleSelectedCount = filtered.filter((file) => selected.has(file.id)).length;
  const hiddenSelectedCount = selectedFiles.length - visibleSelectedCount;
  const fail = (error: unknown, fallback: string): void =>
    setFeedback({ kind: "error", text: error instanceof Error ? error.message : fallback });

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = async (field: "url" | "filename"): Promise<void> => {
    if (!selectedFiles.length) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await navigator.clipboard.writeText(
        selectedFiles
          .map((file) => (field === "url" ? (file.finalUrl ?? file.canonicalUrl) : file.filename))
          .join("\n")
      );
      setFeedback({ kind: "success", text: `已复制 ${selectedFiles.length} 项。` });
    } catch (error) {
      fail(error, "无法写入剪贴板。");
    } finally {
      setBusy(false);
    }
  };

  const queue = async (): Promise<void> => {
    if (!selectedFiles.length) return;
    if (
      snapshot.settings.confirmBeforeDownload &&
      !confirm(`将 ${selectedFiles.length} 个文件加入下载队列？加入后仍需手动开始。`)
    ) {
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const queued = await sendMessage<DownloadTask[]>({
        type: "QUEUE_DOWNLOADS",
        payload: { candidateIds: selectedFiles.map((file) => file.id) }
      });
      const skipped = selectedFiles.length - queued.length;
      const text = !queued.length
        ? "未加入任何文件，请检查文件类型、大小与安全设置。"
        : skipped
          ? `已加入 ${queued.length} 项，另有 ${skipped} 项被安全规则跳过。`
          : `已将 ${queued.length} 项加入下载队列，需在“下载”页手动开始。`;
      setFeedback({ kind: skipped ? "warning" : "success", text });
    } catch (error) {
      fail(error, "无法加入下载队列。");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!session || !selectedFiles.length) return;
    if (!confirm(`删除 ${selectedFiles.length} 项扫描结果？此操作无法撤销。`)) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await sendMessage({
        type: "DELETE_RESULTS",
        payload: { sessionId: session.id, candidateIds: selectedFiles.map((file) => file.id) }
      });
      setSelected(new Set());
      await refresh(session.id);
      setFeedback({ kind: "success", text: `已删除 ${selectedFiles.length} 项扫描结果。` });
    } catch (error) {
      fail(error, "无法删除扫描结果。");
    } finally {
      setBusy(false);
    }
  };

  const exportFiles = async (format: "txt" | "csv" | "json"): Promise<void> => {
    if (!session) return;
    const files = selectedFiles.length ? selectedFiles : filtered;
    if (!files.length) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      if (format === "txt") await saveExport(exportTxt(files), "txt", "text/plain;charset=utf-8");
      else if (format === "csv")
        await saveExport(exportCsv(files, { bom: true }), "csv", "text/csv;charset=utf-8");
      else
        await saveExport(
          exportJson(files, session, snapshot.settings),
          "json",
          "application/json;charset=utf-8"
        );
      setFeedback({
        kind: "success",
        text: `已导出 ${files.length} 项 ${format.toUpperCase()} 结果。`
      });
    } catch (error) {
      fail(error, "无法导出扫描结果。");
    } finally {
      setBusy(false);
    }
  };

  const probe = async (file: FileCandidate): Promise<void> => {
    if (!session) return;
    try {
      await sendMessage({
        type: "PROBE_METADATA",
        payload: { sessionId: session.id, candidateId: file.id }
      });
      await refresh(session.id);
    } catch (error) {
      fail(error, "元数据探测失败。");
    }
  };

  const runCardAction = async (
    action: () => Promise<unknown>,
    success: string,
    fallback: string
  ): Promise<void> => {
    setFeedback(undefined);
    try {
      await action();
      setFeedback({ kind: "success", text: success });
    } catch (error) {
      fail(error, fallback);
    }
  };

  return (
    <section className="page results-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">本地结果库</p>
          <h2>
            发现结果 <span className="count">{filtered.length}</span>
          </h2>
        </div>
        <button type="button" onClick={() => void refresh(session?.id)}>
          刷新
        </button>
      </div>
      {feedback ? <FeedbackNotice kind={feedback.kind}>{feedback.text}</FeedbackNotice> : null}
      <div className="category-scroll" aria-label="文件分类">
        {(Object.keys(categoryLabels) as Array<FileCategory | "all">).map((item) => (
          <button
            type="button"
            className={category === item ? "active" : ""}
            aria-pressed={category === item}
            key={item}
            onClick={() => setCategory(item)}
          >
            {categoryLabels[item]}
          </button>
        ))}
      </div>
      <div className="filters">
        <div className="search-line">
          <input
            aria-label="搜索文件名或 URL"
            placeholder="搜索文件名或 URL"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label>
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            正则
          </label>
        </div>
        {regexError ? <FeedbackNotice kind="error">{regexError}</FeedbackNotice> : null}
        <details>
          <summary>更多筛选与排序</summary>
          <div className="form-grid compact">
            <label>
              扩展名
              <input
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
                placeholder="pdf"
              />
            </label>
            <label>
              MIME
              <input value={mime} onChange={(e) => setMime(e.target.value)} placeholder="audio/" />
            </label>
            <label>
              来源
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="all">全部来源</option>
                {Object.entries(sourceLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              范围
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">内部与外部</option>
                <option value="internal">仅内部</option>
                <option value="external">仅外部</option>
              </select>
            </label>
            <label>
              最小大小 MB
              <input
                type="number"
                min="0"
                value={minMb}
                onChange={(e) => setMinMb(e.target.value)}
              />
            </label>
            <label>
              最大大小 MB
              <input
                type="number"
                min="0"
                value={maxMb}
                onChange={(e) => setMaxMb(e.target.value)}
              />
            </label>
            <label>
              最低置信度
              <input
                type="number"
                min="0"
                max="100"
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
              />
            </label>
            <label>
              排序
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">最新发现</option>
                <option value="confidence">置信度</option>
                <option value="size">文件大小</option>
                <option value="name">文件名</option>
              </select>
            </label>
          </div>
        </details>
      </div>
      <div className="selection-bar">
        <label>
          <input
            type="checkbox"
            checked={Boolean(filtered.length) && filtered.every((file) => selected.has(file.id))}
            onChange={(e) => {
              setSelected((current) => {
                const next = new Set(current);
                for (const file of filtered) {
                  if (e.target.checked) next.add(file.id);
                  else next.delete(file.id);
                }
                return next;
              });
            }}
          />
          全选筛选结果
        </label>
        <span>
          {selectedFiles.length} 项已选
          {hiddenSelectedCount ? `（${hiddenSelectedCount} 项已隐藏）` : ""}
        </span>
      </div>
      {filtered.length ? (
        <VirtualList
          items={filtered}
          itemHeight={176}
          height={Math.max(320, innerHeight - 390)}
          endPadding={72}
          getKey={(file) => file.id}
          renderItem={(file) => (
            <article className={`result-card ${selected.has(file.id) ? "selected" : ""}`}>
              <input
                className="card-check"
                type="checkbox"
                aria-label={`选择 ${file.filename}`}
                checked={selected.has(file.id)}
                onChange={() => toggle(file.id)}
              />
              <div className={`file-type type-${file.category}`}>
                {file.extension?.toUpperCase() ?? "?"}
              </div>
              <div className="result-body">
                <h3 title={file.filename}>{file.filename}</h3>
                <p className="url" title={file.canonicalUrl}>
                  {file.canonicalUrl}
                </p>
                <div className="metadata">
                  <span>{categoryLabels[file.category]}</span>
                  <span>{formatSize(file.contentLength)}</span>
                  <span>{file.mimeType ?? "MIME 未知"}</span>
                  <span>置信度 {file.confidence}</span>
                </div>
                <div className="badges">
                  <span>{file.sources.map((item) => sourceLabels[item]).join(" + ")}</span>
                  {file.isExternal ? (
                    <span className="warning">外部资源</span>
                  ) : (
                    <span>同站资源</span>
                  )}
                  {file.warnings.map((warning) => (
                    <span className="warning" key={warning}>
                      {warningLabels[warning] ?? "检测到资源风险"}
                    </span>
                  ))}
                </div>
                <div className="card-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void runCardAction(
                        () => navigator.clipboard.writeText(file.finalUrl ?? file.canonicalUrl),
                        "已复制文件链接。",
                        "无法写入剪贴板。"
                      )
                    }
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void runCardAction(
                        () => chrome.tabs.create({ url: file.sourcePageUrl }),
                        "已打开来源页。",
                        "无法打开来源页。"
                      )
                    }
                  >
                    来源页
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void runCardAction(
                        () => chrome.tabs.create({ url: file.finalUrl ?? file.canonicalUrl }),
                        "已打开文件链接。",
                        "无法打开文件链接。"
                      )
                    }
                  >
                    打开
                  </button>
                  <button type="button" disabled={file.isExternal} onClick={() => void probe(file)}>
                    元数据
                  </button>
                </div>
              </div>
            </article>
          )}
        />
      ) : (
        <div className="empty-state">
          {regexError
            ? "当前筛选条件下没有结果"
            : "当前筛选条件下没有结果。先运行扫描，或调整筛选条件。"}
        </div>
      )}
      <div className="sticky-actions">
        <button
          type="button"
          disabled={!selectedFiles.length || busy}
          onClick={() => void copy("url")}
        >
          复制链接
        </button>
        <button
          type="button"
          disabled={!selectedFiles.length || busy}
          onClick={() => void copy("filename")}
        >
          复制文件名
        </button>
        <button
          className="primary"
          type="button"
          disabled={!selectedFiles.length || busy}
          onClick={() => void queue()}
        >
          加入下载
        </button>
        <button
          className="danger"
          type="button"
          disabled={!selectedFiles.length || busy}
          onClick={() => void remove()}
        >
          删除
        </button>
        <div className="export-menu">
          <button
            type="button"
            disabled={busy || (!selectedFiles.length && !filtered.length)}
            onClick={() => void exportFiles("txt")}
          >
            TXT
          </button>
          <button
            type="button"
            disabled={busy || (!selectedFiles.length && !filtered.length)}
            onClick={() => void exportFiles("csv")}
          >
            CSV
          </button>
          <button
            type="button"
            disabled={busy || (!selectedFiles.length && !filtered.length)}
            onClick={() => void exportFiles("json")}
          >
            JSON
          </button>
        </div>
      </div>
    </section>
  );
}
