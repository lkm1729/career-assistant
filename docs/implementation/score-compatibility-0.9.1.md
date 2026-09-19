# 0.9.1：评分响应兼容、字段诊断和统一版本

日期：2026-09-16。

## 复现与事实边界

用户报告 Gemini 原生评分出现 `AI_RESPONSE_FORMAT`。旧代码将所有评分校验失败归并为同一错误，无法从此消息还原具体字段。未读取用户个人资料或真实服务商原始响应，未调用真实供应商。

用虚构输入执行 `node node_modules/tsx/dist/cli.mjs --test tests/score-compatibility.test.ts`，修改前 4 项回归全部失败。其中三个小样本复现了同一拒绝消息：可选示例为 null；未评价项证据为 null；无图像情况下视觉分数先于“未评价”降级就被空证据校验拒绝。第四项证明旧诊断缺少字段定位。另确认提示词示例给多个数值分数配空 evidence，与服务端约束矛盾。上述为确认的代码缺陷，不冒充用户那次失败的唯一根因。

## 修改

- 可选 example 允许省略/null；未评价项允许空/null/省略 evidence。真正有分数的非视觉项、实际可评价的视觉项仍必须有合法来源证据。
- 无原始图像时将视觉项强制标为未评价并添加提示，不当零分、不计算完整总分。
- 文本引用保留连续原文校验；不存在的来源、伪造覆盖、截断 JSON、重复/缺失维度、越界/小数分数仍拒绝且不保存。看清/无法辨识页不允许重叠。
- 固定错误码：AI_SCORE_JSON / DIMENSIONS / SCORE / EVIDENCE / COVERAGE / FIELD。消息只使用代码定义的字段路径、数组序号及固定原因，不输出用户内容或原始响应。
- 统一合法的全未评价 JSON 示例，显式列出 allowedEvidenceSources/allowedVisualPages，不向模型示范自相矛盾的数值分数和空证据。
- 只有 Gemini 且模型 structuredOutput 标记 supported 时，才发送 generationConfig.responseMimeType 与 responseJsonSchema。schema 在主进程从已确认输入构建，渲染器不能覆盖；来源枚举与本次发送一致。确认对话框显示模式。未知/不支持不加此选项，不自动重试。其他协议与模型探针不改请求参数。
- Google 官方 generate-content 参考已核对 responseJsonSchema/responseMimeType 及 schema 子集；参考地址 `https://ai.google.dev/api/generate-content`，只读缓存位于 .test-data，不进入发布源码。
- shared/version.ts 从 package.json 读取版本；侧栏、所有页脚和设置窗口共同使用，新增静态防硬编码测试及四页 UI 验证。历史实施记录和历史版本号不改写。

## 验证

- 363 项单元/协议/服务测试通过，包括四协议资料生成与评分、Gemini schema 开关、保留证据校验和失败不保存。
- 类型检查和生产构建通过。
- P08/P09 桌面 2 项、新增 Gemini 评分/四页面版本桌面 1 项通过。
- 工作区 6 项和 Gemini/Anthropic 模型探针 2 项回归通过：开发桌面定向回归合计 11 项，本轮未重跑其余全部桌面套件。
- ZIP 成品重新解压后，ASAR 文件逐一对比、版本、fuse 和测试数据排除检查通过；0.9.1 EXE 为 NotSigned。
- 同版开发 Electron 加载 ZIP 解压副本的实际 app.asar，P08/P09 与 Gemini 新回归合计 3 项通过（不冒充发布 EXE UI 自动化）。
- ZIP 解压副本发布 EXE 以隔离资料目录完成两次正常启动、关闭、重开；未在干净电脑验证。
- 测试日志保留于 .test-data/091-*.log，源码交付排除这些日志和测试数据库。

## 用户复测

完整解压 0.9.1，先关闭旧版，检查侧栏/页脚/设置都是同一版本。直接用原配置重试评分即可；若仍失败，只需提供新的错误码和字段定位，不要发送 Key 或完整简历。若所用模型及代理确实支持 Gemini JSON Schema，可在模型编辑中将结构化输出能力标记支持；400 参数不支持时设回未知并由用户自行决定重试。没有图像仍只会得到部分评价。

0.9.1 不修改数据库表结构、不清空现有草稿/历史，不覆写 0.9.0 或 0.7.3。未做真实供应商与干净电脑验收；评分不是实际 ATS 或录用概率。不会关闭安全校验来假装成功。
