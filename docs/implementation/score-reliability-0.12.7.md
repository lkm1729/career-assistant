# 0.12.7 / 评分来源、超时与 JSON 输出可靠性

日期：2026-09-18。基线：0.12.6。仅处理用户报告的三类评分故障，不进入 O4。

## 用户报告与可确定的事实

| 报错 | 已知事实 | 未知边界 |
| --- | --- | --- |
| AI_SCORE_EVIDENCE / dimensions[3].evidence[2].sourceId | 模型返回的该条引用 ID 不属于当前发送清单 | 没有原始 ID，不能断言是拼写、文件名代替、跨页混淆还是捏造 |
| AI_TIMEOUT | 本地请求等待超时；旧 Anthropic 评分默认总时限为 120 秒 | 旧报错未区分连接、思考、正文阶段，不能认定供应商已停止或未计费 |
| AI_SCORE_JSON / JSON_SYNTAX | 单个闭合代码块的内部无法通过 JSON.parse | 没有正文，不能断言是漏引号、漏括号、非法逗号或真实截断 |

本轮不把合成响应冒充真实供应商响应。未读取生产数据库、密钥、简历或真实响应；未调用真实供应商。用户启用的能力声明不等于该代理已通过原生 JSON Schema 探针。

## 排查与红绿回路

```powershell
node node_modules/tsx/dist/cli.mjs --test tests/score-reliability.test.ts tests/score-reliability-json.test.ts tests/anthropic-deadlines.test.ts
```

- 最初来源/超时回归 2 项失败：没有短 ID 映射，且空闲时限无独立诊断。`.test-data/score-reliability-red.log`。
- JSON 结构诊断 4 项改前失败：仅有笼统 JSON_SYNTAX，缺少无正文的结构分类。`.test-data/score-reliability-json-red.log`。
- 改后 12 项定向测试通过：`.test-data/score-reliability-green.log`。
- 全量 568 项通过：`.test-data/score-reliability-unit.log`。旧测试中“Anthropic 评分没有 output_config / 输出模式必为 prompt-json”的两项期望按新已确认发送合同更新，不删除坏响应拒绝测试。

可检验假设：长来源 ID 复制错误可由短编号+有限枚举预防；持续有流数据却被固定 120 秒切断可由空闲/总时限分离改善；仅靠提示词生成 JSON 的不稳定性可由供应商支持的原生格式约束预防。所有假设都不等于用户每次失败的根因已获得真实响应证实。

## 1. 引用来源：请求内短编号 + 原生枚举 + 原资料精确校验

仅 Anthropic 评分将选中的资料 ID 改为请求内 `s1:p1`、`s2:p1` 等短编号；粘贴文字仍为 `paste`。来源清单、页文字标记、图像页清单和 Schema 使用相同编号。

- 映射由客户端根据当前已选 manifest 构建，不从模型输出、文件名或相似文字推断。
- 评分解析先精确映射回原始 ID，再执行原有来源/quote/用途/图像覆盖校验。历史记录仍使用原资料 ID，不改变数据库/输入资料。
- 未知 ID、错误页号或目标不在当前清单内仍失败，不丢掉坏引用后假装完整评分。
- 其他协议的来源编号行为未改变。切换能力、选择资料或修改输入后，旧确认仍失效。
- 原生 Schema 的来源枚举只含短 ID，不含真实 UUID、文件名、文本或图片。原请求按用户确认仍发送选中材料，未减少证据或添加未选资料。

本机服务用例准确复现用户同字段 `dimensions[3].evidence[2].sourceId` 的非法第三条引用，继续拒绝并保留已有历史。

## 2. Anthropic 评分等待：10 分钟总上限 + 2 分钟无数据上限

`shared/scoring.ts` 定义单一时限常量，后端与发送确认界面同时读取：

- 总等待上限 600000 毫秒。
- 连续无数据上限 120000 毫秒；收到字节（含合法 SSE 心跳）后刷新。
- 心跳不能绕过总上限，字节/帧/正文大小和流完整性限制保留。
- 用户取消优先于超时诊断；所有退出路径清理空闲计时器，取消 reader。
- 本轮只有 Anthropic 评分使用较长时限。其他页面/协议/探针保留原时限。
- 不改变 max_tokens（测试中为 64000）、温度、模型 ID；不启用 thinking，不增加自动重试。

新 AI_TIMEOUT 附固定枚举：`reason=IDLE_LIMIT|TOTAL_LIMIT; phase=CONNECTING|WAITING_EVENTS|THINKING|TEXT|FINISHING`。只描述客户端观察状态，不推断供应商停止计费或停止生成。不保存原始响应、无遥测。

时限测试使用缩短时限的本机流：连接无数据、thinking 无数据、text 无数据、持续心跳后成功、持续心跳仍触发总上限、取消优先和非法时限。不是一次真实 10 分钟模型测试。

## 3. JSON：原生约束优先，损坏内容不补造

原实现评分只为 Gemini 设置原生 Schema；Anthropic 即使 capability=structuredOutput:supported 仍只发格式提示词。现在：

- Anthropic 且该模型明确标记 supported：请求 `output_config.format.type=json_schema`，使用本次短来源 ID 枚举。
- unknown/unsupported：保持 prompt-json，界面明确显示；不会静默切协议或失败后重试。
- 使用保守 Schema 子集，范围/数量等细节继续由客户端严格校验。对象关闭额外字段，原来可选的 example 在原生 Schema 中为 required 的 string|null，解析器仍兼容既有记录/其他协议。
- 所有评分模式仍进行 JSON、四维唯一性、分值、引用、视觉覆盖和总分校验。模型/代理忽略 Schema 时也不能绕过验证。
- 提示词要求每维优先 1–3 条短证据、最多 3 条建议、简洁总结，减少无必要输出；不会截短原始输入材料。
- 前一版单个完整 JSON 围栏+短说明兼容保留。不补全 JSON，不替换引号，不删除逗号，不从多个结果中任选。

JSON_SYNTAX 增加固定结构迹象：`shape=UNTERMINATED_STRING|UNCLOSED_CONTAINER|MISMATCHED_CONTAINER|INVALID_SYNTAX`。结构迹象不是“已证明网络截断”。不使用含正文片段的原生 JSON.parse 错误消息。

如果代理不支持 output_config 而返回 HTTP 400，需要用户明确将模型结构化输出能力设为不支持，再重新确认一次发送；不会自动产生第二笔收费请求。该可能性在发送确认中说明，不能把手工能力标记当成真实供应商已通过验证。

## 修改与验证

生产：`electron/scoring.ts`、`electron/ai-service.ts`、`electron/anthropic.ts`、`electron/chat-completions.ts`（仅共享 options 类型）、`shared/scoring.ts`、`src/ScorePanel.tsx`。版本与发行目录更新为 0.12.7。

- 类型/构建/格式通过：`.test-data/score-reliability-build.log`、`.test-data/score-reliability-format.log`。
- 请求 Schema/短编号/原 ID 持久化、原生能力关闭、旧确认失效、HTTP 400 不重试、非法第三引用、坏 JSON、重开历史与隐私断言已覆盖。
- 现有 0.12.6 空字符串 signature_delta 兼容保留，不扩大为忽略所有 thinking 生命周期。
- 定向桌面 8 项全部通过（6.3 分钟）：`.test-data/score-reliability-desktop.log`。覆盖本轮评分确认/错误分类/Schema 拒绝不重试/重开、4 个原生协议用例、2 个 O3 展示用例、Gemini 评分；未声称全量桌面重跑。
- NSIS/ZIP 打包成功：`.test-data/score-reliability-package.log`。使用 `--config.npmRebuild=false` 保持当前已安装依赖不变，未变更依赖版本。
- 当前构建与 ASAR 逐文件一致，fuses、内嵌完整性、离线字体/OCR/许可清单验证通过：`.test-data/score-reliability-verify.log`。
- ZIP 全部 217 个文件 SHA-256 与 win-unpacked 一致：`.test-data/score-reliability-zip-verify.log`；发行哈希在 `release/0.12.7/SHA256SUMS.txt`。
- 安装器和 EXE 均为 NotSigned：`.test-data/score-reliability-signature.log`。本轮没有执行安装器安装/升级或独立干净机测试。
- 最终 ASAR 评分 UI 1 项通过（53.1 秒）：`.test-data/score-reliability-asar.log`。测试 Electron 加载最终 ASAR，不等同于加固 EXE 的 UI 自动化。
- 实际 EXE 两轮离线启动/正常关闭/重开通过：`.test-data/score-reliability-exe-smoke.log`。
- 最终 ASAR 截图：`docs/implementation/score-reliability-0.12.7-success.png`、`docs/implementation/score-reliability-0.12.7-json-diagnostic.png`。均为虚构本机评分数据。

修改前备份：`.test-data/score-reliability-backup-20260918-114112`。诊断/测试材料只在 `.test-data` 和测试输出中，不打入发行。无调试原始响应日志。无 git commit/push/reset，未删除旧发行。

## 验收边界

本轮修复了可确认的请求构造/时限设计缺口，提供可验证的预防措施；不能保证不支持约束的代理不再输出坏 JSON 或错误引用。真实供应商须用户在相同配置下复测。若仍失败，仅需固定错误码和结构分类；不要求 Key、简历或原始响应。独立干净机、数字签名与既有许可缺口未在本轮关闭。


