# 0.7.3：原生协议兼容性与模型级探针

日期：2026-09-15。基于用户在 0.7.2 真实使用中的反馈；本次只使用本机模拟服务、虚构 Key 和隔离数据库，未读取或发送用户真实简历、Key 或上游响应。

## 问题与证据

### Gemini 候选 index

旧实现要求每个候选明确写 `index: 0`，因此单候选省略 index 也会抛出用户反馈的同一错误；旧测试甚至将省略 index 列为必须失败的输入。新增最小测试先复现此错误，再修复为：

- 请求仍为 candidateCount=1，响应仍仅接受单候选。
- 仅省略 index 等价于本流唯一的 0 号候选；显式非零、负数、小数、字符串和 null 继续拒绝。
- STOP、内容与身份一致性、大小限制、拒绝/工具输出等检查保留。
- 不再把候选结构错误报告成用户配置错误；输出 `AI_GEMINI_STREAM_CANDIDATE_INDEX` 等具体协议错误码。

这是已复现的客户端兼容性缺陷；没有用户真实响应样本，不能证明其请求必然只受此问题影响。

### Anthropic 通用生命周期错误

旧实现把多个不同失败分支归为一条通用错误。本机已复现：合法字符串正文位于 `content_block_start` 时，由于强制要求空字符串而失败。修复后初始正文与后续 text_delta 顺序拼接并计入同一大小上限。

另外增加有界代理兼容：message_start 可省略尚未赋值的 stop_reason/stop_sequence；thinking 开始块允许签名稍后到达，也可接受已提供的字符串初始内容；无终止原因的 message_delta 仅作为元数据处理，不授权完成。end_turn 的 stop_sequence 可省略或为 null。

保留的约束：

- 内容块 index 仍须为连续整数，不能交错、重复、越序。
- thinking/signature 不进入正文、回调或版本；thinking 块结束前仍须有签名。
- 必须明确 end_turn，再收到 message_stop；仅元数据、截断、max_tokens、refusal、工具块、未知内容块等不得保存成正式版本。
- 不接受 message_start 中的预填 content 数组，不猜测缺失角色、消息 ID 或非整数内容块 index。
- 仍不跟随重定向，不自动重试或降低 TLS 校验。

用户原始 Anthropic 故障点尚未被证实：同一通用错误可由多个字段/顺序问题触发，不能仅凭其文字宣称已修复真实供应商的全部变体。新版为失败标出固定解析阶段，如 `AI_ANTHROPIC_STREAM_MESSAGE_START`、`AI_ANTHROPIC_STREAM_CONTENT_BLOCK_START`、`AI_ANTHROPIC_STREAM_MESSAGE_STOP`、`AI_ANTHROPIC_STREAM_END`，不回显原始值或响应正文。

## 模型级探针

0.7.2 已有按模型 ID 调用的文本/图片探针，但入口名为“测试文本”，仅在保存后的模型列表中，不够符合用户的查找预期。本次未用供应商 GET 列表代替模型测试：

1. 模型卡片明确显示“测试模型连通性 · 模型名”；图片探针独立保留。
2. 新增/编辑模型提供“保存并测试模型连通性”。只保存并打开确认区，不自动发请求。
3. 确认区自动滚动并聚焦，显示准确的模型 ID、所属供应商、最终请求地址、协议、参数和费用提示。
4. 确认发送后，只用该模型执行短文本流式生成；不读取本页或其他页求职资料。
5. 每个模型保留独立测试记录；A 模型通过不会把 B 模型或供应商标成通过；修改配置后旧测试标为过期。
6. 连通性不证明简历 JSON 输出格式、多模态或所有模型能力都可用。

## 资料核对与不确定性

本次读取的公开一手资料（2026-09-15）：

- Google API Candidate 字段说明：`https://ai.google.dev/api/generate-content#Candidate`
- Google 官方 Python SDK 类型定义：`https://github.com/googleapis/python-genai/blob/main/google/genai/types.py`，Candidate.index 为可选字段。
- Anthropic 官方 TypeScript SDK：`https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/lib/MessageStream.ts`，content_block_start 使用开始块内容初始化，后续 text_delta 追加。
- Anthropic 官方类型定义：`https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts`。

Anthropic 文档站此次请求重定向到地区不可用页面，因此没有把它当作已成功取得的协议正文；以公开官方 SDK 核对可读到的结构。官方类型模型与流增量/第三方代理省略空字段的行为不能混为一谈：上述省略 nullable/延迟签名支持是本次明确限定范围的兼容策略，不宣称全部都由官方模式强制规定。

公开参考文本的本机快照在 `.test-data/*-20260915.txt`，仅用于本机核对，不加入发行包。未通过原始网络日志或用户数据库采集敏感响应。

## 回归与发行

新增 `tests/native-compatibility.test.ts`，覆盖省略字段、初始正文、延迟签名、元数据增量、非法 index、缺少终止事件、错误阶段脱敏以及真实 HTTP 适配器→模型探针→简历/求职信版本保存链路。

新增 `tests/model-probes-0.7.3.e2e.ts`，逐一测试 Gemini / Anthropic：编辑器保存后确认、取消不发送、准确模型 ID、A/B 模型测试记录隔离、编辑后重测、兼容流生成 V1。

旧测试中“省略 Gemini index”和“Anthropic 开始块含非空正文”两项拒绝断言由新的成功/边界测试替代；不是简单删掉失败测试。其他协议错误、取消、截断、密钥脱敏与资料隔离测试保留。

### 验证结果

- 最小回归先出现与用户反馈相同的两条报错文案；增加兼容例后，3 个正向测试先失败，修复后通过。
- 14 项新增解析器/HTTP/服务回归通过；全量单元、协议和服务测试共 **345 项通过、0 失败**，完整复测同样通过。
- 全量桌面 E2E **30 项通过、0 失败**，2 个隔离 worker，8.8 分钟。包含新增的 Gemini/Anthropic 编辑器模型探针与兼容流生成场景。
- TypeScript、Prettier、生产构建与 Windows ZIP 打包通过。
- 最终重建仅同步了注释修正对应的 main.cjs.map；逐文件确认实际运行的 main.cjs、preload.cjs、HTML/CSS/前端 JS 与全量桌面测试构建完全一致。
- 成品与 ZIP 解压副本的版本、安全开关、ASAR、测试数据排除和构建内容一致性检查通过；离线启动/正常关闭/重开两次通过。
- 未签名；没有在另一台干净电脑或用户的真实收费 API 上验收。不能把本机模拟通过等同于真实供应商问题全部解决。

日志保留在 `.test-data/native-fix-0.7.3-unit.log`、`native-fix-0.7.3-unit-repeat.log`、`native-fix-0.7.3-e2e.log`、`native-fix-0.7.3-package-final.log`、`native-fix-0.7.3-artifact-final.log` 和 `native-fix-0.7.3-packaged-final.log`。测试数据不打入源码/应用 ZIP。

0.7.2 Windows ZIP 的 SHA-256 仍为 `92adcb72dd8a64396a9ce599283abd0edadbfe09a56093c8140aa9ed851ba564`，与上一交付一致。

0.7.3 单独输出到 `release/0.7.3`，保留 0.7.2 与更早包。未改数据库结构、未进行数据迁移、未操作真实用户数据；不执行 commit/push 或公开发布。P08 继续暂停。
