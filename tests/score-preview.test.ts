import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ScorePreview, SCORE_PREVIEW_TTL, SCORE_PREVIEW_LIMIT } from '../electron/score-preview';
import { o4Stores } from './o4-fixture';
import { AiError } from '../shared/ai';
import {
  scorePreviewFixture,
  SCORE_FIXTURE_KEY,
  SCORE_INVALID_BODY,
  SCORE_DIMENSIONS_BODY,
} from './score-preview-fixture';

test('score response cache is default empty, scoped, one-shot, replaceable and not shared with new instances', () => {
  const p = new ScorePreview();
  assert.equal(p.take('one'), null);
  p.set('one', 'BODY', 'KEY');
  assert.equal(new ScorePreview().has('one'), false);
  assert.equal(p.take('two'), null);
  p.clear('two');
  assert.equal(p.take('one')?.text, 'BODY');
  assert.equal(p.take('one'), null);
  p.set('one', 'OLD', 'KEY');
  p.set('two', 'NEW', 'KEY');
  assert.equal(p.has('one'), false);
  p.clear();
  assert.equal(p.has('two'), false);
});
test('score cache retains middle syntax, masks credential forms before bounded clipping', () => {
  const p = new ScorePreview();
  const key = 'KEY+/\\"';
  p.set(
    'one',
    'a'.repeat(50000) +
      'MIDDLE SYNTAX' +
      key +
      JSON.stringify(key).slice(1, -1) +
      encodeURIComponent(key),
    key,
  );
  const response = p.take('one')!;
  assert.equal(response.truncated, false);
  assert.match(response.text, /MIDDLE SYNTAX/);
  for (const secret of [key, JSON.stringify(key).slice(1, -1), encodeURIComponent(key)])
    assert.equal(response.text.includes(secret), false);
  p.set('two', 'x'.repeat(SCORE_PREVIEW_LIMIT + 1), '');
  assert.equal(p.take('two')!.truncated, true);
});
test('score cache actively expires and rejects expired take', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const p = new ScorePreview();
  p.set('one', 'PRIVATE', 'KEY');
  t.mock.timers.tick(SCORE_PREVIEW_TTL);
  t.mock.timers.setTime(1000);
  assert.equal(p.has('one'), false);
  p.set('two', 'PRIVATE', 'KEY');
  t.mock.timers.setTime(1000 + SCORE_PREVIEW_TTL);
  assert.equal(p.take('two'), null);
});
for (const protocol of ['chat-completions', 'anthropic'] as const) {
  test(`score preview ${protocol}: opt-in only, one request, no history/key leakage, invalid options, stale consent and cleanup`, async () => {
    const net = await scorePreviewFixture(protocol);
    mkdirSync('.test-data', { recursive: true });
    const dir = mkdtempSync(resolve('.test-data/score-preview-service-'));
    const path = join(dir, 'db');
    let f = o4Stores(path);
    try {
      const p = f.ai.registry.saveProvider({
        name: 'LOCAL fixture',
        baseUrl: net.baseUrl,
        apiKey: SCORE_FIXTURE_KEY,
        protocol,
      });
      const m = f.ai.registry.saveModel({
        providerId: p.id,
        name: 'LOCAL',
        modelId: 'synthetic',
        protocol: 'inherit',
        capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: { temperature: true, maxCompletionTokens: true, reasoningEffort: false },
        parameters: { maxCompletionTokens: 4096 },
      });
      f.ai.registry.select('score', m.id, {}, f.ai.registry.catalog().pages.score.revision);
      f.workspace.saveWorkspace('score', {
        ...f.workspace.readWorkspace('score'),
        document: 'TypeScript',
      });
      net.setMode('valid');
      await f.service.score(f.service.prepareScore(false));
      const saved = f.scores.list();
      const workbench = f.workspace.workbench.inspect('score');
      net.setMode('invalid');
      for (const optIn of [undefined, false, true]) {
        const c = { ...f.service.prepareScore(false), retainFailedResponse: optIn };
        const before = net.requests.length;
        await assert.rejects(f.service.score(c), (e: unknown) => {
          assert.ok(e instanceof AiError);
          assert.equal(e.diagnostic?.code, 'AI_SCORE_JSON');
          assert.match(e.message, /SEPARATOR_REQUIRED/);
          assert.doesNotMatch(
            JSON.stringify(e.diagnostic),
            /PRIVATE-CONTENT|FAKE-SCORE-PREVIEW-KEY/,
          );
          return true;
        });
        assert.equal(net.requests.length, before + 1);
        assert.equal(f.service.hasScorePreview(c.runId), optIn === true);
        assert.equal(f.service.takeMatchPreview(c.runId), null);
        const preview = f.service.takeScorePreview(c.runId);
        if (optIn)
          assert.equal(
            preview?.text,
            SCORE_INVALID_BODY.replace(SCORE_FIXTURE_KEY, '[API KEY REDACTED]'),
          );
        else assert.equal(preview, null);
        assert.equal(f.service.takeScorePreview(c.runId), null);
        assert.equal(JSON.stringify(net.requests.at(-1)).includes('retainFailedResponse'), false);
        assert.deepEqual(f.scores.list(), saved);
        assert.deepEqual(f.workspace.workbench.inspect('score'), workbench);
      }
      net.setMode('dimensions');
      for (const optIn of [undefined, false, true]) {
        const c = { ...f.service.prepareScore(false), retainFailedResponse: optIn };
        const before = net.requests.length;
        await assert.rejects(f.service.score(c), (e: unknown) => {
          assert.ok(e instanceof AiError);
          assert.equal(e.diagnostic?.code, 'AI_SCORE_DIMENSIONS');
          assert.match(e.message, /count=3; missing=expression/);
          assert.doesNotMatch(
            JSON.stringify(e.diagnostic),
            /PRIVATE-CONTENT|FAKE-SCORE-PREVIEW-KEY/,
          );
          return true;
        });
        assert.equal(net.requests.length, before + 1);
        assert.equal(f.service.hasScorePreview(c.runId), optIn === true);
        assert.equal(f.service.takeMatchPreview(c.runId), null);
        assert.equal(
          f.service.takeScorePreview(c.runId)?.text ?? null,
          optIn ? SCORE_DIMENSIONS_BODY.replace(SCORE_FIXTURE_KEY, '[API KEY REDACTED]') : null,
        );
        assert.equal(f.service.takeScorePreview(c.runId), null);
        assert.deepEqual(f.scores.list(), saved);
        assert.deepEqual(f.workspace.workbench.inspect('score'), workbench);
      }
      net.setMode('invalid');
      const invalid = { ...f.service.prepareScore(false), retainFailedResponse: 'yes' };
      const requests = net.requests.length;
      // Deliberately malformed renderer IPC value: type validation must happen before network.
      await assert.rejects(f.service.score(invalid as never));
      assert.equal(net.requests.length, requests);
      let c = { ...f.service.prepareScore(false), retainFailedResponse: true };
      await assert.rejects(f.service.score(c));
      assert.equal(f.service.hasScorePreview(c.runId), true);
      f.service.prepareScore(false);
      assert.equal(f.service.hasScorePreview(c.runId), false);
      assert.equal(f.service.prepareScore(false).retainFailedResponse, undefined);
      for (const mode of ['valid', 'http-failure', 'truncated', 'evidence'] as const) {
        net.setMode(mode);
        c = { ...f.service.prepareScore(false), retainFailedResponse: true };
        if (mode === 'valid') await f.service.score(c);
        else await assert.rejects(f.service.score(c));
        assert.equal(f.service.hasScorePreview(c.runId), false);
      }
      net.setMode('invalid');
      c = { ...f.service.prepareScore(false), retainFailedResponse: true };
      await assert.rejects(f.service.score(c));
      f.service.cancelAll();
      assert.equal(f.service.hasScorePreview(c.runId), false);
      c = { ...f.service.prepareScore(false), retainFailedResponse: true };
      await assert.rejects(f.service.score(c));
      f.close();
      f = o4Stores(path);
      assert.equal(f.service.hasScorePreview(c.runId), false);
      assert.equal(readFileSync(path).includes(Buffer.from('PRIVATE-CONTENT')), false);
      assert.equal(f.scores.list().length, 2);
    } finally {
      f.close();
      await net.close();
    }
  });
}
