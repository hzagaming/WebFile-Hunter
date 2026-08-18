import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Popup } from "./Popup";
import { I18nProvider } from "@/i18n";
import "@/sidepanel/styles/main.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到 Popup 挂载节点。");
createRoot(root).render(
  <StrictMode>
    <I18nProvider title="WebFile Hunter">
      <Popup />
    </I18nProvider>
  </StrictMode>
);
