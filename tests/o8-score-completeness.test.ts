import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore } from '../electron/scoring';
import type { MaterialManifest } from '../shared/materials';
export function completeManifest(pages = 1): MaterialManifest {
  return {
    revision: 'o8',
    imageCount: pages,
    textCount: pages * 14,
    warnings: [],
    items: [
      {
        id: 'resume-1',
        revision: 'r',
        workspace: 'score',
        purpose: 'resume',
        name: 'Fictional CV.pdf',
        bytes: 100,
        sha256: 'fixture',
        createdAt: '2026-09-18T00:00:00.000Z',
        selected: true,
        status: 'ready',
        totalPages: pages,
        warnings: [],
        pages: Array.from({ length: pages }, (_, i) => ({
          number: i + 1,
          text: 'Fictional work',
          source: 'pdf' as const,
          image: 'data:image/png;base64,AQID',
          warnings: [],
          width: 1000,
          height: 1400,
        })),
      },
    ],
  };
}
export function completeOutput(pages = 1) {
  return {
    dimensions: ['content', 'relevance', 'visual', 'expression'].map((key, i) => ({
      key,
      score: [81, 72, 93, 64][i] as number | null,
      evidence: [{ sourceId: 'resume-1:p1', quote: 'Fictional work' }],
      issues: [] as string[],
      suggestions: ['Specific advice'],
    })),
    summary: 'Fictional review',
    coveredPages: Array.from({ length: pages }, (_, i) => `resume-1:p${i + 1}`),
    unreadablePages: [] as string[],
    conflicts: [] as string[],
  };
}
test('O8 complete selected resume receives the same total with unrelated unselected materials', () => {
  const manifest = completeManifest();
  const response = JSON.stringify(completeOutput());
  assert.equal(parseScore(response, manifest, '').total, 77);
  manifest.warnings = ['未选中：1 项资料；其正文、名称与来源不发送。'];
  const result = parseScore(response, manifest, '');
  assert.equal(result.total, 77, result.warnings.join('\n'));
});

for (const warning of [
  '页面像素较低，可能模糊；请补充清晰原图。',
  '本机 OCR 失败，保留原页面；可手动补充文字，不会改用云端解析。',
  '此页文字抽取或渲染失败；保留可用结果，覆盖不完整。',
]) {
  test(`O8 a sent original page explicitly read by the model is not blocked only by: ${warning}`, () => {
    const manifest = completeManifest();
    manifest.items[0].pages[0].warnings = [warning];
    manifest.warnings = ['Fictional CV.pdf 第1页：' + warning];
    const response = completeOutput();
    const result = parseScore(JSON.stringify(response), manifest, '');
    assert.equal(result.total, 77);
    assert.ok(result.warnings.includes(manifest.warnings[0]), 'quality caveats stay visible');
    response.coveredPages = [];
    response.unreadablePages = ['resume-1:p1'];
    assert.equal(
      parseScore(JSON.stringify(response), manifest, '').total,
      null,
      'actual unreadability still blocks full total',
    );
  });
}

test('O8 partial evaluations expose distinct actionable blockers without changing the fixed rubric', () => {
  const manifest = completeManifest(2);
  const output = completeOutput(2);
  output.coveredPages = ['resume-1:p1'];
  output.dimensions[1].score = null;
  output.dimensions[1].evidence = [];
  const result = parseScore(JSON.stringify(output), manifest, '');
  assert.equal(result.total, null);
  const completeness = result.completeness;
  assert.ok(completeness, 'save precise coverage/blockers with the record');
  assert.deepEqual(
    completeness.reasons.map((r) => r.code),
    ['MODEL_COVERAGE_MISSING', 'DIMENSIONS_INCOMPLETE'],
  );
  assert.equal(completeness.sentImagePages, 2);
  assert.equal(completeness.modelCoveredPages, 1);
  assert.ok(completeness.reasons.every((r) => r.message && r.action));
});

test('O8 full multi-page coverage and short aliases retain exact pages and weighted total', () => {
  const manifest = completeManifest(2);
  const response = completeOutput(2);
  response.coveredPages = ['s1:p1', 's1:p2'];
  response.dimensions.forEach((d) => d.evidence.forEach((e) => (e.sourceId = 's1:p1')));
  const result = parseScore(
    JSON.stringify(response),
    manifest,
    '',
    new Map([
      ['s1:p1', 'resume-1:p1'],
      ['s1:p2', 'resume-1:p2'],
    ]),
  );
  assert.equal(result.total, 77);
  assert.deepEqual(result.coveredPages, ['resume-1:p1', 'resume-1:p2']);
  assert.deepEqual(result.completeness?.reasons, []);
  assert.equal(result.completeness?.modelCoveredPages, 2);
});

for (const scenario of [
  'text',
  'images-disabled',
  'docx',
  'missing-page',
  'missing-image',
  'unreadable',
  'omitted-coverage',
  'conflict',
] as const) {
  test(`O8 genuine incomplete condition remains partial with a specific reason: ${scenario}`, () => {
    const manifest = completeManifest(2);
    const response = completeOutput(2);
    let expected: string;
    switch (scenario) {
      case 'text':
      case 'images-disabled':
        manifest.items[0].pages.forEach((p) => {
          delete p.image;
          if (scenario === 'text') p.source = 'text';
        });
        manifest.imageCount = 0;
        response.coveredPages = [];
        expected = 'RESUME_IMAGES_MISSING';
        break;
      case 'docx':
        manifest.items[0].pages.forEach((p) => {
          p.source = 'docx';
        });
        response.coveredPages = [];
        expected = 'ORIGINAL_LAYOUT_REQUIRED';
        break;
      case 'missing-page':
        manifest.items[0].pages.pop();
        response.coveredPages.pop();
        expected = 'RESUME_PAGES_MISSING';
        break;
      case 'missing-image':
        delete manifest.items[0].pages[1].image;
        response.coveredPages.pop();
        expected = 'RESUME_IMAGES_MISSING';
        break;
      case 'unreadable':
        response.coveredPages.pop();
        response.unreadablePages = ['resume-1:p2'];
        expected = 'MODEL_PAGES_UNREADABLE';
        break;
      case 'omitted-coverage':
        response.coveredPages.pop();
        expected = 'MODEL_COVERAGE_MISSING';
        break;
      case 'conflict':
        response.conflicts = ['Unverified employment date conflict'];
        expected = 'EVIDENCE_CONFLICT';
        break;
    }
    const result = parseScore(JSON.stringify(response), manifest, '');
    assert.equal(result.total, null);
    assert.ok(result.completeness?.reasons.some((r) => r.code === expected));
    if (['text', 'images-disabled', 'docx'].includes(scenario))
      assert.equal(result.dimensions[2].score, null);
    assert.ok(!result.warnings.some((w) => w.includes('图像或页面覆盖不完整、质量不足或存在冲突')));
  });
}

test('O8 does not infer missing model coverage or accept duplicate, foreign or contradictory page IDs', () => {
  for (const change of [
    (v: ReturnType<typeof completeOutput>) => {
      v.coveredPages = ['resume-1:p1', 'resume-1:p1'];
    },
    (v: ReturnType<typeof completeOutput>) => {
      v.coveredPages = ['resume-1:p1', 'not-sent:p2'];
    },
    (v: ReturnType<typeof completeOutput>) => {
      v.unreadablePages = ['resume-1:p1'];
    },
    (v: ReturnType<typeof completeOutput>) => {
      v.dimensions[0].evidence[0].sourceId = 'private-other-page:p1';
    },
  ]) {
    const response = completeOutput(2);
    change(response);
    assert.throws(() => parseScore(JSON.stringify(response), completeManifest(2), ''));
  }
  const response = completeOutput(2);
  response.coveredPages = [];
  const result = parseScore(JSON.stringify(response), completeManifest(2), '');
  assert.equal(result.total, null);
  assert.deepEqual(result.coveredPages, []);
  assert.equal(result.completeness?.modelCoveredPages, 0);
});

test('O8 null dimension is not filled, zeroed or reweighted even with complete page coverage', () => {
  const response = completeOutput();
  response.dimensions[0].score = null;
  response.dimensions[0].evidence = [];
  const result = parseScore(JSON.stringify(response), completeManifest(), '');
  assert.equal(result.total, null);
  assert.equal(result.dimensions[0].score, null);
  assert.deepEqual(
    result.completeness?.reasons.map((r) => r.code),
    ['DIMENSIONS_INCOMPLETE'],
  );
});

test('O8 page-count, page-number and original-image requirements are not bypassed by model coverage', () => {
  for (const mutate of [
    (m: MaterialManifest) => {
      m.items[0].totalPages = 3;
    },
    (m: MaterialManifest) => {
      m.items[0].pages[1].number = 3;
    },
    (m: MaterialManifest) => {
      m.items[0].pages[1].number = 1;
    },
  ]) {
    const m = completeManifest(2);
    mutate(m);
    const response = completeOutput(2);
    response.coveredPages = [...new Set(m.items[0].pages.map((p) => `resume-1:p${p.number}`))];
    const result = parseScore(JSON.stringify(response), m, '');
    assert.equal(result.total, null);
    assert.ok(result.completeness?.reasons.some((r) => r.code === 'RESUME_PAGES_MISSING'));
  }
});

test('O8 unselected, selected evidence and OCR confidence do not expand original resume coverage', () => {
  const m = completeManifest();
  m.items[0].pages[0].ocr = { confidence: 15 };
  m.items[0].pages[0].warnings = [
    'OCR 置信度较低或未识别文字，请对照原页面确认；不可据此断言原文缺失。',
  ];
  m.items.push({
    ...m.items[0],
    id: 'project-1',
    purpose: 'evidence',
    totalPages: 10,
    pages: [
      {
        number: 1,
        source: 'text',
        text: 'Supplementary project',
        warnings: ['Failed extraction for unrelated appendix'],
      },
    ],
  });
  const result = parseScore(JSON.stringify(completeOutput()), m, '');
  assert.equal(result.total, 77);
  assert.equal(result.completeness?.expectedPages, 1);
  assert.equal(result.completeness?.sentImagePages, 1);
});
