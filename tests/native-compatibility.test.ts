import { publicAiDiagnostic, AiService } from '../electron/ai-service';
import { AiStore } from '../electron/ai-store';
import { WorkspaceStore } from '../electron/workspace-store';
import { nativeFixture } from './native-fixture';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiStream } from '../electron/gemini';
import { AnthropicStream } from '../electron/anthropic';
const frame = (value: unknown) => 'data: ' + JSON.stringify(value);

test('Gemini single candidate can omit index on text and STOP frames', () => {
  const parser = new GeminiStream(() => {});
  parser.frame(frame({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
  parser.frame(frame({ candidates: [{ finishReason: 'STOP' }] }));
  assert.equal(parser.finish(), 'OK');
});

test('Anthropic text content supplied in block_start is not lost or rejected', () => {
  const chunks: string[] = [];
  const parser = new AnthropicStream((text) => chunks.push(text));
  for (const event of [
    {
      type: 'message_start',
      message: {
        id: 'fixture',
        type: 'message',
        role: 'assistant',
        content: [],
        stop_reason: null,
        stop_sequence: null,
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'O' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'K' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
    { type: 'message_stop' },
  ])
    parser.frame(frame(event));
  assert.equal(parser.result, 'OK');
  assert.equal(chunks.join(''), 'OK');
});

function anthropicEvents() {
  return [
    {
      type: 'message_start',
      message: { id: 'fixture', type: 'message', role: 'assistant', content: [] },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'PRIVATE-THOUGHT' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'PRIVATE-SIGNATURE' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'O' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'K' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: {}, usage: { output_tokens: 2 } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ];
}
test('Anthropic compatible omitted nulls, delayed thinking signature, and usage-only delta preserve terminal checks', () => {
  const chunks: string[] = [];
  const parser = new AnthropicStream((text) => chunks.push(text));
  for (const event of anthropicEvents()) parser.frame(frame(event));
  assert.equal(parser.result, 'OK');
  assert.deepEqual(chunks, ['O', 'K']);
});
test('Anthropic usage-only delta cannot authorize a final result', () => {
  const events = anthropicEvents().filter((event) => event.delta?.stop_reason !== 'end_turn');
  const parser = new AnthropicStream(() => {});
  assert.throws(() => events.forEach((event) => parser.frame(frame(event))));
  assert.equal(parser.result, null);
});
test('Anthropic missing final thinking signature remains invalid', () => {
  const events = anthropicEvents().filter((event) => event.delta?.type !== 'signature_delta');
  const parser = new AnthropicStream(() => {});
  assert.throws(() => events.forEach((event) => parser.frame(frame(event))));
  assert.equal(parser.result, null);
});

for (const index of [1, -1, 0.5, '0', null]) {
  test(`Gemini still rejects explicit bad index ${index} with protocol diagnosis`, () => {
    const parser = new GeminiStream(() => {});
    assert.throws(
      () =>
        parser.frame(
          frame({
            candidates: [
              { index, content: { parts: [{ text: 'PRIVATE-BODY' }] }, finishReason: 'STOP' },
            ],
          }),
        ),
      (error: unknown) => {
        const diagnostic = publicAiDiagnostic(error);
        assert.equal(diagnostic.code, 'AI_GEMINI_STREAM_CANDIDATE_INDEX');
        assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE-BODY'));
        return true;
      },
    );
  });
}
test('Gemini omitted index does not allow incomplete or multiple candidates', () => {
  const parser = new GeminiStream(() => {});
  parser.frame(frame({ candidates: [{ content: { parts: [{ text: 'partial' }] } }] }));
  assert.throws(
    () => parser.finish(),
    (error: unknown) => publicAiDiagnostic(error).code === 'AI_GEMINI_STREAM_END',
  );
  assert.throws(() => new GeminiStream(() => {}).frame(frame({ candidates: [{}, {}] })));
});
test('Anthropic diagnostic names fixed parser stage without echoing private payloads', () => {
  const parser = new AnthropicStream(() => {});
  parser.frame(frame(anthropicEvents()[0]));
  assert.throws(
    () =>
      parser.frame(
        frame({
          type: 'content_block_start',
          index: 'PRIVATE-KEY',
          content_block: { type: 'text', text: 'PRIVATE-BODY' },
        }),
      ),
    (error: unknown) => {
      const diagnostic = publicAiDiagnostic(error);
      assert.equal(diagnostic.code, 'AI_ANTHROPIC_STREAM_CONTENT_BLOCK_START');
      assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE-'));
      return true;
    },
  );
});

for (const protocol of ['gemini', 'anthropic'] as const) {
  test(`${protocol} compatible HTTP streams pass per-model probes and persist isolated resume/letter versions`, async () => {
    const mock = await nativeFixture();
    mock.setMode('compatible');
    const database = join(mkdtempSync(join(tmpdir(), 'career-compatible-')), 'workspace.sqlite');
    const workspace = new WorkspaceStore(database);
    const store = new AiStore(database, {
      encrypt: (text) => Buffer.from('fixture:' + text),
      decrypt: (data) => data.toString().slice(8),
    });
    try {
      const provider = store.registry.saveProvider({
        name: 'fixture',
        baseUrl: mock.baseUrl(protocol),
        apiKey: 'FAKE-KEY',
        protocol,
      });
      const model = store.registry.saveModel({
        providerId: provider.id,
        modelId: 'native-model',
        name: 'fixture',
        protocol: 'inherit',
        capabilities: { files: 'unknown', images: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: {
          temperature: false,
          maxCompletionTokens: false,
          reasoningEffort: false,
        },
        parameters: {},
      });
      const service = new AiService(store, workspace);
      const connection = store.registry.modelCredentials(model.id).connection;
      await service.testModel(model.id, connection.revision, 'text');
      await service.testModel(model.id, connection.revision, 'image');
      assert.equal(store.registry.catalog().models[0].tests.filter((t) => t.ok).length, 2);
      for (const page of ['resume', 'letter'] as const) {
        store.registry.select(page, model.id, {}, store.registry.catalog().pages[page].revision);
        workspace.saveWorkspace(page, {
          ...workspace.readWorkspace(page),
          prompt: 'Fictional experience ' + page,
        });
        const version = await service.generate(
          {
            page,
            runId: 'compat-run-' + page,
            revision: store.registry.credentials(page).connection.revision,
            input: workspace.readWorkspace(page),
          },
          () => {},
        );
        assert.equal(version.number, 1);
        assert.ok(version.document.includes('原生协议生成正文'));
        assert.ok(!JSON.stringify(version).includes('PRIVATE-SIGNATURE'));
      }
      mock.setMode('truncated');
      await assert.rejects(
        service.generate(
          {
            page: 'resume',
            runId: 'compat-failed-resume',
            revision: store.registry.credentials('resume').connection.revision,
            input: workspace.readWorkspace('resume'),
          },
          () => {},
        ),
      );
      assert.equal(store.listVersions('resume').length, 1);
      assert.equal(store.listVersions('letter').length, 1);
    } finally {
      store.close();
      workspace.close();
      await mock.close();
    }
  });
}

test('native output caps are distinct from protocol lifecycle errors without leaking response text', () => {
  const gemini = new GeminiStream(() => {});
  assert.throws(
    () =>
      gemini.frame(
        frame({
          candidates: [
            {
              index: 0,
              finishReason: 'MAX_TOKENS',
              content: { parts: [{ text: 'PRIVATE-DO-NOT-LOG' }] },
            },
          ],
        }),
      ),
    (error) => {
      const diagnostic = publicAiDiagnostic(error);
      assert.equal(diagnostic.code, 'AI_OUTPUT_LIMIT');
      assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE'));
      return true;
    },
  );
  const anthropic = new AnthropicStream(() => {});
  anthropic.frame(
    frame({
      type: 'message_start',
      message: { id: 'fixture', type: 'message', role: 'assistant', content: [] },
    }),
  );
  assert.throws(
    () => anthropic.frame(frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } })),
    (error) => {
      assert.equal(publicAiDiagnostic(error).code, 'AI_OUTPUT_LIMIT');
      return true;
    },
  );
});
