# O8：评分完整性修正 / 0.12.12

日期：2026-09-18。范围：优化章程第26项。当前状态：本机实现、分层验收与安装器/便携包交付完成，待用户实测。O9–O11未进入。

## 复现与诊断

快速命令：`node --import tsx --test tests/o8-score-completeness.test.ts`。

- 同一份完整PDF清单、同一完整模型响应，正常总分77；仅增加“未选中：1项资料”警告，旧parseScore将总分改为null并出现用户报告的笼统提示。已观察红→绿：`.test-data/o8-red-unselected.log` / `o8-green-unselected.log`。
- 旧规则按页面警告字符串匹配“像素较低|失败”，即便完整原始图像已发送且模型明确覆盖全部页面，也会阻断。低像素、OCR失败、文字抽取/渲染通用提示三种独立变量均先红后绿：`o8-red-quality.log` / `o8-green-quality.log`。
- 检查解析路径：PDF只有render promise完成并转换后才赋值image；之后文字抽取失败也会产生旧通用失败提示。OCR失败保留已渲染原页，不等于图像不存在。保留现有解析器和OCR流程，不增加云端解析。
- 以上是应用侧可重复确认的误拦截，不代表已解释用户过去每次真实供应商失败；未读取或上传用户真实简历/响应。

## 行为变化

1. 完整性只针对本次所选简历及实际发送图像，未选资料提示不再阻断总分，也不自动勾选或上传未选资料。
2. 低像素/OCR质量警告继续保存和显示，但本身不再阻断。必须仍满足实际原始图像存在、页数和页码完整、模型明确覆盖全部页、四维数值与证据合法且无未核实冲突。
3. `shared/score-completeness.ts` 统一确认前检查和结果完整性判定。结果新增可选completeness快照，含策略版本score-completeness-2、页数和具体原因；无需数据库表迁移。
4. 区分：简历缺页/页码不完整、DOCX近似版面、未发送原始图像、模型看不清、模型漏报覆盖、维度未完成、内容冲突。错误原因附具体行动建议，模型漏报明确提示“这不等于原文件残缺”。
5. 发送前展示本机能确定的限制，用户可返回补充或明确继续部分评价；不会自动请求模型或增加预算。
6. 提示词要求逐一检查实际发送清单，不只填写被引用的页，不把低质量/未选资料提示直接写成内容冲突；不得因为已发送就臆造已读覆盖。
7. 旧历史没有详细快照时保留原分数与原提示，明确“不自动重算”。四维权重仍为30/30/20/20，rubricVersion仍为resume-rubric-1；新完整性策略版本独立记录。

## 未放宽的边界

- 无图像、DOCX近似预览不能生成原始视觉分数；真实缺页/不可读/漏报/未完成维度/冲突仍无总分。
- JSON结构、维度数量和范围、原文引用、来源归属、覆盖ID去重和已读/不可读互斥仍严格校验。
- 不推测缺漏字段、不补造页面覆盖、不填零、不重分配权重，不自动重试付费请求。
- 资料发送选择、协议传输、图像开关、能力声明、预算、页面上限、附件来源隔离不变。
- 所选简历附有额外TXT/DOCX等无法提供原始版面的简历项时，仍会提示相应限制；不会擅自认定它是重复件并忽略。

## 变更文件

生产：electron/scoring.ts、shared/scoring.ts、新增shared/score-completeness.ts、新增src/ScoreCoverage.tsx、src/ScorePanel.tsx、src/styles.css。版本：package.json、package-lock.json。
测试：新增tests/o8-score-completeness.test.ts（18项）、tests/o8-score-service.test.ts（四协议）、tests/o8-desktop-fixture.ts、tests/o8-scoring.e2e.ts（4项）；更新tests/scoring.test.ts及tests/p13-acceptance.test.ts中旧的“未选资料必须使评分不完整”预期，保留其隐私与无图像断言。
原文件备份：`.test-data/o8-source-before`。未提交、推送或改正式用户数据库；未删除旧发布版本。

## 验证进度

- 最终676项单元/服务测试通过：`.test-data/o8-unit-release.log`；类型与格式检查通过。
- 核心矩阵覆盖单页、多页、别名还原、页数/页码完整性、低清提示、低OCR置信度、OCR失败、纯文本、图像关闭、DOCX、漏页、缺图、模型漏报/不可读、缺失维度、冲突、非法证据和重复/越界/互斥覆盖ID。
- 四协议真实服务路径的本机模拟请求通过：`.test-data/o8-service.log`；完整带警告的双页80分，模型漏报保持部分评价，非法来源拒绝保存，调用次数验证无自动重试，重开保留完整性快照。
- O8开发Electron专项桌面4项通过：`.test-data/o8-desktop.log`。包括真实本地PDF解析、未选资料不泄露、发送前提示、各类原因、重启、关闭图像与旧记录兼容；浅色和深色窄屏截图已检查。
- 最终ASAR与构建字节匹配、fuses/完整性及离线字体/OCR/许可证清单校验通过：`.test-data/o8-verify-release.log`。
- 最终ASAR19项功能回归全部通过（8.0分钟）：`.test-data/o8-final-asar.log`。O8 4、O7 4、P08–P09 2、Anthropic 1、Gemini 1、O4 5、P14 2；包含0.12.11→0.12.12隔离升级后虚构资料、设置及加密假Key保留和重启。
- 实际硬化EXE隔离启动、正常关闭与重开两轮通过：`.test-data/o8-exe-smoke.log`；没有安装到正式目录。
- ZIP的218个文件与win-unpacked SHA256逐项一致：`.test-data/o8-zip-check.txt`。应用和安装器均为NotSigned：`.test-data/o8-signature.txt`；产物校验值见`release/0.12.12/SHA256SUMS.txt`。

## 验收边界

未调用真实供应商，没有用户真实简历回放证据，不能保证所有供应商都提高出分率。功能修正由本机确定性夹具证明；具体模型仍可能返回部分评价。ASAR回归由开发Electron加载最终包，不等于实际硬化EXE全UI自动化。签名、独立干净机器、既有三项第三方许可文本缺口不在本轮关闭。

## 交付与实测

- 安装器：`release/0.12.12/Career-Assistant-0.12.12-Setup-x64.exe`。
- 便携ZIP：`release/0.12.12/Career-Assistant-0.12.12-win-x64.zip`。
- 校验值：`release/0.12.12/SHA256SUMS.txt`。
- 截图：`docs/implementation/o8-full-score.png`、`docs/implementation/o8-partial-reason-dark.png`。
- 原有0.12.9、0.12.10、0.12.11保持不变，不重新生成更早版本。

建议用原先遇到问题的完整PDF/图片新建一次评分，保留未选补充资料，核对发送前检查和模型覆盖页数。如果仍是部分评价，记录显示的具体原因再决定是否补充；无需发送API Key或私密简历。旧记录不会因为更新自动改分。
