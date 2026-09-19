import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AiStore } from '../electron/ai-store.js';
import { WorkspaceStore } from '../electron/workspace-store.js';
import { AiService } from '../electron/ai-service.js';
import { emptyCapabilities, emptyParameters } from '../shared/models.js';
import { nativeFixture } from './native-fixture.js';
for (const protocol of ['gemini', 'anthropic'] as const)
  test(`${protocol}: letter generation, refine, rollback and trash never read resume data`, async () => {
    const fixture = await nativeFixture();
    const path = join(mkdtempSync(join(tmpdir(), 'career-letter-')), 'workspace.sqlite');
    const workspace = new WorkspaceStore(path);
    const store = new AiStore(path, {
      encrypt: (s) => Buffer.from(s),
      decrypt: (b) => b.toString(),
    });
    try {
      const p = store.registry.saveProvider({
        name: 'Fixture',
        protocol,
        baseUrl: fixture.baseUrl(protocol),
        apiKey: 'FAKE',
      });
      const m = store.registry.saveModel({
        providerId: p.id,
        modelId: 'native-model',
        name: 'Model',
        protocol: 'inherit',
        capabilities: emptyCapabilities(),
        parameterSupport: emptyParameters(),
        parameters: {},
      });
      store.registry.select('letter', m.id, {}, store.registry.catalog().pages.letter.revision);
      workspace.saveWorkspace('resume', {
        ...workspace.readWorkspace('resume'),
        prompt: 'PRIVATE-RESUME-NEVER-SEND',
        document: 'PRIVATE-RESUME-DOCUMENT',
      });
      workspace.saveWorkspace('letter', {
        ...workspace.readWorkspace('letter'),
        prompt: 'Letter-only facts',
        links: 'https://private-link.invalid',
      });
      const before = workspace.readWorkspace('resume');
      const service = new AiService(store, workspace);
      const request = () => ({
        page: 'letter' as const,
        runId: randomUUID(),
        revision: store.registry.connection('letter')!.revision,
        input: workspace.readWorkspace('letter'),
      });
      const v1 = await service.generate(request(), () => {});
      workspace.saveWorkspace('letter', {
        ...workspace.readWorkspace('letter'),
        refinement: 'shorter',
      });
      const v2 = await service.generate(
        { ...request(), operation: 'refine', refinement: 'shorter' },
        () => {},
      );
      assert.equal(v1.number, 1);
      assert.equal(v2.number, 2);
      assert.equal(v2.parentNumber, 1);
      assert.deepEqual(workspace.readWorkspace('resume'), before);
      assert.equal(store.listVersions('resume').length, 0);
      assert.equal(store.restoreVersion(1, workspace.readWorkspace('letter'), 'letter').number, 1);
      store.deleteVersions('letter', [v2], workspace.readWorkspace('letter'));
      assert.equal(store.listVersions('letter').length, 1);
      store.recoverVersions('letter', [v2]);
      const sent = JSON.stringify(fixture.requests.map((r) => r.body));
      assert.ok(!sent.includes('PRIVATE-RESUME'));
      assert.ok(!sent.includes('private-link.invalid'));
      assert.ok(sent.includes('currentLetter'));
      assert.ok(!sent.includes('currentResume'));
      assert.ok(sent.includes('Markdown 求职信正文'));
      assert.ok(!sent.includes('Markdown 简历正文'));
      const draft = workspace.readWorkspace('letter');
      fixture.setMode('unauthorized');
      await assert.rejects(
        service.generate(request(), () => {}),
        /HTTP 401/,
      );
      assert.deepEqual(workspace.readWorkspace('letter'), draft);
    } finally {
      store.close();
      workspace.close();
      await fixture.close();
    }
  });
