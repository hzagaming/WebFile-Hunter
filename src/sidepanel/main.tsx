import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { I18nProvider } from "@/i18n";
import "./styles/main.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到侧边栏挂载节点。");
createRoot(root).render(
  <StrictMode>
    <I18nProvider title="WebFile Hunter">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>
);
