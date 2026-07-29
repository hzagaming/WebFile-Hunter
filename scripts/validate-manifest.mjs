import { access, readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
const manifestPath = resolve(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) throw new Error("manifest_version 必须为 3。\n");
const forbidden = [
  "cookies",
  "debugger",
  "webRequestBlocking",
  "history",
  "proxy",
  "nativeMessaging"
];
for (const permission of forbidden) {
  if ((manifest.permissions ?? []).includes(permission))
    throw new Error(`禁止使用权限：${permission}`);
}

const references = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.options_page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {})
].filter(Boolean);
if (manifest.action?.default_popup) references.push(manifest.action.default_popup);
for (const reference of new Set(references)) await access(resolve(root, reference));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]
    )
  );
  return nested.flat();
}

for (const file of await files(root)) {
  const path = relative(root, file).replaceAll("\\", "/");
  const name = basename(file);
  if (
    /\.map$/i.test(name) ||
    /(?:^|\.)env(?:\.|$)/i.test(name) ||
    /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/i.test(path) ||
    /\.(?:test|spec)\.[^.]+$/i.test(name)
  ) {
    throw new Error(`发布包包含禁止文件：${file}`);
  }
  if (/\.(?:js|mjs|html|css|json|txt|md|xml|svg)$/i.test(file)) {
    const content = await readFile(file, "utf8");
    if (/\b(?:TODO|FIXME)\b/.test(content)) throw new Error(`发现 TODO/FIXME 标记：${file}`);
    const secretPatterns = [
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
      /\bAIza[0-9A-Za-z_-]{35}\b/,
      /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/
    ];
    if (secretPatterns.some((pattern) => pattern.test(content))) {
      throw new Error(`发现疑似密钥或私钥：${file}`);
    }
    if (/https?:\/\/[^\s"']+\.js(?:[?"']|$)/i.test(content))
      throw new Error(`发现远程脚本：${file}`);
    if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(content))
      throw new Error(`发现动态代码执行：${file}`);
  }
}

console.log(`manifest 校验通过：${manifest.name} ${manifest.version}`);
