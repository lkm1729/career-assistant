# 0.12.6 / Anthropic 空签名与评分 JSON 包裹兼容修复

日期：2026-09-18。基线：0.12.5。只处理 O3 原生评分阻塞，不进入 O4。

## 用户证据与结论边界

用户在两次独立评分中分别收到：

1. `AI_SCORE_JSON`：正文已进入评分解析，但不是可直接解析的 JSON。没有原文，不能确定是包裹说明、纯 Markdown、损坏或多个对象。
2. `AI_ANTHROPIC_STREAM_CONTENT_BLOCK_STOP`，结构诊断为 `reason=MISSING_SIGNATURE; phase=blocks; block=thinking; index=same; signature=empty-only`：**已确认客户端在当前 thinking 块收到空签名增量，却在块结束时强制要求非空签名。** 索引与阶段在这次失败中是正确的。

第二项已针对确认的分支修复；第一项修复了可复现的有限 JSON 包裹兼容缺口，但不冒称该缺口就是用户第一次失败的真实根因。没有读取正式 AppData、Key、简历或真实响应，没有调用真实供应商。模型 ID 只是本机模拟的配置标识，不证明上游模型身份。

## 红绿反馈回路

```powershell
node node_modules/tsx/dist/cli.mjs --test tests/anthropic-score-output-compat.test.ts
```

改前 4 项全部失败（`.test-data/anthropic-score-fix-red.log`）。空签名最小重现产生用户相同的 STOP 错误码及全部结构枚举；带短说明的完整 JSON 围栏最小重现产生相同 `AI_SCORE_JSON`。后二项验证新诊断与封装后仍进行证据校验。

假设与变量：
- 空签名元数据阻止纯正文消费：仅取消“已收到签名增量仍必须非空”的限制，即应可以关闭块，但缺正文/缺终止事件仍不能成功。
- 外层短说明导致 JSON 解析失败：仅移除明确单个闭合代码块的外层短说明，结果应与裸 JSON 完全相同。
- 真正语法损坏/截断/歧义多结果：有限封装处理应继续拒绝，且诊断不得包含正文。

改后定向解析器/评分/旧 Anthropic 测试通过。新增测试还覆盖转义字符串、CRLF、大小写 JSON 标签、BOM、无标签围栏、过长说明、未闭合围栏、数组包裹、双重编码与多个对象。最终全量单元/服务 556 项通过。

## 生产修改

### electron/anthropic.ts

- 允许已有 thinking 块中的 `signature_delta.signature` 为字符串 `""`，并在相同 index 的 STOP 正常关闭块。
- 这是**仅消费正文、不保存/回传 thinking 的客户端兼容策略**，不是宣布空签名可用于后续思考回放，也不是对密码学签名真实性的验证。
- 非字符串签名、签名出现在错误块、错误索引、重复 STOP、签名之后再到 thinking 增量仍拒绝。
- 完全缺少签名阶段事件且起始块没有非空签名，仍按原有限策略拒绝；本轮不扩大到未经证实的所有流变体。
- thinking、签名和引用元数据不进入正文回调或历史；完整性仍依赖正确生命周期、非空文本、正常 `end_turn` 和 `message_stop`。
- 未启用 thinking，未改变模型/协议/温度/输出上限，未增加重试或请求。

### electron/scoring.ts

- 评分解析采用岗位匹配已有的有限 envelope 规则；未改动岗位匹配本身。
- 接受裸 JSON，或唯一一个完整闭合的 JSON/无标签代码块。
- 块外说明合计最多 1000 字符且不得含其他结构标记；不搜索任意大括号，不选择多个候选，不补全 JSON，不解包双重编码。
- 单纯标准 JSON 代码围栏原本已支持，不将其误称为本轮新增兼容；改的是前后简短说明以及原先剥离围栏时未要求配对闭合的问题。
- 提取后仍执行完整四维、分值、来源、原文引用、图像覆盖和总分规则。无图像不冒充完整评分。
- 失败时固定类别 `JSON_NOT_DOCUMENT` / `JSON_SYNTAX` / `JSON_FENCE_COUNT` / `JSON_FENCE_FORMAT` / `JSON_ENVELOPE`，保留 `AI_SCORE_JSON`；不返回原始输出。
- 不强制新供应商参数或静默切换协议，保留工作区已有的其他接口实现。

## 服务/桌面验证范围

本机 HTTP fixture 使用假 Key、虚构 TypeScript 简历、用户同名模型 ID 与 64000 输出上限。

- 单独空签名、单独围栏说明、两者同时出现均可生成经过校验的评分。
- 图像评分也覆盖空签名+围栏组合；原生图像能力声明不是用户真实供应商探针成功的证明。
- 错误索引/类型、完全缺签名阶段、缺 message_stop、max_tokens、不完整 JSON、多个 JSON、伪造引用仍失败。
- 每次确认只产生一个 HTTP 请求，无自动重试；失败不覆盖旧记录，busy 释放，重开评分存储保留历史。
- 界面定向用例覆盖两种成功组合、DELTA/STOP/JSON 错误、继续评分和重启恢复。

## 本轮证据

- 备份：`.test-data/anthropic-score-fix-backup-20260918-104504`（只供本地回退比较，不打包）。
- 红测：`.test-data/anthropic-score-fix-red.log`；定向绿测：`.test-data/anthropic-score-fix-green.log`。
- 服务：`.test-data/anthropic-score-fix-service.log`。
- 全量 556 项通过：`.test-data/anthropic-score-fix-unit.log`。
- 类型/构建/全仓格式通过：`.test-data/anthropic-score-fix-build.log`、`.test-data/anthropic-score-fix-format.log`。
- 定向桌面 8 项通过（5.5 分钟）：`.test-data/anthropic-score-fix-desktop.log`。包含本轮 Anthropic、4 个原生协议用例、2 个 O3 展示用例及 Gemini 评分；不冒充全量桌面回归。
- NSIS/ZIP 打包成功：`.test-data/anthropic-score-fix-package.log`。打包使用 `--config.npmRebuild=false` 保持已安装依赖不变，避免并行桌面测试时重建依赖；未修改依赖版本。
- ASAR 与当前构建逐文件匹配、fuses、内嵌完整性与离线资源验证通过：`.test-data/anthropic-score-fix-verify.log`。
- ZIP 全部 217 个文件 SHA-256 与 win-unpacked 一致：`.test-data/anthropic-score-fix-zip-verify.log`。发行哈希见 `release/0.12.6/SHA256SUMS.txt`。
- 安装器及 EXE 均为 NotSigned：`.test-data/anthropic-score-fix-signature.log`。未进行安装器安装/升级和独立干净机测试。
- 最终 ASAR 定向评分 UI 1 项通过（45.6 秒）：`.test-data/anthropic-score-fix-asar.log`。由测试 Electron 加载最终 ASAR；不冒充加固 EXE 的 UI 自动化。
- 实际加固 EXE 两轮离线启动、正常关闭/重开通过：`.test-data/anthropic-score-fix-exe-smoke.log`。
- 最终 ASAR 成功界面与安全 JSON 错误截图：`docs/implementation/anthropic-score-0.12.6-success.png`、`docs/implementation/anthropic-score-0.12.6-json-diagnostic.png`（虚构本机接口数据）。截图前等待按钮恢复和两个渲染帧，避免捕捉上一帧忙碌态。

## 剩余边界

真实供应商仍需用户在相同配置下复测。若继续出现 `AI_SCORE_JSON`，只需反馈新的固定分类，无需正文或 Key。若是纯自然语言、非法 JSON 或歧义多结果，本版会继续安全失败，而不是编造完整评分。

旧发行保留；无 git commit/push/reset。历史 0.12.4/0.12.5 文档描述的是当时规则，本文件明确取代“空签名增量最终仍必须非空”的旧策略。独立干净机、签名与许可缺口不在本轮关闭。


