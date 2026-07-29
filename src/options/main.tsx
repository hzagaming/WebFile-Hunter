import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options";
import "@/sidepanel/styles/main.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到设置页挂载节点。");
createRoot(root).render(
  <StrictMode>
    <Options />
  </StrictMode>
);
