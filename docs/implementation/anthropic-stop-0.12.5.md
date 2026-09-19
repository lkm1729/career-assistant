# 0.12.5 / Anthropic CONTENT_BLOCK_STOP 分支诊断版

日期：2026-09-18。基线：0.12.4。仅处理 O3 原生评分故障，不进入 O4。

## 状态与结论

**真实供应商问题尚未定位或修复。** 用户反馈 0.12.4 的错误从 CONTENT_BLOCK_DELTA 变为 CONTENT_BLOCK_STOP。没有真实流的脱敏结构证据，不能把同错误码的本地模拟当作真实根因。

本轮确认并修复的是可观测性缺口：STOP 把阶段错误、无活动块、无效索引、索引不匹配、thinking 缺非空签名合并为同一错误，且没有 DELTA 已有的分支诊断。0.12.5 保持原解析接受/拒绝规则，只补齐分支诊断，不以放宽完整性校验掩盖故障。

没有读取生产数据库、密钥或简历，没有调用真实供应商，没有改动协议、模型 ID、64000 输出上限或其他用户配置。没有 Git 操作或删除旧发行。签名存在性校验不等于客户端对密码学签名进行真实性验证。

## 假设和反馈回路

按优先级检查：
1. thinking 块未收到非空签名：只补入非空签名，应可正常关闭该块；仍需要后续正文和完整结束事件才能返回结果。
2. STOP 索引不合法或不匹配：仅修正索引，应可关闭已有块。
3. STOP 重复或无对应开始事件：仅恢复完整的块生命周期，应可关闭块。
4. STOP 在 message_start 前或 end_turn 后到达：恢复阶段顺序，应消除阶段错误。

本机评分服务原回归先通过，确认 unsigned 模式能复现同错误码并保留旧记录；这不是供应商复现。新增最小化 parser 对照测试 11 项，改前 9 项因缺少分支诊断失败、2 项正常流对照通过；改后全部通过。

```powershell
node node_modules/tsx/dist/cli.mjs --test tests/anthropic-stop-diagnostic.test.ts
```

原始红/绿日志位于 `.test-data/anthropic-stop-red.log` 与 `.test-data/anthropic-stop-green.log`。本轮修改前文件备份位于 `.test-data/anthropic-stop-backup-20260918-101823`。该目录仅是本地诊断证据，不打入发行包。

## 脱敏诊断约定

例如（**本地模拟样例，不是用户真实响应**）：

```text
reason=MISSING_SIGNATURE; phase=blocks; block=thinking; index=same; signature=empty-only
```

- reason：PHASE、NO_ACTIVE_BLOCK、INDEX_TYPE、INDEX_MISMATCH、MISSING_SIGNATURE。
- phase/block：解析器本地枚举。
- index：invalid、no-active、same、different；不输出原始索引。
- signature：not-applicable、not-started、empty-only、nonempty；不输出签名或长度。not-started 表示尚未开始签名阶段，empty-only 表示已收到签名增量但未收到非空签名。
- 只在既有错误 UI 返回固定枚举；不抓取/写入原始流、不增加遥测。

事件名称不匹配、JSON 损坏、message_stop 后出现额外事件等仍沿用原 FRAME/其他阶段诊断，未扩大为通用事件记录器。

## 未改变的保护

仍要求块类型/索引/顺序正确、非空签名（thinking）、正常 end_turn 与 message_stop；截断、工具块、拒绝、超限与非法评分引用仍然失败。失败不保存评分，不覆盖已有历史。无自动重试、无静默协议切换。思考/签名不进入正文回调或评分记录。

## 下一步所需最小证据

用户使用 0.12.5 保持相同配置，复现一次简历评分，反馈错误码和结构诊断一行即可。不需要 Key、简历、思考内容或原始响应。若是 MISSING_SIGNATURE，再针对该已确认分支评估文本消费场景的兼容策略，而非现在猜测性地删除检查。

## 验证记录

- 单元/服务：552 项通过，`.test-data/anthropic-stop-unit.log`。
- 类型/构建/全仓格式检查通过，`.test-data/anthropic-stop-build.log`、`.test-data/anthropic-stop-format.log`。
- 本轮定向桌面：1 项通过（30.4 秒），覆盖评分成功、DELTA/STOP 诊断显示、一次确认一个请求、失败保留历史、正常再次评分及重启恢复。`.test-data/anthropic-stop-desktop.log`。未声称全量桌面重跑。
- 最终 ASAR 定向桌面 1 项通过（28.2 秒），`.test-data/anthropic-stop-asar.log`。由测试 Electron 加载发行 ASAR，不等同于加固 EXE 的 UI 自动化。
- 实际加固 EXE：两轮隔离离线启动、正常关闭与重开通过，`.test-data/anthropic-stop-exe-smoke.log`。
- 安装器和 ZIP 打包通过，`.test-data/anthropic-stop-package.log`；最终 ASAR/构建匹配、fuses、内嵌完整性、离线资源及许可清单验证通过，`.test-data/anthropic-stop-verify.log`。
- ZIP 全部 217 文件 SHA-256 与 win-unpacked 一致，`.test-data/anthropic-stop-zip-verify.log`。安装器/ZIP 哈希在 `release/0.12.5/SHA256SUMS.txt`。
- 安装器与实际 EXE 均为 NotSigned，`.test-data/anthropic-stop-signature.log`。未执行安装器安装/升级测试或独立干净机测试。
- 截图 `docs/implementation/anthropic-stop-0.12.5.png` 已目视检查，诊断行可读、无敏感模拟内容；截图来自本地虚构接口。

既有独立干净机、签名与许可缺口未在本轮关闭。

