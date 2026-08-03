# 1.2.0

WebFile Hunter 1.2.0 扩展公开网页资源发现能力。当前页与同源递归现在会读取 JSON-LD 中明确的资源字段，并识别显式 MIME、itemprop、`rel=enclosure`、`<template>` 与开放 Shadow DOM；普通结构化页面 URL 仍不会被误判为下载地址。

实时监听可以发现启动后才附加到既有宿主的开放 Shadow Root，也会读取 template 与开放 Shadow DOM 内可访问的样式资源。无扩展名的明确资源不再默认隐藏在低置信度结果中；关闭图片扫描时，延迟图片、poster、SVG image 与 JSON-LD 图片会在各发现链路一致过滤。

为控制复杂页面上的持续开销，Shadow/Template 根发现设有 20,000 元素与 1,000 root 硬上限。解析仍只处理网页已公开引用的资源，不执行目录爆破、文件名枚举、登录绕过、验证码破解或 DRM 规避。

真实 Microsoft Edge E2E 已在测试站命中当前页 15 个候选与递归 5 页/18 个候选，并覆盖延迟 Shadow Root、第三方 CDN/frame、同源导航、导出下载，以及 280/320/380px 五页侧栏。扩展仍完全本地运行，不上传扫描数据，默认静音，不播放音效或背景音乐。
