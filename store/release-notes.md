# 1.1.0

WebFile Hunter 1.1.0 进一步补齐了公开网页资源发现链路。递归扫描现在直接 GET HTML，并能从 robots.txt 声明的 Sitemap/Sitemap Index、raw gzip Sitemap 与当前 SPA 已渲染 DOM 补充同源公开页面；robots.txt 和 Sitemap 请求也统一遵守重试、退避、速率与取消配置。

页面发现新增 Open Graph、Twitter Card、itemprop、video poster、SVG image 和动态 `data-poster` 等资源，过滤 canonical、preconnect 等非资源 link 噪声。HTML 会按响应头、BOM 或 meta 声明解码 GBK 等常见字符集，减少非 UTF-8 站点漏抓。

本版同时修复网络资源来源页路径丢失、已有完整权限时外域元数据按钮仍禁用、Popup 打开侧栏打断权限手势、全失败任务假完成和恢复计数丢失等问题。扫描入口现在明确说明 Sitemap 与 SPA DOM 能力；废弃的无效配置已移除，运行时设置会严格归一化。

真实 Microsoft Edge E2E 已验证 Sitemap Index/raw gzip 隐藏页、拒绝 HEAD 但允许 GET 页面、SPA 动态路由、第三方 CDN/frame、导出下载和 280/320/380px 五页侧栏。扩展仍完全本地运行，不上传扫描数据，默认静音，不播放音效或背景音乐。
