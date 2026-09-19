import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScore,
  scoreResponseExample,
  scoreJsonSchema,
  scoreSources,
} from '../electron/scoring';
import { AiError } from '../shared/ai';
import type { MaterialManifest } from '../shared/materials';
const manifest: MaterialManifest = {
  revision: 'test',
  items: [],
  warnings: [],
  imageCount: 0,
  textCount: 0,
};
const result = () => ({
  dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
    key,
    score: key === 'visual' ? null : 80,
    evidence: key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'Built tested software' }],
    issues: [],
    suggestions: [],
  })),
  summary: 'Use measurable evidence',
  coveredPages: [],
  unreadablePages: [],
  conflicts: [],
});
test('optional null rewrite example does not reject an otherwise valid score', () => {
  const raw = {
    ...result(),
    dimensions: result().dimensions.map((d) => ({ ...d, example: null })),
  };
  assert.equal(parseScore(JSON.stringify(raw), manifest, 'Built tested software').total, null);
});
test('unavailable visual assessment is normalized before numeric evidence requirement', () => {
  const raw = result();
  raw.dimensions[2].score = 80;
  const score = parseScore(JSON.stringify(raw), manifest, 'Built tested software');
  assert.equal(score.dimensions[2].score, null);
  assert.equal(score.total, null);
});
test('null evidence for an unassessed dimension is empty, not a invented score', () => {
  const raw = {
    ...result(),
    dimensions: result().dimensions.map((d) => (d.key === 'visual' ? { ...d, evidence: null } : d)),
  };
  assert.equal(
    parseScore(JSON.stringify(raw), manifest, 'Built tested software').dimensions[2].score,
    null,
  );
});
test('specific safe diagnostic identifies quote validation without returning private content', () => {
  const raw = result();
  raw.dimensions[0].evidence[0].quote = 'PRIVATE-FAKE-QUOTE';
  assert.throws(
    () => parseScore(JSON.stringify(raw), manifest, 'Built tested software'),
    (e) => {
      assert.ok(e instanceof AiError);
      assert.equal(e.diagnostic?.code, 'AI_SCORE_EVIDENCE');
      assert.match(e.diagnostic!.message, /dimensions\[0\]\.evidence\[0\]\.quote/);
      assert.ok(!JSON.stringify(e.diagnostic).includes('PRIVATE-FAKE-QUOTE'));
      return true;
    },
  );
});

test('the documented placeholder is valid and cannot claim a full score', () => {
  assert.equal(
    parseScore(JSON.stringify(scoreResponseExample), manifest, 'Built tested software').total,
    null,
  );
  assert.deepEqual(scoreSources(manifest, 'Built tested software'), {
    allowedEvidenceSources: ['paste'],
    allowedVisualPages: [],
  });
  assert.ok(JSON.stringify(scoreJsonSchema(manifest, 'Built tested software')).includes('paste'));
});
test('specific score diagnostics still reject invalid scores, fake IDs, nonarrays and truncated JSON', () => {
  const cases: [string, string][] = [];
  const badScore = result();
  badScore.dimensions[0].score = 101;
  cases.push([JSON.stringify(badScore), 'AI_SCORE_SCORE']);
  const badId = result();
  badId.dimensions[0].evidence[0].sourceId = 'PRIVATE-UNKNOWN-ID';
  cases.push([JSON.stringify(badId), 'AI_SCORE_EVIDENCE']);
  const noEvidence = result();
  noEvidence.dimensions[0].evidence = [];
  cases.push([JSON.stringify(noEvidence), 'AI_SCORE_EVIDENCE']);
  const badDims = result();
  badDims.dimensions[0].key = 'PRIVATE-UNKNOWN-KEY';
  cases.push([JSON.stringify(badDims), 'AI_SCORE_DIMENSIONS']);
  cases.push(['{"dimensions":', 'AI_SCORE_JSON']);
  cases.push([
    JSON.stringify({ ...result(), coveredPages: ['PRIVATE-UNKNOWN-ID'] }),
    'AI_SCORE_COVERAGE',
  ]);
  cases.push([JSON.stringify({ ...result(), conflicts: null }), 'AI_SCORE_FIELD']);
  for (const [json, code] of cases)
    assert.throws(
      () => parseScore(json, manifest, 'Built tested software'),
      (e) => {
        assert.ok(e instanceof AiError);
        assert.equal(e.diagnostic?.code, code);
        assert.ok(!JSON.stringify(e.diagnostic).includes('PRIVATE-UNKNOWN'));
        return true;
      },
    );
});
