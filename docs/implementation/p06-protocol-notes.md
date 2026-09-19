# P06 Gemini 原生协议适配器：协议依据与兼容边界

核实日期：2026-09-15。仅实现 `electron/gemini.ts` 与 `tests/gemini.test.ts`；endpoint、模型路径、共享参数策略、UI、存储和集成由主代理负责。

## 官方协议依据

本次 web 工具未返回可用正文，改用 PowerShell `Invoke-WebRequest` 只读获取以下 Google 官方页面，响应均为 HTTP 200。未传入真实 API key，未调用生成接口。以下为字段与含义的归纳，不是逐字引用。

| 官方页面                                                                                                                   | 核实内容                                                                                                                                              | 本实现对应                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [GenerateContent / streamGenerateContent](https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent) | POST `v1beta/{model=models/*}:streamGenerateContent`；官方流式 REST 示例使用 `alt=sse`；返回 `GenerateContentResponse`                                | 直接使用共享层给出的完整 endpoint，POST JSON，接收 SSE；不另拼模型路径，不加 OpenAI `stream`/`model` 字段                   |
| [API keys](https://ai.google.dev/gemini-api/docs/api-key)                                                                  | 官方 REST 示例使用 `x-goog-api-key` 头，密钥应保密                                                                                                    | 仅通过该头发送密钥；不加 query key、Bearer 或日志                                                                           |
| [Content / Part / Blob](https://ai.google.dev/api/generate-content#v1beta.Content)                                         | `contents` 表示会话；`systemInstruction` 当前只支持文本；Part 支持 `text`、`inlineData`、工具等不同数据类型，内嵌媒体有 MIME 和 base64 数据           | system 文本按序合并到 `systemInstruction.parts`；user/assistant 分别映射为 user/model；图片仅映射为 `inlineData`            |
| [Part](https://ai.google.dev/api/generate-content#Part)                                                                    | `thought` 表示该片段是否为思考；`thoughtSignature` 是可用于后续请求的不透明签名；它与文本数据是不同字段                                               | 仅隐藏 `thought: true` 的文字；签名附在正常文本上时仍输出该正常文本，但绝不输出签名；带标记的原片段留在 JavaScript 私有字段 |
| [GenerateContentResponse / Candidate / FinishReason](https://ai.google.dev/api/generate-content#GenerateContentResponse)   | 响应有 candidates、promptFeedback、usageMetadata、modelVersion、responseId；candidate 有 index 和 finishReason；STOP 与 MAX_TOKENS、SAFETY 等含义不同 | 只接收单个 index 0；只允许 STOP；阻断、错误、工具、身份变化和不完整输出均拒绝                                               |
| [GenerationConfig / ThinkingConfig](https://ai.google.dev/api/generate-content#GenerationConfig)                           | `temperature`、`maxOutputTokens`、`candidateCount`；thinkingBudget 与 thinkingLevel 是不同配置，thinkingLevel 支持情况与模型代际有关                  | 温度/输出上限直接映射；candidateCount 固定 1；reasoningEffort 防御性拒绝，不猜测转换到任何 thinking 配置                    |

注意：生成接口页面部分历史 shell 示例仍把 key 放在 query 中；本项目遵循 API key 页面头部传递方式及安全要求，不复制示例中的 query key。

## 接入接口

```ts
export async function streamGemini(options: Parameters<typeof streamChat>[0]): Promise<string>;
```

另导出 `geminiBody`（无网络的请求体构造与校验）和 `GeminiStream`（帧解析状态机）。适配器不写文件、不接触用户数据或正式版本。`onText` 仅供临时预览；共享层必须仅在 Promise 成功且正文通过现有业务校验后保存。

## 安全与完成门槛

- 沿用适配器安全边界：默认 120 秒总体超时、用户取消与超时合并、`redirect: manual`、精确 SSE media type 检查、最多 4,000,000 响应 reader 字节（含思考、注释、元数据与 STOP 后数据）、最多 700,000 正文 UTF-16 code units。
- HTTP/流内错误、格式异常、连接和 UTF-8 异常只返回固定的本地 `AiError`，不把远端错误正文、finishMessage、URL、密钥或原始网络异常复制到错误中。
- SSE 支持 LF、CRLF、裸 CR、跨 read 换行与 UTF-8 字节切分、首部 BOM、多行 data、注释与无数据的心跳。文本使用 fatal UTF-8 解码，EOF 时 flush decoder；截断的尾字符/尾帧不能充当成功。
- 只有单个 **显式数字 `index: 0`** 候选、非空可见正文、正常 `finishReason: STOP`，并且继续读到 **完整 EOF** 且未出现尾部错误/身份冲突/新候选时才返回。STOP 可以与最后正文同帧或单独出现。
- STOP 后只允许合法元数据/心跳；流一直不关闭会超时失败。这样不会因提前退出而丢掉尾部错误；不是 Google 官方额外规定，而是本应用的保守完整性策略。
- responseId/modelVersion 缺省时兼容；一旦出现则必须非空且以后出现时保持一致。允许实际 modelVersion 与用户请求别名不同，不把它误判为换模型。响应 Content.role 可缺省，若出现则必须为 model。
- 显式多候选、重复 index 0、缺 index、非 0、字符串 index、STOP 后 candidate、任何非 STOP finish、`[DONE]`、EOF 无 STOP、只有思考、只有空白文本均失败。
- 在发布同一帧的任何正文前，先完整检查该帧所有 parts 与 finishReason。拒绝工具调用/返回、代码执行、拒绝标记、阻断及不支持的非正文输出；思考标记不能掩盖工具。候选/内容/响应包络内错误放置的工具字段也拒绝。
- 思考/签名仅保存在 `#markedParts` 私有内存；不公开 getter，不放入回调、返回值、可枚举对象或错误。原始 parts 不用于本批多轮签名回放。`thoughtSignature` 本身不等于 `thought: true`。

## 有意限制

- 仅接受 system/user/assistant 输入，拒绝 developer、tool、function、model 等未知或工具角色。
- systemInstruction 仅文本。user/assistant 可包含文本和图片；仅接受大小写精确的 `data:image/png;base64,...`、`data:image/jpeg;base64,...`、`data:image/webp;base64,...`。要求规范标准 base64（含正确 padding、无空白/URL-safe 字符、回编码一致）；不发请求取远程图片。
- MIME/data URL 与 base64 校验不是图像解码器，不保证载荷确实是一张可解码图片；实际图片有效性由既有输入处理及服务端负责。远程 URL、file URL、GIF、SVG、jpg 别名、附加 MIME 参数等拒绝。
- 不实现 Files API、远程媒体、音频/视频、函数调用、代码执行、grounding、输出图片、多候选、自动重试、SDK 对话历史或缓存。
- 输出 Part 只接受 `text`、`thought`、`thoughtSignature`；未知字段（包括尚未支持的 partMetadata）失败，不默默忽略可能影响语义的输出。
- 不添加 JSON MIME/schema 强约束；输出最终仍交现有业务正文解析器验证。不会修改模型默认安全设置。
- 即使共享层已拒绝 reasoningEffort，此处仍保留防御性校验；不配置 thinkingBudget、thinkingLevel 或 includeThoughts。
- endpoint 与协议/主机白名单由共享层提供与校验。适配器不会尝试重建路径或放宽共享层 URL 安全策略。

## 验证

所有生成流测试使用 Node `http.createServer` 绑定 `127.0.0.1` 临时端口；只使用假密钥。重定向目标也为本机 mock，并验证目标未收到请求。未使用真实用户文件或 paid API。

执行的命令（只进行本机测试和类型检查）：

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\tsx.cmd --test tests/gemini.test.ts
.\node_modules\.bin\tsx.cmd --test tests/gemini.test.ts tests/chat.test.ts tests/responses.test.ts
.\node_modules\.bin\prettier.cmd --check electron/gemini.ts tests/gemini.test.ts docs/implementation/p06-protocol-notes.md
```

桌面/UI/正式存储回归由主代理并行执行，本适配器测试不代替桌面验收，也不声称已验证真实 Gemini 模型可用性。

最终本机验证结果：Gemini 专项 **191/191** 通过；Gemini + Chat Completions + Responses 兼容回归合计 **213/213** 通过；全项目 `tsc --noEmit` 与上述三个改动文件的 Prettier 检查通过。
