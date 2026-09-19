import { markdownMatchReport } from './match-report-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatch, matchFormatInstruction, matchSources } from '../shared/matching';
const base = {
  requirements: [
    {
      id: 'req-1',
      requirement: 'Python',
      status: 'met',
      hard: true,
      jobEvidence: [{ sourceId: 'job', quote: 'Python' }],
      evidence: [{ sourceId: 'resume', quote: 'Python' }],
      note: '技能明确',
    },
  ],
  summary: '有证据',
  recommendation: 'apply',
  reasons: ['匹配'],
  warnings: [],
};
test('P10 match parser preserves requirement statuses, hard gates and evidence', () => {
  const r = parseMatch(JSON.stringify(base), 'Python role', 'Python', '');
  assert.equal(r.requirements[0].hard, true);
  assert.equal(r.recommendation, 'apply');
  assert.match(matchFormatInstruction(), /not-found不等于/);
});
test('P10 rejects fabricated evidence, unknown status and malformed recommendation', () => {
  const fake = {
    ...base,
    requirements: [{ ...base.requirements[0], evidence: [{ sourceId: 'resume', quote: 'Java' }] }],
  };
  assert.throws(() => parseMatch(JSON.stringify(fake), 'Python', 'Python'));
  assert.throws(() =>
    parseMatch(
      JSON.stringify({ ...base, requirements: [{ ...base.requirements[0], status: 'maybe' }] }),
      'Python',
      'Python',
    ),
  );
  assert.throws(() =>
    parseMatch(JSON.stringify({ ...base, recommendation: 'hire' }), 'Python', 'Python'),
  );
});

test('P10 does not recommend apply when a hard requirement is not found or uncertain', () => {
  const v = {
    ...base,
    requirements: [{ ...base.requirements[0], status: 'not-found' }],
    coverage: 0,
    hardGates: ['Python'],
  };
  assert.equal(parseMatch(JSON.stringify(v), 'Python', 'Python').recommendation, 'uncertain');
});

test('matching output example is accepted by its own parser', () => {
  const instruction = matchFormatInstruction();
  const start = instruction.indexOf('{"requirements"');
  const end = instruction.lastIndexOf('}');
  const example = instruction.slice(start, end + 1);
  assert.doesNotThrow(() => parseMatch(example, '岗位要求原文 岗位原文连续摘录', '简历连续原文'));
});

test('derived coverage and hard gates cannot invalidate otherwise verified evidence', () => {
  const result = parseMatch(
    JSON.stringify({ ...base, coverage: 66.7, hardGates: null }),
    'Python',
    'Python',
  );
  assert.equal(result.coverage, 100);
  assert.deepEqual(result.hardGates, ['Python']);
});

test('matching catalog includes nonempty pasted sources alongside PDF pages', () => {
  const sources = matchSources('Python', 'Python resume', '', [
    { id: 'pdf:p1', purpose: 'resume', name: 'CV', text: 'Project' },
  ]);
  assert.deepEqual(
    sources.map((s) => s.id),
    ['job', 'resume', 'pdf:p1'],
  );
  assert.deepEqual(
    matchSources('', '', '', [{ id: 'scan:p1', purpose: 'resume', name: 'Scan', text: '' }]),
    [],
  );
});

const failureCases: [string, unknown, string, string][] = [
  ['invalid JSON', 'not-json PRIVATE-RESPONSE', 'JSON', 'response'],
  ['invalid root', [], 'FIELD', 'response'],
  ['unknown enum', { ...base, recommendation: 'PRIVATE-RESPONSE' }, 'FIELD', 'recommendation'],
  [
    'duplicate requirement',
    { ...base, requirements: [base.requirements[0], base.requirements[0]] },
    'FIELD',
    'requirements',
  ],
  [
    'invalid boolean',
    { ...base, requirements: [{ ...base.requirements[0], hard: 'false' }] },
    'FIELD',
    'requirements[0].hard',
  ],
  [
    'missing evidence',
    { ...base, requirements: [{ ...base.requirements[0], evidence: [] }] },
    'EVIDENCE',
    'requirements[0].evidence',
  ],
  [
    'malformed evidence',
    {
      ...base,
      requirements: [
        { ...base.requirements[0], status: 'uncertain', evidence: 'PRIVATE-RESPONSE' },
      ],
    },
    'FIELD',
    'requirements[0].evidence',
  ],
  [
    'wrong source',
    {
      ...base,
      requirements: [
        { ...base.requirements[0], evidence: [{ sourceId: 'PRIVATE-RESPONSE', quote: 'Python' }] },
      ],
    },
    'SOURCE',
    'requirements[0].evidence[0].sourceId',
  ],
  [
    'role confusion',
    {
      ...base,
      requirements: [{ ...base.requirements[0], evidence: [{ sourceId: 'job', quote: 'Python' }] }],
    },
    'SOURCE',
    'requirements[0].evidence[0].sourceId',
  ],
  [
    'fabricated quote',
    {
      ...base,
      requirements: [
        { ...base.requirements[0], evidence: [{ sourceId: 'resume', quote: 'PRIVATE-RESPONSE' }] },
      ],
    },
    'QUOTE',
    'requirements[0].evidence[0].quote',
  ],
  [
    'bad job quote',
    {
      ...base,
      requirements: [
        { ...base.requirements[0], jobEvidence: [{ sourceId: 'job', quote: 'PRIVATE-RESPONSE' }] },
      ],
    },
    'QUOTE',
    'requirements[0].jobEvidence[0].quote',
  ],
];
for (const [name, raw, code, path] of failureCases)
  test(`matching safe diagnostic: ${name}`, () => {
    assert.throws(
      () => parseMatch(typeof raw === 'string' ? raw : JSON.stringify(raw), 'Python', 'Python'),
      (error) => {
        const e = error as Error & { diagnostic: { code: string; message: string } };
        assert.equal(e.diagnostic.code, `AI_MATCH_${code}`);
        assert.ok(e.diagnostic.message.includes(path));
        assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE-RESPONSE|Python/);
        return true;
      },
    );
  });

test('matching preserves strict quotes but tolerates PDF whitespace and Unicode variants', () => {
  const raw = {
    ...base,
    requirements: [
      { ...base.requirements[0], evidence: [{ sourceId: 'resume', quote: 'Ｐｙｔｈｏｎ' }] },
    ],
  };
  assert.equal(parseMatch(JSON.stringify(raw), 'Python', 'Py\nthon').coverage, 100);
  raw.requirements[0].evidence[0].quote = 'Py...thon';
  assert.throws(() => parseMatch(JSON.stringify(raw), 'Python', 'Python'));
});
test('image-only uncertain requirements need no invented evidence', () => {
  const raw = {
    ...base,
    requirements: [{ ...base.requirements[0], status: 'uncertain', evidence: [] }],
  };
  const r = parseMatch(JSON.stringify(raw), 'Python', '', '', [
    { id: 'scan:p1', purpose: 'resume', name: 'Scan', text: '' },
  ]);
  assert.equal(r.coverage, 0);
  assert.equal(r.recommendation, 'uncertain');
});

test('complete Markdown report is diagnosed as non-JSON and never saved as a match', () => {
  const markdown =
    '# 岗位匹配度报告\n\n## 总体结论\n建议申请。\n\n## 岗位要求逐项分析\n- Python：已体现\n- 相关项目经验：部分体现\n';
  assert.throws(
    () => parseMatch(markdown, 'Python', 'Python'),
    (error) => {
      const e = error as Error & { diagnostic?: { code: string; message: string } };
      assert.equal(e.diagnostic?.code, 'AI_MATCH_MARKDOWN');
      assert.match(e.diagnostic?.message ?? '', /检测到Markdown式报告，未返回可验证的JSON对象/);
      assert.doesNotMatch(JSON.stringify(e.diagnostic), /建议申请|Python/);
      return true;
    },
  );
});

test('malformed JSON mentioning a report is not mislabeled as Markdown', () => {
  assert.throws(
    () => parseMatch('{"summary":"岗位要求报告"', 'Python', 'Python'),
    (error) => {
      const e = error as Error & { diagnostic?: { code: string } };
      assert.equal(e.diagnostic?.code, 'AI_MATCH_JSON');
      return true;
    },
  );
});

test('4266-character Markdown with an unlabelled block is not a JSON envelope error', () => {
  assert.equal(markdownMatchReport.length, 4266);
  assert.equal(markdownMatchReport.includes('{'), false);
  assert.throws(
    () => parseMatch(markdownMatchReport, 'Python', 'Python'),
    (error) => {
      const e = error as Error & { diagnostic?: { code: string; message: string } };
      assert.equal(e.diagnostic?.code, 'AI_MATCH_MARKDOWN');
      assert.match(e.diagnostic?.message ?? '', /MARKDOWN_REPORT/);
      assert.doesNotMatch(JSON.stringify(e.diagnostic), /JSON_ENVELOPE|Python|虚构测试/);
      return true;
    },
  );
});
