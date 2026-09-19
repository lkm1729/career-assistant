# Anthropic 简历评分 CONTENT_BLOCK_DELTA：诊断中

基线：0.12.3。用户反馈其他O3功能验收正常；简历评分同模型在OpenAI Chat Completions下正常，在Anthropic Messages下稳定出现AI_ANTHROPIC_STREAM_CONTENT_BLOCK_DELTA。本条不代表已复现真实供应商根因，不进入O4。

## 当前证据

错误发生在electron/anthropic.ts的增量事件处理，早于electron/ai-service.ts的parseScore调用。多个结构/生命周期分支共享该错误码，原错误没有提供具体delta类型、活动块类型、索引关系或字段类型。

隔离实验位于.test-data/anthropic-score-diagnosis.test.ts，仅使用虚构数据，不接触正式配置、数据库或网络供应商。命令：

```powershell
node node_modules/tsx/dist/cli.mjs --test .test-data/anthropic-score-diagnosis.test.ts
```

7项诊断断言通过（.test-data/anthropic-score-diagnosis.log）：
- 完整text流携带评分JSON可通过流解析及评分校验，含Markdown加粗建议。
- 带thinking和非空signature后再输出text的评分可通过，思考/签名不进入正文。
- 错索引、非字符串text、text块中thinking_delta、空thinking签名、缺少block_start五种不同合成序列，均被拒绝为用户报告的同一个错误码，且没有最终结果。

这只是诊断碰撞/对照实验，不是对真实响应的重放，也不是已找到某种应接受却被拒绝的合法供应商变体。现有Anthropic及评分相关43项回归通过（.test-data/anthropic-score-existing-regression.log），不能据此否定用户可重复的问题。

## 尚缺信息与下一步

需要实际模型ID、供应商/代理名称或仅主机名、原生文本/图片探针已有测试结果。不索取Key、账号、简历或完整原始响应；不要求为了诊断额外发起付费请求。

若这些信息仍不足，请用户授权提供最小结构诊断：仅输出本地固定枚举的块/增量类型、字段类型及索引关系，不包括原始正文、thinking、signature值、供应商错误体或凭证。取得真实失败的结构后，建立失败回归，单变量修复并验证拒绝截断/乱序、历史保持等保护。

本轮仅新增隔离诊断测试/日志和本记录，未修改生产源码、测试主套件、版本号、发行包或正式数据库；未开启日志抓取、联网调用供应商、提交、推送、删除文件。当前状态：根因未确认，未修复，不发布猜测性兼容补丁。

## 2026-09-18 后续进展

用户提供配置截图并授权开始尝试修复。0.12.4已修复本机证明的两处流兼容缺口并增加固定枚举结构诊断，真实OpenLux根因仍待复测。详见 [0.12.4实施记录](anthropic-score-0.12.4.md)。以上为前一阶段历史记录，不以新增本机证据冒充真实供应商重放。

