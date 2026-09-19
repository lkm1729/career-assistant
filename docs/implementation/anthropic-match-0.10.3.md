# 0.10.3 · Anthropic匹配JSON兼容与可选结构化输出

日期：2026-09-16。基线0.10.2；旧发行目录完整保留。不迁移、不清空正式数据库。

## 症状与复现边界

用户确认Gemini原生匹配可用；Anthropic Messages返回AI_MATCH_JSON / response — 不是完整JSON对象。错误已到业务文本解析阶段，而非证据校验或探针连通性阶段。

未取得真实供应商响应、真实简历或API Key，未调用付费模型。以虚构资料在本机模拟Anthropic SSE，返回“说明文字 + 完整JSON代码块”，经真实服务入口复现相同AI_MATCH_JSON。

```text
npx tsx --test tests/match-json-envelope.test.ts tests/p10-p11-service.test.ts
旧实现：18 tests / 13 pass / 5 fail
```

五项失败包括两种完整代码块包装被拒绝、未闭合围栏被错误接受、包装导致未能进入证据校验、Anthropic服务链被通用JSON失败阻断。确认的是代码兼容性缺口，不能宣称已确认用户Claude实际响应也是同样包装。

## 修复范围

1. 匹配JSON解析首先尝试严格JSON。失败时仅兼容唯一、闭合、类型为json或无语言标记的Markdown代码块；大小写JSON和CRLF测试覆盖。
2. 代码块前后说明合计最多1000字符，不能包含花括号、方括号、反引号或尖括号。不搜索任意花括号、不从多个结果挑选、不去除推理/XML标签、不修补尾逗号/截断/错误转义、不把字符串套JSON自动解包。
3. 提取后仍执行完整字段、来源用途、连续原文、正向状态证据及硬性资格检查。多个代码块、未闭合围栏、额外结构、损坏JSON、虚构证据全部拒绝。
4. AI_MATCH_JSON保留，增加仅由程序生成的子类：JSON_SYNTAX、JSON_NOT_DOCUMENT、JSON_FENCE_COUNT、JSON_FENCE_FORMAT、JSON_ENVELOPE。不返回JSON.parse原始异常，不输出原始响应、引用原文或密钥。
5. Anthropic匹配仅当实际协议为anthropic且模型structuredOutput标记supported时发送output_config.format.type=json_schema及静态Schema。其他模式不新增参数；不按模型名称猜能力，不开启工具，不自动重试/降级。
6. Schema不包含本次材料ID、姓名、简历正文或证据；这些仍只在用户确认的消息材料内。格式约束不代替本机证据验证。
7. 确认窗口展示Anthropic原生JSON Schema或提示词JSON，设置说明同步。主进程根据当前持久化模型配置重新决定模式，忽略渲染端伪造模式；能力变更使旧确认失效，发送前拒绝。
8. Gemini请求参数、Anthropic流完成规则保持不变。原生思考/签名块不混入文本；多文本块拼接经流式回归验证。max_tokens截断、无end_turn/message_stop仍拒绝。

## 参数依据与访问限制

上轮通过公开文档网页核对时，当前网络被重定向到地区不可用页，不能将HTTP 200当成文档获取成功。随后只读获取Anthropic官方SDK：

```text
https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/resources/messages/messages.ts
```

本地只读核对副本位于.test-data/0.10.3-anthropic-sdk.ts（不进入发行包）。Messages流式示例、JSONOutputFormat、OutputConfig及MessageCreateParams确认参数形式。这不是对用户模型ID或中转服务能力的验证；没有宣称任意Claude模型都支持。

## 验证

- 上轮修复后全量428/428单元/协议/服务测试，类型、格式、构建通过；续作再次运行428/428测试及类型/格式检查，全部通过。
- 覆盖：带说明JSON、未闭合/多份结果拒绝、原文证据检查、安全错误、思考过滤、多文本块、Schema白名单、未知能力不发送、渲染端不能强制启用、能力变更拒绝旧确认、失败不重试/不写历史。
- 最终ASAR与当前dist/dist-electron逐文件一致，fuses/完整性/版本0.10.3/无测试资料入包检查通过。
- 正式EXE以独立测试库启动/正常关闭两次通过。Windows签名状态NotSigned；未完成干净电脑验收。
- 最终ASAR桌面回归5/5通过（4.4分钟）：Chat Completions、Responses、Gemini、Anthropic四协议P10/P11场景，以及Gemini评分/全页设置版本一致性。
- Anthropic桌面场景验证带说明JSON代码块可成功保存、确认框显示原生JSON Schema且实际请求携带相应字段；四协议损坏JSON显示AI_MATCH_JSON/JSON_SYNTAX、无自动重试且不新增历史，取消、输出截断、输入隔离、重启恢复保持。
- 桌面回归使用开发Electron加载最终app.asar，以DOM/IPC/请求断言为功能证据；截图不作为本轮独立视觉验收结论。正式发行EXE启动测试另行执行，不启用调试接口。
- Windows ZIP CRC通过，ZIP内EXE和ASAR与win-unpacked逐文件哈希一致；源码采用明确目录白名单，无.test-data、node_modules或旧发行包混入。

## 用户验收

正常关闭旧版，完整解压0.10.3，运行目录内Career Assistant.exe。先保持原Anthropic设置重试匹配；若供应商明确支持JSON Schema，可在应用设置的对应模型中把“结构化输出能力”标记为支持并保存，检查匹配确认框显示Anthropic原生JSON Schema再确认发送。

若接口拒绝output_config，不要连续重试或盲目增加预算；将能力改回未知后由用户重新确认。应用不会自动降级重发。

若仍报AI_MATCH_JSON，请仅反馈版本、实际协议、确认框输出模式、完整错误码及JSON_*子类。无需发送简历、API Key或完整模型响应。仍保留真实Claude复测为待用户验收，不提前关闭P10/P11。
