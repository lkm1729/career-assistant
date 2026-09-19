import type { MatchRecord, MatchRequirement } from '../shared/matching';
export const o3Job = 'TypeScript Degree Testing Cloud';
export const o3Resume = 'TypeScript Testing';
export const o3Requirements: MatchRequirement[] = [
  {
    id: 'a',
    requirement: 'TypeScript',
    hard: true,
    status: 'met',
    jobEvidence: [{ sourceId: 'job', quote: 'TypeScript' }],
    evidence: [{ sourceId: 'resume', quote: 'TypeScript' }],
    note: '已核对项目技能',
  },
  {
    id: 'b',
    requirement: 'Degree',
    hard: true,
    status: 'not-found',
    jobEvidence: [{ sourceId: 'job', quote: 'Degree' }],
    evidence: [],
    note: '材料尚未列出学历',
  },
  {
    id: 'c',
    requirement: 'Testing',
    hard: false,
    status: 'partial',
    jobEvidence: [{ sourceId: 'job', quote: 'Testing' }],
    evidence: [{ sourceId: 'resume', quote: 'Testing' }],
    note: '测试经历细节不足',
  },
  {
    id: 'd',
    requirement: 'Cloud',
    hard: false,
    status: 'uncertain',
    jobEvidence: [{ sourceId: 'job', quote: 'Cloud' }],
    evidence: [],
    note: '需确认云平台要求',
  },
];
export const o3Routine =
  '网页为静态文字快照，未执行脚本或登录，可能含导航、广告或缺少动态岗位正文。请预览并核对完整性后勾选。';
export const o3Legacy: MatchRecord = {
  id: 'o3-legacy',
  createdAt: '2026-09-17T00:00:00.000Z',
  requirements: o3Requirements,
  summary: '测试用旧匹配记录',
  recommendation: 'uncertain',
  reasons: ['技能部分匹配'],
  warnings: [o3Routine, '岗位薪资缺失，请核对。'],
  coverage: 50,
  hardGates: ['TypeScript', 'Degree'],
  input: { job: o3Job, resume: o3Resume, evidence: '', systemPrompt: '' },
  connection: {
    providerName: 'fixture',
    modelName: 'fixture',
    modelId: 'fixture',
    protocol: 'chat-completions',
    baseUrl: 'https://example.com',
    endpoint: 'https://example.com/v1/chat/completions',
    hasKey: false,
    revision: 'fixture',
  },
};
