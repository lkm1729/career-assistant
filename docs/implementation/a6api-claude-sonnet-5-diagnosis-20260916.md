# A6API / claude-sonnet-5 匹配 Markdown 故障诊断

日期：2026-09-16。结论等级：本机配置与请求构造已核验；真实 A6API 链路根因待验证。不是已修复声明。

## 本轮直接证据

### 1. 用户截图

模型 ID 为 claude-sonnet-5；协议 Anthropic Messages；最终地址 https://api.a6api.com/v1/messages；结构化输出能力手动标记 supported；temperature 支持勾选但数值未指定；max_tokens 覆盖为 128000；reasoning_effort 未启用。Markdown 是实际返回的文本，不是用户选中的输出模式。

### 2. 本机配置与运行版（只读）

以 Node SQLite readOnly:true + PRAGMA query_only=ON 查询 C:\Users\MSI\AppData\Roaming\Career Assistant\workspace.sqlite。SQL 仅投影供应商地址/协议、目标模型 ID/能力/参数以及岗位匹配页模型选择；没有 SELECT *，没有读取 encrypted_key、工作区正文、个人资料或报告，没有实例化会迁移数据库的 Store。

核验结果：

- A6API 的 base URL 路径为 /，供应商协议 anthropic，模型协议 inherit。
- claude-sonnet-5 的 structuredOutput 已保存为 supported，且该配置正是 match 页选中的模型。
- 模型输出上限 128000，本页没有输出上限覆盖；模型温度未指定。
- 运行中的可执行文件为 D:\Codex\Projects\Career_Assistant\release\0.10.5\win-unpacked\Career Assistant.exe，版本 0.10.5.0。

因此当前配置不是“没有保存结构化支持”或“岗位匹配页选中了另一模型”。这是本轮快照，不能证明较早失败请求当时使用的配置完全相同。

### 3. 本机 HTTP 请求与现有发行物

扩展 tests/match-model-contract.test.ts，新增截图对应的 claude-sonnet-5 + 128000 参数，在 Anthropic 和 Chat 两种协议、unknown/supported 能力下检查实际 loopback HTTP 请求。虚构数据与假 Key，不向 A6API 发送。

结果：

- Anthropic supported 分支发送 output_config.format.type=json_schema 与岗位匹配 Schema。
- Chat supported 分支发送 response_format.type=json_schema 及 strict=true。
- max_tokens / max_completion_tokens 为 128000；没有显式 temperature、reasoning_effort 或 thinking。
- 当前格式契约确实进入系统消息；相同有效 JSON 可以保存，相同 Markdown 会产生 AI_MATCH_MARKDOWN。
- 收到 Markdown 后没有自动重试，既有匹配历史和工作区不变。
- 原生响应中的 max_tokens 截断、工具/拒绝块与流不完整有独立失败处理；不能把 Markdown 错误直接解释为输出上限不足。

命令与结果：

```powershell
node --import tsx --test tests/matching.test.ts tests/match-json-envelope.test.ts tests/match-preview.test.ts tests/p10-p11-service.test.ts tests/match-model-contract.test.ts tests/anthropic.test.ts tests/chat.test.ts
# 99 tests, 99 pass, 0 fail, approximately 3.1 seconds
npm run typecheck
# PASS
node node_modules/prettier/bin/prettier.cjs --check tests/match-model-contract.test.ts
# PASS
node scripts/verify-release.mjs
# PASS: 0.10.5 ASAR agrees byte-for-byte with dist/dist-electron;
# release security fuses, package metadata and test-data exclusions verified.
```

注意：loopback 成功不是 A6API 成功；发行文件验证不是对历史真实请求的抓包。本轮没有新发行版、没有桌面回归，也没有改变生产请求策略。

## 公开来源核验

通过背景浏览器只读查看 A6API 接入文档和 claude-sonnet-5 模型市场；没有登录、选择令牌、固定商家、修改路由或发起模型请求。

```text
https://a6api.com/docs
https://a6api.com/models
```

2026-09-16 观察：

- 接入文档标注更新于 2026-09-13。文档承认旧 /v1 前缀兼容，Claude Messages 需要对应认证头和版本头。因此截图路径不应仅因含 /v1 被判为错误。
- 平台说明其按渠道状况进行路由。同一 claude-sonnet-5 的公开条目包含商家自述为 Kiro、CCMax、AWS 等不同来源；商家描述只是公开自述，不代表已独立鉴真，也不证明用户请求路由到了任何特定商家。
- 在已读取的公开接入页及模型条目中，未取得这个模型/所选渠道对 output_config.format 的明确执行保证。没有记载不等于证实不支持。
- “原生协议”在本案指客户端到 A6API 的请求格式，不表示直接调用 Anthropic 官方端点，更不能由模型品牌推断上游处理方式。

Anthropic 文档网页本次重定向到区域不可用页，不能把该响应当作成功获取文档。经批准改为读取 Anthropic 官方 SDK 的公开源码，不执行下载文件：

```text
https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/resources/messages/messages.ts
```

本地快照：.test-data/a6api-diagnosis-anthropic-sdk-20260916.ts。
SHA256：FF12D72F49D3F0308B920C1DC2F06665B9CDEAA1F849D47202DB04BC0C287AF9。

核验位置：2373–2379 行定义 JSONOutputFormat；2639 行列出 claude-sonnet-5；2656–2666 行定义 OutputConfig.format；4723 行为请求 output_config。由此可核对应用字段形式；不能据此证明 A6API 渠道完整支持，也不能断言该配置的 128000 是真实上游允许的额度。

## 收敛后的判断

**优先待验证：A6API 的所选 Claude 路由未执行/转换了结构化输出约束。** 这是结合已排除的当前配置错误、正确的本机参数形式、多商家来源及用户两协议均返回 Markdown 的现象提出的假设，不是已确认根因。

保留的其他可能性：历史失败时配置不同；真实输入长度或提示词与短 fixture 不同；网关重写消息或响应；特定参数或 Schema 组合不兼容。当前未读取真实提示词或响应，不能排除这些差异。Gemini 正常不证明 Claude 渠道也执行同样的高级参数。

本轮不建议继续反复勾选能力、盲目增加 max_tokens、关闭校验、给 Markdown 猜测补成正式匹配记录或先宣称发布修复。

## 下一步真实诊断（未执行，待授权）

最多两次用户确认的 A6API 原生 Messages 小探针，仅使用虚构文字和静态 JSON Schema，不发送简历、岗位材料、截图或历史。每次输出上限不超过 1024，不自动重试或切换协议/商家。

1. 最小 Schema 执行探针：格式约束只允许固定结构，与要求纯文本的极短合成消息形成可判定对照。记录是否返回符合 Schema 的对象，而不是仅“能输出 OK”。不能据此区分原生约束与上游提示词模拟约束。
2. 若第一项可用，再用应用原有岗位匹配 Schema 与极短虚构岗位/简历测试完整校验。第一项已明确失败则停止，避免追加无意义费用。

只读使用本机已保存的目标供应商凭证，运行时在内存解密用于认证，不落盘、不回显；仅保存无凭证/无原始响应的通过与否及结构摘要。实际模型费用不可撤销，不能因 max_tokens 上限就承诺确切价格，执行前另行取得明确授权。两个小探针即使通过，也不等同真实简历场景完整验收。

## 本轮文件变更

- tests/match-model-contract.test.ts：仅扩展回归场景。
- docs/implementation/a6api-claude-sonnet-5-diagnosis-20260916.md：本报告。
- .test-data/a6api-diagnosis-anthropic-sdk-20260916.ts：只读官方源码快照。

未修改正式数据库、供应商/模型设置、业务源码或发行文件。没有 git commit/push，也没有删除新文件之外的内容。