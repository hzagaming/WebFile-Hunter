import { useState } from "react";
import { sendMessage } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import { ALL_SITES_ORIGINS } from "@/core/host-permissions";
import { clampScanConfig } from "@/utils/defaults";
import { FeedbackNotice } from "../components/FeedbackNotice";
import { StatusBadge } from "../components/StatusBadge";
import type { ScanConfig, ScanSession } from "@/types/models";

interface Props {
  snapshot: AppSnapshot;
  refresh: (sessionId?: string) => Promise<void>;
  openResults: () => void;
}

async function requestSitePermission(url: string): Promise<boolean> {
  const parsed = new URL(url);
  return chrome.permissions.request({ origins: [`${parsed.protocol}//${parsed.hostname}/*`] });
}

async function requestAllSitesPermission(): Promise<boolean> {
  return chrome.permissions.request({ origins: ALL_SITES_ORIGINS });
}

function elapsed(session: ScanSession): string {
  const start = session.startedAt ?? session.createdAt;
  const end = session.completedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function isSupportedPage(tab: AppSnapshot["activeTab"]): boolean {
  if (!tab) return false;
  try {
    return ["http:", "https:"].includes(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}

const workingMessages: Record<string, string> = {
  current: "正在启动当前页扫描…",
  monitor: "正在启动完整嗅探…",
  crawl: "正在启动同域递归扫描…",
  pause: "正在暂停递归扫描…",
  resume: "正在继续递归扫描…",
  stop: "正在停止扫描任务…"
};

export function ScannerPage({ snapshot, refresh, openResults }: Props) {
  const [showCrawlConfig, setShowCrawlConfig] = useState(false);
  const [config, setConfig] = useState<ScanConfig>(snapshot.settings.scan);
  const [working, setWorking] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const tab = snapshot.activeTab;
  const session = snapshot.activeSession;
  const canScan = isSupportedPage(tab);

  const run = async (mode: "current" | "monitor" | "crawl"): Promise<void> => {
    if (!tab || !canScan) return;
    setWorking(mode);
    setLocalError(undefined);
    try {
      const granted =
        mode === "monitor"
          ? await requestAllSitesPermission()
          : await requestSitePermission(tab.url);
      if (!granted) {
        throw new Error(
          mode === "monitor"
            ? "未授予完整嗅探权限，任务没有启动。可改用当前页或同域扫描。"
            : "未授予当前网站权限，任务没有启动。插件不会重复弹出授权窗口。"
        );
      }
      const created =
        mode === "current"
          ? await sendMessage<ScanSession>({
              type: "SCAN_CURRENT_PAGE",
              payload: { tabId: tab.id }
            })
          : mode === "monitor"
            ? await sendMessage<ScanSession>({
                type: "START_LIVE_MONITOR",
                payload: { tabId: tab.id, origin: tab.origin }
              })
            : await sendMessage<ScanSession>({
                type: "START_RECURSIVE_CRAWL",
                payload: { tabId: tab.id, config: clampScanConfig(config) }
              });
      setShowCrawlConfig(false);
      await refresh(created.id);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "任务启动失败。");
    } finally {
      setWorking(undefined);
    }
  };

  const control = async (action: "pause" | "resume" | "stop"): Promise<void> => {
    if (!session) return;
    if (action === "stop" && !confirm("停止当前扫描任务？已发现的结果会保留。")) return;
    const type =
      action === "pause" ? "PAUSE_SCAN" : action === "resume" ? "RESUME_SCAN" : "STOP_SCAN";
    setWorking(action);
    setLocalError(undefined);
    try {
      if (type === "PAUSE_SCAN") await sendMessage({ type, payload: { sessionId: session.id } });
      else if (type === "RESUME_SCAN")
        await sendMessage({ type, payload: { sessionId: session.id } });
      else await sendMessage({ type, payload: { sessionId: session.id } });
      await refresh(session.id);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "无法控制任务。");
    } finally {
      setWorking(undefined);
    }
  };

  return (
    <section className="page scanner-page" aria-busy={Boolean(working)}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">发现公开资源</p>
          <h2>开始扫描</h2>
        </div>
        {session ? <StatusBadge status={session.status} /> : null}
      </div>
      <p className="section-copy">
        当前页与递归扫描按站点授权；完整嗅探会单独请求 HTTP/HTTPS 全站权限，但只记录当前标签页。
        结果只保存在本地，不会自动下载或提交表单。
      </p>
      {localError ? (
        <div className="notice notice-error" role="alert">
          {localError}
        </div>
      ) : null}
      {working ? (
        <FeedbackNotice kind="info">{workingMessages[working] ?? "正在处理…"}</FeedbackNotice>
      ) : null}
      {!canScan ? (
        <FeedbackNotice kind="info">当前页面不支持扫描，仅支持 HTTP 或 HTTPS 网页。</FeedbackNotice>
      ) : null}
      {canScan ? (
        <FeedbackNotice kind={snapshot.allSitesAccess ? "success" : "info"}>
          {snapshot.allSitesAccess
            ? "完整跨域嗅探已启用：可识别第三方 CDN、媒体、接口响应与跨域 frame 资源。"
            : "完整嗅探首次启动时会显示全站权限确认；可随时在设置中一键撤销。"}
        </FeedbackNotice>
      ) : null}

      <div className="scan-actions">
        <button
          className="primary action-card"
          type="button"
          disabled={!canScan || Boolean(working)}
          onClick={() => void run("current")}
        >
          <span className="action-icon" aria-hidden="true">
            ⌕
          </span>
          <span>
            <strong>扫描当前页面</strong>
            <small>分析 DOM、样式和已加载资源，不进入其他页面</small>
          </span>
        </button>
        <button
          className="action-card"
          type="button"
          aria-expanded={showCrawlConfig}
          aria-controls="crawl-config"
          disabled={!canScan || Boolean(working)}
          onClick={() => void run("monitor")}
        >
          <span className="action-icon" aria-hidden="true">
            ◉
          </span>
          <span>
            <strong>开始完整嗅探</strong>
            <small>
              覆盖当前标签页的同站与第三方后续请求，持续 {snapshot.settings.monitorDurationSeconds}{" "}
              秒
            </small>
          </span>
        </button>
        <button
          className="action-card"
          type="button"
          disabled={!canScan || Boolean(working)}
          onClick={() => setShowCrawlConfig(true)}
        >
          <span className="action-icon" aria-hidden="true">
            ⌘
          </span>
          <span>
            <strong>同域递归扫描</strong>
            <small>结合页面链接、HTTP Link、Sitemap 与当前 SPA DOM 扫描同源公开页面</small>
          </span>
        </button>
      </div>

      {showCrawlConfig ? (
        <div id="crawl-config" className="config-panel" aria-busy={working === "crawl"}>
          <div className="section-heading">
            <h3>递归扫描确认</h3>
            <button
              className="icon-button"
              type="button"
              aria-label="关闭递归扫描设置"
              disabled={Boolean(working)}
              onClick={() => setShowCrawlConfig(false)}
            >
              ×
            </button>
          </div>
          <p>
            只访问 <strong>{tab?.origin}</strong>，不会自动扩展到子域名或外部网站。
          </p>
          <div className="form-grid">
            <label>
              最大深度
              <input
                type="number"
                min="0"
                max="5"
                disabled={Boolean(working)}
                value={config.maxDepth}
                onChange={(e) => setConfig({ ...config, maxDepth: Number(e.target.value) })}
              />
            </label>
            <label>
              最大页面
              <input
                type="number"
                min="1"
                max="2000"
                disabled={Boolean(working)}
                value={config.maxPages}
                onChange={(e) => setConfig({ ...config, maxPages: Number(e.target.value) })}
              />
            </label>
            <label>
              同路径查询变体
              <input
                type="number"
                min="1"
                max="50"
                disabled={Boolean(working)}
                value={config.maxQueryVariantsPerPath}
                onChange={(e) =>
                  setConfig({ ...config, maxQueryVariantsPerPath: Number(e.target.value) })
                }
              />
            </label>
            <label>
              样式表抓取上限
              <input
                type="number"
                min="1"
                max="500"
                disabled={Boolean(working)}
                value={config.maxStylesheets}
                onChange={(e) => setConfig({ ...config, maxStylesheets: Number(e.target.value) })}
              />
            </label>
            <label>
              并发数
              <input
                type="number"
                min="1"
                max="6"
                disabled={Boolean(working)}
                value={config.maxConcurrency}
                onChange={(e) => setConfig({ ...config, maxConcurrency: Number(e.target.value) })}
              />
            </label>
            <label>
              请求间隔（毫秒）
              <input
                type="number"
                min="500"
                step="100"
                disabled={Boolean(working)}
                value={config.minDelayMs}
                onChange={(e) => setConfig({ ...config, minDelayMs: Number(e.target.value) })}
              />
            </label>
            <label>
              超时（秒）
              <input
                type="number"
                min="1"
                max="120"
                disabled={Boolean(working)}
                value={config.requestTimeoutMs / 1000}
                onChange={(e) =>
                  setConfig({ ...config, requestTimeoutMs: Number(e.target.value) * 1000 })
                }
              />
            </label>
            <label>
              重试次数
              <input
                type="number"
                min="0"
                max="3"
                disabled={Boolean(working)}
                value={config.retries}
                onChange={(e) => setConfig({ ...config, retries: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="check-grid">
            <label>
              <input
                type="checkbox"
                disabled={Boolean(working)}
                checked={config.respectRobots}
                onChange={(e) => setConfig({ ...config, respectRobots: e.target.checked })}
              />
              尊重 robots.txt
            </label>
            <label>
              <input
                type="checkbox"
                disabled={Boolean(working)}
                checked={config.discoverSitemaps}
                onChange={(e) => setConfig({ ...config, discoverSitemaps: e.target.checked })}
              />
              发现 Sitemap
            </label>
            <label>
              <input
                type="checkbox"
                disabled={Boolean(working)}
                checked={config.capturePageText}
                onChange={(e) => setConfig({ ...config, capturePageText: e.target.checked })}
              />
              提取网页文字
            </label>
            <label>
              <input
                type="checkbox"
                disabled={Boolean(working)}
                checked={config.followRedirects}
                onChange={(e) => setConfig({ ...config, followRedirects: e.target.checked })}
              />
              跟随重定向（最多 {config.maxRedirects} 次）
            </label>
            <label>
              <input
                type="checkbox"
                disabled={Boolean(working)}
                checked={config.probeMetadata}
                onChange={(e) => setConfig({ ...config, probeMetadata: e.target.checked })}
              />
              探测文件元数据
            </label>
            <label>
              <input
                type="checkbox"
                disabled={Boolean(working)}
                checked={config.excludeDangerousActions}
                onChange={(e) =>
                  setConfig({ ...config, excludeDangerousActions: e.target.checked })
                }
              />
              排除危险操作 URL
            </label>
          </div>
          <button
            className="primary full"
            type="button"
            disabled={working === "crawl"}
            onClick={() => void run("crawl")}
          >
            确认并请求当前站点权限
          </button>
        </div>
      ) : null}

      {session ? (
        <div className="progress-card">
          <div className="section-heading">
            <h3>最近任务</h3>
            <StatusBadge status={session.status} />
          </div>
          <p className="current-url" title={session.startUrl}>
            {session.startUrl}
          </p>
          {session.currentUrl ? (
            <p className="current-url" title={session.currentUrl}>
              {session.status === "running" ? "正在处理" : "最后处理"}：{session.currentUrl}
            </p>
          ) : null}
          <div className="metrics">
            <div>
              <strong>{session.pagesProcessed}</strong>
              <span>已处理页面</span>
            </div>
            <div>
              <strong>{Math.max(0, session.pagesQueued - session.pagesProcessed)}</strong>
              <span>队列</span>
            </div>
            <div>
              <strong>{session.filesDiscovered}</strong>
              <span>发现文件</span>
            </div>
            <div>
              <strong>{session.errors}</strong>
              <span>错误</span>
            </div>
          </div>
          <div className="progress-meta">
            <span>
              模式：
              {session.mode === "current_page"
                ? "当前页"
                : session.mode === "live_monitor"
                  ? "实时监听"
                  : "递归扫描"}
            </span>
            <span>运行：{elapsed(session)}</span>
            {session.requestsPerMinute !== undefined ? (
              <span>请求速率：{session.requestsPerMinute} 次/分钟</span>
            ) : null}
          </div>
          {session.errorMessage ? (
            <FeedbackNotice kind="error">{session.errorMessage}</FeedbackNotice>
          ) : null}
          <div className="button-row">
            {session.status === "running" && session.mode === "recursive_crawl" ? (
              <button
                type="button"
                disabled={Boolean(working)}
                onClick={() => void control("pause")}
              >
                暂停
              </button>
            ) : null}
            {session.status === "paused" ? (
              <button
                type="button"
                disabled={Boolean(working)}
                onClick={() => void control("resume")}
              >
                继续
              </button>
            ) : null}
            {session.status === "running" || session.status === "paused" ? (
              <button
                className="danger"
                type="button"
                disabled={Boolean(working)}
                onClick={() => void control("stop")}
              >
                停止任务
              </button>
            ) : null}
            {session.filesDiscovered > 0 ? (
              <button
                className="primary"
                type="button"
                disabled={Boolean(working)}
                onClick={openResults}
              >
                查看结果
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
