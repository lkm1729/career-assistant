# Claude Markdown 匹配报错诊断与旧发行包清理

日期：2026-09-16。当前源码版本：0.10.5。本轮没有修改业务源码、升级版本或生成新发行包。

## 用户观察与本轮边界

用户报告：Claude 经 Chat Completions 或 Anthropic 原生协议返回可阅读的 Markdown 岗位匹配报告，但应用报 AI_MATCH_MARKDOWN / MARKDOWN_REPORT，不保存匹配记录。本轮没有读取真实报告、正式数据库、凭证，也没有调用真实供应商或产生付费重试。所有复现均使用虚构资料与本机 fixture。

## 可重复的失败信号

在项目根目录执行：

```powershell
node --import tsx --input-type=module -e "import { parseMatch } from './shared/matching.ts'; import { markdownMatchReport } from './tests/match-report-fixture.ts'; parseMatch(markdownMatchReport, 'Python services required', 'Python services built');"
```

已执行，退出码 1，错误为：

```text
MatchValidationError: 匹配输出格式不符合要求：response — MARKDOWN_REPORT：检测到Markdown式报告，未返回可验证的JSON对象；未保存匹配记录。
code: AI_MATCH_MARKDOWN
```

这是对用户描述形态的最小合成复现，不是用户真实响应的重放。

## 假设与验证

1. **应用输入输出契约与 Markdown 使用预期不一致：本机代码已证实。** shared/matching.ts 的 MatchOutputMode 只有 prompt-json、chat-json-schema、anthropic-json-schema，没有 Markdown 报告模式。所有协议返回文本后均进入 electron/ai-service.ts 的 parseMatch。本机判定位置是收到响应后的格式/证据校验，不是这条错误所能证明的网络或鉴权失败。换协议不会取消共同的 JSON 校验。
2. **供应商格式约束没有发送或没有被执行：仅完成本机分支验证。** 模型 structuredOutput 标记 supported 时，Chat 与 Anthropic 服务测试分别核验 response_format 与 output_config 格式约束；unknown 时走提示词 JSON。不能由本机模拟通过推断用户供应商真正执行了约束。本轮未确认用户运行的应用版本、确认框模式或真实请求。
3. **响应中有 JSON，但被解析器遗漏：用户真实响应层面尚未验证。** 当前 AI_MATCH_MARKDOWN 分类要求没有左花括号、没有 JSON 围栏，并发现 Markdown 标题或表格。测试覆盖 JSON 包装及 Markdown 分类，但没有获取用户原始响应，不能作真实供应商端到端结论。

## 测试

```powershell
node --import tsx --test tests/matching.test.ts tests/match-json-envelope.test.ts tests/match-preview.test.ts tests/p10-p11-service.test.ts
```

45 项通过，0 失败，约 1.8 秒。日志：.test-data/claude-markdown-diagnosis-20260916-tests.txt。

注意：这些现有测试将纯 Markdown 拒绝视为预期行为；通过证明当前防护与模拟服务分支有效，**不代表用户报错已修复**。本轮没有发布修复版，也没有进行桌面/打包/真实供应商验收。

## 用户澄清与剩余验证（2026-09-16 续查）

用户已澄清：没有主动设置或要求 Markdown，只能配置“支持结构化输出”；Markdown 是实际观察到的模型响应。Claude 在 Chat 与 Anthropic 两种协议下出现问题，Gemini 没有此问题。此前把这一描述理解成用户选择的输出模式是诊断误解，已撤回；不能继续把自定义 Markdown 要求当成已知原因。

新增 tests/match-model-contract.test.ts，覆盖 Chat 下 claude-fixture/gemini-fixture、Anthropic 下 claude-fixture、Gemini 下 gemini-fixture，各自 structuredOutput=unknown/supported，共 8 个本机对照场景。检查实际收到的 HTTP 请求：

- 每个场景均包含匹配 JSON 系统契约。
- Chat/Anthropic 的 supported 分支确实携带对应 Schema 字段；unknown 分支不发送。
- 当前 Gemini 岗位匹配仍是提示词 JSON；Gemini 评分的原生 Schema 支持不能混为岗位匹配的实现。
- 相同的有效 JSON 在各场景均可保存；相同的纯 Markdown 均被共同校验器拒绝，没有根据模型名称区别处理。
- 模拟供应商在收到 Schema 后仍返回 Markdown 时，应用不自动重试、不覆盖旧记录或输入。

新增 8 个测试通过，类型检查通过。最初测试编写时的失败是序列化会省略 undefined 属性导致的测试比较错误，已改为比较失败前后数据库快照；不是用户问题的根因或修复证据。

这只是本机传输与校验链路验证，不是真实模型对照实验。真实供应商是否忽略/转换参数、模型是否支持该参数、实际运行版是否发送了该参数，仍不能从 fixture 推断。本轮没有修改生产请求策略、放宽校验、调用真实模型、自动读取凭证或发布新版本。继续定位需要非敏感配置元数据：Claude 的模型 ID、供应商名称/域名、发送确认框的“本次输出格式”一行；不需要 API Key、简历或完整报告，也不需要先付费重试。

## 旧发行包清理

完成显式批准后的永久删除，不经过回收站。删除范围仅为 release 下 0.10.0 以前的旧发行产物：

- 0.2.0、0.3.0、0.4.0、0.4.1、0.5.0、0.5.1。
- 0.7.0、0.7.1、0.7.2、0.7.2-before-review-20260915、0.7.3。
- 0.9.0、0.9.1、0.9.2。
- Career-Assistant-0.1.0-portable.exe。
- 未编号 win-unpacked，经 Career Assistant.exe 的 ProductVersion 核验为 0.1.0.0。

合计 16 项、1147 个文件、9029370061 字节（约 8.409 GiB 文件逻辑大小）。删除前检查绝对目标路径、版本、文件数与总大小、目录链接、疑似数据库/用户数据目录和运行进程；未终止任何进程。执行后确认目标已移除，0.10.0–0.10.5 六个版本的文件数与总大小与清理前一致。未清理源代码、依赖、缓存或正式用户数据。

审计文件：

- .test-data/release-cleanup-20260916-inventory.json
- .test-data/release-cleanup-20260916.ps1（一次性脚本；已有结果时拒绝重复执行）
- .test-data/release-cleanup-20260916-result.json