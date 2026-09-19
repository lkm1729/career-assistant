// Entirely fictional report with the user's observed shape, not their private response.
const start =
  '以下是岗位匹配报告（虚构测试）。\n\n# 岗位匹配度报告\n\n## 要求与证据\n| 要求 | 证据状态 |\n| --- | --- |\n| Python | 已体现 |\n\n';
const end = '\n\n```\n建议核对原文证据，不虚构经历。\n```';
export const markdownMatchReport =
  start + '测试资料仅供回归验证。'.repeat(500).slice(0, 4266 - start.length - end.length) + end;
