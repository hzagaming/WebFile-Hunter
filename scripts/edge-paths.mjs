import { access } from "node:fs/promises";
import { join } from "node:path";

export function edgeCandidates(platform = process.platform, env = process.env) {
  if (platform === "darwin") {
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta",
      "/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev"
    ];
  }
  if (platform === "win32") {
    return [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter(Boolean)
      .map((root) => join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
  }
  return [
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/microsoft-edge-beta",
    "/usr/bin/microsoft-edge-dev",
    "/opt/microsoft/msedge/msedge"
  ];
}

export async function findEdgeExecutable(options = {}) {
  const canAccess = options.canAccess ?? access;
  const configured = options.edgePath ?? process.env.EDGE_PATH;
  if (configured) {
    try {
      await canAccess(configured);
      return configured;
    } catch {
      throw new Error(`EDGE_PATH 指向的 Edge 不可访问：${configured}`);
    }
  }
  const candidates = edgeCandidates(options.platform, options.env);
  for (const candidate of candidates) {
    try {
      await canAccess(candidate);
      return candidate;
    } catch {
      // 继续探测下一个标准安装路径。
    }
  }
  throw new Error(`未找到 Microsoft Edge。请设置 EDGE_PATH。已检查：${candidates.join(", ")}`);
}
