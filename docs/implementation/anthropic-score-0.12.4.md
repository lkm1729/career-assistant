# 0.12.4 / Anthropic 原生评分流兼容修复与结构诊断

日期：2026-09-18。基线0.12.3。O3其他功能用户已确认正常，本轮仅处理Anthropic评分异常，不进入O4。
状态：本机兼容缺口已修复，桌面与发行验证完成；真实OpenLux问题待用户复测，根因尚未确认。

## 用户报告与已知边界

用户截图：模型ID `claude-sonnet-5`，Anthropic Messages，主机 `api.openlux.ai`，输出上限64000，temperature支持但未指定值，未启用reasoning_effort；文本探针曾成功但配置变更后已过期。图片能力是手动声明，不是图片探针已通过的证据。

本任务没有读取密钥、正式数据库或原始供应商响应，没有调用OpenLux或真实付费模型；模型名称仅作为供应商配置标识，不据此断言真实上游模型身份。没有改动用户配置、64000上限、温度或协议。

`AI_ANTHROPIC_STREAM_CONTENT_BLOCK_DELTA`覆盖多个拒绝分支；只凭该代码不能确定真实根因。之前7项合成对照证明文本流/标准thinking链可通过，五种异常均可返回相同代码。不能把同码模拟等同于真实响应复现。

## 可检验假设与原始红绿

1. 文本块出现合法引用元数据：旧代码将citations_delta当未知增量拒绝。
2. 空签名片段先到、非空有效签名随后到：旧代码在空片段上提前拒绝，即使最终链完整。
3. 代理块类型、索引、字段类型或顺序异常：应继续拒绝，不猜补正文，但需要分支级脱敏诊断。

失败回归：

```powershell
node node_modules/tsx/dist/cli.mjs --test tests/anthropic-delta-compat.test.ts
```

改前 `.test-data/anthropic-delta-red.log`：5项中4失败、1通过。前两种完整流及HTTP评分链失败于用户同款CONTENT_BLOCK_DELTA；诊断用例因缺少具体reason失败，危险流拒绝断言已通过。改后同一回归通过，另补元数据类型/畸形输入/顺序和评分服务回归。未修改原有Anthropic拒绝测试来迁就实现。

## 协议核对

2026-09-18读取Anthropic官方TypeScript SDK公开main版本（仅作研究参考，未安装新依赖）：

```text
https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/resources/messages/messages.ts
https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/lib/MessageStream.ts
```

本地参考：`.test-data/anthropic-sdk-messages-reference.ts`、`.test-data/anthropic-sdk-stream-reference.ts`。官方类型有citations_delta五种引用位置元数据；SDK对文本和引用分开处理。signature_delta的signature为字符串，SDK不使用“每个片段必须非空”的检查。空片段容忍是本次有限兼容策略，不声称官方承诺任何代理都会发送空片段，也不将SDK较宽松的整体状态机照搬进应用。

## 修复边界

生产逻辑只修改 `electron/anthropic.ts`：

- 文本块内的已知citations_delta：校验元数据对象、类型、字段类型/范围后丢弃；不会把引用正文追加到JSON，不请求引用URL、不将元数据保存或冒充已验证评分证据。实际score/match引用校验完全保留。
- thinking块可接收空signature_delta而继续等待；必须在content_block_stop前实际收到非空签名。空片段不算有效签名；开始签名后仍拒绝后续thinking增量，思考/签名不进入正文或历史。
- 继续检查块类型、索引、事件顺序、工具/拒绝、输出上限、UTF-8、字节/字符限制、end_turn及message_stop。仍不接受tool_use/input_json_delta、无签名thinking或截断正文。
- 不自动重试、不切换协议、不降低输出上限、不启用thinking、不新增远程访问或遥测。

这证明两个客户端兼容缺口已经修复；**尚未证明用户OpenLux失败属于这两个分支，也不能宣称真实问题已解决**。

## 脱敏结构诊断

保留原错误码，失败消息增加本地固定枚举：

```text
reason=BLOCK_TYPE_MISMATCH; phase=blocks; block=text; delta=thinking_delta;
index=same; text=missing; thinking=string; signature=missing; citation=missing
```

上述只是测试样例，不是用户真实响应。reason覆盖PHASE、NO_ACTIVE_BLOCK、INDEX_TYPE、INDEX_MISMATCH、DELTA_OBJECT、UNKNOWN_DELTA_TYPE、BLOCK_TYPE_MISMATCH、TEXT_TYPE、THINKING_TYPE、THINKING_AFTER_SIGNATURE、SIGNATURE_TYPE、CITATION_SHAPE。

未知远程类型统一显示other；不输出原始类型字符串、正文、思考、签名、凭证、URL、文件名、原始索引或长度，不抓完整响应，不新增诊断落盘/遥测。用户复测若仍失败，仅反馈这一行即可帮助继续定位；不需要Key或原始流。

## 验证

- 全部541项单元/服务通过：`.test-data/anthropic-delta-unit.log`。
- 类型/构建/格式通过：`.test-data/anthropic-delta-build.log`、`.test-data/anthropic-delta-format.log`。
- 新评分服务回归使用64000、用户相同模型ID但本机模拟服务器：文本/图像评分成功；不合法类型/索引、缺签名、截断、非法评分引用均不覆盖已有记录；每次授权只有一个请求，重开记录保持，敏感模拟内容不进入存储。
- 桌面12项全部通过（6.6分钟）：`.test-data/anthropic-delta-desktop.log`。范围为新Anthropic评分、Gemini/Anthropic原生旧流程、Gemini评分、O2/O3。不把O3那次54项全量通过冒充本版全量重跑。
- 最终ASAR五项全部通过（1.3分钟）：`.test-data/anthropic-delta-asar.log`。含新评分、O3、0.12.3隔离数据升级与离线字体。
- 实际加固EXE两轮离线启动/正常关闭/重开通过：`.test-data/anthropic-delta-exe-smoke.log`；开发Electron加载ASAR的UI与实际EXE启动分开记录。
- 最终ASAR与构建内容、fuses、完整性、离线字体/OCR/许可清单哈希通过：`.test-data/anthropic-delta-verify.log`。
- NSIS安装器/ZIP打包成功：`.test-data/anthropic-delta-package.log`。ZIP全部217文件SHA-256与解包目录一致：`.test-data/anthropic-delta-zip-verify.log`。发行哈希见release/0.12.4/SHA256SUMS.txt；安装器与EXE均NotSigned：`.test-data/anthropic-delta-signature.log`。

## 安全与交付

修改前备份：`.test-data/anthropic-delta-before-20260918-094139`。无Git仓库，仅只读差异自审，未提交/推送/重置；无子代理审查。研究与实验文件位于明确的.test-data目录，不打入发行包；生产代码没有临时DEBUG日志。

保留0.12.3及所有已保留发行目录，不修改正式数据库，不重复系统安装/卸载。未签名、独立干净Windows、第三方许可缺项与顶层许可证待定边界不变。

最终ASAR错误界面已视觉检查：同目录anthropic-score-0.12.4-diagnostic.png（仅合成故障截图）。结构诊断可读，历史评分仍显示；未捕获用户真实资料。

公开参考文件本地SHA-256（用于定位本次读取内容，不声称固定上游提交）：

```text
A6E07B35F1DAC56A343A9EEB3CAB19CD39676CA4B48FEB20EB3ABA4B5AC9C729  anthropic-sdk-messages-reference.ts
1B90FB2319A1D0241F782D034D80884FFDF061465E8EBA2A6B5F94B06236A0DE  anthropic-sdk-stream-reference.ts
```
