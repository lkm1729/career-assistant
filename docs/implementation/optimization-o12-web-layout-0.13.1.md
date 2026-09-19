# O12网页参考链接卡片补修 · 0.13.1

日期：2026-09-19。范围：第31项排版补修，仅修改`src/Materials.tsx`标题结构、`src/styles.css`局部规则、版本元数据和回归测试；不更改O13/O14业务逻辑，不接触正式用户数据库，不提交/推送Git。

## 问题与根因

用户截图显示网页卡片标题细小、被推到右上角，说明文字靠近右边缘，文件卡片正常。
在真实Electron界面复现：标题computed font-size=9px；新增桌面回归明确期望至少18px，因此旧构建失败（`.test-data/o12-web-layout-red.log`）。

两个CSS冲突共同导致问题：
1. 旧`.link-drafts summary span`规则把新标题容器当成右侧注解：9px、muted颜色、margin-left:auto。
2. `.materials details`的padding优先级高于单类卡片样式，网页卡片失去与文件卡片一致的水平内边距。

## 修正

- 网页标题使用独立strong，18px/750字重，与文件入口层级一致。
- summary使用显式网格：左侧链接图标和加粗标题；右端只放展开/收起标记；下一行完整显示说明文字，并允许换行。
- 移除只服务旧标题布局的注解样式。针对details只覆盖padding，避免扩大选择器优先级意外覆盖两张卡片原有彩色左边框。
- 保留原生details/summary语义、Enter/Space展开/收起、键盘焦点、浅/深色及减少动态效果。
- 不改变输入内容、用途选择、读取前确认、联网规则和文件导入区行为。

## 回归设计与本机证据

`tests/o12-web-layout.e2e.ts`覆盖四页×浅色1280宽/深色800宽：标题字号/字重、图标旁左对齐、两卡相同padding、两卡4px强调边框、说明文字位于标题下方且不越界、无水平溢出、键盘折叠与输入保留、未确认不导入。
上轮测试只判断可见性/卡片距离，未捕获字号和内部对齐；本次针对用户症状补齐度量，并查看原生窗口截图。

- 旧版复现：预期失败，实测9px（不是网络或启动失败）。
- 初次修复开发桌面：4/4通过；浅色/深色截图已查看。
- 全套单元/服务：709通过，`.test-data/o12-web-layout-unit.log`。
- 类型、格式、构建通过；最终打包日志`.test-data/o12-web-layout-package-final.log`。
- 最终ASAR：8/8通过（4页排版 + 4项O7网页流程），`.test-data/o12-web-layout-final-asar.log`。ASAR由测试Electron加载，和实际硬化EXE启动验证分开记录。
- 最终硬化EXE：隔离启动/正常关闭/重开2/2通过，`.test-data/o12-web-layout-exe-smoke.log`，没有安装到正式目录。
- 发布静态校验：app-only fuses、ASAR完整性、构建字节和版本一致、离线资源、测试资料排除通过，`.test-data/o12-web-layout-verify-final.log`。
- ZIP：218文件与最终win-unpacked逐项SHA256一致，`.test-data/o12-web-layout-zip-verify.log`。
- 实际EXE及安装程序签名检查：NotSigned。构建继续报告既有大chunk、作者元数据、三项许可文本缺口，不宣称公开发布闭环。
- 最终截图已查看，另存`o12-web-layout-0.13.1-light.png`及`o12-web-layout-0.13.1-dark.png`，只裁去侧栏和无关界面，不改变卡片像素。

## 本轮审查

对照修改前快照检查结构与CSS差异。生产逻辑只改标题DOM及局部样式；移除的link-drafts summary注解规则只有该组件使用。最终回归额外锁定文件/网页两卡4px左边框，避免修复padding时影响用户已认可的文件区。无后端、IPC、数据库、上传或网页请求逻辑变更。

## 交付

`release/0.13.1/Career-Assistant-0.13.1-Setup-x64.exe`与`Career-Assistant-0.13.1-win-x64.zip`已完成本机交付验证；哈希见该目录`SHA256SUMS.txt`。保留旧0.13.0产物，不执行安装。

## 当前章程状态

O12：0.13.1排版补修、最终包回归及本机交付完成，等待用户视觉确认。
O13/O14：不改动，保持0.13.0验证状态；用户反馈“功能大致达成”，不扩大为逐项最终验收。
签名、独立干净机、既有许可证缺口和真实供应商验证不是本轮UI修复的验收内容。
