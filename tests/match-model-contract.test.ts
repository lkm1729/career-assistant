import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiService, publicAiDiagnostic } from '../electron/ai-service';
import { AiStore } from '../electron/ai-store';
import { MatchStore } from '../electron/matching';
import { WorkspaceStore } from '../electron/workspace-store';
import { emptyCapabilities, emptyParameters } from '../shared/models';
import { matchFormatInstruction } from '../shared/matching';
import { nativeFixture } from './native-fixture';
import { responsesFixture } from './responses-fixture';
import { markdownMatchReport } from './match-report-fixture';

// Differential local fixtures, NOT a test of real Claude/Gemini compliance.
// Model names must not select a protocol or bypass the shared evidence validator.
const cases = [
  { protocol: 'chat-completions', modelId: 'claude-fixture' },
  { protocol: 'chat-completions', modelId: 'gemini-fixture' },
  { protocol: 'anthropic', modelId: 'claude-fixture' },
  { protocol: 'gemini', modelId: 'gemini-fixture' },
  // Screenshot configuration; these names still call only the loopback fixtures.
  { protocol: 'anthropic', modelId: 'claude-sonnet-5' },
  { protocol: 'chat-completions', modelId: 'claude-sonnet-5' },
] as const;
const validReply = JSON.stringify({
  requirements: [
    {
      id: 'req-1',
      requirement: 'Python',
      hard: true,
      status: 'met',
      jobEvidence: [{ sourceId: 'job', quote: 'Python' }],
      evidence: [{ sourceId: 'resume', quote: 'Python' }],
      note: 'Fictional verified citation',
    },
  ],
  summary: 'Fictional match',
  recommendation: 'apply',
  reasons: [],
  warnings: [],
});
for (const { protocol, modelId } of cases) {
  for (const structuredOutput of ['unknown', 'supported'] as const) {
    test(`${protocol}/${modelId}/${structuredOutput}: wire constraints and identical JSON/Markdown validation`, async () => {
      let answer = validReply;
      const mock =
        protocol === 'chat-completions'
          ? await responsesFixture(() => answer)
          : await nativeFixture(() => answer);
      const baseUrl =
        typeof mock.baseUrl === 'string'
          ? mock.baseUrl
          : mock.baseUrl(protocol as 'anthropic' | 'gemini');
      const path = join(mkdtempSync(join(tmpdir(), 'career-match-contract-')), 'db');
      const workspace = new WorkspaceStore(path);
      const store = new AiStore(path, {
        encrypt: (s) => Buffer.from(s),
        decrypt: (b) => b.toString(),
      });
      const matches = new MatchStore(new DatabaseSync(path));
      const service = new AiService(store, workspace, undefined, undefined, matches);
      try {
        const provider = store.registry.saveProvider({
          name: 'Local fixture',
          baseUrl,
          protocol,
          apiKey: 'FAKE-KEY',
        });
        const model = store.registry.saveModel({
          providerId: provider.id,
          name: modelId,
          modelId,
          protocol: 'inherit',
          capabilities: { ...emptyCapabilities(), structuredOutput },
          parameterSupport:
            modelId === 'claude-sonnet-5'
              ? { temperature: true, maxCompletionTokens: true, reasoningEffort: false }
              : emptyParameters(),
          parameters: modelId === 'claude-sonnet-5' ? { maxCompletionTokens: 128000 } : {},
        });
        store.registry.select('match', model.id, {}, store.registry.catalog().pages.match.revision);
        workspace.saveWorkspace('match', {
          ...workspace.readWorkspace('match'),
          prompt: 'Python required',
          document: 'Python projects',
        });
        const before = workspace.readWorkspace('match');
        const confirmation = service.prepareMatch();
        const expectedMode =
          structuredOutput === 'supported' && protocol !== 'gemini'
            ? protocol === 'anthropic'
              ? 'anthropic-json-schema'
              : 'chat-json-schema'
            : 'prompt-json';
        assert.equal(confirmation.outputMode, expectedMode);
        const record = await service.match(confirmation);
        assert.equal(record.coverage, 100);
        assert.equal(mock.requests.length, 1);
        const checkWire = () => {
          const body = mock.requests.at(-1)!.body;
          if (modelId === 'claude-sonnet-5') {
            assert.equal(body.model, 'claude-sonnet-5');
            assert.equal(
              protocol === 'anthropic' ? body.max_tokens : body.max_completion_tokens,
              128000,
            );
            assert.equal(
              body.temperature,
              undefined,
              'support checkbox without a value must not set sampling',
            );
            assert.equal(body.reasoning_effort, undefined);
            assert.equal(body.thinking, undefined);
            assert.equal(
              body.output_format,
              undefined,
              'use current output_config.format, not old beta field',
            );
          }
          const system =
            protocol === 'anthropic'
              ? body.system.map((p: { text: string }) => p.text).join('\n')
              : protocol === 'gemini'
                ? body.systemInstruction.parts.map((p: { text: string }) => p.text).join('\n')
                : body.messages
                    .filter((m: { role: string }) => m.role === 'system')
                    .map((m: { content: string }) => m.content)
                    .join('\n');
          assert.ok(system.includes(matchFormatInstruction(expectedMode)));
          assert.equal(
            body.response_format?.type,
            expectedMode === 'chat-json-schema' ? 'json_schema' : undefined,
          );
          assert.equal(
            body.output_config?.format?.type,
            expectedMode === 'anthropic-json-schema' ? 'json_schema' : undefined,
          );
          if (expectedMode === 'chat-json-schema') {
            assert.equal(body.response_format.json_schema.strict, true);
            assert.equal(body.response_format.json_schema.schema.type, 'object');
          }
          if (expectedMode === 'anthropic-json-schema')
            assert.equal(body.output_config.format.schema.type, 'object');
        };
        checkWire();
        const savedBeforeFailure = matches.list();
        answer = markdownMatchReport;
        await assert.rejects(service.match(service.prepareMatch()), (error) => {
          const diagnostic = publicAiDiagnostic(error);
          assert.equal(diagnostic.code, 'AI_MATCH_MARKDOWN');
          assert.doesNotMatch(JSON.stringify(diagnostic), /FAKE-KEY|Python projects/);
          return true;
        });
        checkWire();
        assert.equal(mock.requests.length, 2, 'no automatic retry after ignored format constraint');
        assert.deepEqual(matches.list(), savedBeforeFailure);
        assert.deepEqual(workspace.readWorkspace('match'), before);
        assert.equal(service.busy, false);
      } finally {
        service.cancelAll();
        workspace.close();
        store.close();
        matches.close();
        await mock.close();
      }
    });
  }
}
