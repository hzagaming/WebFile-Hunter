# WebFile Hunter（网页文件猎手）

WebFile Hunter 是一个面向 Microsoft Edge 的 Manifest V3 扩展。它只在用户主动操作后，从当前网页、当前标签页后续产生的网络请求，以及用户明确授权的同源公开页面中发现文件资源。扫描、历史、设置和下载任务记录全部保存在本地浏览器。

本项目不是目录爆破、登录绕过、付费墙破解、DRM 解密或隐蔽数据收集工具。

## 功能

- 当前页面扫描：DOM 属性、`download`、`srcset`、内联/可访问样式表、Performance Resource Timing、可注入 iframe。
- 实时资源监听：仅观察当前标签页，合并 `requestId` 对应的请求与响应头，识别无后缀下载接口，并在同源导航后按剩余时长继续监听。
- 同源递归扫描：BFS、robots.txt、深度/页面/并发/速率硬限制、超时、重试、暂停、恢复和取消。
- 文件识别：扩展名、MIME、Content-Disposition、标签上下文、查询参数、请求类型和响应大小综合评分。
- 元数据探测：优先 HEAD，失败时使用 `Range: bytes=0-0`，不完整下载大文件。
- 结果管理：分类、扩展名、MIME、大小、来源、置信度、内外部、关键字和正则筛选；虚拟列表支持大量结果。
- 本地导出：TXT、CSV（可带 UTF-8 BOM）、JSON。
- 下载队列：用户手动开始、并发限制、取消、重试、打开文件、在文件夹中显示。
- 本地历史与恢复：支持打开、单次导出、删除和清空扫描历史；清空时保留设置与下载记录。IndexedDB 检查点可供递归任务手动恢复。
- 最小权限：主机权限按站点请求，设置页可逐项撤销。

## 技术栈

- Microsoft Edge / Chromium Extension APIs
- Manifest V3 + Extension Service Worker
- React 19 + TypeScript strict mode
- Vite 8 多入口构建
- parse5（后台 HTML 解析，不依赖 DOM）
- idb / IndexedDB
- Zod 跨上下文消息校验
- Vitest + Testing Library + Playwright

## 架构

```text
src/
├── background/   Service Worker、消息路由、监听、爬虫、权限、下载、检查点
├── content/      当前页面 DOM/CSS/Performance 扫描与动态资源观察
├── core/         URL、安全、分类、去重、HTML 提取、文件名处理
├── database/     IndexedDB v1 数据库与本地设置
├── messaging/    可判别消息联合、Zod 验证、消息客户端
├── export/       TXT、CSV、JSON 导出
├── sidepanel/    主界面、虚拟结果列表、扫描/下载/历史/设置页
├── popup/        快速扫描、监听与打开侧边栏
└── options/      独立设置页
```

后台监听器在 Service Worker 顶层同步注册。持久状态写入 IndexedDB；实时监听映射只写入 `chrome.storage.session`，浏览器重启后不会自动恢复。递归队列每 10 页、每 5 秒或暂停时保存检查点，恢复前重新检查站点权限。

## 安装依赖

要求 Node.js 22.13 或更高版本。

```bash
npm install
```

## 开发与验证

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
npm run package
```

`npm run test:e2e` 会使用一次性浏览器配置启动本机 Microsoft Edge，加载临时扩展副本和本地演示站。临时副本预授予本地测试站权限，生产 `dist/manifest.json` 仍使用可选主机权限。测试结束后删除临时浏览器配置。

脚本会自动探测 macOS、Windows 和 Linux 的常见 Edge 安装路径；非标准安装可设置 `EDGE_PATH`。

## 构建

```bash
npm run build
```

构建脚本生成四种本地图标、分别构建 UI/Service Worker 与 IIFE Content Script，复制 manifest，并检查：

- manifest 版本与文件引用；
- 禁止权限；
- 远程脚本；
- `eval` / `new Function`；
- source map、测试文件和 `.env` 泄漏；
- TODO/FIXME、私钥和常见访问密钥残留。

输出目录：`dist/`。

## 在 Edge 中加载

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本项目的 `dist` 目录。
5. 将 WebFile Hunter 固定到工具栏。
6. 打开一个 HTTP 或 HTTPS 测试网页。
7. 点击扩展并打开侧边栏。

## 三种扫描模式

### 扫描当前页面

不申请永久主机权限。用户点击后，扩展通过 `activeTab` 和 `chrome.scripting` 扫描当前页面及浏览器允许访问的 frame，不会自动进入链接或下载文件。

### 实时资源监听

先请求当前站点权限，只记录当前 tab 的后续请求。响应头用于识别 `Content-Type`、`Content-Length`、`Content-Disposition`、`Accept-Ranges`、ETag、Last-Modified 和重定向地址。停止后立即移除内容观察器；浏览器重启后不恢复。

### 同源递归扫描

先显示配置，再请求当前站点权限。爬虫只使用 GET/HEAD，只访问完全相同的 origin，子域名视为外域。外域文件链接可以记录，但不会被探测或继续访问。robots.txt 的 401/403 或超时会安全停止任务。

## 权限说明

| 权限         | 用途                                     |
| ------------ | ---------------------------------------- |
| `activeTab`  | 仅在用户操作后读取当前网页上下文         |
| `scripting`  | 注入本地打包的页面扫描脚本               |
| `storage`    | 保存设置、小型运行状态和界面偏好         |
| `downloads`  | 执行用户明确选择并手动开始的下载任务     |
| `webRequest` | 观察当前标签页资源请求，不阻断或修改请求 |
| `sidePanel`  | 显示主界面                               |
| `alarms`     | 自动结束监听并辅助后台生命周期           |
| 可选主机权限 | 仅在用户启动监听或递归扫描时访问指定站点 |

扩展不申请 cookies、history、debugger、proxy、nativeMessaging、webRequestBlocking 或 declarativeNetRequest。

## 数据与安全

- 扫描数据不上传，不包含遥测、广告 SDK 或账户系统。
- URL 在后台重新解析与验证；递归请求必须属于任务授权 origin。
- 默认阻止本机、私网、链路本地、URL 凭据、危险端口和登出/删除/支付类路径。
- 所有跨上下文消息由 Zod 严格验证；网页不能发送任意 URL 触发后台 fetch。
- 不读取密码字段、表单内容、Cookie、Authorization 或 Token。
- 不执行网页 JavaScript，不点击按钮，不提交表单，不伪造 Referer。
- m3u8、DASH、分片和 blob 只标记，不合并、不解密、不伪装成普通音频。

更多信息见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 演示站

`tests/fixtures/site/` 包含 TXT、MP3 响应头、PDF、ZIP、无后缀下载接口、重定向、慢响应、429、403 和 robots.txt。文件均为极小占位内容，不包含版权媒体。

## 发布打包

先构建，再打包：

```bash
npm run build
npm run package
```

输出：

```text
release/webfile-hunter-v0.2.0.zip
```

ZIP 根目录直接包含 `manifest.json`，可用于 Edge Add-ons 提交准备。

## 已知限制

- 无法发现页面、HTML 或网络请求完全没有引用的隐藏文件，不执行目录爆破或文件名枚举。
- 不破解登录、付费内容、验证码、防盗链、许可证或 DRM。
- `blob:` URL 通常不是永久下载地址；m3u8 和 DASH 不是普通 MP3 直链。
- 某些网站拒绝 HEAD，扩展只会尝试受限 Range GET，不绕过服务器限制。
- 跨域 iframe 未授权时无法扫描；浏览器策略可能隐藏部分响应头。
- 签名 URL 会保留必要查询参数，但过期后仍可能失效。
- Service Worker 被终止时，递归任务依赖最近检查点；实时监听不会跨浏览器重启恢复。
- 当前版本不合并流媒体分片，也不在完整下载后计算 SHA-256。

## 故障排除

- “仅支持 HTTP 或 HTTPS”：`edge://`、本地文件、扩展页和其他内部页面不能扫描。
- “当前网站权限尚未授予”：回到扫描页重新点击监听/递归并确认该站点权限。
- “网站拒绝 HEAD”：仍可复制链接或打开来源页；扩展不会伪造凭据绕过限制。
- 侧边栏没有刷新：点击页面右上角“刷新”，或重新打开侧边栏；结果仍保存在 IndexedDB。
- 扩展更新后异常：在 `edge://extensions` 点击“重新加载”，再检查 Service Worker 控制台。

## 许可证

MIT，见 [LICENSE](LICENSE)。
