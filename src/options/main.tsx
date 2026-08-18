import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options";
import { I18nProvider } from "@/i18n";
import "@/sidepanel/styles/main.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到设置页挂载节点。");
createRoot(root).render(
  <StrictMode>
    <I18nProvider title="WebFile Hunter 设置">
      <Options />
    </I18nProvider>
  </StrictMode>
);
