# O14结果标题编号补修 · 0.13.2

日期：2026-09-19。用户反馈：设计简历/撰写求职信的当前正文和工作版本已显示V1，但右上角“AI正式结果”仍显示旧累计编号V19/V8。

## 根因与范围

两页共用`src/panels.tsx`正文结果面板，其ResultHeader status仍直接拼接`version.number`。O14已把number保留为稳定内部身份，并提供displayNumber与versionLabel作为界面编号；此前只改了其他显示点，漏掉该标题。

本轮复用同一个versionLabel修正三条状态：AI正式结果、历史AI结果、手动编辑稿来源编号。最新/历史判断仍按稳定记录顺序，正文、版本身份、回收站、数据库、供应商、O12排版与O13导入逻辑均不改变。无迁移，不读写正式用户数据，不提交/推送Git。旧版Release保留。

## 复现与回归

新增`tests/o14-result-label.e2e.ts`：通过既有隔离fixture建立累计19份/8份但仅剩一份的两页历史。

- 旧版2项均如预期失败：当前正文V1，右上角分别V19/V8（`.test-data/o14-result-label-red.log`）。
- 修复后检查：当前V1；恢复旧记录后当前V2；切换旧版本后历史V1；编辑后基于V1；重启保留；删除恢复记录后再次V1；清空/撤销保持语义。同时断言内部身份不变、正文和历史内容未被显示修复改写。
- 截图使用原生隐藏窗口capturePage，仅包含隔离模拟正文。
- 开发专项：2/2通过，`.test-data/o14-result-label-green.log`。
- 完整单元/服务：709通过，`.test-data/o14-result-label-unit.log`。类型/格式/构建通过。
- 最终ASAR：10/10通过（两页新增标题回归 + 8项O12/O13/O14既有回归），`.test-data/o14-result-label-final-asar.log`。
- 加强回归：恢复内部编号18/7的旧记录后，历史/手动编辑状态仍显示V1；两页2/2重复复验通过（不额外计算不同场景数），`.test-data/o14-result-label-final-expanded.log`。
- 最终硬化EXE：隔离启动/正常关闭/重开2/2通过，`.test-data/o14-result-label-exe-smoke.log`。未执行正式安装。
- 发布静态校验通过，`.test-data/o14-result-label-verify.log`；ZIP218个文件与最终win-unpacked逐项SHA256一致，`.test-data/o14-result-label-zip.log`。
- EXE及安装程序签名实测NotSigned。保留既有大chunk/作者元数据/3项许可证文本缺口警告。独立干净机及真实供应商没有本轮新增验证。
- 截图已检查，另存`o14-result-label-0.13.2-resume.png`和`o14-result-label-0.13.2-letter.png`（仅裁切测试窗口无关区域）。

## 交付与审查

对比本轮源码快照，业务代码仅`src/panels.tsx`的三条标题格式化分支变化；它们复用已有versionLabel，不修改内部编号、生成/删除/恢复机制、数据库或正文。其余改动为0.13.2版本元数据、测试与文档；旧版Release保留，无Git提交/推送。

产物位于`release/0.13.2/`：安装程序、ZIP和SHA256SUMS.txt。此处包内桌面测试是测试Electron加载最终ASAR，不与实际硬化EXE启动测试混称。

## 章程状态

O12：0.13.1修复，用户本次认可整体工作；本轮不改布局。
O13：本轮不改功能，保持原交付状态。
O14：第35项标题编号遗漏已在0.13.2完成实现、回归及本机交付；第36项未改。剩余为用户确认两页标题编号显示。
