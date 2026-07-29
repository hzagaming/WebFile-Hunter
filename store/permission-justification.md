# 权限用途

- `activeTab`：仅在用户操作后扫描当前页面。
- `scripting`：向当前页面及允许访问的 frame 注入本地打包扫描脚本。
- `storage`：保存设置、结果摘要、小型运行状态和扫描历史。
- `downloads`：执行用户明确选择、加入队列并手动开始的下载任务。
- `webRequest`：观察当前标签页的文件资源请求和响应头，不阻断、不修改请求。
- `sidePanel`：显示扫描、结果、下载、历史与设置主界面。
- `alarms`：按时停止实时监听并辅助后台任务生命周期。
- `optional host permissions`：仅在用户启动监听或递归扫描时访问当前指定网站，可随时撤销。

扩展不申请 cookies、history、debugger、proxy、management、nativeMessaging、browsingData、webRequestBlocking 或 declarativeNetRequest。
