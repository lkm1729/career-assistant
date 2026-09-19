import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { WorkspaceStore } from '../electron/workspace-store';
import { MaterialStore } from '../electron/material-store';
import { ScoreStore, parseScore } from '../electron/scoring';
import { AiService } from '../electron/ai-service';
import { streamAnthropic } from '../electron/anthropic';
import { AiError } from '../shared/ai';
import { anthropicScoreFixture } from './anthropic-score-fixture';

test('Anthropic score uses a native schema and short page IDs while records keep original IDs', async () => {
  const f = await anthropicScoreFixture();
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/score-reliability-'));
  const path = join(dir, 'db');
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
      name: 'local',
      baseUrl: f.baseUrl,
      apiKey: 'FAKE-KEY',
      protocol: 'anthropic',
    });
    const m = ai.registry.saveModel({
      providerId: p.id,
      name: 'local',
      modelId: 'fixture',
      protocol: 'inherit',
      capabilities: { images: 'supported', files: 'supported', structuredOutput: 'supported' },
      parameterSupport: { temperature: true, maxCompletionTokens: true, reasoningEffort: false },
      parameters: { maxCompletionTokens: 64000 },
    });
    ai.registry.select('score', m.id, {}, ai.registry.catalog().pages.score.revision);
    ws.saveWorkspace('score', { ...ws.readWorkspace('score'), document: 'TypeScript' });
    const file = join(dir, 'PRIVATE-file.png');
    writeFileSync(file, 'fake');
    const [item] = await ms.importPaths(
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
    ms.update('score', item.id, item.revision, true);
    const manifest = ms.manifest('score', true);
    const fixture = {
      dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
        key,
        score: 80,
        evidence: [{ sourceId: 's1:p1', quote: 'TypeScript' }],
        issues: [],
        suggestions: [],
      })),
      summary: 'score',
      coveredPages: ['s1:p1'],
      unreadablePages: [],
      conflicts: [],
    };
    // The map is trusted request-local state, never inferred from model output.
    const mapped = parseScore(
      JSON.stringify(fixture),
      manifest,
      'TypeScript',
      new Map([['s1:p1', `${item.id}:p1`]]),
    );
    const invalid = structuredClone(fixture);
    invalid.dimensions[0].evidence[0].sourceId = 's999:p1';
    assert.throws(
      () =>
        parseScore(
          JSON.stringify(invalid),
          manifest,
          'TypeScript',
          new Map([['s1:p1', `${item.id}:p1`]]),
        ),
      AiError,
    );
    assert.equal(mapped.dimensions[0].evidence[0].sourceId, `${item.id}:p1`);
    const confirm = svc.prepareScore(true);
    assert.equal(confirm.outputMode, 'anthropic-json-schema');
    const r = await svc.score(confirm);
    assert.equal(r.total, 80);
    assert.equal(r.dimensions[2].evidence[0].sourceId, `${item.id}:p1`);
    const body = f.requests[0];
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.deepEqual(
      body.output_config.format.schema.properties.dimensions.items.properties.evidence.items
        .properties.sourceId.enum,
      ['paste', 's1:p1'],
    );
    assert.doesNotMatch(JSON.stringify(body.output_config), /PRIVATE|TypeScript|FAKE-KEY/);
    assert.ok(!JSON.stringify(body.messages).includes(item.id));
    assert.equal(f.requests.length, 1);
    assert.equal(body.max_tokens, 64000);
    assert.doesNotMatch(JSON.stringify(body.output_config), /maxItems|minItems|minimum|maximum/);
    const baseline = ss.list();
    for (const [mode, code] of [
      ['unknown-source', 'AI_SCORE_EVIDENCE'],
      ['invalid-json', 'AI_SCORE_JSON'],
      ['schema-rejected', 'AI_HTTP_400'],
    ] as const) {
      f.setMode(mode);
      const before: number = f.requests.length;
      await assert.rejects(svc.score(svc.prepareScore(true)), (e: unknown) => {
        assert.ok(e instanceof AiError);
        assert.equal(e.diagnostic?.code, code);
        if (mode === 'unknown-source')
          assert.match(e.diagnostic.message, /dimensions\[3\]\.evidence\[2\]\.sourceId/);
        assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE|FAKE-KEY/);
        return true;
      });
      assert.equal(f.requests.length, before + 1);
      assert.deepEqual(ss.list(), baseline);
      assert.equal(svc.busy, false);
    }
    f.setMode('schema-required');
    await svc.score(svc.prepareScore(true));
    const stale = svc.prepareScore(true);
    ai.registry.saveModel({
      ...m,
      capabilities: { ...m.capabilities, structuredOutput: 'unsupported' },
    });
    const before: number = f.requests.length;
    await assert.rejects(svc.score(stale));
    assert.equal(f.requests.length, before);
    const fallback = svc.prepareScore(true);
    assert.equal(fallback.outputMode, 'prompt-json');
    f.setMode('metadata');
    await svc.score(fallback);
    assert.equal(f.requests.at(-1)!.output_config, undefined);
    const fresh = new ScoreStore(path);
    try {
      assert.deepEqual(fresh.list(), ss.list());
    } finally {
      fresh.close();
    }
    assert.doesNotMatch(JSON.stringify(ss.list()), /PRIVATE-THINKING|PRIVATE-SIGNATURE|FAKE-KEY/);
  } finally {
    ss.close();
    ms.close();
    ai.close();
    ws.close();
    await f.close();
  }
});

test('Anthropic idle timeout is distinct from total deadline and contains no response content', async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: ping\ndata: {"type":"ping"}\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('address');
  try {
    await assert.rejects(
      streamAnthropic({
        endpoint: `http://127.0.0.1:${a.port}/v1/messages`,
        modelId: 'fixture',
        apiKey: 'FAKE-KEY',
        messages: [{ role: 'user', content: 'PRIVATE' }],
        signal: new AbortController().signal,
        timeoutMs: 600,
        idleTimeoutMs: 50,
        onText: () => {},
      }),
      (e: unknown) => {
        assert.ok(e instanceof AiError);
        assert.equal(e.diagnostic?.code, 'AI_TIMEOUT');
        assert.match(e.diagnostic.message, /reason=IDLE_LIMIT/);
        assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE|FAKE-KEY|127\.0\.0\.1/);
        return true;
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
