import { useEffect, useState } from "react";
import { sendMessage } from "@/messaging/message-client";
import type { AppSnapshot } from "@/messaging/message-types";
import { ALL_SITES_ORIGINS, isAllSitesOrigin } from "@/core/host-permissions";
import { clampAppSettings, DEFAULT_SETTINGS } from "@/utils/defaults";
import type { AppSettings, FileCategory } from "@/types/models";
import { FeedbackNotice, type FeedbackKind } from "../components/FeedbackNotice";

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
  const [settingsDraft, setSettings] = useState<AppSettings>();
  const settings = settingsDraft ?? snapshot.settings;
  const [origins, setOrigins] = useState<string[]>([]);
  const broadOrigins = origins.filter(isAllSitesOrigin);
  const siteOrigins = origins.filter((origin) => !isAllSitesOrigin(origin));
  const fullAccess = ALL_SITES_ORIGINS.every((origin) => origins.includes(origin));
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string }>();
  const [working, setWorking] = useState(false);
  const [customExtensionsDraft, setCustomExtensions] = useState<string>();
  const customExtensions =
    customExtensionsDraft ?? formatCustomMap(snapshot.settings.customExtensions, ", ");
  const [customMimesDraft, setCustomMimes] = useState<string>();
  const customMimes = customMimesDraft ?? formatCustomMap(snapshot.settings.customMimeTypes, "\n");
  const fail = (error: unknown, fallback: string): void =>
    setFeedback({ kind: "error", text: error instanceof Error ? error.message : fallback });

  useEffect(() => {
    let active = true;
    void sendMessage<string[]>({ type: "GET_GRANTED_ORIGINS" })
      .then((value) => {
        if (active) setOrigins(value);
      })
      .catch((error: unknown) => {
        if (active) fail(error, "无法读取已授权网站。");
      });
    return () => {
      active = false;
    };
  }, []);

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
      setFeedback({ kind: "success", text: "设置已保存到本地浏览器。" });
      await refresh(snapshot.activeSession?.id);
    } catch (error) {
      fail(error, "无法保存设置。");
    } finally {
      setWorking(false);
    }
  };

  const revoke = async (originPattern: string): Promise<void> => {
    if (!confirm(`撤销 ${originPattern} 的权限？对应进行中任务会停止。`)) return;
    setWorking(true);
    setFeedback(undefined);
    try {
      await sendMessage({ type: "REVOKE_ORIGIN", payload: { originPattern } });
      setOrigins((current) => current.filter((origin) => origin !== originPattern));
      setFeedback({ kind: "success", text: "网站权限已撤销，对应进行中任务已安全停止。" });
    } catch (error) {
      fail(error, "无法撤销网站权限。");
    } finally {
      setWorking(false);
    }
  };

  const revokeAllSites = async (): Promise<void> => {
    if (!confirm("撤销完整跨域嗅探权限？进行中的实时嗅探会停止。")) return;
    setWorking(true);
    setFeedback(undefined);
    try {
      await sendMessage({ type: "REVOKE_ALL_SITES" });
      setOrigins((current) => current.filter((origin) => !isAllSitesOrigin(origin)));
      setFeedback({ kind: "success", text: "完整嗅探权限已撤销，实时嗅探已安全停止。" });
      await refresh(snapshot.activeSession?.id);
    } catch (error) {
      fail(error, "无法撤销完整嗅探权限。");
    } finally {
      setWorking(false);
    }
  };

  const clear = async (): Promise<void> => {
    if (!confirm("确定清除全部扫描结果、历史、设置和下载任务记录？此操作无法撤销。")) return;
    setWorking(true);
    setFeedback(undefined);
    try {
      await sendMessage({ type: "CLEAR_ALL_DATA" });
      const defaults = structuredClone(DEFAULT_SETTINGS);
      updateSettings?.(defaults);
      setSettings(updateSettings ? undefined : defaults);
      setCustomExtensions(updateSettings ? undefined : "");
      setCustomMimes(updateSettings ? undefined : "");
      setFeedback({ kind: "success", text: "全部本地数据已清除，设置已恢复默认值。" });
      await refresh();
    } catch (error) {
      fail(error, "无法清除本地数据。");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className={`page settings-page ${standalone ? "standalone" : ""}`} aria-busy={working}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">本地与最小权限</p>
          <h2>设置</h2>
        </div>
        <button className="primary" type="button" disabled={working} onClick={() => void save()}>
          保存
        </button>
      </div>
      {feedback ? <FeedbackNotice kind={feedback.kind}>{feedback.text}</FeedbackNotice> : null}
      <div className="settings-group">
        <h3>默认递归扫描</h3>
        <div className="form-grid">
          <label>
            最大深度
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
            最大页面数
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
            同路径查询变体上限
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
            样式表抓取上限
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
            并发数
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
            请求间隔（毫秒）
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
            HTML 上限（MB）
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
            请求超时（秒）
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
            最大重定向
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
            重试次数
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
            尊重 robots.txt
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
            发现 Sitemap
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
            提取网页文字
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
            跟随重定向
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
            自动探测元数据
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
            排除危险操作 URL
          </label>
        </div>
      </div>
      <div className="settings-group">
        <h3>发现与显示</h3>
        <div className="check-grid">
          <label>
            <input
              type="checkbox"
              checked={settings.scanStylesheets}
              onChange={(e) => setSettings({ ...settings, scanStylesheets: e.target.checked })}
            />
            扫描可访问样式表
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.scanImages}
              onChange={(e) => setSettings({ ...settings, scanImages: e.target.checked })}
            />
            扫描图片资源
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.showLowConfidence}
              onChange={(e) => setSettings({ ...settings, showLowConfidence: e.target.checked })}
            />
            显示低置信度资源
          </label>
        </div>
        <div className="form-grid">
          <label>
            实时监听秒数
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
            历史保留天数
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
          自定义扩展名（扩展名:分类）
          <textarea
            rows={3}
            value={customExtensions}
            onChange={(e) => setCustomExtensions(e.target.value)}
            placeholder="psd:image, blend:model"
          />
        </label>
        <label>
          自定义 MIME（MIME:分类）
          <textarea
            rows={3}
            value={customMimes}
            onChange={(e) => setCustomMimes(e.target.value)}
            placeholder="application/x-demo:unknown"
          />
        </label>
      </div>
      <div className="settings-group">
        <h3>下载</h3>
        <div className="form-grid">
          <label>
            下载并发
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
            大小上限（MB）
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
            默认导出
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
            每次询问保存位置
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.groupByDomain}
              onChange={(e) => setSettings({ ...settings, groupByDomain: e.target.checked })}
            />
            按域名分类
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.groupByCategory}
              onChange={(e) => setSettings({ ...settings, groupByCategory: e.target.checked })}
            />
            按类型分类
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.confirmBeforeDownload}
              onChange={(e) =>
                setSettings({ ...settings, confirmBeforeDownload: e.target.checked })
              }
            />
            批量下载前确认
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.skipUnknownDownloads}
              onChange={(e) => setSettings({ ...settings, skipUnknownDownloads: e.target.checked })}
            />
            跳过未知类型
          </label>
        </div>
      </div>
      <div className="settings-group">
        <h3>资源访问权限</h3>
        <p>权限只用于你主动启动的任务。完整嗅探仍只处理指定标签页，不读取浏览历史。</p>
        {broadOrigins.length ? (
          <div className={`permission-scope ${fullAccess ? "enabled" : "partial"}`}>
            <div>
              <strong>{fullAccess ? "完整跨域嗅探已启用" : "完整跨域嗅探权限不完整"}</strong>
              <small>
                {fullAccess
                  ? "覆盖 HTTP/HTTPS 第三方 CDN、媒体与接口响应"
                  : "当前权限不足以完整观察跨域资源，建议撤销后重新启用"}
              </small>
            </div>
            <button type="button" disabled={working} onClick={() => void revokeAllSites()}>
              撤销完整权限
            </button>
          </div>
        ) : (
          <p>完整跨域嗅探未启用，首次启动完整嗅探时会请求确认。</p>
        )}
        <h3 className="permission-subheading">已授权网站</h3>
        <div className="permission-list">
          {siteOrigins.map((origin) => (
            <div key={origin}>
              <code>{origin}</code>
              <button type="button" disabled={working} onClick={() => void revoke(origin)}>
                撤销
              </button>
            </div>
          ))}
          {!siteOrigins.length ? <p>暂无单独网站权限。</p> : null}
        </div>
      </div>
      <div className="settings-group danger-zone">
        <h3>本地数据</h3>
        <p>扩展不会上传扫描历史、URL、文件名或网页内容。</p>
        <button className="danger" type="button" disabled={working} onClick={() => void clear()}>
          清除全部本地数据
        </button>
      </div>
    </section>
  );
}
