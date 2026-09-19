# 0.12.7.1 / 评分 JSON INVALID_SYNTAX 热修复

日期：2026-09-18。基线：0.12.7。用户反馈其他报错已基本恢复，本轮只处理评分 JSON 语法兼容及要求的四段版本号，不进入 O4。

## 用户证据与结论

用户报告 `AI_SCORE_JSON`、单个闭合代码块内 `shape=INVALID_SYNTAX`。该 shape 只说明旧扫描器没有发现引号/括号未闭合，**不能唯一确定具体语法错误**。未取得或读取真实供应商响应；没有读取正式数据库、Key、简历，未调用真实供应商。

本轮发现并修复三类明确的客户端兼容缺口：完整对象的尾随逗号、字符串值中直接出现 CR/LF/TAB、字符串外完整 JSONC 风格注释。这三类均用完整评分 fixture 复现了用户同码、同 shape。不能把合成复现等同于用户原始响应已确认属于这三类。

## 红绿诊断

```powershell
node node_modules/tsx/dist/cli.mjs --test tests/score-json-hotfix.test.ts
```

- 改前 5 项全部失败，前三项及组合均出现用户同款 `JSON_SYNTAX...shape=INVALID_SYNTAX`；第5项在JSON阶段提前失败而非进入证据校验。`.test-data/score-json-hotfix-red.log`。
- 改后同5项全部通过；输出字段/数值/文本与严格JSON基线逐项相同，唯一增加的是固定规范化说明。`.test-data/score-json-hotfix-green.log`。
- 39 项聚焦回归通过，含旧结构诊断、评分服务、词法/语法拒绝边界：`.test-data/score-json-hotfix-focused.log`。

事先假设：尾随逗号；直接写入换行/制表符；夹带注释；存在真实缺值、漏引号、重复字段等歧义。前三类仅处理格式，第四类继续失败，不能猜补结果。

## 实现

新增 `electron/score-json.ts`：有明确语法与深度/长度上限的本地解析模块，只供评分使用。没有引入通用 JSON 修复库、eval、远程修复调用或自动重试。

允许的偏差：

- `TRAILING_COMMA`：非空对象/数组的最后一个真实条目后多出一个逗号。
- `STRING_CONTROLS`：双引号字符串**值**内部的原始换行、回车、制表符，解码值保持完全一致，不删除、不替换为空格；字段名中原始控制字符不做兼容。
- `COMMENTS`：字符串外 `//` 行注释或闭合 `/* ... */` 注释。只作为词法空白，不解释内容，不存储到结果、不执行指令。

边界：

- 不补引号、冒号、逗号、括号，不推断缺失字段或值，不选择多个候选结果。
- 数组空洞、未闭合注释、单引号/无引号字段、非法转义、缺分隔符、缺值、重复字段均拒绝。
- 重复字段按**解码后的键**识别，因此 `a` 与 `\u0061` 也不能产生“最后一个值覆盖前一个值”的歧义。
- 正文中的 URL、注释样式文本、`,}`/`,]`、反斜杠和 Unicode 按字符串保留。
- `__proto__` 使用自有数据属性构建，不触发原型 setter。
- 700000 字符与64层嵌套上限，非有限数值拒绝；无截断或补全。
- 既有单一闭合围栏/有限外层说明策略不变；多个代码块/多个JSON/双重编码等仍拒绝。

`electron/scoring.ts` 在语法解码后仍执行四维、数值、来源、原文引用、图像覆盖与总分规则。成功报告的 warnings 增加固定说明，例如 `COMMENTS, STRING_CONTROLS, TRAILING_COMMA`，不会隐瞒兼容处理。不合格引用不会因语法规范化而变成合格。

提示词继续要求严格 JSON（无注释、无尾随逗号、无重复字段、正确转义），兼容仅为响应端兜底，不鼓励供应商返回非严格格式。

仍失败时，在既有 shape 后附加安全枚举 `reason=SEPARATOR_REQUIRED|INVALID_ESCAPE|DUPLICATE_KEY|...`。不使用包含正文片段的原生 JSON.parse 错误文本，不新增原始响应落盘或遥测。shape 仍是粗略结构迹象，reason 是此次语法解析器失败位置的固定类别。

## 保持不变

本轮没有修改 Anthropic 流解析、空签名兼容、10分钟总时限/2分钟无数据时限、短来源映射、原生Schema路由、供应商参数、模型ID或资料选择规则。不会自动重试。其他页面材料仍独立。坏响应/坏引用不保存结果、不覆盖历史。

唯一相关测试维护：全量并发执行时，原100ms本机空闲测试曾在HTTP首包到达前抢先超时，错误地期望THINKING而实际仍是CONNECTING。测试等待阈值改为500ms（总上限5秒），心跳成功测试仍明确跨过空闲阈值；没有更改生产时限。该维护不是本轮功能修复依据。

## 版本 0.12.7.1

对外版本/界面/发行目录/文件名为 **0.12.7.1**。内部 npm package/lock 的版本为 `0.12.7+1`；用户版本统一取 `build.buildVersion=0.12.7.1`，Windows buildNumber=1。

`npm run package` 使用 `scripts/package-win.mjs`：调用现有 electron-builder API，通过 effectiveOptionComputed 对 NSIS 的 VERSION 和 ProductVersion 文本使用公开四段版本。不修改 node_modules，不绕过签名或完整性保护，不在打包后篡改 EXE。文件版本与数值产品版本由 buildVersion/buildNumber 正常生成。

版本回归验证界面、release目录、artifact宏、package/lock映射、NSIS品牌/注册表版本输入。第三方许可清单中的产品版本使用公开版本。打包仍 publish never、npmRebuild=false；未变更依赖。

## 验证记录

- 全量 **603 项**通过：`.test-data/score-json-hotfix-unit.log`。
- 类型/构建/全仓格式通过：`.test-data/score-json-hotfix-build.log`、`.test-data/score-json-hotfix-format.log`。
- 严格 JSON 差分包含150组固定种子的生成样例及转义/原型样式字段，解码结果与 JSON.parse 一致；另有27个明确畸形输入拒绝用例。
- 本机 HTTP 评分服务覆盖三种偏差、组合、图像评分、规范化后仍拒绝假证据、原历史保持、一次授权一次请求及重开。
- 定向桌面 **4 项全部通过**（2.4 分钟）：`.test-data/score-json-hotfix-desktop.log`。覆盖四种格式成功、规范化说明、歧义语法和假引用仍拒绝、单次请求与重开、O3 展示、Gemini评分/四页版本。未重跑全量桌面。
- 最终 ASAR **3 项通过**（1.4 分钟）：`.test-data/score-json-hotfix-asar.log`。使用测试 Electron 加载最终 ASAR；从保留的0.12.7 ASAR创建隔离数据，再打开0.12.7.1，历史/虚构加密Key保留；离线字体四页验证通过。不是正式AppData升级，也不是安装器安装测试。
- 实际加固 EXE 两轮离线启动/正常关闭/重开通过：`.test-data/score-json-hotfix-exe-smoke.log`。
- NSIS/ZIP构建成功：`.test-data/score-json-hotfix-package.log`。安装器和实际EXE的 FileVersion、ProductVersion **全部为0.12.7.1**：`.test-data/score-json-hotfix-windows-version.log`。
- 最终ASAR与构建逐文件一致、内嵌完整性/fuses/离线资源/许可清单验证通过：`.test-data/score-json-hotfix-verify.log`。验证脚本按builder移除build配置的实际行为检查package内部版本到公开版本的映射；UI版本通过最终ASAR实测。
- ZIP全部 **217 文件** SHA-256匹配win-unpacked：`.test-data/score-json-hotfix-zip-verify.log`；发行哈希见 `release/0.12.7.1/SHA256SUMS.txt`。
- 安装器/EXE均NotSigned：`.test-data/score-json-hotfix-signature.log`。没有运行安装器，没有独立干净机验收。
- 截图 `docs/implementation/score-json-hotfix-0.12.7.1-success.png` / `score-json-hotfix-0.12.7.1-diagnostic.png` 来自虚构本机接口；成功界面已目视检查，显示规范化说明和0.12.7.1版本。

## 文件与回退

修改前备份：`.test-data/score-json-hotfix-backup-20260918-121718`。诊断与虚构测试数据不打入发行。无 git commit/push/reset，未删除旧发行，未修改正式 AppData。

新增：`electron/score-json.ts`、`tests/score-json-hotfix.test.ts`、`tests/score-json-grammar.test.ts`、`scripts/package-win.mjs`及类型声明。修改评分入口、相关fixture/测试、版本与许可/发行验证脚本。没有更改匹配/求职信的解析规则。

## 验收边界

本轮确认解决的是上述三个有限客户端兼容缺口，真实供应商仍需用户复测。若真实响应属于漏引号/漏值等歧义问题，会继续返回更具体的安全原因，而不会编造评分。真实供应商成功率、独立干净机、数字签名及既有许可缺口不在本轮声称完成。

