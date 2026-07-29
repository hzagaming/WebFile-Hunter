import { useAppSnapshot } from "@/sidepanel/hooks/useAppSnapshot";
import { SettingsPage } from "@/sidepanel/pages/SettingsPage";

export function Options() {
  const state = useAppSnapshot();
  return (
    <main className="options-shell">
      <header className="options-header">
        <div className="brand-mark" aria-hidden="true">
          ⌕
        </div>
        <div>
          <h1>WebFile Hunter 设置</h1>
          <p>扫描、下载、权限与本地数据</p>
        </div>
      </header>
      {state.error ? (
        <div className="notice notice-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.snapshot ? (
        <SettingsPage
          snapshot={state.snapshot}
          refresh={state.refresh}
          updateSettings={state.updateSettings}
          standalone
        />
      ) : (
        <div className="empty-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          正在加载设置…
        </div>
      )}
    </main>
  );
}
