# O7：网页资料入口与间距 / 0.12.11

日期：2026-09-18。范围：优化章程第 21、22 项。状态：本机实现与分层验收完成，待用户实测。O8–O11 未进入。

## 已实现

- 四页网页输入改为纵向分组：用途与链接字段分开，字段间距 16px，确认按钮上方留白 20px，链接文字从 11px 调至 13px。沿用现有浅/深色主题，无新动效或依赖。
- 评分页接入既有多链接管线，单批最多 5 个，逐条设置简历/目标岗位/补充证据；每页仍最多 16 项资料，不改变解析预算。
- 评分页同步开放网页读取失败时的本地文字补充。保留 HTTPS/私网/DNS/重定向防护、显式读取确认、公共 DNS 默认关闭及新资料默认不发送。
- 复用独立的资料批量管理：全选/取消全选、部分选择、确认移除。删除选择不影响发送勾选；只移除本页应用副本，不删原文件、其他页资料或历史快照。
- 评分模式以实际发送快照判定：目标文字或选中的 job 资料均可进入目标岗位模式；仅项目证据不冒充目标岗位。界面、供应商请求及历史记录使用同一判定。
- 评分页复用多份岗位来源核对，界面禁用未确认的发送，服务端也在网络调用前核验；用途/资料变更使旧确认失效，不沿用上一次核对。
- 仅调整评分提示中“目标可来自岗位网页”的说明。四维权重、视觉证据、覆盖完整性、总分门槛和 JSON/来源校验不变；第 26 项留待 O8。

## 修改范围

生产：src/panels.tsx、src/styles.css、src/ScorePanel.tsx、electron/main.ts、electron/material-store.ts、electron/ai-service.ts、electron/scoring.ts、shared/scoring.ts；版本：package.json、package-lock.json。

测试：新增 tests/o7-web-fixture.ts、tests/o7-web-materials.e2e.ts、tests/o7-score-web.test.ts；更新 tests/material-management.test.ts、tests/p12-web-workflow.test.ts 中“评分页不允许本地网页补充”的旧预期，保持四页 opt-in 与隔离断言。

原文件在 `.test-data/o7-source-before` 单独备份。未初始化 Git、未提交或推送、未改正式用户数据库，也未改动保留的 0.12.9/0.12.10 产物。

## 红绿验证

1. 评分页入口测试先红：找不到“网页链接草稿”；开放前端与主进程入口后通过。证据：`.test-data/o7-red-entry-approved.log`、`o7-green-entry.log`。最初沙箱桌面进程启动超时，不作为功能失败证据；获准启动后才观察到真实入口失败。
2. 四页布局先红：输入框到按钮仅 4px（阈值 16px）；修正后浅色 1360px、深色 800px 四页全部通过。证据：`o7-red-spacing.log`、`o7-green-spacing.log`。
3. 本地补充服务先红：评分页被旧白名单拒绝；开放后 9 项资料管理/网页工作流回归通过。证据：`o7-red-fallback.log`、`o7-green-fallback.log`。
4. 仅岗位网页模式先红（general 而非 targeted），修正后通过；多岗位未确认也先红（缺少拒绝），服务端保护与确认 UI 补齐后通过。证据：`o7-red-mode.log`、`o7-green-mode.log`、`o7-red-job-consent.log`、`o7-green-job-consent.log`。

## 验证进度

- 类型检查、全项目格式检查通过。
- 最终元数据及提示修改后的 654 项单元/服务测试全部通过：`.test-data/o7-unit-release.log`。
- O7 开发构建桌面 4 项通过：`.test-data/o7-desktop-final.log`。涵盖多链接部分失败、逐项用途、未确认零读取、默认不发送、跨页隔离、重启、批量删除取消/确认、四页间距/键盘操作、多岗位确认、旧快照拒绝与运行中保护。
- 最终 ASAR 源码字节匹配、fuses/完整性、离线字体/OCR及许可清单哈希校验通过：`.test-data/o7-verify-release.log`。
- 最终 ASAR 17 项回归全部通过（7.2 分钟）：`.test-data/o7-final-asar.log`；包含 O1 4、O6 2、O7 4、P08–P09 2、P12–P13 3、P14 2。0.12.10 → 0.12.11 隔离升级验证了虚构资料、设置与加密假密钥保留，以及升级后重启。
- NSIS 安装器与便携 ZIP 已生成，ZIP 的 218 个文件与 win-unpacked SHA256 逐一匹配：`.test-data/o7-zip-check.txt`。安装器未安装到正式用户目录。
- 实际硬化 EXE 在隔离数据库下两轮启动、正常关闭与重开通过：`.test-data/o7-exe-smoke.log`；这是启动 smoke，不冒称完整 EXE UI 自动化。
- 应用 EXE 与安装器均为 NotSigned：`.test-data/o7-signature.txt`。准确产物哈希见 `release/0.12.11/SHA256SUMS.txt`。
- 对比原文件备份，parseScore 的证据校验、视觉覆盖门槛与总分算法逐字相同，未进入 O8：`.test-data/o7-scope-check.txt`。
- 最终包浅色/深色窄屏截图已人工查看，无网页输入/确认按钮重叠：`o7-web-score-light.png`、`o7-web-score-dark-narrow.png`。
- 本批不改数据库表结构；历史记录仍保留当时的模式，不回写旧评价。

## 验收边界

网页通过 DNS/HTTPS 测试边界夹具，模型通过本机 HTTP 模拟，不代表真实网站适配或真实供应商评分表现。ASAR UI 验证使用开发 Electron，不等于硬化 EXE 的完整 UI 自动化。安装器构建不等于干净机器安装验收。签名与既有第三方许可文本缺口不在本轮解决范围。

## 交付

- 安装器：`release/0.12.11/Career-Assistant-0.12.11-Setup-x64.exe`。
- 便携包：`release/0.12.11/Career-Assistant-0.12.11-win-x64.zip`。
- 校验值：`release/0.12.11/SHA256SUMS.txt`；说明：`release/0.12.11/RELEASE-NOTES.txt`。
- 保留 0.12.9、0.12.10；未重新生成已按用户要求删除的更早版本。

实测建议：评分页输入个人项目和岗位链接，逐条指定用途并确认读取；勾选所需资料，核对目标模式与多岗位提示；在批量管理中先取消一次，再移除所选网页，确认简历和其他页资料保留。网页是文字快照，不代替用于视觉评分的原始 PDF/图片。
