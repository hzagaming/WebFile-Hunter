# 1.8.0

WebFile Hunter 1.8.0 深化同源公开资源发现。递归扫描现在会读取静态 HTML 明确引用的同源样式表，并继续解析其中的 `@import`，发现未出现在 HTML 中的图片、字体、源码和其他资源；即使 stylesheet URL 没有 `.css` 后缀也可识别。所有样式请求继续遵守同源、robots、安全 URL、限速、响应大小与可配置的样式表数量硬上限，外域样式只记录、不主动扩散。

文件分类新增“3D 模型”，覆盖 GLB、GLTF、OBJ、STL、FBX、USDZ 等常用格式与 `model/*` MIME，同时扩充现代图片、音视频、字体、字幕、归档和电子书后缀。`application/*+json` 与 `application/*+xml` 会归入结构化数据，精确 MIME 仍优先，避免破坏 DASH、SVG 等已有判断。云存储 Content-Disposition 查询参数、更多下载文件名键和非法百分号路径也能更准确恢复文件名。

当前 DOM、动态监听和递归 HTML 新增高清、Retina、回退、缩放、大图与原图懒加载属性。结果页所有分类现在都显示计数，并提供一键重置全部筛选和排序；文件详情新增原始、规范与最终 URL、Content-Disposition、ETag、Last-Modified、Accept-Ranges、元数据状态、发现时间，以及分别复制资源与来源页 URL 的操作。

真实 Microsoft Edge E2E 新增仅存在于递归页面样式表中的资源、3D 模型分类、分类计数、筛选重置和扩展详情验证，并继续覆盖网页文字隐私过滤、图片与音频实际加载、焦点闭环、新标签页、真实下载落盘及 280/320/380px 六页界面。扩展继续完全本地运行，默认静音，不播放 SFX 或 BGM；音频只响应用户点击。
