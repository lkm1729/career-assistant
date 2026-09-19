# O9：AI 回答区、按钮与易读引用 · 0.12.13

日期：2026-09-18。范围：优化章程 23、24、24.5。用户已认可 O7/O8，授权本轮 O9，并要求每次进展同步章程状态和剩余工作。

## 当前结论

O9 实现完成，0.12.13 安装器/ZIP 已生成；最终 ASAR 回归、实际 EXE smoke、ZIP 校验和交付截图均已完成；O9 等待用户实测确认。O10/O11 未进入。

## 实现

1. **四页结果区统一**：简历、评分、匹配、求职信均有 AI 回答区标识、独立标题、强调边框、主题色底材和适度阴影。状态区分等待、生成中、已保存、历史结果、手动编辑稿；进行新请求时明确说明下方仍是旧结果，不把未完成内容标为正式结果。
2. **手动定位**：输入操作区下方提供“查看 AI 结果”。点击才定位并移交键盘焦点；流式 token 不触发自动滚动、抢焦点或重新解析未改动的正文。原有操作反馈的一次性定位保持，不扩张到逐 token 定位。
3. **按钮一致性**：补齐缺少样式的普通按钮底材、边框、圆角和留白；主按钮渐变/阴影、次按钮和危险按钮明确区分。主题变量适配白蓝/黑黄；保留禁用状态及键盘焦点，遵守减少动态效果设置。
4. **易读引用**：只读解析当前结果保存的来源快照，显示“资料名称 · 第 N 页”与引用原文。没有旧来源名称时诚实显示“参考资料 · 第 N 页”，不读取现有资料猜测。跳过明确未选来源的名称。引用原文逐字保留，不擅自翻译、补写或裁剪证据。
5. **技术信息按需展开**：证据 UUID/sourceId 留在“引用技术详情”；版本正文原文、历史 JSON/来源快照和未校验的流式内容保留在折叠详情。内部存储、来源合法性校验和评分规则不变。
6. **阅读与编辑分开**：简历/求职信阅读预览及建议显示可读引用，Markdown 编辑保留原文与技术编号。复制/导出遵循当前视图；求职信 Raw Text 继续使用安全渲染后的纯文字。切换预览不改写工作区或历史正文。
7. **安全边界不变**：Markdown 禁止活动 HTML、链接和远程图片载入；资料名称当作字面文字转义。未引入遥测、云同步、额外供应商调用或跨页资料查找。

## 代码和备份

- 新增：`shared/reference-display.ts`、`src/ResultHeader.tsx`、`src/EvidenceQuote.tsx`。
- 修改：`src/App.tsx`、`src/panels.tsx`、`src/Advice.tsx`、`src/ai-controls.tsx`、`src/ScorePanel.tsx`、`src/MatchPanel.tsx`、`src/MatchSummary.tsx`、`src/styles.css`。
- 版本：`package.json`、`package-lock.json` 同步 0.12.13。
- 新增测试：`tests/o9-reference-display.test.ts`、`tests/o9-rendering.test.ts`、`tests/o9-fixture.ts`、`tests/o9-results.e2e.ts`。
- 开始时受影响原文件备份：`.test-data/o9-source-before`；本轮无 Git 提交/推送，无正式用户数据库操作，无旧发布目录删除。
- 单人核对备份差异，关注主题覆盖、来源快照隔离、编辑原文保留、流式渲染依赖、状态真实性；未修改生产后端及供应商协议。

## 分层验证

- **单元/服务**：683 项通过（新增 7 项）；`.test-data/o9-unit-release.log`。覆盖选中快照、多页、旧/异常结构、普通数字不改写、恶意文件名安全、证据字面渲染及 pending 动画状态。
- **类型/格式/构建**：通过；`.test-data/o9-build-final-code.log`、`.test-data/o9-format-final.log`、`.test-data/o9-package.log`。构建仍提示较大前端 chunk 和既有第三方许可缺口，不等于零警告。
- **开发 Electron**：8 项展示/历史/主题/O6性能回归通过（`.test-data/o9-dev-regression.log`），另 2 项复制导出/流式专项通过（`.test-data/o9-dev-extra-recheck.log`）。只用隔离库和本机模拟供应商。
- **性能**：9/500 模型场景通过原有响应性门槛，没有放宽断言；开发轮 500 模型的简历/求职信确认 action-to-two-frames 中位数分别约185/197ms。本机结果不是所有设备性能保证，也不是 O11 的确认页优化已实现。
- **最终 ASAR 静态验证**：与 dist/dist-electron 内容一致，版本、app-only fuses、ASAR 完整性、无测试数据打包、离线字体/OCR和许可清单通过；`.test-data/o9-verify-release.log`。
- **最终 ASAR 功能回归**：25项全部通过（8.4分钟）；`.test-data/o9-final-asar.log`。包含O3/O4/O6/O7/O8/O9及P14升级/离线字体回归。
- **截图**：`docs/implementation/o9-screens/`，来自最终ASAR隔离测试；浅深色、窄屏和四页结果区均已归档。
- **实际硬化 EXE**：隔离启动、正常关闭和重开两轮通过；`.test-data/o9-exe-smoke.log`。没有安装到正式目录。
- **ZIP**：218 个文件 SHA256 与 win-unpacked 逐项一致；`.test-data/o9-zip-check.txt`。
- **签名**：安装器与应用均 NotSigned；`.test-data/o9-signature.txt`。

### 测试修正记录

首轮专项的预览选择器误用 `.markdown-preview`，改为实际 `.markdown-body` 后通过。初始深色截图在 CSS 过渡结束前采样，改为真实主题按钮切换并结束有限过渡，重新采集。复制/导出专项改为先等待“草稿已导出”再读文件，避免高频读取与 Windows 原子替换竞争；减少动态效果断言按现有 `animation:none` 检查 0s。没有放宽业务、性能或安全门槛。原始失败日志保留在 `.test-data/o9-desktop.log`、`.test-data/o9-dev-extra.log`。

## 验收边界与后续章程

开发 Electron 加载最终 ASAR 的功能覆盖，不等同于硬化 EXE 全 UI 自动化。没有真实供应商调用或用户私有简历回放；没有独立干净 Windows 安装验收。签名及三个既有上游许可证正文缺口未关闭。

| 批次 | 状态 | 剩余 |
| --- | --- | --- |
| O7（21、22） | 用户已认可，0.12.11 | 无本批开发待办 |
| O8（26） | 用户已认可，0.12.12 | 真实模型仍按具体完整性原因判断 |
| O9（23、24、24.5） | 0.12.13 本机验证中 | 最终包功能回归、截图归档和用户实测 |
| O10（25、27） | 未开始 | 回收站、切换前草稿、独立评分/匹配历史的多选/全选删除 |
| O11（28、29、30） | 未开始 | 确认页简化、结果时间/当次模型、操作按钮旁供应商/模型/协议 |

## 交付与建议实测

- 安装器：`release/0.12.13/Career-Assistant-0.12.13-Setup-x64.exe`。
- ZIP：`release/0.12.13/Career-Assistant-0.12.13-win-x64.zip`。
- SHA256：`release/0.12.13/SHA256SUMS.txt`。
- 保留既有 0.12.9–0.12.12，不重新生成更早版本。

建议依次点击四页“查看 AI 结果”，检查浅深色与较窄窗口；查看有附件引用的历史结果，确认默认只出现名称/页码，展开后仍可追溯编号；对比阅读预览和 Markdown 编辑，确认复制/导出符合当前模式。无需发送私密简历或 API Key。
