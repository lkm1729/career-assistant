import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateMatchScore, parseMatch } from '../shared/matching';
import { MatchStore } from '../electron/matching';
import { MatchSummary } from '../src/MatchSummary';
import { o3Legacy, o3Job, o3Resume, o3Requirements, o3Routine } from './o3-fixture';

test('parser ignores fabricated scores, persists its own rubric, and still refuses invalid citations', () => {
  const r = parseMatch(
    JSON.stringify({
      ...o3Legacy,
      recommendation: 'apply',
      matchScore: 100,
      matchScoreVersion: 'model',
      matchScoreBreakdown: { hardUnmet: [] },
    }),
    o3Job,
    o3Resume,
  );
  assert.equal(r.matchScore, 42);
  assert.equal(r.coverage, 50);
  assert.equal(r.matchScoreVersion, 'match-evidence-v1');
  assert.equal(r.recommendation, 'uncertain');
  assert.deepEqual(r.matchScoreBreakdown?.hardUnmet, ['Degree']);
  assert.throws(() =>
    parseMatch(
      JSON.stringify({
        ...o3Legacy,
        requirements: [
          { ...o3Requirements[0], evidence: [{ sourceId: 'job', quote: 'TypeScript' }] },
        ],
      }),
      o3Job,
      o3Resume,
    ),
  );
  const store = new MatchStore(new DatabaseSync(':memory:'));
  try {
    store.save({ ...o3Legacy, ...r });
    assert.deepEqual(store.list()[0].matchScoreBreakdown, r.matchScoreBreakdown);
  } finally {
    store.close();
  }
});
test('score endpoints and unknown states preserve denominator and do not invent evidence credit', () => {
  assert.equal(calculateMatchScore([{ ...o3Requirements[0], hard: false }]).score, 100);
  assert.equal(calculateMatchScore([{ ...o3Requirements[0], status: 'partial' }]).score, 50);
  assert.equal(calculateMatchScore([{ ...o3Requirements[3], hard: true }]).score, 0);
  assert.equal(calculateMatchScore([o3Requirements[1]]).score, 0);
  const almost = [
    ...Array.from({ length: 20 }, (_, i) => ({ ...o3Requirements[0], hard: false, id: String(i) })),
    o3Requirements[1],
  ];
  assert.equal(calculateMatchScore(almost).score, 91);
  assert.deepEqual(calculateMatchScore(almost).breakdown.hardUnmet, ['Degree']);
});
test('legacy display is read-only, explains scoring, shows partial gaps and never hides hard conditions', () => {
  const store = new MatchStore(new DatabaseSync(':memory:'));
  try {
    store.save(o3Legacy);
    const before = store.list();
    const html = renderToStaticMarkup(createElement(MatchSummary, { record: before[0] }));
    assert.match(html, /aria-valuenow="42"/);
    assert.match(html, /证据覆盖：50%/);
    assert.match(html, /旧记录按当前规则只读展示/);
    assert.match(html, /硬性条件尚未全部体现/);
    assert.match(html, /仅部分体现/);
    assert.match(html, /申请 \/ 面试前建议/);
    assert.doesNotMatch(html, new RegExp(o3Routine));
    assert.match(html, /岗位薪资缺失/);
    assert.deepEqual(store.list(), before);
    assert.equal(before[0].matchScore, undefined);
  } finally {
    store.close();
  }
});
