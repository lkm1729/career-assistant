import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WorkspaceStore } from '../electron/workspace-store';
import { AiStore } from '../electron/ai-store';
import { MaterialStore } from '../electron/material-store';
import { ScoreStore } from '../electron/scoring';
import { AiService } from '../electron/ai-service';
import { AiError } from '../shared/ai';
import { anthropicScoreFixture } from './anthropic-score-fixture';

test('native score service with 64000 tokens: metadata compatibility, sanitized errors, no retries and history survival', async () => {
  const f = await anthropicScoreFixture();
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/anthropic-score-service-'));
  const path = join(dir, 'workspace.sqlite');
  const ws = new WorkspaceStore(path);
  const ai = new AiStore(path, {
    encrypt: (s) => Buffer.from('test:' + s),
    decrypt: (b) => b.toString().slice(5),
  });
  const ms = new MaterialStore(path);
  const ss = new ScoreStore(path);
  const svc = new AiService(ai, ws, ms, ss);
  try {
    const p = ai.registry.saveProvider({
      name: 'synthetic-not-openlux',
      baseUrl: f.baseUrl,
      apiKey: 'FAKE-TEST-KEY',
      protocol: 'anthropic',
    });
    const m = ai.registry.saveModel({
      providerId: p.id,
      name: 'Synthetic Claude',
      modelId: 'claude-sonnet-5',
      protocol: 'inherit',
      capabilities: { images: 'supported', files: 'supported', structuredOutput: 'supported' },
      parameterSupport: { temperature: true, maxCompletionTokens: true, reasoningEffort: false },
      parameters: { maxCompletionTokens: 64000 },
    });
    ai.registry.select('score', m.id, {}, ai.registry.catalog().pages.score.revision);
    ws.saveWorkspace('score', { ...ws.readWorkspace('score'), document: 'TypeScript' });
    const first = await svc.score(svc.prepareScore(false));
    assert.equal(first.dimensions[0].score, 80);
    assert.equal(first.total, null);
    assert.equal(ss.list().length, 1);
    assert.equal(f.requests[0].max_tokens, 64000);
    assert.equal(f.requests[0].thinking, undefined);
    assert.equal(f.requests[0].output_config.format.type, 'json_schema');
    for (const [mode, code] of [
      ['wrong-index', 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_DELTA'],
      ['wrong-type', 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_DELTA'],
      ['truncated', 'AI_ANTHROPIC_STREAM_END'],
      ['no-signature', 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_STOP'],
      ['stop-wrong-index', 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_STOP'],
      ['invalid-json', 'AI_SCORE_JSON'],
      ['multiple-json', 'AI_SCORE_JSON'],
      ['unsigned-truncated', 'AI_ANTHROPIC_STREAM_END'],
      ['unsigned-limit', 'AI_OUTPUT_LIMIT'],
      ['unsigned-invalid-score', 'AI_SCORE_EVIDENCE'],
      ['invalid-score', 'AI_SCORE_EVIDENCE'],
      ['json-ambiguous', 'AI_SCORE_JSON'],
      ['json-normalized-invalid-score', 'AI_SCORE_EVIDENCE'],
    ] as const) {
      f.setMode(mode);
      const n = f.requests.length;
      await assert.rejects(svc.score(svc.prepareScore(false)), (e: unknown) => {
        assert.ok(e instanceof AiError);
        assert.equal(e.diagnostic?.code, code);
        if (mode === 'no-signature') {
          assert.match(e.diagnostic!.message, /reason=MISSING_SIGNATURE/);
          assert.match(e.diagnostic!.message, /block=thinking; index=same; signature=not-started/);
        }
        assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE|FAKE-TEST-KEY/);
        return true;
      });
      assert.equal(f.requests.length, n + 1);
      assert.deepEqual(ss.list(), [first]);
      assert.equal(svc.busy, false);
    }
    for (const mode of [
      'unsigned',
      'wrapped',
      'unsigned-wrapped',
      'json-trailing-comma',
      'json-controls',
      'json-comments',
      'json-combined',
    ] as const) {
      f.setMode(mode);
      const n = f.requests.length;
      const before = ss.list().length;
      const accepted = await svc.score(svc.prepareScore(false));
      assert.equal(accepted.dimensions[0].score, 80);
      assert.equal(accepted.total, null);
      if (mode.startsWith('json-'))
        assert.ok(accepted.warnings.some((w) => w.includes('JSON') && w.includes('规范化')));
      assert.equal(ss.list().length, before + 1);
      assert.equal(f.requests.length, n + 1);
      assert.doesNotMatch(JSON.stringify(ss.list()), /PRIVATE|FAKE-TEST-KEY/);
    }
    f.setMode('json-combined');
    const file = join(dir, 'fictional.png');
    writeFileSync(file, 'fictional-placeholder');
    const imported = await ms.importPaths(
      'score',
      'resume',
      [file],
      async () => ({
        pages: [
          {
            number: 1,
            text: 'TypeScript',
            image: 'data:image/png;base64,AQID',
            source: 'image',
            warnings: [],
            width: 1000,
            height: 1400,
          },
        ],
        totalPages: 1,
        warnings: [],
      }),
      new AbortController().signal,
    );
    const item = imported[0];
    ms.update('score', item.id, item.revision, true);
    const full = await svc.score(svc.prepareScore(true));
    assert.equal(full.total, 80);
    assert.doesNotMatch(
      JSON.stringify(ss.list()),
      /PRIVATE-THINKING|PRIVATE-SIGNATURE|PRIVATE-CITATION|FAKE-TEST-KEY/,
    );
    const re = new ScoreStore(path);
    try {
      assert.deepEqual(re.list(), ss.list());
    } finally {
      re.close();
    }
  } finally {
    ss.close();
    ms.close();
    ai.close();
    ws.close();
    await f.close();
  }
});
