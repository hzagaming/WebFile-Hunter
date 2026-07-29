import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Popup } from "./Popup";
import "@/sidepanel/styles/main.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到 Popup 挂载节点。");
createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
