# 岗位匹配：应用侧请求与材料编排诊断

日期：2026-09-16。基线 0.10.5；本轮只调查并增加回归测试，没有修改生产行为、发布新版或调用真实 API。

## 用户新证据与诊断范围

用户截图显示供应商列表探针 HTTP 200，模型文本流探针及红色图片样本识别均通过。接受这些结果，不重复连通性/模型探针，也不再以“尚未连通”解释岗位匹配错误。上轮将渠道兼容性排在首位只是待验证假设，不是已经定位根因。

本轮转向系统提示词、材料组织、响应提取、JSON 校验和既有测试覆盖。全程无真实网络模型调用，没有解密/读取凭证。只读数据库查询按字段投影/聚合，不输出简历、岗位、文件名、原始报告或提示词正文。

## 1. 用户没有要求 Markdown

当前 match 草稿的 systemPrompt 与 shared/contracts.ts 中默认匹配提示词完全相等，331 字符。没有自定义 Markdown/JSON/表格要求。对当前岗位文字及选中资料抽取文字只计算相关模式计数：Markdown 关键词、显式 Markdown 输出要求、明显忽略既有指令表述、JSON 关键词与常见 role 标签均未命中。这是有限的关键词核查，不是完整提示注入检测。

不能再将本次问题归因于用户自定义 Markdown 要求。

## 2. 当前材料与 Gemini 已保存成功记录不是同一输入布局

只读形态核验：

| 项目 | 当前工作区 | 已保存 Gemini 成功记录 |
| --- | --- | --- |
| 系统提示词 | 默认提示词 | 与当前相同 |
| 粘贴岗位 | 4167 字符 | 空 |
| 粘贴简历 | 空 | 空 |
| 简历来源 | 1 份选中 PDF，1 页 | 1 个简历附件来源 |
| PDF 抽取文字 | 4662 字符 | 与当前该页文字相同 |
| 网页岗位来源 | 存在但未选中 | 使用了 1 个岗位附件来源 |
| 图像 | PDF 有图像；本次发送开关不持久化，无法追溯失败调用 | 成功快照记录发送 1 张 |

该成功记录的模型为 gemini-3.8-flash，协议 gemini，包含 7 条要求。只读取得这类结构元数据，没有输出记录正文。

这不能反驳用户观察到的“Claude 失败、Gemini 成功”，但现有记录不能作为严格的只改变模型的 A/B 实验。也不能从当前草稿反推每次历史失败请求的内容。

## 3. 有源码证据的请求表达改进点（不是已证实根因）

见 electron/ai-service.ts:284–307：

```text
system = 用户系统提示词 + 应用 JSON 输出契约
user[0] = { job, resume, evidence, sources 元数据, warnings }
user[1..] = 每页附件 JSON 文字 + 可选图像
```

只用 PDF 简历时，顶层 resume 字段为空，真实简历文字在后续附件文本块中；这不等于简历没发送。当前用户消息基本是资料集合，输出格式规则集中在 system 消息，材料末尾没有独立的明确任务/输出要求。

它是可以加固的请求表达方式，不是无效 Anthropic 请求，也不证明 Claude 没有读 system。不能通过一个专门模拟“丢弃 system”的假服务，反过来宣称真实供应商就是这么做的。

可考虑的窄改进：在材料前明确“执行岗位匹配”及来源读取方式，在材料之后加入简短、由应用固定的 JSON 输出要求；解释 resume 空串仅代表未粘贴、仍应使用 purpose=resume 附件。保持来源/连续原文证据验证、Schema 参数、调用次数和正文历史保护不变。不建议直接让 Markdown 进入正式匹配记录。尚未实施，因为目前缺乏证明这一调整能消除真实 Claude 故障的响应证据。

## 4. 业务层差分测试

新增 tests/match-material-layout.test.ts，使用完全虚构文字，但保留 4167/4662 的长度和两种材料布局：

- Chat Completions、Anthropic、Gemini 三协议。
- 粘贴岗位 vs 岗位网页附件。
- 有图像 vs 无图像。

共 12 个场景，每个运行严格 JSON、说明包裹的单个 JSON 围栏、纯 Markdown 三种受控响应，共 36 次本机 loopback 请求。

验证：

- 所有选中正文在请求中各出现一次，没有因 resume 空串丢弃 PDF。
- 来源清单与正文中的 sourceId 一致。
- 不发送未选中网页正文或其他工作区正文。
- 图像开关与实际请求图像数相符。
- 系统消息确实有 JSON 格式规则；Chat/Anthropic 对应 Schema 字段仍存在。
- 完整 JSON 和可接受围栏可通过严格来源/证据校验并保存。
- 纯 Markdown 原样进入本机失败预览，与模拟端发出的字符串逐字符相等，没有被本机“从 JSON 转成 Markdown”。
- Anthropic 测试还覆盖 thinking 块不混入正文、文本起始块与 delta 拼接。
- 失败不自动重试、不新增记录、不覆盖草稿或旧结果。

这些测试检查传输/保存契约，不模拟真实模型是否遵从提示词，不证明真实 Claude 端到端成功。

### 反向检查测试是否能捕获缺陷

.test-data/verify-match-layout-regressions.mjs 用 esbuild 内存替换构建两个临时变体，**未编辑实际生产源码**：

1. 去掉 system 中的 matchFormatInstruction：12/12 测试失败。
2. 去掉材料正文块：12/12 测试失败。

证明新增测试不是仅检查硬编码返回值；它能够抓到缺少格式指令或漏发附件的回归。这些是人为注入缺陷，不是原应用存在这些缺陷的证据。最初构建变体时的字符串转义错误仅是诊断脚本错误，调整后两个预期红测试均按断言失败。

## 5. 验证结果

```powershell
node --import tsx --test tests/matching.test.ts tests/match-json-envelope.test.ts tests/match-preview.test.ts tests/p10-p11-service.test.ts tests/match-model-contract.test.ts tests/match-material-layout.test.ts tests/anthropic.test.ts tests/chat.test.ts
# 111 tests / 111 pass / 0 fail, approximately 2.5 seconds
npm run typecheck
# PASS
node node_modules/prettier/bin/prettier.cjs --check tests/match-material-layout.test.ts
# PASS
node .test-data/verify-match-layout-regressions.mjs
# Both controlled regressions detected; production source untouched.
```

测试日志：.test-data/match-application-side-20260916-tests.txt。

未运行桌面/打包测试，因为本轮未改业务源码或发行物。没有宣称已修复；没有新版本、数据库迁移、git commit/push、删除或覆盖用户内容。

## 结论与边界

已排除当前默认提示词显式要求 Markdown；未发现同输入布局下可复现的漏材料、丢格式指令或 JSON 被流解析器转丢的问题。发现此前成功/失败对照不是同一请求布局，及用户消息的任务表达有加固空间。

真实失败响应未持久保存，本轮没有重新付费调用，因此仍无法确认为什么真实 Claude 生成了 Markdown。不能把“探针通过”“111 项本机测试通过”或“存在请求表达改进点”中的任何一项替代根因证据。本轮停止重复连通性测试与泛泛归咎网关。