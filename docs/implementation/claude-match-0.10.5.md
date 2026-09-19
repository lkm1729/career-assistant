# 0.10.5 · 匹配输出契约与Chat Completions结构化输出

2026-09-16，基线0.10.4。保留旧发行目录，不迁移或清空正式数据库。本版修复应用输出契约/诊断缺口，不宣称所有真实Claude中转服务已经通过验收。

## 已确认的复现范围

用户已在本机观察到完整的Markdown匹配报告。返回形态：4266字符、正文首部为其他文字、没有左花括号/JSON围栏/think标签，解析失败为JSON_ENVELOPE。可读报告不等于程序已验证的结构化结果；正确性/完整性是用户观察，应用尚未走到来源和证据校验。

本轮用完全虚构资料生成4266字符、含一个无语言标记代码块的Markdown报告，回放只读提取的0.10.4发布版解析器：

```text
npx tsx .test-data/0.10.5-markdown-baseline.ts
0.10.4 released parser: AI_MATCH_JSON / JSON_ENVELOPE
字符数=4266；正文首部=其他文字；含左花括号=否；含JSON围栏=否；含think标签=否
Assertion failed: expected AI_MATCH_MARKDOWN, actual AI_MATCH_JSON
```

该脚本只使用.test-data内基线副本，未修改旧发行包。新回归在tests/matching.test.ts、tests/p10-p11-service.test.ts和tests/p10-p11.e2e.ts覆盖同一合成报告。它复现用户描述的返回形态与错误，不冒充获得了用户原始响应。

## 修复

1. 输出有Markdown标题或表格、没有对象左花括号和JSON围栏时，返回专用AI_MATCH_MARKDOWN / MARKDOWN_REPORT。消息由程序生成，不回显正文，不以中文关键词判断语义；损坏JSON提到“岗位要求报告”仍保持AI_MATCH_JSON。
2. parseMatch的严格结构/来源/连续原文/硬性资格检查保持。Markdown没有被猜测转换、算分、或写入正式匹配历史；原来成功结果不变。
3. 新增Chat Completions内部参数chatResponseJsonSchema，由主进程生成response_format.type=json_schema，json_schema包含name=career_match、strict=true及静态schema。原Chat匹配即使模型能力为supported也未发送此约束，本轮已补齐。
4. 只有保存的模型structuredOutput为supported且实际协议为Chat Completions才发送上述参数；Anthropic沿用output_config.format，Gemini匹配与Responses请求保持原样。能力未知/不支持不添加参数，不自动开启，不根据模型名称推断。
5. 静态schema不含姓名、岗位正文、简历、API Key或动态来源ID。schema约束类型与枚举；实际来源引用仍由本机验证。schema不是事实正确性保证。
6. 确认窗口展示Chat Completions JSON Schema、Anthropic原生JSON Schema或提示词JSON，设置说明同步。主进程重新计算模式，忽略渲染端强制模式；两种协议能力变化均使旧确认失效，重新设为unknown后均不发送Schema。
7. 提示词按模式提示有无供应商约束，并强调只返回JSON而非Markdown报告。应用不覆写用户自定义提示，不自动续写、格式转换收费调用或降级重试。
8. 专用Markdown失败也遵守既有临时预览授权：默认不保留，本次显式同意才保留，不持久化；错误对象不含正文，查看不重发。无同意、有同意、现有历史保护均有服务与桌面断言。

## 已验证 / 待验证

- 全量npm test：437/437通过；类型、格式、构建检查通过。新Chat HTTP测试验证实际线上请求形状（仅本机HTTP模拟，不是真实供应商）。
- 4266字符Markdown对旧解析器产生预期红结果，对新版产生AI_MATCH_MARKDOWN；服务断言四协议不重试/不新增历史、默认不保留、显式同意临时预览可用。
- Chat与Anthropic的schema启用/未知能力/旧确认失效、渲染端不能强制开启均验证；其余协议未附带Chat参数。
- 首次0.10.5包在后续源码改动后被逐文件一致性检查拒绝，未交付；已用当前构建重打包。旧测试不能冒充这次最终包测试。
- 最终重打包ASAR桌面回归5/5通过（6.7分钟）：四协议含4266字符Markdown专用诊断、不新增历史、临时预览、Chat/Anthropic模式与实际请求、取消/输出截断、输入隔离、重启；Gemini评分及四页/设置版本一致通过。功能证据为DOM/IPC/请求断言，开发Electron加载最终app.asar，不作为正式EXE调试或完整视觉验收。
- 最终重打包EXE隔离库启动/正常关闭两次通过；fuses、ASAR完整性、dist/dist-electron逐文件一致、无测试数据/脚本入包通过。Windows ZIP CRC和内含EXE/ASAR与win-unpacked哈希一致，源码白名单ZIP校验通过。
- 模型测试全部为本机模拟和虚构资料，不使用真实简历、密钥或付费模型。真实Claude请求是否遵守Schema仍待用户复测；未签名/干净电脑验收仍未关闭。

## 用户复测

1. 正常关闭旧版，完整解压0.10.5。资料和旧包不清空。
2. 保持原模型/协议/资料；如果供应商明确支持该接口的JSON Schema，在模型编辑页将结构化输出能力设为支持并保存。确认窗口应显示相应Schema模式，而不是提示词JSON。
3. 不确定支持情况时保持未知。没有Schema约束的模型仍可能返回Markdown；新版会明确报AI_MATCH_MARKDOWN，不承诺靠提示词就一定成功。
4. 如果确认框已显示Schema却仍返回Markdown，反馈协议、确认框模式、错误码即可。需要核对供应商/网关是否实际执行约束，不继续扩大解析器猜格式。
5. HTTP 400/422不必然表示网关不支持：也可能是模型、schema或其他参数不兼容。核对供应商支持说明；若确认不支持，将能力改回未知，只有用户再次确认后才重发。不要盲目连续重试或增加预算。
6. 无需发送简历、API Key或完整报告。P10/P11仍待最终用户验收，P12–P14不因补丁发布而关闭。
