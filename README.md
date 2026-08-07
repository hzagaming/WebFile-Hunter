# WebFile Hunter（网页文件猎手）

WebFile Hunter 是一个面向 Microsoft Edge 的 Manifest V3 扩展。它只在用户主动操作后，从当前网页、当前标签页后续产生的网络请求，以及用户明确授权的同源公开页面中发现文件资源。扫描、历史、设置和下载任务记录全部保存在本地浏览器。

本项目不是目录爆破、登录绕过、付费墙破解、DRM 解密或隐蔽数据收集工具。

## 功能

- 当前页面扫描：DOM 属性、`download`、`srcset`、Open Graph、JSON-LD、itemprop、enclosure、object param、template、开放 Shadow DOM、内联/可访问样式表、Performance Resource Timing、可注入 iframe 与同源继承 Frame。
- 网页文字提取：独立侧栏按当前页、权限允许的 frame 与递归页面保存公开可见正文，支持搜索、复制和 TXT 导出；排除隐藏内容与用户输入。
- 完整实时嗅探：用户明确授权后，仅观察当前标签页的同站与第三方 CDN、媒体、接口及 frame 请求，合并 `requestId` 对应的请求与响应头，并在同源导航后按剩余时长继续监听。
- 同源递归扫描：直接 GET 静态 HTML，结合页面链接、HTTP Link/Refresh、可选 Sitemap/Sitemap Index（含 raw gzip）和当前 SPA 已渲染 DOM 做 BFS；提供深度、页面、同路径查询变体、并发、速率、超时和重定向硬限制，以及暂停、恢复和取消。
- 文件识别：扩展名、MIME、Content-Disposition、标签上下文、查询参数、请求类型和响应大小综合评分；严格区分源码、字体、字幕、数据、文档、电子书、分段媒体等分类。
- 元数据探测：仅资源头信息优先 HEAD，服务器不支持 HEAD 时使用 `Range: bytes=0-0`，不完整下载大文件；HTML 页面抓取不依赖 HEAD，并按响应头、BOM 或 meta 声明解码字符集。
- 结果管理：图片缩略图、音频手动试听、资源详情、独立打开/下载/复制操作，以及分类、扩展名、MIME、大小、来源、置信度、内外部、关键字和正则筛选；虚拟列表支持大量结果。
- 本地导出：TXT、CSV（可带 UTF-8 BOM）、JSON。
- 下载队列：用户手动开始、并发限制、取消、重试、打开文件、在文件夹中显示。
- 本地历史与恢复：支持打开、单次导出、删除和清空扫描历史；清空时保留设置与下载记录。IndexedDB 检查点可供递归任务手动恢复。
- 分级权限：当前页和递归扫描按站点授权；完整嗅探单独请求 HTTP/HTTPS 全站可选权限，设置页可一键撤销。

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
├── database/     IndexedDB v2 数据库与本地设置
├── messaging/    可判别消息联合、Zod 验证、消息客户端
├── export/       TXT、CSV、JSON 导出
├── sidepanel/    主界面、虚拟结果列表、扫描/结果/文本/下载/历史/设置页
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

`npm run test:e2e` 会使用一次性浏览器配置启动本机 Microsoft Edge，加载临时扩展副本和本地演示站。临时副本预授予测试所需权限，用于验证当前页、srcdoc Frame、JSON-LD/显式 MIME/object param、源码/字体分类、跨域资源嗅探、HTTP Link/Refresh、Sitemap Index/raw gzip/SPA 递归、网页文字隐私过滤、媒体预览、文件详情、设置、导出和下载链路；生产 `dist/manifest.json` 仍只声明可选主机权限。测试结束后删除临时浏览器配置。

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

侧栏通过 `tabs` 识别所在窗口的当前网页，但这不会授予页面内容访问。用户点击后，扩展按当前站点请求可撤销的主机权限，再通过 `chrome.scripting` 扫描页面及浏览器允许访问的 frame；同源继承来源的 srcdoc/about:blank Frame 会使用独立文本地址，不会覆盖父页。扩展不会自动进入链接或下载文件。

### 完整实时嗅探

用户点击后请求 HTTP 与 HTTPS 全站可选权限，以满足 MV3 对请求发起页和第三方目标 URL 的双重 Host 权限要求。扩展仍只记录用户启动任务的当前 tab，不观察其他标签页。响应头用于识别 `Content-Type`、`Content-Length`、`Content-Disposition`、`Accept-Ranges`、ETag、Last-Modified 和重定向地址；停止后立即移除内容观察器，浏览器重启后不恢复。

### 同源递归扫描

先显示配置，再请求当前站点权限。后台使用 GET 读取静态 HTML，并从页面链接、HTTP Link/Refresh、可选 Sitemap/Sitemap Index（支持 raw gzip）和启动时当前标签页已渲染的 SPA DOM 补充队列；同一路径的查询参数变体受到独立上限约束。资源元数据探测才会使用 HEAD。爬虫只访问完全相同的 origin，子域名视为外域；外域文件链接可以记录，但不会继续扩散，只有用户授予完整嗅探权限时才可探测其元数据。启用 robots 时，robots.txt 的 401/403 或重试后仍失败会安全停止任务。

## 权限说明

| 权限         | 用途                                               |
| ------------ | -------------------------------------------------- |
| `activeTab`  | 仅在用户操作后读取当前网页上下文                   |
| `tabs`       | 识别每个侧栏所在窗口的当前标签页 URL               |
| `scripting`  | 注入本地打包的页面扫描脚本                         |
| `storage`    | 保存设置、小型运行状态和界面偏好                   |
| `downloads`  | 执行用户明确选择并手动开始的下载任务               |
| `webRequest` | 观察当前标签页资源请求，不阻断或修改请求           |
| `sidePanel`  | 显示主界面                                         |
| `alarms`     | 自动结束监听并辅助后台生命周期                     |
| 可选主机权限 | 按站点扫描；完整嗅探时显式请求 HTTP/HTTPS 全站范围 |

扩展不申请 cookies、history、debugger、proxy、nativeMessaging、webRequestBlocking 或 declarativeNetRequest。

## 数据与安全

- 扫描数据不上传，不包含遥测、广告 SDK 或账户系统。
- 网页文字只提取公开可见正文，不读取显式隐藏元素、输入框、密码、文本框、下拉选项或可编辑草稿；不执行 OCR。
- URL 在后台重新解析与验证；递归请求必须属于任务授权 origin。
- 默认阻止本机、私网、链路本地、URL 凭据、危险端口和登出/删除/支付类路径。
- 所有跨上下文消息由 Zod 严格验证；网页不能发送任意 URL 触发后台 fetch。
- 不读取密码字段、表单内容、Cookie、Authorization 或 Token。
- 后台递归抓取不执行远端网页 JavaScript；只读取当前标签页已经渲染的 DOM，不点击按钮、不提交表单、不伪造 Referer。
- m3u8、DASH、分片和 blob 只标记，不合并、不解密、不伪装成普通音频。

更多信息见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 演示站

`tests/fixtures/site/` 包含 TXT、MP3 响应头、PDF、ZIP、字体、srcdoc Frame、object param、无后缀下载接口、HTTP Link/Refresh、CSS `@import`/`image-set`/构造样式表、重定向、慢响应、429、403、robots.txt、Sitemap Index/raw gzip/根路径回退和 SPA 动态路由。文件均为极小占位内容，不包含版权媒体。

## 发布打包

先构建，再打包：

```bash
npm run build
npm run package
```

输出：

```text
release/webfile-hunter-v1.7.0.zip
```

ZIP 根目录直接包含 `manifest.json`，可用于 Edge Add-ons 提交准备。

## 已知限制

- 可从 Sitemap、HTTP Link/Refresh 和当前已渲染 DOM 补充页面，但无法发现这些公开入口及网络请求都未引用的隐藏文件；不执行目录爆破、文件名枚举或外域无限扩散。
- JSON-LD 只读取明确的资源字段，不分析任意 JavaScript 字符串或把普通页面 URL 当作下载地址。
- 不破解登录、付费内容、验证码、防盗链、许可证或 DRM。
- `blob:` URL 通常不是永久下载地址；m3u8 和 DASH 不是普通 MP3 直链。
- HTML 页面直接使用 GET；资源元数据 HEAD 被明确标记为不支持时才尝试受限 Range GET，不绕过服务器限制。
- 完整嗅探未授权时无法观察第三方目标响应头或跨域 iframe 内容；浏览器保护页始终无法扫描。
- 签名 URL 会保留必要查询参数，但过期后仍可能失效。
- Service Worker 被终止时，递归任务依赖最近检查点；实时监听不会跨浏览器重启恢复。
- 当前版本不合并流媒体分片，也不在完整下载后计算 SHA-256。

## 故障排除

- “仅支持 HTTP 或 HTTPS”：`edge://`、本地文件、扩展页和其他内部页面不能扫描。
- “当前网站权限尚未授予”：回到扫描页重新点击对应扫描模式并确认该站点权限。
- “完整嗅探需要全站权限”：重新点击“开始完整嗅探”并确认权限，或使用当前页/同域扫描；权限可在设置中一键撤销。
- “资源元数据探测失败”：页面递归仍可继续；可复制链接或打开来源页，扩展不会伪造凭据绕过限制。
- 侧边栏没有刷新：点击页面右上角“刷新”，或重新打开侧边栏；结果仍保存在 IndexedDB。
- 扩展更新后异常：在 `edge://extensions` 点击“重新加载”，再检查 Service Worker 控制台。

## 许可证

MIT，见 [LICENSE](LICENSE)。
