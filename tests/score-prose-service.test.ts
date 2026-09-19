import { BRACKET_SOURCE, bracketScore, malformedBracketScore } from './score-bracket-fixture';
import { malformedPlaceholderScore, placeholderScore } from './score-placeholder-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { o4Stores } from './o4-fixture';
import { scorePreviewFixture, SCORE_FIXTURE_KEY } from './score-preview-fixture';
import { malformedProseScore, proseScore } from './score-prose-fixture';
import { malformedCompactScore, compactProseScore } from './score-prose-compact-fixture';
import { AiError } from '../shared/ai';
for (const protocol of ['chat-completions', 'anthropic'] as const) {
  for (const scenario of [
    {
      name: 'bracket-evidence',
      body: malformedBracketScore(false, 2),
      expected: bracketScore(),
      source: BRACKET_SOURCE,
    },
    {
      name: 'bracket-example-alias',
      body: malformedBracketScore(true),
      expected: bracketScore(true),
      source: BRACKET_SOURCE,
    },
    {
      name: 'numeric-placeholder',
      body: malformedPlaceholderScore(),
      expected: placeholderScore(),
    },
    { name: 'legacy', body: malformedProseScore(), expected: proseScore() },
    { name: 'compact', body: malformedCompactScore(), expected: compactProseScore() },
    {
      name: 'pretty-summary-example',
      body: malformedCompactScore(2),
      expected: compactProseScore(),
    },
  ]) {
    test(`Claude prose ${protocol}/${scenario.name}: chunked response saves once, persists, rejects evidence and interrupted stream without retry`, async () => {
      const net = await scorePreviewFixture(protocol, scenario.body);
      mkdirSync('.test-data', { recursive: true });
      const path = join(mkdtempSync(resolve('.test-data/prose-service-')), 'db');
      let f = o4Stores(path);
      try {
        const p = f.ai.registry.saveProvider({
          name: 'LOCAL',
          baseUrl: net.baseUrl,
          apiKey: SCORE_FIXTURE_KEY,
          protocol,
        });
        const m = f.ai.registry.saveModel({
          providerId: p.id,
          name: 'Synthetic Claude',
          modelId: 'synthetic',
          protocol: 'inherit',
          capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
          parameterSupport: {
            temperature: true,
            maxCompletionTokens: true,
            reasoningEffort: false,
          },
          parameters: { maxCompletionTokens: 4096 },
        });
        f.ai.registry.select('score', m.id, {}, f.ai.registry.catalog().pages.score.revision);
        f.workspace.saveWorkspace('score', {
          ...f.workspace.readWorkspace('score'),
          document: scenario.source ?? 'TypeScript',
        });
        net.setMode('valid');
        const c = { ...f.service.prepareScore(false), retainFailedResponse: true };
        await f.service.score(c);
        assert.equal(net.requests.length, 1);
        assert.equal(f.service.hasScorePreview(c.runId), false);
        const saved = f.scores.list();
        assert.equal(saved.length, 1);
        assert.equal(saved[0].dimensions.length, 4);
        if (scenario.source) assert.equal(saved[0].dimensions[1].evidence[0].quote, BRACKET_SOURCE);
        if (scenario.name === 'bracket-example-alias')
          assert.ok(saved[0].warnings.some((w) => w.includes('EMPTY_EXAMPLE_PLACEHOLDER')));
        if (scenario.name === 'numeric-placeholder')
          assert.ok(saved[0].warnings.some((w) => w.includes('EMPTY_EXAMPLE_PLACEHOLDER')));
        assert.deepEqual(
          saved[0].dimensions[0].suggestions,
          scenario.expected.dimensions[0].suggestions,
        );
        assert.equal(saved[0].summary, scenario.expected.summary);
        if (scenario.name !== 'legacy')
          assert.equal(saved[0].dimensions[3].example, scenario.expected.dimensions[3].example);
        assert.ok(saved[0].warnings.some((w) => w.includes('PROSE_QUOTES')));
        const request = net.requests[0];
        assert.equal(Object.hasOwn(request, 'response_format'), false);
        assert.equal(Object.hasOwn(request, 'output_config'), false);
        assert.match(JSON.stringify(request), /裸英文双引号/);
        const workbench = f.workspace.workbench.inspect('score');
        for (const [mode, code] of [
          ['evidence', 'AI_SCORE_EVIDENCE'],
          [
            'truncated',
            protocol === 'anthropic' ? 'AI_ANTHROPIC_STREAM_END' : 'AI_STREAM_INCOMPLETE',
          ],
          ['invalid', 'AI_SCORE_JSON'],
        ] as const) {
          net.setMode(mode);
          const n: number = net.requests.length;
          await assert.rejects(
            f.service.score(f.service.prepareScore(false)),
            (e: unknown) => e instanceof AiError && e.diagnostic?.code === code,
          );
          assert.equal(net.requests.length, n + 1);
          assert.deepEqual(f.scores.list(), saved);
          assert.deepEqual(f.workspace.workbench.inspect('score'), workbench);
        }
        f.close();
        f = o4Stores(path);
        assert.deepEqual(f.scores.list(), saved);
      } finally {
        f.close();
        await net.close();
      }
    });
  }
}
