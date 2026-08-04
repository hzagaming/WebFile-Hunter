import { useState } from "react";
import { useAppSnapshot } from "./hooks/useAppSnapshot";
import { ScannerPage } from "./pages/ScannerPage";
import { ResultsPage } from "./pages/ResultsPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TextPage } from "./pages/TextPage";

type Tab = "scan" | "results" | "text" | "downloads" | "history" | "settings";

const tabs: ReadonlyArray<{ id: Tab; label: string; icon: string }> = [
  { id: "scan", label: "扫描", icon: "⌁" },
  { id: "results", label: "结果", icon: "▤" },
  { id: "text", label: "文本", icon: "≡" },
  { id: "downloads", label: "下载", icon: "⇩" },
  { id: "history", label: "历史", icon: "◷" },
  { id: "settings", label: "设置", icon: "⚙" }
];

export function App() {
  const [tab, setTab] = useState<Tab>("scan");
  const state = useAppSnapshot();
  const host = displayHost(state.snapshot?.activeTab?.url);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          ⌕
        </div>
        <div>
          <h1>WebFile Hunter</h1>
          <p title={state.snapshot?.activeTab?.url}>当前网站：{host}</p>
        </div>
        <span className="permission-chip">
          {state.snapshot?.allSitesAccess ? "完整嗅探已授权" : "按站点授权"}
        </span>
      </header>

      {state.error ? (
        <div className="notice notice-error" role="alert">
          <span>{state.error}</span>
          <button type="button" aria-label="关闭错误" onClick={() => state.setError(undefined)}>
            ×
          </button>
        </div>
      ) : null}

      <nav className="tabs" aria-label="主导航">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? "active" : ""}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <main className="main-content" aria-busy={state.loading}>
        {!state.snapshot ? (
          <div className="empty-state" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            正在读取扩展状态…
          </div>
        ) : tab === "scan" ? (
          <ScannerPage
            snapshot={state.snapshot}
            refresh={state.refresh}
            openResults={() => setTab("results")}
          />
        ) : tab === "results" ? (
          <ResultsPage snapshot={state.snapshot} refresh={state.refresh} />
        ) : tab === "text" ? (
          <TextPage snapshot={state.snapshot} refresh={state.refresh} />
        ) : tab === "downloads" ? (
          <DownloadsPage
            snapshot={state.snapshot}
            refresh={state.refresh}
            updateDownloads={state.updateDownloads}
          />
        ) : tab === "history" ? (
          <HistoryPage
            snapshot={state.snapshot}
            refresh={state.refresh}
            openResults={() => setTab("results")}
            openText={() => setTab("text")}
          />
        ) : (
          <SettingsPage
            snapshot={state.snapshot}
            refresh={state.refresh}
            updateSettings={state.updateSettings}
          />
        )}
      </main>
    </div>
  );
}

function displayHost(url?: string): string {
  if (!url) return "未选择网页";
  try {
    return new URL(url).host;
  } catch {
    return "当前页面不可用";
  }
}
