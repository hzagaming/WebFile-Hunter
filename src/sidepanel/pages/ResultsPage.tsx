import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction
} from "react";
import { sendMessage } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import { exportCsv } from "@/export/export-csv";
import { exportJson } from "@/export/export-json";
import { exportTxt } from "@/export/export-txt";
import { saveExport } from "@/export/save-export";
import { siteOriginPattern } from "@/core/host-permissions";
import { VirtualList } from "../components/VirtualList";
import { FeedbackNotice, type FeedbackKind } from "../components/FeedbackNotice";
import type { DiscoverySource, DownloadTask, FileCandidate, FileCategory } from "@/types/models";
import { useI18n, type MessageKey, type Translate } from "@/i18n";

interface Props {
  snapshot: AppSnapshot;
  refresh: (sessionId?: string) => Promise<void>;
}

type CategoryFilter = FileCategory | "all" | "possible";
type PreviewKind = "audio" | "image";

const categoryLabels: Record<CategoryFilter, MessageKey> = {
  all: "全部",
  possible: "可能资源",
  audio: "音频",
  video: "视频",
  text: "文本",
  document: "文档",
  ebook: "电子书",
  archive: "压缩包",
  image: "图片",
  subtitle: "字幕",
  data: "数据",
  code: "源码",
  font: "字体",
  model: "3D 模型",
  unknown: "未知"
};

const metadataStatusLabels: Record<FileCandidate["metadataStatus"], MessageKey> = {
  not_requested: "未请求",
  pending: "探测中",
  complete: "已完成",
  failed: "失败"
};

const sourceLabels: Record<DiscoverySource, MessageKey> = {
  DOM_ATTRIBUTE: "页面元素",
  DOWNLOAD_ATTRIBUTE: "下载属性",
  CSS_URL: "样式资源",
  PERFORMANCE_ENTRY: "性能记录",
  NETWORK_REQUEST: "网络请求",
  NETWORK_HEADER: "响应头",
  CRAWLED_PAGE: "递归页面",
  MANUAL_URL: "元数据探测"
};

const warningLabels: Record<string, MessageKey> = {
  temporary_url: "临时签名链接，可能过期",
  temporary_blob: "临时浏览器资源，不能直接下载",
  segmented_stream: "分段流媒体，不能作为普通文件下载",
  mime_extension_conflict: "MIME 与扩展名不一致"
};

function formatSize(bytes: number | undefined, t: Translate): string {
  if (bytes === undefined) return t("大小未知");
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(seconds: number | undefined, t: Translate): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return t("试听");
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function resourceUrl(file: FileCandidate): string {
  return file.finalUrl ?? file.canonicalUrl;
}

function canOpenResource(file: FileCandidate): boolean {
  if (file.warnings.some((warning) => ["temporary_blob", "segmented_stream"].includes(warning))) {
    return false;
  }
  try {
    const url = new URL(file.finalUrl ?? file.canonicalUrl);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function previewKind(file: FileCandidate): PreviewKind | undefined {
  if (file.category === "audio" || file.mimeType?.toLowerCase().startsWith("audio/")) {
    return "audio";
  }
  if (file.category === "image" || file.mimeType?.toLowerCase().startsWith("image/")) {
    return "image";
  }
  return undefined;
}

function canDownloadResource(file: FileCandidate): boolean {
  return file.isDownloadable && canOpenResource(file);
}

function searchableValues(file: FileCandidate, t: Translate): string[] {
  return [
    file.filename,
    file.canonicalUrl,
    file.finalUrl,
    file.extension,
    file.mimeType,
    t(categoryLabels[file.category]),
    file.sourcePageUrl,
    file.sourcePageTitle,
    ...file.sources.flatMap((item) => [item, t(sourceLabels[item])]),
    ...file.warnings.flatMap((item) => [item, warningLabels[item] ? t(warningLabels[item]) : item])
  ].filter((value): value is string => Boolean(value));
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function markdownLink(file: FileCandidate): string {
  const name = file.filename.replace(/([\\[\]])/g, "\\$1");
  const url = resourceUrl(file).replace(/([()])/g, "\\$1");
  return `[${name}](${url})`;
}

interface ImageThumbnailProps {
  file: FileCandidate;
  enabled: boolean;
  open: () => void;
}

function ImageThumbnail({ file, enabled, open }: ImageThumbnailProps) {
  const { known, t } = useI18n();
  const [failed, setFailed] = useState(false);
  return (
    <button
      className={`result-media image-thumbnail ${failed ? "failed" : ""}`}
      type="button"
      disabled={!enabled}
      aria-label={t("放大预览：{filename}", { filename: known(file.filename) })}
      title={failed ? t("缩略图加载失败，可尝试在新标签页打开") : t("点击放大图片")}
      onClick={open}
    >
      {enabled && !failed ? (
        <img
          src={resourceUrl(file)}
          alt={t("缩略图：{filename}", { filename: known(file.filename) })}
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">IMG</span>
      )}
    </button>
  );
}

interface InlineAudioProps {
  file: FileCandidate;
  enabled: boolean;
  active: boolean;
  setActive: Dispatch<SetStateAction<string | undefined>>;
}

function InlineAudio({ file, enabled, active, setActive }: InlineAudioProps) {
  const { known, t } = useI18n();
  const audio = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const clearActive = (): void =>
    setActive((current) => (current === file.id ? undefined : current));

  useEffect(() => {
    if (!active && (loading || playing)) {
      audio.current?.pause();
    }
  }, [active, loading, playing]);

  const toggle = async (): Promise<void> => {
    const element = audio.current;
    if (!element || !enabled) return;
    if (active && playing) {
      element.pause();
      setPlaying(false);
      setLoading(false);
      clearActive();
      return;
    }
    setFailed(false);
    setLoading(true);
    setActive(file.id);
    try {
      await element.play();
    } catch {
      setLoading(false);
      setFailed(true);
      clearActive();
    }
  };

  const isLoading = active && loading;
  const isPlaying = active && playing;
  const state = failed
    ? t("不可播放")
    : isLoading
      ? t("加载中")
      : isPlaying
        ? t("播放中")
        : formatDuration(duration, t);
  return (
    <div className={`result-media inline-audio ${failed ? "failed" : ""}`}>
      <button
        type="button"
        disabled={!enabled}
        aria-label={t("{action}音频：{filename}", {
          action: isPlaying ? t("暂停") : t("播放"),
          filename: known(file.filename)
        })}
        title={enabled ? t("直接试听此音频") : t("临时、分段或无效音频无法试听")}
        onClick={() => void toggle()}
      >
        <span className="audio-play-icon" aria-hidden="true">
          {isLoading ? "…" : isPlaying ? "Ⅱ" : "▶"}
        </span>
        <span className="audio-state" aria-live="polite">
          {state}
        </span>
      </button>
      <audio
        ref={audio}
        src={enabled ? resourceUrl(file) : undefined}
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onCanPlay={() => setLoading(false)}
        onPlay={() => {
          setLoading(false);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          clearActive();
        }}
        onError={() => {
          setLoading(false);
          setPlaying(false);
          setFailed(true);
          clearActive();
        }}
      />
    </div>
  );
}

function canProbeResource(file: FileCandidate, snapshot: AppSnapshot): boolean {
  if (!file.isExternal || snapshot.allSitesAccess) return true;
  try {
    const protocol = new URL(file.canonicalUrl).protocol;
    return (
      snapshot.grantedOrigins.includes(siteOriginPattern(file.canonicalUrl)) ||
      snapshot.grantedOrigins.includes(`${protocol}//*/*`)
    );
  } catch {
    return false;
  }
}

export function ResultsPage({ snapshot, refresh }: Props) {
  const { known, language, locale, t } = useI18n();
  const [category, setCategory] = useState<CategoryFilter>("all");
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
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<{ file: FileCandidate; kind: PreviewKind }>();
  const [previewError, setPreviewError] = useState<string>();
  const [detailsFile, setDetailsFile] = useState<FileCandidate>();
  const [detailsFeedback, setDetailsFeedback] = useState<{
    kind: FeedbackKind;
    text: string;
  }>();
  const pageRef = useRef<HTMLElement>(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  const [activeAudioId, setActiveAudioId] = useState<string>();
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const session = snapshot.activeSession;
  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(
      (Object.keys(categoryLabels) as CategoryFilter[]).map((item) => [item, 0])
    ) as Record<CategoryFilter, number>;
    for (const file of snapshot.files) {
      const possible = file.confidence < 50;
      if (possible) counts.possible += 1;
      if (!possible || snapshot.settings.showLowConfidence) {
        counts.all += 1;
        counts[file.category] += 1;
      }
    }
    return counts;
  }, [snapshot.files, snapshot.settings.showLowConfidence]);
  const hasActiveFilters = Boolean(
    category !== "all" ||
    search ||
    extension ||
    mime ||
    source !== "all" ||
    scope !== "all" ||
    minConfidence ||
    minMb ||
    maxMb ||
    regex ||
    sort !== "newest"
  );

  const resetFilters = (): void => {
    setCategory("all");
    setSearch("");
    setExtension("");
    setMime("");
    setSource("all");
    setScope("all");
    setMinConfidence(0);
    setMinMb("");
    setMaxMb("");
    setRegex(false);
    setSort("newest");
  };

  useEffect(() => {
    const updateViewportHeight = (): void => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", updateViewportHeight);
    return () => window.removeEventListener("resize", updateViewportHeight);
  }, []);

  useEffect(() => {
    if (!detailsFile && !preview) return;
    const background = [...(pageRef.current?.children ?? [])].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.classList.contains("media-preview-backdrop")
    );
    for (const element of background) element.setAttribute("inert", "");
    return () => {
      for (const element of background) element.removeAttribute("inert");
    };
  }, [detailsFile, preview]);

  const { filtered, regexError } = useMemo(() => {
    let matcher: RegExp | undefined;
    const expression = search.trim();
    if (regex && expression) {
      try {
        matcher = new RegExp(expression, "iu");
      } catch {
        return { filtered: [], regexError: t("正则表达式无效，请检查语法。") };
      }
    }
    const minBytes = minMb ? Number(minMb) * 1024 ** 2 : 0;
    const maxBytes = maxMb ? Number(maxMb) * 1024 ** 2 : Number.POSITIVE_INFINITY;
    const queryTerms = normalizeSearch(search).split(/\s+/).filter(Boolean);
    const extensionQuery = normalizeSearch(extension).replace(/^\.+/, "");
    const mimeQuery = normalizeSearch(mime);
    const result = snapshot.files.filter((file) => {
      const isPossible = file.confidence < 50;
      const values = searchableValues(file, t);
      const haystack = normalizeSearch(values.join("\n"));
      const matchesSearch =
        !expression ||
        (matcher
          ? matcher.test(values.join("\n"))
          : queryTerms.every((term) => haystack.includes(term)));
      return (
        matchesSearch &&
        (category === "all" ||
          (category === "possible" ? isPossible : file.category === category)) &&
        (!extensionQuery || normalizeSearch(file.extension ?? "") === extensionQuery) &&
        (!mimeQuery || normalizeSearch(file.mimeType ?? "").includes(mimeQuery)) &&
        (source === "all" || file.sources.includes(source as FileCandidate["source"])) &&
        (scope === "all" || (scope === "external") === file.isExternal) &&
        file.confidence >= minConfidence &&
        (file.contentLength ?? 0) >= minBytes &&
        (file.contentLength ?? Number.POSITIVE_INFINITY) <= maxBytes &&
        (category === "possible" || snapshot.settings.showLowConfidence || !isPossible)
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
    source,
    t
  ]);
  const selectedFiles = useMemo(
    () => snapshot.files.filter((file) => selected.has(file.id)),
    [selected, snapshot.files]
  );
  const visibleSelectedCount = filtered.filter((file) => selected.has(file.id)).length;
  const hiddenSelectedCount = selectedFiles.length - visibleSelectedCount;
  const fail = (error: unknown, fallback: string): void =>
    setFeedback({ kind: "error", text: error instanceof Error ? known(error.message) : fallback });

  const refreshResults = async (): Promise<void> => {
    setBusy(true);
    setRefreshing(true);
    setFeedback(undefined);
    try {
      await refresh(session?.id);
    } catch (error) {
      fail(error, t("无法刷新扫描结果。"));
    } finally {
      setRefreshing(false);
      setBusy(false);
    }
  };

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
      setFeedback({
        kind: "success",
        text: t("已复制 {count} 项。", { count: selectedFiles.length })
      });
    } catch (error) {
      fail(error, t("无法写入剪贴板。"));
    } finally {
      setBusy(false);
    }
  };

  const queue = async (): Promise<void> => {
    if (!selectedFiles.length) return;
    if (
      snapshot.settings.confirmBeforeDownload &&
      !confirm(
        t("将 {count} 个文件加入下载队列？加入后仍需手动开始。", {
          count: selectedFiles.length
        })
      )
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
        ? t("未加入任何文件，请检查文件类型、大小与安全设置。")
        : skipped
          ? t("已加入 {queued} 项，另有 {skipped} 项被安全规则跳过。", {
              queued: queued.length,
              skipped
            })
          : t("已将 {count} 项加入下载队列，需在“下载”页手动开始。", {
              count: queued.length
            });
      setFeedback({ kind: skipped ? "warning" : "success", text });
    } catch (error) {
      fail(error, t("无法加入下载队列。"));
    } finally {
      setBusy(false);
    }
  };

  const download = async (file: FileCandidate): Promise<void> => {
    if (
      snapshot.settings.confirmBeforeDownload &&
      !confirm(
        t("现在下载“{filename}”？浏览器可能继续询问保存位置。", {
          filename: known(file.filename)
        })
      )
    ) {
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const existing = snapshot.downloads.find(
        (task) =>
          task.candidateId === file.id &&
          ["queued", "starting", "in_progress"].includes(task.status)
      );
      const task =
        existing ??
        (
          await sendMessage<DownloadTask[]>({
            type: "QUEUE_DOWNLOADS",
            payload: { candidateIds: [file.id] }
          })
        )[0];
      if (!task) {
        setFeedback({
          kind: "warning",
          text: t("未创建下载任务，请检查文件类型、大小与安全设置。")
        });
        return;
      }
      if (["starting", "in_progress"].includes(task.status)) {
        setFeedback({ kind: "warning", text: t("该文件已在下载中。") });
        return;
      }
      await sendMessage({
        type: "DOWNLOAD_ACTION",
        payload: { action: "start", taskId: task.id }
      });
      setFeedback({
        kind: "success",
        text: t("已开始下载“{filename}”。", { filename: known(file.filename) })
      });
    } catch (error) {
      fail(error, t("无法开始下载。"));
    } finally {
      setBusy(false);
    }
  };

  const openPreview = (file: FileCandidate, kind: PreviewKind): void => {
    setActiveAudioId(undefined);
    previewTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreviewError(undefined);
    setDetailsFile(undefined);
    setPreview({ file, kind });
  };

  const closePreview = (): void => {
    setPreview(undefined);
    setPreviewError(undefined);
    queueMicrotask(() => previewTrigger.current?.focus());
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePreview();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button, audio")].filter(
      (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0
    );
    if (!controls.length) return;
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const openDetails = (file: FileCandidate): void => {
    setActiveAudioId(undefined);
    previewTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreview(undefined);
    setDetailsFeedback(undefined);
    setDetailsFile(file);
  };

  const closeDetails = (): void => {
    setDetailsFile(undefined);
    setDetailsFeedback(undefined);
    queueMicrotask(() => previewTrigger.current?.focus());
  };

  const copyDetail = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setDetailsFeedback({ kind: "success", text: t("{label}已复制。", { label }) });
    } catch (error) {
      setDetailsFeedback({
        kind: "error",
        text: error instanceof Error ? known(error.message) : t("无法复制{label}。", { label })
      });
    }
  };

  const openDetailTab = async (url: string, label: string): Promise<void> => {
    setDetailsFeedback(undefined);
    try {
      await chrome.tabs.create({ url });
      setDetailsFeedback({
        kind: "success",
        text: t("{label}已在新标签页打开。", { label })
      });
    } catch (error) {
      setDetailsFeedback({
        kind: "error",
        text: error instanceof Error ? known(error.message) : t("无法打开{label}。", { label })
      });
    }
  };

  const handleDetailsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDetails();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button")].filter(
      (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0
    );
    if (!controls.length) return;
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const remove = async (): Promise<void> => {
    if (!session || !selectedFiles.length) return;
    if (!confirm(t("删除 {count} 项扫描结果？此操作无法撤销。", { count: selectedFiles.length })))
      return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await sendMessage({
        type: "DELETE_RESULTS",
        payload: { sessionId: session.id, candidateIds: selectedFiles.map((file) => file.id) }
      });
      setSelected(new Set());
      await refresh(session.id);
      setFeedback({
        kind: "success",
        text: t("已删除 {count} 项扫描结果。", { count: selectedFiles.length })
      });
    } catch (error) {
      fail(error, t("无法删除扫描结果。"));
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
        text: t("已导出 {count} 项 {format} 结果。", {
          count: files.length,
          format: format.toUpperCase()
        })
      });
    } catch (error) {
      fail(error, t("无法导出扫描结果。"));
    } finally {
      setBusy(false);
    }
  };

  const probe = async (file: FileCandidate): Promise<void> => {
    if (!session) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await sendMessage({
        type: "PROBE_METADATA",
        payload: { sessionId: session.id, candidateId: file.id }
      });
      await refresh(session.id);
    } catch (error) {
      fail(error, t("元数据探测失败。"));
    } finally {
      setBusy(false);
    }
  };

  const runCardAction = async (
    action: () => Promise<unknown>,
    success: string,
    fallback: string
  ): Promise<void> => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback({ kind: "success", text: success });
    } catch (error) {
      fail(error, fallback);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      ref={pageRef}
      className="page results-page"
      role="region"
      aria-label={t("发现结果")}
      aria-busy={busy}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t("本地结果库")}</p>
          <h2>
            {t("发现结果")} <span className="count">{filtered.length}</span>
          </h2>
        </div>
        <button type="button" disabled={busy} onClick={() => void refreshResults()}>
          {refreshing ? t("刷新中…") : t("刷新")}
        </button>
      </div>
      {feedback ? <FeedbackNotice kind={feedback.kind}>{feedback.text}</FeedbackNotice> : null}
      <div className="category-scroll" aria-label={t("文件分类")}>
        {(Object.keys(categoryLabels) as CategoryFilter[]).map((item) => (
          <button
            type="button"
            className={category === item ? "active" : ""}
            aria-pressed={category === item}
            key={item}
            onClick={() => setCategory(item)}
          >
            {t(categoryLabels[item])}
            <span className="filter-count" aria-hidden="true">
              {categoryCounts[item]}
            </span>
          </button>
        ))}
      </div>
      <div className="filters">
        <div className="search-line">
          <input
            type="search"
            aria-label={t("搜索结果")}
            placeholder={t("文件名、URL、类型或 MIME")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button className="ghost search-clear" type="button" onClick={() => setSearch("")}>
              {t("清空")}
            </button>
          ) : null}
          <label>
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            {t("正则")}
          </label>
        </div>
        {regexError ? <FeedbackNotice kind="error">{regexError}</FeedbackNotice> : null}
        {search.trim() && !regexError ? (
          <p className="search-summary" role="status">
            {regex
              ? t("找到 {count} 项正则匹配", { count: filtered.length })
              : t("找到 {count} 项；多个关键词需全部匹配", { count: filtered.length })}
          </p>
        ) : null}
        <details>
          <summary>{t("更多筛选与排序")}</summary>
          <div className="form-grid compact">
            <label>
              {t("扩展名")}
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
              {t("来源")}
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="all">{t("全部来源")}</option>
                {Object.entries(sourceLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("范围")}
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">{t("内部与外部")}</option>
                <option value="internal">{t("仅内部")}</option>
                <option value="external">{t("仅外部")}</option>
              </select>
            </label>
            <label>
              {t("最小大小 MB")}
              <input
                type="number"
                min="0"
                value={minMb}
                onChange={(e) => setMinMb(e.target.value)}
              />
            </label>
            <label>
              {t("最大大小 MB")}
              <input
                type="number"
                min="0"
                value={maxMb}
                onChange={(e) => setMaxMb(e.target.value)}
              />
            </label>
            <label>
              {t("最低置信度")}
              <input
                type="number"
                min="0"
                max="100"
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
              />
            </label>
            <label>
              {t("排序")}
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">{t("最新发现")}</option>
                <option value="confidence">{t("置信度")}</option>
                <option value="size">{t("文件大小")}</option>
                <option value="name">{t("文件名")}</option>
              </select>
            </label>
          </div>
        </details>
        {hasActiveFilters ? (
          <div className="filter-footer">
            <span>{t("已启用筛选或自定义排序")}</span>
            <button className="ghost" type="button" onClick={resetFilters}>
              {t("重置筛选")}
            </button>
          </div>
        ) : null}
      </div>
      <div className="selection-bar">
        <label>
          <input
            type="checkbox"
            disabled={busy}
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
          {t("全选筛选结果")}
        </label>
        <span>
          {t("{count} 项已选", { count: selectedFiles.length })}
          {hiddenSelectedCount ? t("（{count} 项已隐藏）", { count: hiddenSelectedCount }) : ""}
        </span>
      </div>
      {filtered.length ? (
        <VirtualList
          items={filtered}
          itemHeight={language === "en" ? 285 : 249}
          height={Math.max(320, viewportHeight - 390)}
          endPadding={72}
          getKey={(file) => file.id}
          renderItem={(file) => {
            const filename = known(file.filename);
            const openable = canOpenResource(file);
            const mediaKind = previewKind(file);
            const downloadable = canDownloadResource(file);
            const probeAllowed = canProbeResource(file, snapshot);
            return (
              <article
                className={`result-card ${mediaKind ? "has-media" : ""} ${selected.has(file.id) ? "selected" : ""}`}
              >
                <input
                  className="card-check"
                  type="checkbox"
                  aria-label={t("选择 {filename}", { filename })}
                  checked={selected.has(file.id)}
                  disabled={busy}
                  onChange={() => toggle(file.id)}
                />
                {mediaKind === "image" ? (
                  <ImageThumbnail
                    key={resourceUrl(file)}
                    file={file}
                    enabled={openable}
                    open={() => openPreview(file, "image")}
                  />
                ) : mediaKind === "audio" ? (
                  <InlineAudio
                    key={resourceUrl(file)}
                    file={file}
                    enabled={openable}
                    active={activeAudioId === file.id}
                    setActive={setActiveAudioId}
                  />
                ) : (
                  <div className={`file-type type-${file.category}`}>
                    {file.extension?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="result-body">
                  <h3 title={filename}>{filename}</h3>
                  <p className="url" title={file.canonicalUrl}>
                    {file.canonicalUrl}
                  </p>
                  <div className="metadata">
                    <span>{t(categoryLabels[file.category])}</span>
                    <span>{formatSize(file.contentLength, t)}</span>
                    <span>{file.mimeType ?? t("MIME 未知")}</span>
                    <span>{t("置信度 {count}", { count: file.confidence })}</span>
                  </div>
                  <div className="badges">
                    <span>{file.sources.map((item) => t(sourceLabels[item])).join(" + ")}</span>
                    {file.confidence < 50 ? (
                      <span className="warning">{t("可能资源，请人工确认")}</span>
                    ) : null}
                    {file.isExternal ? (
                      <span className="warning">{t("外部资源")}</span>
                    ) : (
                      <span>{t("同站资源")}</span>
                    )}
                    {file.warnings.map((warning) => (
                      <span className="warning" key={warning}>
                        {warningLabels[warning] ? t(warningLabels[warning]) : t("检测到资源风险")}
                      </span>
                    ))}
                  </div>
                  <div className="card-actions">
                    {mediaKind ? (
                      <button
                        type="button"
                        disabled={busy || !openable}
                        title={!openable ? t("临时、分段或无效媒体无法预览") : undefined}
                        onClick={() => openPreview(file, mediaKind)}
                      >
                        {mediaKind === "audio" ? t("试听") : t("预览")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy || !openable}
                      title={openable ? t("在新标签页打开资源") : t("临时、分段或无效资源无法打开")}
                      onClick={() =>
                        void runCardAction(
                          () => chrome.tabs.create({ url: file.finalUrl ?? file.canonicalUrl }),
                          t("已在新标签页打开文件。"),
                          t("无法打开文件链接。")
                        )
                      }
                    >
                      {t("打开")}
                    </button>
                    <button
                      className="primary"
                      type="button"
                      disabled={busy || !downloadable}
                      title={downloadable ? t("下载此文件") : t("该资源不符合直接下载的安全条件")}
                      onClick={() => void download(file)}
                    >
                      {t("下载")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runCardAction(
                          () => navigator.clipboard.writeText(file.finalUrl ?? file.canonicalUrl),
                          t("已复制文件链接。"),
                          t("无法写入剪贴板。")
                        )
                      }
                    >
                      {t("复制")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title={t("在新标签页打开发现该资源的网页")}
                      onClick={() =>
                        void runCardAction(
                          () => chrome.tabs.create({ url: file.sourcePageUrl }),
                          t("已打开来源页。"),
                          t("无法打开来源页。")
                        )
                      }
                    >
                      {t("打开来源页")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !openable || !probeAllowed}
                      title={
                        !openable
                          ? t("临时或无效资源无法探测元数据")
                          : !probeAllowed
                            ? t("需要完整嗅探权限或对应资源站点权限")
                            : undefined
                      }
                      onClick={() => void probe(file)}
                    >
                      {t("元数据")}
                    </button>
                    <button type="button" disabled={busy} onClick={() => openDetails(file)}>
                      {t("详情")}
                    </button>
                  </div>
                </div>
              </article>
            );
          }}
        />
      ) : (
        <div className="empty-state">
          {regexError
            ? t("当前筛选条件下没有结果")
            : t("当前筛选条件下没有结果。先运行扫描，或调整筛选条件。")}
        </div>
      )}
      <div className="sticky-actions">
        <button
          type="button"
          disabled={!selectedFiles.length || busy}
          onClick={() => void copy("url")}
        >
          {t("复制链接")}
        </button>
        <button
          type="button"
          disabled={!selectedFiles.length || busy}
          onClick={() => void copy("filename")}
        >
          {t("复制文件名")}
        </button>
        <button
          className="primary"
          type="button"
          disabled={!selectedFiles.length || busy}
          onClick={() => void queue()}
        >
          {t("加入下载")}
        </button>
        <button
          className="danger"
          type="button"
          disabled={!selectedFiles.length || busy}
          onClick={() => void remove()}
        >
          {t("删除")}
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
      {detailsFile ? (
        <div
          className="media-preview-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetails();
          }}
        >
          <div
            className="media-preview file-details-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-details-title"
            onKeyDown={handleDetailsKeyDown}
          >
            <div className="media-preview-heading">
              <div>
                <p className="eyebrow">{t("完整资源信息")}</p>
                <h2 id="file-details-title">
                  {t("文件详情：{filename}", { filename: known(detailsFile.filename) })}
                </h2>
              </div>
              <button type="button" autoFocus aria-label={t("关闭文件详情")} onClick={closeDetails}>
                {t("关闭")}
              </button>
            </div>
            <dl className="file-details-grid">
              <div>
                <dt>{t("分类")}</dt>
                <dd>{t(categoryLabels[detailsFile.category])}</dd>
              </div>
              <div>
                <dt>{t("置信度")}</dt>
                <dd>{detailsFile.confidence}</dd>
              </div>
              <div>
                <dt>{t("扩展名")}</dt>
                <dd>{detailsFile.extension ?? t("未知")}</dd>
              </div>
              <div>
                <dt>{t("大小")}</dt>
                <dd>{formatSize(detailsFile.contentLength, t)}</dd>
              </div>
              <div className="wide">
                <dt>MIME</dt>
                <dd>{detailsFile.mimeType ?? t("未知")}</dd>
              </div>
              {detailsFile.originalUrl !== detailsFile.canonicalUrl ? (
                <div className="wide">
                  <dt>{t("原始 URL")}</dt>
                  <dd>{detailsFile.originalUrl}</dd>
                </div>
              ) : null}
              <div className="wide">
                <dt>{t("规范 URL")}</dt>
                <dd>{detailsFile.canonicalUrl}</dd>
              </div>
              <div className="wide">
                <dt>{t("最终 URL")}</dt>
                <dd>
                  {detailsFile.finalUrl
                    ? detailsFile.finalUrl === detailsFile.canonicalUrl
                      ? t("与规范 URL 相同")
                      : detailsFile.finalUrl
                    : t("未发生重定向或尚未探测")}
                </dd>
              </div>
              <div className="wide">
                <dt>{t("来源页")}</dt>
                <dd>{detailsFile.sourcePageUrl}</dd>
              </div>
              <div className="wide">
                <dt>{t("发现方式")}</dt>
                <dd>{detailsFile.sources.map((item) => t(sourceLabels[item])).join(" + ")}</dd>
              </div>
              <div>
                <dt>{t("元数据状态")}</dt>
                <dd>{t(metadataStatusLabels[detailsFile.metadataStatus])}</dd>
              </div>
              <div>
                <dt>{t("发现时间")}</dt>
                <dd>{new Date(detailsFile.discoveredAt).toLocaleString(locale)}</dd>
              </div>
              <div className="wide">
                <dt>Content-Disposition</dt>
                <dd>{detailsFile.contentDisposition ?? t("未知")}</dd>
              </div>
              <div className="wide">
                <dt>ETag</dt>
                <dd>{detailsFile.etag ?? t("未知")}</dd>
              </div>
              <div className="wide">
                <dt>Last-Modified</dt>
                <dd>{detailsFile.lastModified ?? t("未知")}</dd>
              </div>
              <div className="wide">
                <dt>Accept-Ranges</dt>
                <dd>{detailsFile.acceptRanges ?? t("未知")}</dd>
              </div>
              <div className="wide">
                <dt>{t("风险提示")}</dt>
                <dd>
                  {detailsFile.warnings.length
                    ? detailsFile.warnings
                        .map((warning) =>
                          warningLabels[warning] ? t(warningLabels[warning]) : warning
                        )
                        .join(language === "zh-CN" ? "；" : "; ")
                    : t("未发现已知风险")}
                </dd>
              </div>
            </dl>
            {detailsFeedback ? (
              <FeedbackNotice kind={detailsFeedback.kind}>{detailsFeedback.text}</FeedbackNotice>
            ) : null}
            <div className="file-details-actions">
              <button
                type="button"
                onClick={() => void copyDetail(detailsFile.filename, t("文件名"))}
              >
                {t("复制文件名")}
              </button>
              <button
                type="button"
                onClick={() => void copyDetail(resourceUrl(detailsFile), t("资源 URL"))}
              >
                {t("复制资源 URL")}
              </button>
              <button
                type="button"
                onClick={() => void copyDetail(detailsFile.sourcePageUrl, t("来源页 URL"))}
              >
                {t("复制来源页 URL")}
              </button>
              <button
                type="button"
                onClick={() => void copyDetail(markdownLink(detailsFile), t("Markdown"))}
              >
                {t("复制 Markdown")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void copyDetail(JSON.stringify(detailsFile, null, 2), t("元数据 JSON"))
                }
              >
                {t("复制元数据 JSON")}
              </button>
              <button
                type="button"
                disabled={!canOpenResource(detailsFile)}
                onClick={() => void openDetailTab(resourceUrl(detailsFile), t("资源"))}
              >
                {t("打开资源")}
              </button>
              <button
                type="button"
                onClick={() => void openDetailTab(detailsFile.sourcePageUrl, t("来源页"))}
              >
                {t("打开来源页")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {preview ? (
        <div
          className="media-preview-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <div
            className="media-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-preview-title"
            onKeyDown={handlePreviewKeyDown}
          >
            <div className="media-preview-heading">
              <div>
                <p className="eyebrow">
                  {preview.kind === "audio" ? t("媒体试听") : t("媒体预览")}
                </p>
                <h2 id="media-preview-title">
                  {preview.kind === "audio"
                    ? t("音频试听：{filename}", { filename: known(preview.file.filename) })
                    : t("图片预览：{filename}", { filename: known(preview.file.filename) })}
                </h2>
              </div>
              <button type="button" autoFocus aria-label={t("关闭预览")} onClick={closePreview}>
                {t("关闭")}
              </button>
            </div>
            <p
              className="media-preview-url"
              title={preview.file.finalUrl ?? preview.file.canonicalUrl}
            >
              {preview.file.finalUrl ?? preview.file.canonicalUrl}
            </p>
            <div className={`media-preview-stage ${preview.kind}`}>
              {preview.kind === "image" ? (
                <img
                  key={preview.file.id}
                  src={preview.file.finalUrl ?? preview.file.canonicalUrl}
                  alt={known(preview.file.filename)}
                  referrerPolicy="no-referrer"
                  onLoad={() => setPreviewError(undefined)}
                  onError={() => setPreviewError(t("图片加载失败，资源可能已过期或拒绝外部预览。"))}
                />
              ) : (
                <audio
                  key={preview.file.id}
                  src={preview.file.finalUrl ?? preview.file.canonicalUrl}
                  aria-label={t("音频播放器：{filename}", {
                    filename: known(preview.file.filename)
                  })}
                  controls
                  preload="metadata"
                  onCanPlay={() => setPreviewError(undefined)}
                  onError={() =>
                    setPreviewError(t("音频加载失败，资源可能已过期或不受浏览器支持。"))
                  }
                />
              )}
            </div>
            {previewError ? <FeedbackNotice kind="error">{previewError}</FeedbackNotice> : null}
            <p className="media-preview-tip">
              {preview.kind === "audio"
                ? t("点击播放器开始试听；不会自动播放。")
                : t("图片按原始比例缩放显示。")}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
