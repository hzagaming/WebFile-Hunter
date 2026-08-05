# 1.4.0

WebFile Hunter 1.4.0 扩展公开网页发现范围。CSS 扫描现在支持裸 `@import`、标准与前缀 `image-set`、递归导入样式表，以及 Document 和开放 Shadow Root 的构造样式表；相对地址会按各自样式表 URL 正确解析。HTML 同时新增 `area`、legacy `frame` 和 alternate 页面入口。

实时监听与同源递归现在会读取 HTTP `Link` 响应头，可发现 preload/enclosure 文件与 next/prev/canonical/alternate 页面。robots.txt 没有声明 Sitemap 时，会安全尝试同源根路径的 `sitemap.xml` 和 `sitemap_index.xml`。所有新入口仍经过同源、robots、危险 URL、深度、页面、并发和速率限制，并设置响应头与 CSS 规则数量硬上限。

扫描启动、暂停、继续和停止期间新增静音、可访问的实时文字反馈；280px 窄侧栏结果卡按钮目标与裁切问题同步修复。真实 Microsoft Edge E2E 已覆盖嵌套/构造 CSS、HTTP Link、默认 Sitemap 回退、正文、跨域 frame、导出下载及 280/320/380px 六页界面。

扩展仍完全本地运行，不上传扫描数据，不执行目录爆破、登录绕过或 DRM 规避，默认静音，不播放音效或背景音乐。
