import { useEffect, useState } from "react";
import { sendMessage } from "@/messaging/message-client";
import type { ScanSession } from "@/types/models";

export function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => setTab(tabs[0]))
      .catch((value: unknown) =>
        setError(value instanceof Error ? value.message : "无法读取当前标签页。")
      )
      .finally(() => setLoaded(true));
  }, []);
  const page = (() => {
    try {
      if (!tab?.url) return undefined;
      const parsed = new URL(tab.url);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed : undefined;
    } catch {
      return undefined;
    }
  })();
  const host = page?.host ?? "不可用";

  const openPanel = (): void => {
    if (tab?.id === undefined) return;
    void chrome.sidePanel
      .open({ tabId: tab.id })
      .catch((value: unknown) =>
        setError(value instanceof Error ? value.message : "无法打开侧边栏。")
      );
  };

  const run = async (mode: "scan" | "monitor"): Promise<void> => {
    if (tab?.id === undefined || !page) return;
    setWorking(true);
    setError(undefined);
    openPanel();
    try {
      if (
        !(await chrome.permissions.request({
          origins: [`${page.protocol}//${page.hostname}/*`]
        }))
      ) {
        throw new Error("未授予当前网站权限。");
      }
      if (mode === "monitor") {
        const parsed = page;
        const origin = parsed.origin;
        await sendMessage<ScanSession>({
          type: "START_LIVE_MONITOR",
          payload: { tabId: tab.id, origin }
        });
      } else {
        await sendMessage<ScanSession>({ type: "SCAN_CURRENT_PAGE", payload: { tabId: tab.id } });
      }
      window.close();
    } catch (value) {
      setError(value instanceof Error ? value.message : "操作失败。");
      setWorking(false);
    }
  };

  return (
    <main className="popup-shell">
      <header>
        <div className="brand-mark" aria-hidden="true">
          ⌕
        </div>
        <div>
          <h1>WebFile Hunter</h1>
          <p>当前网页：{host}</p>
        </div>
      </header>
      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}
      {loaded && tab && !page ? (
        <div className="notice notice-info" role="status">
          当前页面不支持扫描，仅支持 HTTP 或 HTTPS 网页。
        </div>
      ) : null}
      <button
        className="primary full"
        type="button"
        disabled={working || !page}
        onClick={() => void run("scan")}
      >
        扫描当前页面
      </button>
      <button
        className="full"
        type="button"
        disabled={working || !page}
        onClick={() => void run("monitor")}
      >
        开始监听
      </button>
      <button
        className="full ghost"
        type="button"
        disabled={tab?.id === undefined}
        onClick={openPanel}
      >
        打开侧边栏
      </button>
      <p className="privacy-note">完全本地运行 · 不读取 Cookie 或密码</p>
    </main>
  );
}
