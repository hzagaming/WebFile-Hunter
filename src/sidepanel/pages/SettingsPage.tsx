import { useState } from "react";
import { sendMessage } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import {
  ALL_SITES_ORIGINS,
  isAllSitesOrigin,
  permissionPatternsForSite
} from "@/core/host-permissions";
import { clampAppSettings, DEFAULT_SETTINGS } from "@/utils/defaults";
import type { AppSettings, FileCategory } from "@/types/models";
import { FeedbackNotice, type FeedbackKind } from "../components/FeedbackNotice";
import { useI18n } from "@/i18n";

interface Props {
  snapshot: AppSnapshot;
  refresh: (sessionId?: string) => Promise<void>;
  updateSettings?: (settings: AppSettings) => void;
  standalone?: boolean;
}

function parseCustomMap(value: string): Record<string, FileCategory> {
  const output: Record<string, FileCategory> = {};
  for (const pair of value.split(/[\n,]+/)) {
    const [key, category = "unknown"] = pair.split(":").map((item) => item.trim().toLowerCase());
    if (
      key &&
      !["__proto__", "constructor", "prototype"].includes(key) &&
      [
        "audio",
        "video",
        "text",
        "document",
        "ebook",
        "archive",
        "image",
        "subtitle",
        "data",
        "code",
        "font",
        "model",
        "unknown"
      ].includes(category)
    )
      output[key.replace(/^\./, "")] = category as FileCategory;
  }
  return output;
}

function formatCustomMap(value: Record<string, FileCategory>, separator: string): string {
  return Object.entries(value)
    .map(([key, category]) => `${key}:${category}`)
    .join(separator);
}

export function SettingsPage({ snapshot, refresh, updateSettings, standalone = false }: Props) {
  const { known, setPreference, t } = useI18n();
  const [settingsDraft, setSettings] = useState<AppSettings>();
  const settings = settingsDraft ?? snapshot.settings;
  const origins = snapshot.grantedOrigins;
  const broadOrigins = origins.filter(isAllSitesOrigin);
  const siteOrigins = origins.filter((origin) => !isAllSitesOrigin(origin));
  const fullAccess = ALL_SITES_ORIGINS.every((origin) => origins.includes(origin));
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string }>();
  const [working, setWorking] = useState(false);
  const [useCurrentSite, setUseCurrentSite] = useState(true);
  const [customSite, setCustomSite] = useState("");
  const [customExtensionsDraft, setCustomExtensions] = useState<string>();
  const customExtensions =
    customExtensionsDraft ?? formatCustomMap(snapshot.settings.customExtensions, ", ");
  const [customMimesDraft, setCustomMimes] = useState<string>();
  const customMimes = customMimesDraft ?? formatCustomMap(snapshot.settings.customMimeTypes, "\n");
  const fail = (error: unknown, fallback: string): void =>
    setFeedback({ kind: "error", text: error instanceof Error ? known(error.message) : fallback });
  const currentSite = (() => {
    try {
      const url = new URL(snapshot.activeTab?.url ?? "");
      return ["http:", "https:"].includes(url.protocol) ? url : undefined;
    } catch {
      return undefined;
    }
  })();

  const save = async (): Promise<void> => {
    const next = clampAppSettings({
      ...settings,
      customExtensions: parseCustomMap(customExtensions),
      customMimeTypes: parseCustomMap(customMimes)
    });
    setWorking(true);
    setFeedback(undefined);
    try {
      await sendMessage({ type: "SAVE_SETTINGS", payload: { settings: next } });
      updateSettings?.(next);
      setSettings(updateSettings ? undefined : next);
      setCustomExtensions(
        updateSettings ? undefined : formatCustomMap(next.customExtensions, ", ")
      );
      setCustomMimes(updateSettings ? undefined : formatCustomMap(next.customMimeTypes, "\n"));
      setFeedback({ kind: "success", text: t("设置已保存到本地浏览器。") });
      await refresh(snapshot.activeSession?.id);
    } catch (error) {
      fail(error, t("无法保存设置。"));
    } finally {
      setWorking(false);
    }
  };

  const revoke = async (originPattern: string): Promise<void> => {
    if (!confirm(t("撤销 {origin} 的权限？对应进行中任务会停止。", { origin: originPattern })))
      return;
    setWorking(true);
    setFeedback(undefined);
    try {
      const removed = await sendMessage<boolean>({
        type: "REVOKE_ORIGIN",
        payload: { originPattern }
      });
      if (removed) {
        setFeedback({ kind: "success", text: t("网站权限已撤销，对应进行中任务已安全停止。") });
      } else {
        setFeedback({ kind: "warning", text: t("网站权限已不存在，列表已刷新。") });
      }
      await refresh(snapshot.activeSession?.id);
    } catch (error) {
      fail(error, t("无法撤销网站权限。"));
    } finally {
      setWorking(false);
    }
  };

  const revokeAllSites = async (): Promise<void> => {
    if (!confirm(t("撤销完整跨域嗅探权限？进行中的实时嗅探会停止。"))) return;
    setWorking(true);
    setFeedback(undefined);
    try {
      const removed = await sendMessage<boolean>({ type: "REVOKE_ALL_SITES" });
      if (removed) {
        setFeedback({ kind: "success", text: t("完整嗅探权限已撤销，实时嗅探已安全停止。") });
      } else {
        setFeedback({ kind: "warning", text: t("完整嗅探权限已不存在，状态已刷新。") });
      }
      await refresh(snapshot.activeSession?.id);
    } catch (error) {
      fail(error, t("无法撤销完整嗅探权限。"));
    } finally {
      setWorking(false);
    }
  };

  const authorizeSite = async (): Promise<void> => {
    let requestedOrigins: string[];
    try {
      requestedOrigins = permissionPatternsForSite(
        useCurrentSite ? (currentSite?.href ?? "") : customSite
      );
    } catch (error) {
      fail(error, t("无法识别授权网站。"));
      return;
    }
    setWorking(true);
    setFeedback(undefined);
    try {
      if (!(await chrome.permissions.request({ origins: requestedOrigins }))) {
        setFeedback({ kind: "warning", text: t("未授予网站权限。") });
        return;
      }
      await refresh(snapshot.activeSession?.id);
      setFeedback({ kind: "success", text: t("网站已获授权，可在对应标签页主动开始扫描。") });
    } catch (error) {
      fail(error, t("无法添加网站权限。"));
    } finally {
      setWorking(false);
    }
  };

  const clear = async (): Promise<void> => {
    if (!confirm(t("确定清除全部扫描结果、历史、设置和下载任务记录？此操作无法撤销。"))) return;
    setWorking(true);
    setFeedback(undefined);
    try {
      await sendMessage({ type: "CLEAR_ALL_DATA" });
      const defaults = structuredClone(DEFAULT_SETTINGS);
      updateSettings?.(defaults);
      setSettings(updateSettings ? undefined : defaults);
      setPreference(defaults.language);
      setCustomExtensions(updateSettings ? undefined : "");
      setCustomMimes(updateSettings ? undefined : "");
      setFeedback({ kind: "success", text: t("全部本地数据已清除，设置已恢复默认值。") });
      await refresh();
    } catch (error) {
      fail(error, t("无法清除本地数据。"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className={`page settings-page ${standalone ? "standalone" : ""}`} aria-busy={working}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t("本地与最小权限")}</p>
          <h2>{t("设置")}</h2>
        </div>
        <button className="primary" type="button" disabled={working} onClick={() => void save()}>
          {t("保存")}
        </button>
      </div>
      {feedback ? <FeedbackNotice kind={feedback.kind}>{feedback.text}</FeedbackNotice> : null}
      <fieldset className="settings-group" disabled={working}>
        <h3>{t("界面语言")}</h3>
        <label>
          {t("界面语言")}
          <select
            value={settings.language}
            onChange={(event) => {
              const language = event.target.value as AppSettings["language"];
              setSettings({ ...settings, language });
              setPreference(language);
            }}
          >
            <option value="auto">{t("跟随浏览器")}</option>
            <option value="zh-CN">{t("简体中文")}</option>
            <option value="en">English</option>
          </select>
        </label>
      </fieldset>
      <fieldset
        className="settings-group"
        disabled={working}
        aria-labelledby="settings-crawl-heading"
      >
        <h3 id="settings-crawl-heading">{t("默认递归扫描")}</h3>
        <div className="form-grid">
          <label>
            {t("最大深度")}
            <input
              type="number"
              min="0"
              max="5"
              value={settings.scan.maxDepth}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, maxDepth: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            {t("最大页面数")}
            <input
              type="number"
              min="1"
              max="2000"
              value={settings.scan.maxPages}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, maxPages: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            {t("同路径查询变体上限")}
            <input
              type="number"
              min="1"
              max="50"
              value={settings.scan.maxQueryVariantsPerPath}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: {
                    ...settings.scan,
                    maxQueryVariantsPerPath: Number(e.target.value)
                  }
                })
              }
            />
          </label>
          <label>
            {t("样式表抓取上限")}
            <input
              type="number"
              min="1"
              max="500"
              value={settings.scan.maxStylesheets}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, maxStylesheets: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            {t("并发数")}
            <input
              type="number"
              min="1"
              max="6"
              value={settings.scan.maxConcurrency}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, maxConcurrency: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            {t("请求间隔（毫秒）")}
            <input
              type="number"
              min="500"
              value={settings.scan.minDelayMs}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, minDelayMs: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            {t("HTML 上限（MB）")}
            <input
              type="number"
              min="1"
              max="5"
              value={settings.scan.maxHtmlBytes / 1024 ** 2}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, maxHtmlBytes: Number(e.target.value) * 1024 ** 2 }
                })
              }
            />
          </label>
          <label>
            {t("请求超时（秒）")}
            <input
              type="number"
              min="1"
              max="120"
              value={settings.scan.requestTimeoutMs / 1000}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: {
                    ...settings.scan,
                    requestTimeoutMs: Number(e.target.value) * 1000
                  }
                })
              }
            />
          </label>
          <label>
            {t("最大重定向")}
            <input
              type="number"
              min="0"
              max="5"
              value={settings.scan.maxRedirects}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, maxRedirects: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            {t("重试次数")}
            <input
              type="number"
              min="0"
              max="3"
              value={settings.scan.retries}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, retries: Number(e.target.value) }
                })
              }
            />
          </label>
        </div>
        <div className="check-grid">
          <label>
            <input
              type="checkbox"
              checked={settings.scan.respectRobots}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, respectRobots: e.target.checked }
                })
              }
            />
            {t("尊重 robots.txt")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.scan.discoverSitemaps}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, discoverSitemaps: e.target.checked }
                })
              }
            />
            {t("发现 Sitemap")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.scan.capturePageText}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, capturePageText: e.target.checked }
                })
              }
            />
            {t("提取网页文字")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.scan.followRedirects}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, followRedirects: e.target.checked }
                })
              }
            />
            {t("跟随重定向")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.scan.probeMetadata}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, probeMetadata: e.target.checked }
                })
              }
            />
            {t("自动探测元数据")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.scan.excludeDangerousActions}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  scan: { ...settings.scan, excludeDangerousActions: e.target.checked }
                })
              }
            />
            {t("排除危险操作 URL")}
          </label>
        </div>
      </fieldset>
      <fieldset
        className="settings-group"
        disabled={working}
        aria-labelledby="settings-discovery-heading"
      >
        <h3 id="settings-discovery-heading">{t("发现与显示")}</h3>
        <div className="check-grid">
          <label>
            <input
              type="checkbox"
              checked={settings.scanStylesheets}
              onChange={(e) => setSettings({ ...settings, scanStylesheets: e.target.checked })}
            />
            {t("扫描可访问样式表")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.scanImages}
              onChange={(e) => setSettings({ ...settings, scanImages: e.target.checked })}
            />
            {t("扫描图片资源")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.showLowConfidence}
              onChange={(e) => setSettings({ ...settings, showLowConfidence: e.target.checked })}
            />
            {t("显示低置信度资源")}
          </label>
        </div>
        <div className="form-grid">
          <label>
            {t("实时监听秒数")}
            <input
              type="number"
              min="10"
              max="3600"
              value={settings.monitorDurationSeconds}
              onChange={(e) =>
                setSettings({ ...settings, monitorDurationSeconds: Number(e.target.value) })
              }
            />
          </label>
          <label>
            {t("历史保留天数")}
            <input
              type="number"
              min="1"
              max="3650"
              value={settings.retentionDays}
              onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          {t("自定义扩展名（扩展名:分类）")}
          <textarea
            rows={3}
            value={customExtensions}
            onChange={(e) => setCustomExtensions(e.target.value)}
            placeholder="psd:image, blend:model"
          />
        </label>
        <label>
          {t("自定义 MIME（MIME:分类）")}
          <textarea
            rows={3}
            value={customMimes}
            onChange={(e) => setCustomMimes(e.target.value)}
            placeholder="application/x-demo:unknown"
          />
        </label>
      </fieldset>
      <fieldset
        className="settings-group"
        disabled={working}
        aria-labelledby="settings-download-heading"
      >
        <h3 id="settings-download-heading">{t("下载")}</h3>
        <div className="form-grid">
          <label>
            {t("下载并发")}
            <input
              type="number"
              min="1"
              max="6"
              value={settings.downloadConcurrency}
              onChange={(e) =>
                setSettings({ ...settings, downloadConcurrency: Number(e.target.value) })
              }
            />
          </label>
          <label>
            {t("大小上限（MB）")}
            <input
              type="number"
              min="1"
              value={Math.round(settings.maxDownloadBytes / 1024 ** 2)}
              onChange={(e) =>
                setSettings({ ...settings, maxDownloadBytes: Number(e.target.value) * 1024 ** 2 })
              }
            />
          </label>
          <label>
            {t("默认导出")}
            <select
              value={settings.exportFormat}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  exportFormat: e.target.value as AppSettings["exportFormat"]
                })
              }
            >
              <option value="txt">TXT</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
        </div>
        <div className="check-grid">
          <label>
            <input
              type="checkbox"
              checked={settings.askWhereToSave}
              onChange={(e) => setSettings({ ...settings, askWhereToSave: e.target.checked })}
            />
            {t("每次询问保存位置")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.groupByDomain}
              onChange={(e) => setSettings({ ...settings, groupByDomain: e.target.checked })}
            />
            {t("按域名分类")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.groupByCategory}
              onChange={(e) => setSettings({ ...settings, groupByCategory: e.target.checked })}
            />
            {t("按类型分类")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.confirmBeforeDownload}
              onChange={(e) =>
                setSettings({ ...settings, confirmBeforeDownload: e.target.checked })
              }
            />
            {t("下载前确认（单项与批量）")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.skipUnknownDownloads}
              onChange={(e) => setSettings({ ...settings, skipUnknownDownloads: e.target.checked })}
            />
            {t("跳过未知类型")}
          </label>
        </div>
      </fieldset>
      <div className="settings-group">
        <h3>{t("资源访问权限")}</h3>
        <p>{t("权限只用于你主动启动的任务。完整嗅探仍只处理指定标签页，不读取浏览历史。")}</p>
        <div className="permission-editor">
          <label className="permission-switch">
            <input
              type="checkbox"
              checked={useCurrentSite}
              disabled={working}
              onChange={(event) => setUseCurrentSite(event.target.checked)}
            />
            {t("自动识别当前网站")}
          </label>
          {useCurrentSite ? (
            <p className="current-url" title={currentSite?.origin}>
              {currentSite?.origin ?? t("当前标签页不是可授权的 HTTP(S) 网站。")}
            </p>
          ) : (
            <label className="permission-url-field">
              {t("网站 URL")}
              <input
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect="off"
                spellCheck={false}
                value={customSite}
                disabled={working}
                placeholder={t("google.com 或 https://google.com")}
                onChange={(event) => setCustomSite(event.target.value)}
              />
            </label>
          )}
          <button
            className="primary"
            type="button"
            disabled={working || (useCurrentSite ? !currentSite : customSite.trim().length === 0)}
            onClick={() => void authorizeSite()}
          >
            {t("授权网站")}
          </button>
        </div>
        {broadOrigins.length ? (
          <div className={`permission-scope ${fullAccess ? "enabled" : "partial"}`}>
            <div>
              <strong>{fullAccess ? t("完整跨域嗅探已启用") : t("完整跨域嗅探权限不完整")}</strong>
              <small>
                {fullAccess
                  ? t("覆盖 HTTP/HTTPS 第三方 CDN、媒体与接口响应")
                  : t("当前权限不足以完整观察跨域资源，建议撤销后重新启用")}
              </small>
            </div>
            <button type="button" disabled={working} onClick={() => void revokeAllSites()}>
              {t("撤销完整权限")}
            </button>
          </div>
        ) : (
          <p>{t("完整跨域嗅探未启用，首次启动完整嗅探时会请求确认。")}</p>
        )}
        <h3 className="permission-subheading">{t("已授权网站")}</h3>
        <div className="permission-list">
          {siteOrigins.map((origin) => (
            <div key={origin}>
              <code>{origin}</code>
              <button type="button" disabled={working} onClick={() => void revoke(origin)}>
                {t("撤销")}
              </button>
            </div>
          ))}
          {!siteOrigins.length ? <p>{t("暂无单独网站权限。")}</p> : null}
        </div>
      </div>
      <div className="settings-group danger-zone">
        <h3>{t("本地数据")}</h3>
        <p>{t("扩展不会上传扫描历史、URL、文件名或网页内容。")}</p>
        <button className="danger" type="button" disabled={working} onClick={() => void clear()}>
          {t("清除全部本地数据")}
        </button>
      </div>
    </section>
  );
}
