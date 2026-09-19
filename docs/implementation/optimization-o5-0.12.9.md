# O5 — HTTP 错误展示与模型发现 / 0.12.9

日期：2026-09-18。基线：用户已验收 O4 / 0.12.8。本轮仅进入 O5，不进入 O6 性能优化。

## 实现边界

- 真实 HTTP 失败在错误标题突出状态码；为 500 / 502 / 503 分别提供中文解释及建议，保留 429 限流/额度提示。
- 内部 `AI_HTTP_*` 诊断码保留在可展开的技术详情中。本地校验、JSON、取消、网络失败和超时不伪装成 HTTP 500。
- 设置中的模型区域新增“获取模型列表”。先展示供应商派生的目标地址及发送范围，确认后才发出 GET；不发送简历、材料、系统提示词或工作台状态。
- 根据供应商实际协议路由：Chat Completions / Responses 使用 Bearer 认证列表；Anthropic 使用原生列表；Gemini 使用原生列表并去掉模型资源名的 `models/` 前缀。
- 支持搜索、多选、全选搜索结果、逐页明确获取、两步确认导入、重复 ID 跳过；保留手动添加。
- 导入只创建新模型：继承供应商协议、能力未知、参数能力全部关闭、无探针记录，不切换任何页面当前模型，不覆盖已有模型。
- 主进程持有发现会话及分页游标，渲染进程不能指定下一页 URL；重定向不跟随，游标仅作为原端点的编码查询值。
- 单页最多等待 30 秒、读取 1 MB；最多 20 页、5000 个去重模型；一次导入最多 500 项，现有全局模型上限仍为 500。超限或无效批次不部分写入。
- 取消、网络错误、鉴权错误、未开放端点、空列表分别呈现。列表请求不写入连通性探针结果，不自动重试，不自动验证推理权限或能力。
- 列表只在本次运行内存中保存；显式导入才持久化。供应商修订变化、旧会话、未发现的 ID 被后端拒绝；获取期间共用现有请求互斥和取消控制。

## 官方接口核验

本轮 web 工具未返回可用正文；通过公开 HTTPS 下载官方文档 / 官方 SDK 源码核对，未使用供应商密钥。官网返回不相关页面或 403 的材料未当作有效依据。

- OpenAI 官方 SDK：`https://raw.githubusercontent.com/openai/openai-node/master/src/resources/models.ts`。`Models.list()` 为 GET `/models`，Bearer 认证；`ModelsPage` 注明当前不实际分页。兼容代理的非标准分页不猜测、不跟随 next URL。
- Anthropic 官方 SDK：`https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/resources/models.ts`。GET `/v1/models`，`ModelListParams` 继承 `src/core/pagination.ts` 的 `PageParams`，使用 `after_id` / `limit`；按原生列表的 `has_more` / `last_id` 手动翻页。
- Gemini 官方文档：`https://ai.google.dev/api/models`。列表 `pageSize` / `pageToken`，响应 `models` / `nextPageToken`。
- 公开核验快照在 `.test-data/o5-openai-sdk.txt`、`.test-data/o5-anthropic-sdk.txt`、`.test-data/o5-anthropic-pagination.txt`、`.test-data/o5-google-models.html`。第三方代理是否实现这些接口仍以其文档及用户实测为准；不能由模型名称判断。

## 验证进度

- 修改前备份：`.test-data/o5-before-20260918-160556`。
- 新增 21 项 O5 单元/服务测试通过，覆盖四种协议、认证头、GET 无正文、分页去重、401/403/404/405/429/500/502/503、重定向、取消/超时、格式及大小上限、游标循环、20 页 / 5000 项上限、预取消不发请求、严格 JSON 媒体类型、原子导入、500 上限、持久化、旧会话和工作台隔离。
- 全量首次 648 项中 Gemini 旧测试的缺失 Content-Type 场景偶发连接失败（父/子记为 2 失败）；不修改业务逻辑或放宽断言，原样重跑 648 全部通过。原始日志与重跑日志均保留。
- 最终源码全量 **650 项通过**；类型检查、构建、格式检查通过。日志：`.test-data/o5-unit-final.log`、`.test-data/o5-format.log`。
- 相关桌面 **14 项通过**（O2 4 项、O4 5 项、O5 5 项）；完成按钮旁导入反馈与搜索样式打磨后，最终 O5 桌面 **5 项再通过**。输出目录：`.test-data/o5-desktop-results`、`.test-data/o5-desktop-final`。
- 最终模型列表、导入反馈及 HTTP 503 截图已人工查看：搜索框样式统一，完成反馈位于导入按钮下方，真实 HTTP 码与详情可见。初次隐藏窗口截图存在合成帧滞后；补充双动画帧与等待后重新截图，未把旧帧当作最终界面证据。
- 最终 ASAR **12 项通过**：O5 5 项、O4 5 项、0.12.8 → 0.12.9 保留旧数据/加密测试 Key 的升级与重启 1 项、离线字体与四页渲染 1 项。输出目录 `.test-data/o5-final-asar`。此层使用开发 Electron 加载最终包，不等于硬化 EXE 的完整 UI 自动化。
- 硬化实际 EXE 的两轮离线启动 / 隔离数据库 / 正常关闭 / 重开通过；隔离数据目录 `.test-data/packaged-offline-65739e6f8ee344d085803a3efb2672e2`。
- 最终包校验脚本通过：ASAR 与当前构建逐文件一致；fuses、完整性、离线字体/OCR 与许可文件哈希通过，未打包测试资料。
- ZIP 内 **218 个文件** SHA-256 与 win-unpacked 完全一致；安装器 FileVersion / ProductVersion 为 0.12.9，EXE 为 0.12.9 / 0.12.9.0；两者均 **NotSigned**。日志中的 signing 阶段不是有效签名证明。
- Vite 提示主包约 506.26 kB 的体积警告仍在，不将它当作 O6 已处理的证据。

## 安全与未覆盖范围

仅使用 `.test-data` 隔离配置、虚构材料、FAKE Key、localhost 模拟服务；不访问正式 AppData，不请求真实供应商，不安装/卸载正式应用。未执行 git commit/push/reset，未清理旧 release。
本轮不宣称 O6 掉帧修复，不修改既有评分 JSON / Anthropic 等待上限语义；仍保留收费请求无自动重试的边界。
包仍未签名；独立干净 Windows 验收、真实供应商列表/生成验证以及三个上游许可证全文缺口均未在本轮关闭。

## 交付文件

- `release/0.12.9/Career-Assistant-0.12.9-Setup-x64.exe`（约 214.02 MiB）。
- `release/0.12.9/Career-Assistant-0.12.9-win-x64.zip`（约 269.14 MiB）。
- 附 `SHA256SUMS.txt`、`RELEASE-NOTES.txt`。
- EXE SHA-256：`cd4ee71a99667a6486aff2f772728003f9096744151dd1dcadcd47b4a285c036`。
- ZIP SHA-256：`500f57271bffab21926033af50caaeaf37adbd903626479f78b316d36c342d98`。

建议用户复测：对已配置供应商获取列表，搜索并导入一两个未添加模型；核对原有选择与能力标记未改变；再次获取时已有模型不可重复勾选；未开放列表时仍可手动添加。无须为了测试导入而运行收费文本/图片探针。

## 本轮结论

O5 / 0.12.9 源码、分层本机验收与本地 EXE / ZIP 交付完成，待用户真实供应商实测验收。没有进入 O6。
