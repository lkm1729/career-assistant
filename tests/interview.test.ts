import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { AiService, publicAiDiagnostic } from '../electron/ai-service';
import { WorkspaceStore } from '../electron/workspace-store';
import { MaterialStore } from '../electron/material-store';
import { InterviewStore } from '../electron/interview-store';
import { parseInterview } from '../shared/interview';
import { emptyCapabilities, emptyParameters } from '../shared/models';
import { responsesFixture } from './responses-fixture';
import { nativeFixture } from './native-fixture';

const text = Array.from(
  { length: 20 },
  (_, i) =>
    `Q${i + 1}. What happened ${i + 1}?\nQ${i + 1}-ZH. 第 ${i + 1} 题发生了什么？\nA${i + 1}. I applied a documented skill.\nA${i + 1}-ZH. 我运用了有据可查的技能。`,
).join('\n\n');
test('20 numbered English pairs are complete and ordered', () => {
  assert.equal(parseInterview(text).length, 20);
  assert.throws(() => parseInterview(text.replace('A5.', 'A6.')), /编号/);
  assert.throws(
    () => parseInterview(text.replace('Q2-ZH. 第 2 题发生了什么？', 'Q2-ZH. What happened?')),
    /中文翻译/,
  );
  assert.equal(parseInterview(text)[0].questionZh, '第 1 题发生了什么？');
  assert.throws(() => parseInterview(text.slice(0, -33)), /不完整|20组/);
});

test('interview uses isolated selected sources, confirmation snapshot, and local history', async () => {
  const fixture = await responsesFixture(() => text);
  const path = join(mkdtempSync(join(tmpdir(), 'interview-test-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  const ai = new AiStore(path, {
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  const materials = new MaterialStore(path);
  const interviews = new InterviewStore(path);
  const service = new AiService(ai, workspace, materials, undefined, undefined, interviews);
  try {
    const provider = ai.registry.saveProvider({
      name: 'Local mock',
      baseUrl: fixture.baseUrl,
      apiKey: 'FAKE-KEY',
      protocol: 'chat-completions',
    });
    const model = ai.registry.saveModel({
      providerId: provider.id,
      name: 'Fixture',
      modelId: 'fixture',
      protocol: 'inherit',
      capabilities: emptyCapabilities(),
      parameterSupport: emptyParameters(),
      parameters: {},
    });
    ai.registry.select('interview', model.id, {}, ai.registry.catalog().pages.interview.revision);
    workspace.saveWorkspace('interview', {
      ...workspace.readWorkspace('interview'),
      prompt: 'Job: engineer',
      resumeText: 'Candidate: worked on systems',
    });
    const selected = materials.importText('interview', 'evidence', {
      title: 'Selected',
      text: 'VISIBLE EVIDENCE',
    });
    materials.update('interview', selected[0].id, selected[0].revision, true);
    materials.importText('interview', 'evidence', {
      title: 'Private',
      text: 'SECRET UNSELECTED CONTENT',
    });
    materials.importText('resume', 'evidence', { title: 'Other page', text: 'SECRET OTHER PAGE' });
    const stale = service.prepareInterview(false);
    workspace.saveWorkspace('interview', {
      ...workspace.readWorkspace('interview'),
      prompt: 'changed job',
    });
    await assert.rejects(service.interview(stale), /变化/);
    const confirmation = service.prepareInterview(false);
    const result = await service.interview(confirmation);
    assert.equal(result.pairs.length, 20);
    assert.equal(interviews.list()[0].id, result.id);
    assert.equal(workspace.workbench.inspect('interview').hasResult, true);
    assert.equal(fixture.requests.length, 1);
    const wire = JSON.stringify(fixture.requests[0].body);
    assert.match(wire, /VISIBLE EVIDENCE/);
    assert.doesNotMatch(wire, /SECRET UNSELECTED CONTENT|SECRET OTHER PAGE|Private|Other page/);
    await assert.rejects(service.interview(confirmation), /已保存/);
    const job = materials
      .importText('interview', 'job', { title: 'Another role', text: 'Second job duties' })
      .at(-1)!;
    materials.update('interview', job.id, job.revision, true);
    const multiJob = service.prepareInterview(false);
    await assert.rejects(service.interview(multiJob), /岗位来源尚未确认/);
    assert.equal(fixture.requests.length, 1);
    multiJob.sameJobConfirmed = true;
    assert.equal((await service.interview(multiJob)).pairs.length, 20);
    assert.equal(fixture.requests.length, 2);
    const state = workspace.workbench.inspect('interview');
    workspace.workbench.clear(state);
    assert.equal(workspace.workbench.inspect('interview').hasResult, false);
    workspace.workbench.undo(workspace.workbench.inspect('interview'));
    assert.equal(workspace.workbench.inspect('interview').hasResult, true);
  } finally {
    interviews.close();
    materials.close();
    ai.close();
    workspace.close();
    await fixture.close();
  }
});

for (const protocol of ['responses', 'gemini', 'anthropic'] as const) {
  test(`interview generates across ${protocol} provider protocol`, async () => {
    const fixture =
      protocol === 'responses'
        ? await responsesFixture(() => text)
        : await nativeFixture(() => text);
    const path = join(mkdtempSync(join(tmpdir(), `interview-${protocol}-`)), 'workspace.sqlite');
    const workspace = new WorkspaceStore(path);
    const ai = new AiStore(path, {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
    });
    const materials = new MaterialStore(path);
    const interviews = new InterviewStore(path);
    const service = new AiService(ai, workspace, materials, undefined, undefined, interviews);
    try {
      const provider = ai.registry.saveProvider({
        name: 'Mock',
        baseUrl:
          typeof fixture.baseUrl === 'string'
            ? fixture.baseUrl
            : fixture.baseUrl(protocol === 'responses' ? 'gemini' : protocol),
        apiKey: 'FAKE-KEY',
        protocol,
      });
      const model = ai.registry.saveModel({
        providerId: provider.id,
        name: 'Fixture',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: emptyCapabilities(),
        parameterSupport: emptyParameters(),
        parameters: {},
      });
      ai.registry.select('interview', model.id, {}, ai.registry.catalog().pages.interview.revision);
      workspace.saveWorkspace('interview', {
        ...workspace.readWorkspace('interview'),
        prompt: 'Target role',
        resumeText: 'Candidate background',
      });
      const c = service.prepareInterview(false);
      const result = await service.interview(c);
      assert.equal(result.pairs.length, 20);
      assert.equal(fixture.requests.length, 1);
      assert.match(JSON.stringify(fixture.requests[0].body), /Candidate background/);
    } finally {
      interviews.close();
      materials.close();
      ai.close();
      workspace.close();
      await fixture.close();
    }
  });
}

// Service -> real protocol transport -> local stalled SSE. Scale only the clock;
// assert the production deadline value, exact AI_TIMEOUT, and no saved partial result.
for (const protocol of ['chat-completions', 'responses', 'gemini', 'anthropic'] as const) {
  test(`interview ${protocol}: long-form deadline remains finite, no incomplete result saved`, async (t) => {
    const fixture =
      protocol === 'gemini' || protocol === 'anthropic'
        ? await nativeFixture(() => text)
        : await responsesFixture(() => text);
    fixture.setMode('slow');
    const path = join(
      mkdtempSync(join(tmpdir(), `interview-deadline-${protocol}-`)),
      'workspace.sqlite',
    );
    const workspace = new WorkspaceStore(path);
    const ai = new AiStore(path, {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
    });
    const materials = new MaterialStore(path);
    const interviews = new InterviewStore(path);
    const service = new AiService(ai, workspace, materials, undefined, undefined, interviews);
    const deadlines: number[] = [];
    const idleLimits: number[] = [];
    if (protocol === 'anthropic') {
      const realTimer = globalThis.setTimeout;
      t.mock.method(
        globalThis,
        'setTimeout',
        (fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
          if (ms === 600_000) idleLimits.push(ms);
          return realTimer(fn, ms, ...args);
        },
      );
    }
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', (ms: number) => {
      deadlines.push(ms);
      return realTimeout(350);
    });
    try {
      const provider = ai.registry.saveProvider({
        name: 'Local mock',
        baseUrl:
          typeof fixture.baseUrl === 'string'
            ? fixture.baseUrl
            : fixture.baseUrl(
                protocol === 'chat-completions' || protocol === 'responses' ? 'gemini' : protocol,
              ),
        apiKey: 'FAKE-KEY',
        protocol,
      });
      const model = ai.registry.saveModel({
        providerId: provider.id,
        name: 'Fixture',
        modelId: 'fixture',
        protocol: 'inherit',
        capabilities: emptyCapabilities(),
        parameterSupport: emptyParameters(),
        parameters: {},
      });
      ai.registry.select('interview', model.id, {}, ai.registry.catalog().pages.interview.revision);
      workspace.saveWorkspace('interview', {
        ...workspace.readWorkspace('interview'),
        prompt: 'Target role',
        resumeText: 'Candidate background',
      });
      const before = workspace.readWorkspace('interview');
      await assert.rejects(service.interview(service.prepareInterview(false)), (error) => {
        assert.equal(publicAiDiagnostic(error).code, 'AI_TIMEOUT');
        return true;
      });
      assert.deepEqual(deadlines, [protocol === 'anthropic' ? 1_800_000 : 600_000]);
      if (protocol === 'anthropic')
        assert.ok(idleLimits.includes(600_000), 'native idle limit remains finite');
      assert.equal(fixture.requests.length, 1, 'never retry automatically');
      assert.deepEqual(interviews.list(), []);
      assert.deepEqual(workspace.readWorkspace('interview'), before);
      assert.equal(service.busy, false);
    } finally {
      service.cancelAll();
      t.mock.restoreAll();
      interviews.close();
      materials.close();
      ai.close();
      workspace.close();
      await fixture.close();
    }
  });
}
