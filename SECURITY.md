# 安全政策

## 支持范围

当前稳定版本为 `1.0.x`。安全修复优先落到主开发分支。

## 报告漏洞

请使用 GitHub 私密安全报告功能。报告应包含最小复现步骤、受影响版本和风险说明。请勿附带真实 Cookie、Authorization、密码、Token、签名下载链接或私人网页内容。

## 安全边界

- 仅处理 HTTP/HTTPS。
- 递归 fetch 必须绑定有效 session、授权 origin、未取消状态和硬限制。
- 默认阻止本机、私网、链路本地、危险端口、URL 凭据和高风险操作路径。
- 只使用 GET/HEAD，不执行网页脚本、不提交表单、不点击页面业务按钮。
- 不申请 cookies、debugger、webRequestBlocking、proxy 或 nativeMessaging。
- 不使用远程脚本、`eval`、`new Function` 或动态远程 import。
- Zod 验证全部扩展消息；未知类型和多余字段会被拒绝或清理。
- 错误日志不得记录密码、Cookie、Authorization、Token 或完整敏感响应头。

## 明确不支持

目录爆破、内网扫描、登录绕过、付费墙破解、验证码规避、DRM 解密、分片合并、许可证绕过和凭据收集不属于本项目范围。
