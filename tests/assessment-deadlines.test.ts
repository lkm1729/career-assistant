import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AiService, publicAiDiagnostic } from '../electron/ai-service';
import { AiStore } from '../electron/ai-store';
import { MatchStore } from '../electron/matching';
import { MaterialStore } from '../electron/material-store';
import { ScoreStore } from '../electron/scoring';
import { WorkspaceStore } from '../electron/workspace-store';
import { emptyCapabilities, emptyParameters } from '../shared/models';

// Actual service -> native stream -> localhost HTTP. Only the clock is scaled;
// never contact a provider or inspect a user's database/credentials.
for (const page of ['match', 'score'] as const) {
  test(`${page}: extended native request still has a finite total bound before headers`, async (t) => {
    let requests = 0;
    const server = createServer((req) => {
      req.resume();
      req.on('end', () => {
        requests++;
      }); // Deliberately withhold headers.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    mkdirSync('.test-data', { recursive: true });
    const path = join(mkdtempSync(resolve('.test-data/assessment-deadline-')), 'db');
    const workspace = new WorkspaceStore(path);
    const store = new AiStore(path, {
      encrypt: (s) => Buffer.from(s),
      decrypt: (b) => b.toString(),
    });
    const materials = new MaterialStore(path);
    const scores = new ScoreStore(path);
    const matches = new MatchStore(new DatabaseSync(path));
    const service = new AiService(store, workspace, materials, scores, matches);
    const deadlines: number[] = [];
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', (ms: number) => {
      deadlines.push(ms);
      return realTimeout(500);
    });
    try {
      const provider = store.registry.saveProvider({
        name: 'loopback',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        protocol: 'anthropic',
        apiKey: 'FAKE-KEY',
      });
      const model = store.registry.saveModel({
        providerId: provider.id,
        name: 'fixture',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: emptyCapabilities(),
        parameterSupport: emptyParameters(),
        parameters: {},
      });
      store.registry.select(page, model.id, {}, store.registry.catalog().pages[page].revision);
      workspace.saveWorkspace(page, {
        ...workspace.readWorkspace(page),
        prompt: 'Python required',
        document: 'Python projects',
      });
      const before = workspace.readWorkspace(page);
      await assert.rejects(
        page === 'match'
          ? service.match(service.prepareMatch())
          : service.score(service.prepareScore(false)),
        (error) => {
          const d = publicAiDiagnostic(error);
          assert.equal(d.code, 'AI_TIMEOUT');
          assert.match(d.message, /reason=TOTAL_LIMIT; phase=CONNECTING/);
          assert.doesNotMatch(JSON.stringify(d), /Python|FAKE-KEY/);
          t.diagnostic(d.message);
          return true;
        },
      );
      assert.equal(requests, 1, 'no automatic retry');
      assert.deepEqual(workspace.readWorkspace(page), before);
      assert.deepEqual(matches.list(), []);
      assert.deepEqual(scores.list(), []);
      assert.equal(service.busy, false);
      assert.deepEqual(
        deadlines,
        [1_800_000],
        'both native assessments should allow 30 minutes total, not the legacy 2/10 minutes',
      );
    } finally {
      service.cancelAll();
      t.mock.restoreAll();
      materials.close();
      scores.close();
      matches.close();
      workspace.close();
      store.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

for (const page of ['match', 'score'] as const) {
  test(`${page}: delayed headers complete; idle/cancel preserve a prior result without retrying`, async (t) => {
    let mode: 'complete' | 'idle' | 'cancel' = 'complete';
    let requests = 0;
    let service: AiService;
    const valid =
      page === 'match'
        ? {
            requirements: [
              {
                id: 'req-1',
                requirement: 'Python',
                hard: true,
                status: 'met',
                jobEvidence: [{ sourceId: 'job', quote: 'Python' }],
                evidence: [{ sourceId: 'resume', quote: 'Python' }],
                note: 'Fictional',
              },
            ],
            summary: 'Fictional',
            recommendation: 'apply',
            reasons: [],
            warnings: [],
          }
        : {
            dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
              key,
              score: key === 'visual' ? null : 80,
              evidence: key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'Python' }],
              issues: [],
              suggestions: [],
              example: null,
            })),
            summary: 'Fictional',
            coveredPages: [],
            unreadablePages: [],
            conflicts: [],
          };
    const frames = [
      {
        type: 'message_start',
        message: {
          id: 'fixture',
          type: 'message',
          role: 'assistant',
          content: [],
          stop_reason: null,
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: JSON.stringify(valid) },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ]
      .map((f) => `data: ${JSON.stringify(f)}\n\n`)
      .join('');
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        requests++;
        if (mode === 'cancel') {
          service.cancelAll();
          return;
        }
        if (mode === 'idle') return;
        const timer = setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(frames);
        }, 300);
        res.on('close', () => clearTimeout(timer));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    mkdirSync('.test-data', { recursive: true });
    const path = join(mkdtempSync(resolve('.test-data/assessment-success-')), 'db');
    const workspace = new WorkspaceStore(path);
    const store = new AiStore(path, {
      encrypt: (s) => Buffer.from(s),
      decrypt: (b) => b.toString(),
    });
    const materials = new MaterialStore(path);
    const scores = new ScoreStore(path);
    const matches = new MatchStore(new DatabaseSync(path));
    service = new AiService(store, workspace, materials, scores, matches);
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const realSetTimeout = globalThis.setTimeout;
    const idleLimits: number[] = [];
    t.mock.method(AbortSignal, 'timeout', (ms: number) =>
      realTimeout(ms === 1_800_000 ? 10_000 : 100),
    );
    t.mock.method(
      globalThis,
      'setTimeout',
      (fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
        if (ms === 600_000 || ms === 120_000) {
          idleLimits.push(ms);
          return realSetTimeout(fn, mode === 'idle' ? 500 : 5_000, ...args);
        }
        return realSetTimeout(fn, ms, ...args);
      },
    );
    try {
      const provider = store.registry.saveProvider({
        name: 'loopback',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        protocol: 'anthropic',
        apiKey: 'FAKE-KEY',
      });
      const model = store.registry.saveModel({
        providerId: provider.id,
        name: 'fixture',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: emptyCapabilities(),
        parameterSupport: emptyParameters(),
        parameters: {},
      });
      store.registry.select(page, model.id, {}, store.registry.catalog().pages[page].revision);
      workspace.saveWorkspace(page, {
        ...workspace.readWorkspace(page),
        prompt: 'Python required',
        document: 'Python projects',
      });
      const before = workspace.readWorkspace(page);
      const run = () =>
        page === 'match'
          ? service.match(service.prepareMatch())
          : service.score(service.prepareScore(false));
      await run();
      const history = page === 'match' ? matches.list() : scores.list();
      assert.equal(history.length, 1);
      for (const failure of ['idle', 'cancel'] as const) {
        mode = failure;
        await assert.rejects(run(), (error) => {
          const d = publicAiDiagnostic(error);
          assert.equal(d.code, failure === 'idle' ? 'AI_TIMEOUT' : 'AI_CANCELLED');
          if (failure === 'idle') assert.match(d.message, /reason=IDLE_LIMIT; phase=CONNECTING/);
          assert.doesNotMatch(JSON.stringify(d), /FAKE-KEY|Python/);
          return true;
        });
        assert.deepEqual(page === 'match' ? matches.list() : scores.list(), history);
        assert.deepEqual(workspace.readWorkspace(page), before);
        assert.equal(service.busy, false);
      }
      assert.ok(idleLimits.length >= 3);
      assert.ok(
        idleLimits.every((ms) => ms === 600_000),
        'ten-minute idle bound used on both actual service paths',
      );
      assert.equal(requests, 3);
    } finally {
      service.cancelAll();
      t.mock.restoreAll();
      materials.close();
      scores.close();
      matches.close();
      workspace.close();
      store.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
