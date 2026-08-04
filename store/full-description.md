# WebFile Hunter（网页文件猎手）

WebFile Hunter 帮助用户在主动操作后发现网页中公开引用的 TXT、MP3、PDF、EPUB、ZIP、图片、视频、字幕和数据文件。

主要功能：

- 侧栏独立打开时也能识别任意普通 HTTP/HTTPS 活动网页；
- 按站点授权后扫描当前页面的 DOM、样式和已加载资源；
- 显式授权后完整嗅探当前标签页的同站及第三方 CDN、媒体、接口和 frame 请求；
- 在明确授权后通过静态 HTML、robots.txt Sitemap/Sitemap Index（含 raw gzip）和当前 SPA 已渲染 DOM 做同源限速递归；
- 识别 Open Graph、Twitter Card、itemprop 与动态媒体属性，并按页面声明解码常见字符集；
- 在独立文本栏提取公开可见正文，按页面搜索、复制或导出 TXT，并排除显式隐藏内容和用户输入；
- 通过扩展名、MIME 和 Content-Disposition 识别无后缀文件；
- 分类、正则筛选、批量选择、复制、TXT/CSV/JSON 导出；
- 用户选择后加入下载队列并手动开始；
- 本地历史、暂停、恢复、权限撤销和安全的数据清理确认。

界面支持窄侧栏、键盘操作和 reduced-motion。作为专注型工具，扩展不会默认播放音效或背景音乐。

扩展完全本地运行，不上传扫描数据，不使用广告或分析服务，不读取 Cookie 或密码。它不会执行目录爆破、登录绕过、付费墙破解或 DRM 解密。
