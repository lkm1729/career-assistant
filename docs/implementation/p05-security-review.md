# P05 本地优先与安全边界复核

日期：2026-09-15；交付版本：0.5.1

## 原则和结论范围

以减少真实攻击面为目标，而不是规避检测。没有上游拦截日志，无法判断上一轮的实际触发原因，也不能承诺不会再报警。这是对应用源码、构建配置和交付物的针对性复核，不是全面渗透测试或第三方安全认证。

本项目没有自建云端、云同步、遥测、自动更新上传或应用侧运行数据收集代码。草稿、设置、版本和能力测试记录保存在本机 SQLite。正文数据库未加密，只有 API Key 使用系统 safeStorage 加密。系统自身备份、用户同步软件及供应商日志不在应用控制范围内。

离线可编辑、保存、查看和恢复已有版本。确认远程生成、调整或能力测试时，会发送已展示的对应内容与认证信息至用户指定的供应商；不应宣传为所有情况下数据均不离机。应用不附带本地大模型；本地 AI 需用户另行配置兼容的回环服务。

## 本次实际改动

- 正式包忽略 CAREER_DEV_URL，只加载包内页面；开发模式保留精确的本机开发地址。
- 正式包关闭 DevTools，并移除 Chromium 调试端口/管道参数。通过 Electron fuses 禁用 RunAsNode、Node 环境选项及 Node inspector，启用只加载 app.asar 与嵌入式 ASAR 完整性验证。
- 采用标准 ZIP 便携目录，而非 NSIS 自解压单文件。产物无需提权辅助程序，不包含 resources/elevate.exe，EXE 使用 asInvoker。
- 正式包测试改用普通启动、正常关闭和重开，不再开启 CDP 端口或调用 taskkill。开发模式的完整 E2E 仍使用 Playwright，不把开发调试能力带入发布运行路径。
- 隔离测试数据仍通过 CAREER_TEST_MODE / CAREER_TEST_DATA 显式指定；它们只控制本机测试存储，不重新开放正式包调试器。正式包测试窗口正常显示。
- 隐私界面区分本机保存与用户确认的供应商请求。
- 构建显式 --publish never，避免自动发布；旧发布目录保留。

Node 环境选项被关闭意味着正式包不再接受 NODE_OPTIONS / NODE_EXTRA_CA_CERTS 注入。若某个企业代理依赖这些设置，需要单独设计受控证书支持，不能通过关闭 TLS 验证解决。

## 保留的正常功能与防护

- HTTPS 供应商请求、回环 HTTP 本地模型/模拟服务、凭证加密、SQLite 与文档导出不删除。
- 请求不自动跟随重定向，URL 拒绝内嵌凭证/查询/片段，更换供应商地址需要重新填写密钥。
- IPC 验证当前窗口主 frame 和页面来源；关闭 Node integration，启用 context isolation、sandbox 和 webSecurity。
- 拒绝新窗口、webview、导航和权限请求；Markdown 原始 HTML、图片和链接不执行或自动加载。
- Responses 使用 store:false、不发送 tools/background/previous_response_id；其含义不等于供应商绝不留日志。
- 不完整、取消、拒绝或错误响应不创建正式版本；版本恢复无需供应商在线。

## 验证方法

- tests/runtime-policy.test.ts：发布页面选择、开发地址边界、打包配置。
- tests/offline.e2e.ts：离线编辑/预览/重开、惰性外部 Markdown、隐私文案、测试操作期间没有主进程 fetch。
- scripts/verify-release.mjs：读取实际 EXE fuses 和 app.asar，确认版本、测试文件排除和无提权辅助程序。
- scripts/smoke-packaged.ps1：隔离数据库、正常启动/关闭/重开，不使用调试协议。
- 原有 Chat、Responses、取消、版本与能力测试继续回归。最终结果见 p05.md。

## 发布前仍需处理

签名、另一台干净电脑验证、依赖完整漏洞审计和开源许可证选择尚未完成。仓库目前没有顶层 LICENSE，本次不代替作者选择许可，也不声称已经完成公开开源发行。
