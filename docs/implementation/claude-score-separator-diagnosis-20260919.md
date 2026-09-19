# Claude简历评分 SEPARATOR_REQUIRED · 诊断记录

日期：2026-09-19。版本基线：0.13.2。用户确认功能/优化基本完成，新增反馈为Claude经Chat Completions或Anthropic Messages评分时出现AI_SCORE_JSON / shape=INVALID_SYNTAX / reason=SEPARATOR_REQUIRED，其他三页正常。

## 已确认与尚未确认

- 当前评分服务无论协议，都在streamModel返回文本后进入同一个parseScore/scoreJson/decodeScoreJson流程，再保存通过校验的结果。
- 报错发生在JSON语法阶段，尚未执行完整评分字段、引用证据与覆盖校验；界面中的“可能原因”是通用提示，不能据此确认引用不合法或协议失败。
- 本机最小实验表明：缺逗号、字符串中未转义引号、非法数字三个不同输入都会产生与用户逐字相同的报错。命令：`npx tsx .test-data/score-separator-diagnosis-20260919/probe.ts`；输出见同目录probe.log。
- 这只复现了报错路径，不是用户实际故障根因，也不是证明应该接受这些损坏JSON。不能把人为构造的非法样本变绿作为修复。
- 现有评分JSON/兼容/Anthropic评分服务等6个测试文件共46项通过（regression.log），不等于真实供应商验证。
- 当前ScoreConfirmation/ScoreBridge与score服务没有失败响应预览或留存入口；本轮没有读取正式AppData、Key、简历、真实剪贴板或响应，没有调用真实供应商。

## 当前阻塞与下一步

缺少一次实际失败的原始输出，无法判定是模型真实语法损坏、客户端文本组装错误或尚未覆盖的可确定格式偏差。遵循diagnosing-bugs：尚无针对用户真实缺陷的失败回归，不先猜测并放宽解析。

需要用户提供保留引号/反斜杠/逗号/换行的脱敏失败响应，或授权加入默认关闭、单次明确勾选后启用的失败响应本机诊断入口。后者需把含个人资料的原始输出与安全错误日志分开，不自动外传、不自动重试收费请求；收集实际证据后才确定修复范围与版本。

本轮仅新增隔离诊断文件与此记录；生产代码和版本未变，保持0.13.2。不宣称BUG修复，不生成无实质修复的Release。
