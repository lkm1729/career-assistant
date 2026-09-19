# P07 Anthropic Messages 原生适配器说明

核对日期：2026-09-15。范围仅为 `electron/anthropic.ts`、`tests/anthropic.test.ts` 与本说明；共享层、模型路由、UI 和桌面服务集成由主代理负责。

## 接口与请求映射

- 导出 `streamAnthropic(options: Parameters<typeof streamChat>[0]): Promise<string>`、纯请求体构建函数 `anthropicBody`、状态机 `AnthropicStream`。
- 原样使用主代理传入的 `options.endpoint`；不重写 `/v1/messages` 或代理前缀。仅 HTTPS 或本机 HTTP；禁止地址内凭证、查询参数、片段以及所有重定向。
- `POST`、`stream: true`，使用 `x-api-key` 和 `anthropic-version: 2023-06-01`，不使用 bearer。
- 顶部连续 system 消息转换为独立的 `system` 文本块数组；普通消息仅 user/assistant。拒绝中途 system，避免将它移动到顶层后改变语义。
- 图片仅允许 user 消息中的规范 `data:image/png;base64,...`、`data:image/jpeg;base64,...`、`data:image/webp;base64,...`，映射为 `image.source = {type: 'base64', media_type, data}`。拒绝远程 URL、GIF、其他媒体类型、空载荷、空白、非规范 padding 和超过限制的图片。不额外下载图片。
- `max_tokens` 必填：本应用默认 **4096**，不是服务端默认；有效范围为整数 1–1000000，实际模型上限由服务端决定。
- 仅传入有效参数中存在的 temperature，且本地验证有限数值 0–1；参数是否启用由共享层决定。具体模型可能进一步限制 temperature。
- 显式拒绝 reasoningEffort，不将它误映射为 thinking 或其他参数。请求体白名单不发送 tools、后台执行、服务端会话、store、stop_sequences 或缓存控制。

## 完成与安全边界

- 生命周期：一次 message_start → 顺序索引的 content_block_start/delta/stop → 一次 message_delta(end_turn) → message_stop。
- 只将 text_delta 交给 onText 并累积为结果；thinking_delta、signature_delta、redacted_thinking 不进入正文。thinking 块在 stop 前必须收到 signature_delta；本适配器不启用 thinking，也不保存或续传其历史。
- 文本块 start 必须为空；索引从 0 连续递增，不允许并行打开内容块、重复 stop、跨块 delta 或完成后的同批数据事件。未知事件（ping 除外）/内容块/增量类型均拒绝，不静默忽略潜在工具输出。
- 只有非空正文、正常 end_turn 和完整 message_stop 都成立才 resolve。stop_sequence 对应调用方提供的自定义停止串，本批不发送该参数，故也不接受该停止原因。
- max_tokens、tool_use、refusal、pause_turn、其他停止原因、错误事件、EOF 截断、非法 UTF-8 和结构损坏一律 reject。失败之前可能已经发送预览片段，但不会返回可持久化结果；最终保存仍由主代理服务层掌控。
- 支持 UTF-8 跨字节、LF/CRLF/CR 跨网络块、注释、ping、多行 data；不以 `[DONE]` 或 EOF 替代 message_stop。完整结束后取消读取，不要求服务端关闭 HTTP 连接；不继续监视结束后未来才送达的字节。
- 默认整次请求超时 120000 ms，ping 不延长超时。用户取消与回调失败都会拒绝结果并取消响应读取；无自动重试或断线恢复。
- 错误信息不回显服务端响应体、异常详情、地址、密钥或思考内容。HTTP 认证/限流/状态码有本地固定提示。

应用侧硬限制（十进制字节；字符数为 JavaScript UTF-16 code units）：

| 项目                            | 限制                           |
| ------------------------------- | ------------------------------ |
| JSON 请求体                     | 32000000 bytes（含 JSON 转义） |
| 每张解码图片                    | 5000000 bytes                  |
| 整个响应流                      | 4000000 bytes                  |
| 单个 SSE 事件/未完成帧          | 1000000 字符                   |
| 累积正文                        | 700000 字符                    |
| 输入消息                        | 1000 条                        |
| 每条输入消息内容块 / 输出内容块 | 1024                           |

图片检查覆盖 MIME 标签、规范 base64 和大小，不替代真实图片解码或具体模型视觉能力检查。未使用真实账号，也未验证实际模型的服务端限制。

## 官方协议来源与访问限制

尝试通过 web 工具获取官方 Messages/SSE 文档时没有返回内容；shell 请求以下官方页面均实际返回地区不可用页，**没有将这些跳转页当作已读协议正文**：

- `https://platform.claude.com/docs/en/api/messages`
- `https://platform.claude.com/docs/en/api/messages-streaming`
- `https://platform.claude.com/docs/en/build-with-claude/vision`
- `https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons`
- `https://docs.anthropic.com/en/docs/build-with-claude/streaming.md`

实际成功读取并交叉核对的一级来源为 Anthropic 官方 TypeScript SDK 源码（当次 main 快照）：

1. `https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/client.ts`
   - API-key 鉴权使用 `X-Api-Key`；默认版本头为 `anthropic-version: 2023-06-01`。
2. `https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/resources/messages/messages.ts`
   - Messages 请求与内容块类型、必填 max_tokens、base64 图片 source 类型。
   - RawMessageStart/Delta/Stop、RawContentBlockStart/Delta/Stop 事件及 thinking/signature 类型。
   - end_turn 是自然结束；stop_sequence 是命中调用方提供的自定义停止序列；max_tokens、tool_use、pause_turn、refusal 不能按普通完整正文接受。
   - signature_delta 在 thinking 块的 content_block_stop 前传递。

## 验证

- `tsx --test tests/anthropic.test.ts`：31/31 通过；全部使用纯函数或 127.0.0.1 模拟服务，密钥为假的测试常量。
- Anthropic、Chat Completions、Responses 三组回归：53/53 通过。
- Anthropic 两个 TypeScript 文件独立严格类型检查、当前全量 `tsc --noEmit`：均通过。并行 Gemini 测试落盘期间曾短暂出现外部 TS2322，最新复查已消失；本任务没有修改该文件。
- 三个指定交付文件的 Prettier 检查：通过。
- 覆盖请求白名单/默认值/数值约束、代理路径与请求头、图片限制、UTF-8 和三种换行逐字节分包、thinking 排除、非法索引与生命周期、异常停止/工具/截断/错误、字节和正文限长、所有常见重定向、超时及取消。
- 没有修改用户数据或执行 commit；未在此适配器任务运行桌面 E2E，桌面验收由主代理完成。
