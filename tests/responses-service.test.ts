import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AiStore } from '../electron/ai-store.js';
import { WorkspaceStore } from '../electron/workspace-store.js';
import { AiService } from '../electron/ai-service.js';
import { emptyCapabilities, emptyParameters } from '../shared/models.js';
import { responsesFixture } from './responses-fixture.js';
async function fixture() {
  const mock = await responsesFixture();
  const path = join(mkdtempSync(join(tmpdir(), 'career-p05-service-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  const store = new AiStore(path, {
    encrypt: (text) => Buffer.from('fake:' + text),
    decrypt: (data) => data.toString().slice(5),
  });
  const provider = store.registry.saveProvider({
    name: 'P05',
    baseUrl: mock.baseUrl,
    apiKey: 'test-only-key',
    protocol: 'responses',
  });
  const model = store.registry.saveModel({
    providerId: provider.id,
    name: 'P05',
    modelId: 'mock',
    protocol: 'inherit',
    capabilities: emptyCapabilities(),
    parameterSupport: emptyParameters(),
    parameters: {},
  });
  store.registry.select('resume', model.id, {}, store.registry.catalog().pages.resume.revision);
  workspace.saveWorkspace('resume', {
    ...workspace.readWorkspace('resume'),
    prompt: '真实经历',
    document: '原正文',
    refinement: '保留修改要求',
  });
  const request = {
    runId: 'p05-service-run',
    revision: store.getConnection()!.revision,
    input: workspace.readWorkspace('resume'),
    operation: 'refine' as const,
    refinement: '保留修改要求',
  };
  return {
    ...mock,
    store,
    workspace,
    model,
    request,
    service: new AiService(store, workspace),
    cleanup: async () => {
      store.close();
      workspace.close();
      await mock.close();
    },
  };
}
test('Responses service completion persists protocol and refinement, duplicate run ID never repeats a paid request', async () => {
  const f = await fixture();
  try {
    const version = await f.service.generate(f.request, () => {});
    assert.equal(version.connection.protocol, 'responses');
    assert.equal(version.refinement, '保留修改要求');
    assert.equal(f.workspace.readWorkspace('resume').currentVersionNumber, 1);
    await assert.rejects(
      f.service.generate(
        { ...f.request, operation: 'generate', input: f.workspace.readWorkspace('resume') },
        () => {},
      ),
      /本次运行已保存/,
    );
    assert.equal(f.requests.length, 1);
    assert.equal(f.store.listVersions().length, 1);
  } finally {
    await f.cleanup();
  }
});
test('Responses service rejects protocol configuration changed after confirmation before any network request', async () => {
  const f = await fixture();
  try {
    f.store.registry.saveModel({ ...f.model, protocol: 'chat-completions' });
    await assert.rejects(
      f.service.generate(f.request, () => {}),
      /配置已变更/,
    );
    assert.equal(f.requests.length, 0);
    assert.equal(f.store.listVersions().length, 0);
    assert.equal(f.workspace.readWorkspace('resume').document, '原正文');
  } finally {
    await f.cleanup();
  }
});
test('Responses service rejects incomplete, failed, refused, invalid and interrupted generations without consuming drafts', async () => {
  const f = await fixture();
  try {
    const before = f.workspace.readWorkspace('resume');
    for (const mode of ['incomplete', 'failed', 'refusal', 'truncated', 'invalid'] as const) {
      f.setMode(mode);
      await assert.rejects(f.service.generate(f.request, () => {}));
      assert.deepEqual(f.workspace.readWorkspace('resume'), before);
      assert.equal(f.store.listVersions().length, 0);
      assert.equal(f.service.busy, false);
    }
    f.setMode('slow');
    await assert.rejects(
      f.service.generate(f.request, () => f.service.cancel(f.request.runId)),
      /已取消/,
    );
    assert.deepEqual(f.workspace.readWorkspace('resume'), before);
    assert.equal(f.store.listVersions().length, 0);
  } finally {
    await f.cleanup();
  }
});
