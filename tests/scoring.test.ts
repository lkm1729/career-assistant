import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore } from '../electron/scoring';
import type { MaterialManifest } from '../shared/materials';
const manifest = (source: 'pdf' | 'text' | 'docx' = 'pdf'): MaterialManifest => ({
  revision: 'fixture',
  imageCount: source === 'text' ? 0 : 1,
  textCount: 6,
  warnings: [],
  items: [
    {
      id: 'resume-1',
      revision: 'r',
      workspace: 'score',
      purpose: 'resume',
      name: 'cv',
      bytes: 1,
      sha256: 'hash',
      createdAt: '2026-09-16',
      selected: true,
      status: 'ready',
      totalPages: 1,
      warnings: [],
      pages: [
        {
          number: 1,
          text: 'actual',
          source,
          image: source === 'text' ? undefined : 'data:image/png;base64,AQID',
          warnings: [],
          width: 1000,
          height: 1400,
        },
      ],
    },
  ],
});
const output = () => ({
  dimensions: ['content', 'relevance', 'visual', 'expression'].map((key, i) => ({
    key,
    score: [81, 72, 93, 64][i],
    evidence: [{ sourceId: 'resume-1:p1', quote: 'actual' }],
    issues: [],
    suggestions: ['specific advice'],
  })),
  summary: 'Summary',
  coveredPages: ['resume-1:p1'],
  unreadablePages: [],
  conflicts: [],
});
test('rubric computes fixed weighted rounded total, ignores model-provided total', () => {
  const result = parseScore(JSON.stringify({ ...output(), total: 100 }), manifest(), '');
  assert.equal(result.total, 77);
  assert.equal(result.rubricVersion, 'resume-rubric-1');
});
test('missing images, approximate DOCX, missing pages and conflicts block total; quality hints and unselected sources alone do not', () => {
  const text = output();
  text.coveredPages = [];
  assert.equal(parseScore(JSON.stringify(text), manifest('text'), '').dimensions[2].score, null);
  assert.equal(parseScore(JSON.stringify(text), manifest('text'), '').total, null);
  assert.equal(parseScore(JSON.stringify(text), manifest('docx'), '').total, null);
  const partial = manifest();
  partial.items[0].totalPages = 2;
  assert.equal(parseScore(JSON.stringify(output()), partial, '').total, null);
  const blurry = manifest();
  blurry.items[0].pages[0].warnings = ['页面像素较低'];
  assert.equal(parseScore(JSON.stringify(output()), blurry, '').total, 77);
  const omitted = manifest();
  omitted.warnings = ['未选中：other.pdf'];
  assert.equal(parseScore(JSON.stringify(output()), omitted, '').total, 77);
  const conflict = { ...output(), conflicts: ['text and image conflict'] };
  assert.equal(parseScore(JSON.stringify(conflict), manifest(), '').total, null);
  const notRead = output();
  notRead.coveredPages = [];
  assert.equal(parseScore(JSON.stringify(notRead), manifest(), '').total, null);
});
test('rejects fake citations, malformed scores, missing dimensions and unprovided image coverage', () => {
  for (const mutate of [
    (v: ReturnType<typeof output>) => {
      v.dimensions[0].score = 101;
    },
    (v: ReturnType<typeof output>) => {
      v.dimensions.pop();
    },
    (v: ReturnType<typeof output>) => {
      v.dimensions[0].evidence[0].sourceId = 'other-tab:p1';
    },
    (v: ReturnType<typeof output>) => {
      v.coveredPages = ['other:p9'];
    },
    (v: ReturnType<typeof output>) => {
      v.dimensions[0].evidence = [];
    },
  ]) {
    const v = output();
    mutate(v);
    assert.throws(() => parseScore(JSON.stringify(v), manifest(), ''));
  }
});

test('text-only evidence cannot fabricate quotes; visual evidence must reference an actual resume image', () => {
  const v = output();
  v.coveredPages = [];
  v.dimensions[0].evidence[0].quote = 'fabricated content';
  assert.throws(() => parseScore(JSON.stringify(v), manifest('text'), ''));
  const visual = output();
  visual.dimensions[2].evidence = [{ sourceId: 'paste', quote: 'actual' }];
  assert.throws(() => parseScore(JSON.stringify(visual), manifest(), 'actual'));
});
