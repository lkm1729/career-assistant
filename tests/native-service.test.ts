import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AiStore } from '../electron/ai-store.js';
import { WorkspaceStore } from '../electron/workspace-store.js';
import { AiService } from '../electron/ai-service.js';
import { emptyCapabilities, emptyParameters } from '../shared/models.js';
import { nativeFixture, type NativeProtocol } from './native-fixture.js';

for (const protocol of ['gemini', 'anthropic'] as const) {
  async function fixture() {
    const mock = await nativeFixture();
    const path = join(mkdtempSync(join(tmpdir(), 'career-native-')), 'workspace.sqlite');
    const workspace = new WorkspaceStore(path);
    const store = new AiStore(path, {
      encrypt: (s) => Buffer.from('fake:' + s),
      decrypt: (s) => s.toString().slice(5),
    });
    const provider = store.registry.saveProvider({
      name: protocol,
      baseUrl: mock.baseUrl(protocol),
      apiKey: 'NATIVE-FAKE',
      protocol,
    });
    const model = store.registry.saveModel({
      name: protocol,
      modelId: 'native-model',
      providerId: provider.id,
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
      refinement: '待处理修改',
    });
    workspace.saveWorkspace('letter', {
      ...workspace.readWorkspace('letter'),
      prompt: 'OTHER-PAGE-PRIVATE',
    });
    const request = () => ({
      runId: 'native-run-' + store.listVersions().length,
      revision: store.getConnection()!.revision,
      input: workspace.readWorkspace('resume'),
    });
    return {
      ...mock,
      store,
      workspace,
      model,
      path,
      request,
      service: new AiService(store, workspace),
      close: async () => {
        store.close();
        workspace.close();
        await mock.close();
      },
    };
  }
  test(
    protocol +
      ' service: independent probes, V1/refine/restore and reopen retain exact protocol without cross-page data',
    async () => {
      const f = await fixture();
      try {
        for (const kind of ['text', 'image'] as const)
          await f.service.testModel(
            f.model.id,
            f.store.registry.modelConnection(f.model.id).revision,
            kind,
          );
        assert.equal(f.store.registry.catalog().models[0].tests.length, 2);
        const v1 = await f.service.generate(f.request(), () => {});
        f.workspace.saveWorkspace('resume', {
          ...f.workspace.readWorkspace('resume'),
          refinement: '待处理修改',
        });
        const v2 = await f.service.generate(
          { ...f.request(), operation: 'refine', refinement: '待处理修改' },
          () => {},
        );
        assert.equal(v1.connection.protocol, protocol);
        assert.equal(v2.parentNumber, 1);
        const v3 = f.store.restoreVersion(1, f.workspace.readWorkspace('resume'));
        assert.deepEqual(v3, v1);
        assert.equal(f.store.listVersions().length, 2);
        assert.equal(f.requests.length, 4);
        assert.equal(f.workspace.readWorkspace('resume').currentVersionNumber, 1);
        assert.ok(!JSON.stringify(f.requests.map((r) => r.body)).includes('OTHER-PAGE-PRIVATE'));
        assert.ok(f.requests.every((r) => !r.headers.authorization));
        assert.equal(
          f.requests[0].headers[protocol === 'gemini' ? 'x-goog-api-key' : 'x-api-key'],
          'NATIVE-FAKE',
        );
        assert.ok(!JSON.stringify(f.store.listVersions()).includes('NATIVE-FAKE'));
        const reopened = new WorkspaceStore(f.path);
        try {
          assert.equal(reopened.readWorkspace('resume').document, '# 原生协议生成正文');
        } finally {
          reopened.close();
        }
      } finally {
        await f.close();
      }
    },
  );
  test(
    protocol +
      ' service: failure, refusal, incomplete, invalid, cancellation and stale config never consume drafts',
    async () => {
      const f = await fixture();
      try {
        const before = f.workspace.readWorkspace('resume');
        for (const mode of [
          'incomplete',
          'failed',
          'refusal',
          'truncated',
          'unauthorized',
          'invalid',
        ] as const) {
          f.setMode(mode);
          await assert.rejects(f.service.generate(f.request(), () => {}));
          assert.deepEqual(f.workspace.readWorkspace('resume'), before);
          assert.equal(f.store.listVersions().length, 0);
          assert.equal(f.service.busy, false);
        }
        f.setMode('slow');
        const request = f.request();
        await assert.rejects(
          f.service.generate(request, () => f.service.cancel(request.runId)),
          /已取消/,
        );
        assert.deepEqual(f.workspace.readWorkspace('resume'), before);
        const count = f.requests.length;
        f.store.registry.saveModel({ ...f.model, modelId: 'changed-model' });
        await assert.rejects(
          f.service.generate(request, () => {}),
          /配置已变更/,
        );
        assert.equal(f.requests.length, count);
        assert.equal(f.store.listVersions().length, 0);
      } finally {
        await f.close();
      }
    },
  );
}
