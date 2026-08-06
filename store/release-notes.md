# 1.5.0

WebFile Hunter 1.5.0 继续扩大公开网页发现范围。当前页与完整嗅探现在可安全接收同源继承来源的 `about:srcdoc` / `about:blank` Frame，将其中明确引用的资源和公开可见正文分别入库；Frame 正文使用独立地址，不再与父页互相覆盖。DOM 与递归 HTML 同时新增 `<object>` 内 `movie`、`src`、`url`、`file`、`filename` 等明确 param 资源，通用或游离 param 不会进入结果。

同源递归新增 HTTP `Refresh` 响应头页面入口；robots.txt 未声明 Sitemap 时，标准同源根入口新增 `/sitemap.xml.gz`。所有入口仍严格经过同源、robots、危险操作 URL、深度、页面、并发、速率、体积和取消限制，不执行目录爆破、任意脚本字符串扫描或权限绕过。

六栏导航新增结果、文字与下载实时计数；结果刷新、文字、下载、历史、设置和递归配置统一公开忙碌状态，避免重复操作。授权状态获得更清晰的视觉区分，递归配置补齐展开关系、禁用态与键盘语义。产品继续默认静音，不播放 SFX 或 BGM，以视觉和屏幕阅读器反馈代替干扰性声音。

真实 Microsoft Edge E2E 已验证 28 个当前页候选、同源 srcdoc Frame 资源与独立正文、object param、HTTP Refresh、压缩 Sitemap 回退、9 页/36 个递归候选，以及 280/320/380px 六页界面、导出和真实下载。扩展仍完全本地运行，不上传扫描数据。
