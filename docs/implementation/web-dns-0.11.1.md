# 0.11.1 · 公开网页 Fake-IP DNS 兼容修复

日期：2026-09-17。基线：0.11.0；保留旧发行包和正式数据库。P14 不变。

## 复现与证据

用户链接为 CityU 的 Graduate Trainee 岗位，slug：
`1789108696696-6aa3a1d8177b02001da5dff6-careerbridge-graduate-trainee-automated-system-h-k-limited-hk`。

1. 直接运行实际 `readWeb()`，稳定出现与用户相同的“网页解析到内网、保留地址或不支持的地址”及 `WEB_READ_FAILED`。
2. 系统 `lookup(..., {all:true,family:4})` 得到页面主机 198.18.0.166、公开 API 主机 198.18.0.213，其他公开域名也返回同类地址。系统 DNS 包含 198.18.0.2。符合代理/TUN Fake-IP 特征；没有检查或修改用户的代理配置，不能断言具体是哪款软件造成。
3. 直接 UDP DNS 查询在本机超时，不能靠将 lookup 换成 resolve4 修复。
4. 公共 HTTPS DNS 返回可用公网 IPv4，以原有 HTTPS 下载器、原域名 TLS 校验、IP 钉住读取同一公开 API，成功得到 `[CareerBridge+] Graduate Trainee`，2,991 字符，含职责和要求。IP 仅作为诊断证据，应用不硬编码站点 IP。
5. 最小自动回归命令：`node --import tsx --test tests/web-dns.test.ts`。先写两项回归，在旧代码均失败；`red.txt` 保存原始失败。不是通过删掉 SSRF 检查获得绿测试。

证据目录：`.test-data/web-dns-fix-20260917/`。不含真实凭证或求职资料；只访问用户明确提供的公开岗位及公开 DNS，模型测试均为本机模拟。

## 修复与隐私边界

- `electron/web-material.ts` 保留现有 HTTPS/443、IPv4、公网/保留网段检查、每跳重新检查、原站点/跳转限制、20秒总期限、体积限制和取消。
- 默认仍阻止系统合成地址。新错误码 `WEB_DNS_SYNTHETIC` 告知可能的代理 Fake-IP，而非将所有情况笼统描述为内网网站。
- 匹配/求职信“确认访问网页”新增 **允许公共 DNS 兼容解析（仅本次）**。默认关闭；每次新确认/取消/跨页均不继承授权，无全局开关、不写偏好数据库。
- 只有所有系统解析答案都在 198.18.0.0/15、且本次明确授权时才查询 Cloudflare。正常公网、不支持地址、混合公网/私网不会尝试公共 DNS；绝不连接合成 IP。
- `electron/web-dns.ts` 通过固定 1.1.1.1:443 和 cloudflare-dns.com TLS/Host 请求 DNS-over-HTTPS JSON，不通过系统再次解析该 DNS 主机，不执行脚本、不读取 Cookie/代理凭证、不跟随 DNS HTTP 跳转、不关闭证书验证。
- Cloudflare 可见实际目标主机名和网络 IP；不发送 URL 路径/查询参数、简历、模型 Key、Cookies。确认框明示该新增第三方流量，未授权不发送。
- 响应最多32KiB、64条记录、8跳别名；核对原问题类型/主机名、状态与截断标记，仅沿准确 CNAME 链获取 A 记录；拒绝循环、冲突和畸形答案。所有目标 A 记录仍重新通过现有公网过滤，再锁定单个 IP 建立 TLS。
- 返回私网/保留/混合结果时仍拒绝；查询失败不自动换 DNS、不重试，不放行内网。日志/诊断不回显远程异常原文。
- 公开网页不是模型调用；导入资料默认不勾选，仍需用户单独授权发送给模型。

## 已实施回归范围

- 默认无额外 DNS、明确授权后完整导入；正常公网不查询第三方。
- 内网/空/混合/IPv6/合成返回仍阻止，取消及时退出，重定向重新校验，CityU 接口继续拒绝跳转。
- DNS CNAME/问题校验、响应大小/状态/压缩/畸形响应与错误脱敏；固定 IP/原 TLS 主机/无路径与凭证发送。
- 两页确认框默认关闭、取消和新确认重置；IPC 非 boolean 授权被拒绝。
- 真实 CityU 链接在两页先验证默认拒绝，再勾选兼容选项成功导入；岗位正文正确，来源保存，未自动勾选，无模型配置或评估历史。

## 最终验证与交付

| 检查 | 结果 | 证据（位于本轮目录） |
| --- | --- | --- |
| 全量单元/协议/服务测试 | **510/510 通过**，新增 DNS 专项33项 | unit-final.txt、targeted.txt |
| 类型/格式/构建 | 全部通过 | build-final.txt、format-final.txt |
| 相关桌面回归 | **15/15 通过**，11分钟；四协议P10/P11、P12/P13、两页真实网页、草稿/重启/安全交互 | regression.txt、regression-results/ |
| 已打包ASAR专项 | **2/2 通过**；两页授权交互与同一真实链接导入 | asar-ui.txt、asar-ui-results/ |
| ASAR与构建一致性/fuses | 通过；无测试资料/脚本、无elevate、启用完整性验证 | asar.txt |
| ZIP全部75文件 | 大小及SHA256与win-unpacked一致 | zip.txt、verify-zip.ps1 |
| 正式EXE隔离启动/关闭/重开 | 两轮通过 | exe-smoke.txt |

本轮没有重跑全部旧桌面套件：按影响范围重跑上述15项。ASAR交互是在开发Electron加载最终包的app.asar执行，不冒充正式EXE的完整UI自动化；正式EXE另有启动冒烟。

最终交付：
- ZIP：`release/0.11.1/Career-Assistant-0.11.1-win-x64.zip`。
- EXE：`release/0.11.1/win-unpacked/Career Assistant.exe`，必须保留同目录资源。
- ZIP SHA256：`DB3F18BF552F6AD8674D64EA785F279AA50B748930DE76A6CD56C3E4C1DAFAD0`。
- 文件版本0.11.1；未签名（NotSigned），未声称完成P14或干净机器验收。
- 原0.11.0未移动/覆写；未改用户代理/DNS系统设置、密钥、数据库或模型配置；无Git提交/推送、无临时生产日志。

### 用户复测

1. 正常关闭旧版，启动0.11.1。
2. 在岗位匹配或撰写求职信页粘贴原链接，点击“读取网页前确认”。
3. 当前Fake-IP网络下，阅读披露并勾选“允许公共 DNS 兼容解析（仅本次）”，再确认读取。
4. 确认导入的Graduate Trainee岗位正文。导入不会自动发送给模型，仍需手动选择资料。

如果不愿向Cloudflare查询主机名，请保持不勾选，选择手动粘贴/PDF，或自行把代理配置为真实DNS解析。应用不会代改系统网络设置。
