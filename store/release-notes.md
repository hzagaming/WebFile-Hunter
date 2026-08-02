# 1.1.1

WebFile Hunter 1.1.1 集中加固动态网页发现一致性。实时监听现在能识别 SPA 对既有 Open Graph、Twitter Card 与 itemprop 元信息属性的更新；外域资源元数据探测会正确识别已授予的对应资源站点权限，禁用时也会明确说明需要的授权。

递归链路现在尊重 SPA 已渲染 DOM 中的页面级 robots `nofollow`/`none`，跳过明确使用 POST 或 dialog 的表单 action，并修复 robots.txt 在 `Crawl-delay` 后错误合并新 User-agent 分组的问题。空或无效表单 method 仍按浏览器规则作为 GET 处理。

安全与响应体验也同步增强：损坏的 `filename*` 会回退到合法 `filename`；URL 检查补充 CGNAT、文档、基准、组播与 IPv6 特殊地址；侧栏应用快照并行读取结果、设置、权限、下载和未完成任务，减少刷新等待。

真实 Microsoft Edge E2E 已验证既有 Open Graph 元信息动态更新、第三方 CDN 网络响应、跨域 frame、同源递归、导出下载和 280/320/380px 五页侧栏。扩展仍完全本地运行，不上传扫描数据，默认静音，不播放音效或背景音乐。
