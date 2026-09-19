import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatEndpoint } from '../shared/ai.js';
import { AiStore } from '../electron/ai-store.js';
import { WorkspaceStore } from '../electron/workspace-store.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const key = randomBytes(32);
const vault = {
  encrypt(text: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  },
  decrypt(data: Buffer) {
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
  },
};
const input = {
  providerName: '测试供应商',
  baseUrl: 'https://example.com/v1',
  modelId: 'test-model',
  modelName: '测试模型',
  apiKey: 'fake-test-secret-DO-NOT-LOG',
};
test('endpoint paths preserve proxy prefixes and reject unsafe destinations', () => {
  assert.equal(chatEndpoint('https://example.com'), 'https://example.com/v1/chat/completions');
  assert.equal(
    chatEndpoint('https://example.com/proxy/v1/'),
    'https://example.com/proxy/v1/chat/completions',
  );
  assert.equal(
    chatEndpoint('https://example.com/v1/chat/completions/'),
    'https://example.com/v1/chat/completions',
  );
  assert.throws(() => chatEndpoint('https://user:pass@example.com/v1'));
  assert.throws(() => chatEndpoint('http://example.com/v1'));
  assert.throws(() => chatEndpoint('https://example.com/v1?api_key=x'));
});
test('connection secrets stay encrypted; metadata is public and endpoint changes retain the existing key', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'career-ai-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  workspace.saveWorkspace('letter', {
    ...workspace.readWorkspace('letter'),
    prompt: '旧版求职信草稿',
  });
  const store = new AiStore(path, vault);
  const connection = store.saveConnection(input);
  assert.equal(JSON.stringify(connection).includes(input.apiKey), false);
  assert.equal(store.credentials().apiKey, input.apiKey);
  store.saveConnection({ ...input, modelName: '改名', apiKey: '' });
  assert.equal(store.credentials().apiKey, input.apiKey);
  store.saveConnection({ ...input, baseUrl: 'https://other.example/v1', apiKey: '' });
  assert.equal(store.credentials().apiKey, input.apiKey);
  assert.equal(store.getConnection()?.endpoint, 'https://other.example/v1/chat/completions');
  assert.equal(workspace.readWorkspace('letter').prompt, '旧版求职信草稿');
  store.close();
  workspace.close();
  assert.equal(readFileSync(path).includes(Buffer.from(input.apiKey)), false);
});

test('completed versions append atomically, preserve input and do not duplicate run IDs', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'career-version-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  const draft = { ...workspace.readWorkspace('resume'), prompt: '经历', document: '手动草稿' };
  workspace.saveWorkspace('resume', draft);
  const store = new AiStore(path, vault);
  const connection = store.saveConnection(input);
  const request = {
    runId: 'run-id-12345',
    revision: connection.revision,
    input: { prompt: draft.prompt, systemPrompt: draft.systemPrompt, document: draft.document },
  };
  const result = { document: '# 正式简历', suggestions: '建议', rationale: '说明' };
  assert.equal(store.complete(request, connection, result).number, 1);
  assert.equal(store.complete(request, connection, result).number, 1);
  assert.equal(store.listVersions().length, 1);
  assert.equal(store.listVersions()[0].input.document, '手动草稿');
  assert.equal(workspace.readWorkspace('resume').document, '# 正式简历');
  assert.equal(workspace.readWorkspace('letter').document, '');
  assert.throws(() => store.complete({ ...request, runId: 'run-id-67890' }, connection, result));
  assert.equal(store.listVersions().length, 1);
  store.removeConnection();
  assert.equal(store.listVersions().length, 1);
  store.close();
  workspace.close();
  const reopened = new AiStore(path, vault);
  assert.equal(reopened.listVersions()[0].document, '# 正式简历');
  reopened.close();
});

test('refinement creates a child version and restore is non-destructive', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'career-p04-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  workspace.saveWorkspace('resume', {
    ...workspace.readWorkspace('resume'),
    prompt: '经历',
    document: '手动草稿',
  });
  const store = new AiStore(path, vault);
  const connection = store.saveConnection(input);
  const firstDraft = workspace.readWorkspace('resume');
  const first = store.complete(
    {
      runId: 'p04-first-run',
      revision: connection.revision,
      input: {
        prompt: firstDraft.prompt,
        systemPrompt: firstDraft.systemPrompt,
        document: firstDraft.document,
      },
    },
    connection,
    { document: '# V1', suggestions: '建议1', rationale: '说明1' },
  );
  assert.equal(first.number, 1);
  assert.equal(workspace.readWorkspace('resume').currentVersionNumber, 1);

  workspace.saveWorkspace('resume', {
    ...workspace.readWorkspace('resume'),
    refinement: '突出项目成果并缩短到一页',
  });
  const refineDraft = workspace.readWorkspace('resume');
  const second = store.complete(
    {
      runId: 'p04-refine-run',
      revision: connection.revision,
      operation: 'refine',
      refinement: refineDraft.refinement,
      input: {
        prompt: refineDraft.prompt,
        systemPrompt: refineDraft.systemPrompt,
        document: refineDraft.document,
      },
    },
    connection,
    { document: '# V2', suggestions: '建议2', rationale: '说明2' },
  );
  assert.equal(second.number, 2);
  assert.equal(second.operation, 'refine');
  assert.equal(second.refinement, '突出项目成果并缩短到一页');
  assert.equal(second.parentNumber, 1);
  assert.equal(second.input.document, '# V1');
  assert.equal(workspace.readWorkspace('resume').refinement, '');
  assert.equal(workspace.readWorkspace('resume').currentVersionNumber, 2);

  const restored = store.restoreVersion(1, workspace.readWorkspace('resume'));
  assert.equal(restored.number, 1);
  assert.deepEqual(restored, first);
  assert.equal(store.listVersions().length, 2);
  assert.equal(workspace.readWorkspace('resume').document, '# V1');
  assert.equal(workspace.readWorkspace('resume').currentVersionNumber, 1);
  assert.equal(store.historyState('resume').checkpoints[0].draft.currentVersionNumber, 2);
  store.close();
  workspace.close();
});

test('encryption failure and changed input cannot overwrite existing saved state', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'career-failure-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  workspace.saveWorkspace('resume', { ...workspace.readWorkspace('resume'), prompt: '真实经历' });
  const store = new AiStore(path, vault);
  const connection = store.saveConnection(input);
  const draft = workspace.readWorkspace('resume');
  const request = {
    runId: 'first-run-version',
    revision: connection.revision,
    input: { prompt: draft.prompt, systemPrompt: draft.systemPrompt, document: draft.document },
  };
  const result = { document: '# V1', suggestions: '建议1', rationale: '说明1' };
  store.complete(request, connection, result);
  const second = {
    ...request,
    runId: 'second-run-version',
    input: { ...request.input, document: '# V1' },
  };
  assert.equal(store.complete(second, connection, { ...result, document: '# V2' }).number, 2);
  assert.equal(store.listVersions()[1].document, '# V1');
  assert.equal(store.listVersions()[0].document, '# V2');
  store.close();
  const unavailable = new AiStore(path, {
    encrypt() {
      throw new Error('Unavailable');
    },
    decrypt: vault.decrypt,
  });
  assert.throws(() => unavailable.saveConnection({ ...input, apiKey: 'replacement-fake-key' }));
  assert.equal(unavailable.getConnection()?.revision, connection.revision);
  assert.equal(unavailable.credentials().apiKey, input.apiKey);
  unavailable.close();
  workspace.close();
});

test('failed draft update rolls back the version insert in the same transaction', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(mkdtempSync(join(tmpdir(), 'career-atomic-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  workspace.saveWorkspace('resume', {
    ...workspace.readWorkspace('resume'),
    prompt: '已有经历',
    document: '已有正文',
  });
  const store = new AiStore(path, vault);
  const connection = store.saveConnection(input);
  const draft = workspace.readWorkspace('resume');
  const fault = new DatabaseSync(path);
  fault.exec(
    "CREATE TRIGGER fail_draft_update BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
  );
  assert.throws(() =>
    store.complete(
      {
        runId: 'atomic-failed-run',
        revision: connection.revision,
        input: { prompt: draft.prompt, systemPrompt: draft.systemPrompt, document: draft.document },
      },
      connection,
      { document: '新正文', suggestions: '建议', rationale: '说明' },
    ),
  );
  assert.equal(store.listVersions().length, 0);
  assert.equal(workspace.readWorkspace('resume').document, '已有正文');
  fault.close();
  store.close();
  workspace.close();
});

for (const changed of ['prompt', 'systemPrompt', 'document', 'refinement', 'links'] as const) {
  test(`restore refuses a stale ${changed} confirmation without losing drafts or history`, () => {
    const path = join(mkdtempSync(join(tmpdir(), 'career-p04-stale-')), 'workspace.sqlite');
    const workspace = new WorkspaceStore(path);
    const store = new AiStore(path, vault);
    try {
      const connection = store.saveConnection(input);
      const original = workspace.readWorkspace('resume');
      store.complete(
        { runId: 'restore-stale-seed', revision: connection.revision, input: original },
        connection,
        { document: '# V1', suggestions: '建议', rationale: '说明' },
      );
      const expected = workspace.readWorkspace('resume');
      workspace.saveWorkspace('resume', { ...expected, [changed]: '最近编辑，不能被覆盖' });
      const before = workspace.readWorkspace('resume');
      assert.throws(() => store.restoreVersion(1, expected), /确认后已改变/);
      assert.deepEqual(workspace.readWorkspace('resume'), before);
      assert.equal(store.listVersions().length, 1);
    } finally {
      store.close();
      workspace.close();
    }
  });
}

test('restore preserves current inputs and pending manual edits in its snapshot, survives reopening without a provider', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'career-p04-restore-')), 'workspace.sqlite');
  let workspace = new WorkspaceStore(path);
  let store = new AiStore(path, vault);
  const connection = store.saveConnection(input);
  const first = workspace.readWorkspace('resume');
  const source = store.complete(
    { runId: 'restore-offline-seed', revision: connection.revision, input: first },
    connection,
    { document: '# 来源正文', suggestions: '来源建议', rationale: '来源说明' },
  );
  workspace.saveWorkspace('resume', {
    ...workspace.readWorkspace('resume'),
    document: '未形成正式版本的手改正文',
    prompt: '新经历',
    systemPrompt: '新系统提示词',
    refinement: '未执行的修改要求',
    currentVersionNumber: null,
  });
  const before = workspace.readWorkspace('resume');
  store.removeConnection();
  const restored = store.restoreVersion(1, before);
  assert.equal(restored.number, 1);
  assert.deepEqual(restored, source);
  assert.equal(restored.parentNumber, null);
  assert.deepEqual(store.historyState('resume').checkpoints[0].draft, before);
  assert.equal(restored.suggestions, source.suggestions);
  assert.equal(restored.rationale, source.rationale);
  assert.equal(workspace.readWorkspace('resume').prompt, before.prompt);
  assert.equal(workspace.readWorkspace('resume').systemPrompt, before.systemPrompt);
  assert.equal(workspace.readWorkspace('resume').refinement, '');
  assert.deepEqual(store.listVersions()[0], source);
  store.close();
  workspace.close();
  workspace = new WorkspaceStore(path);
  store = new AiStore(path, vault);
  try {
    assert.equal(store.getConnection(), null);
    assert.deepEqual(store.listVersions()[0], restored);
    assert.equal(workspace.readWorkspace('resume').currentVersionNumber, 1);
    assert.throws(() => store.restoreVersion(999, workspace.readWorkspace('resume')), /找不到/);
    assert.equal(store.listVersions().length, 1);
  } finally {
    store.close();
    workspace.close();
  }
});

test('rollback draft write failure rolls back the checkpoint and retains the prior content', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(mkdtempSync(join(tmpdir(), 'career-p04-atomic-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  const store = new AiStore(path, vault);
  const fault = new DatabaseSync(path);
  try {
    const connection = store.saveConnection(input);
    store.complete(
      {
        runId: 'restore-atomic-seed',
        revision: connection.revision,
        input: workspace.readWorkspace('resume'),
      },
      connection,
      { document: '# V1', suggestions: '建议', rationale: '说明' },
    );
    workspace.saveWorkspace('resume', {
      ...workspace.readWorkspace('resume'),
      document: 'manual edit before rollback',
    });
    const before = workspace.readWorkspace('resume');
    const history = store.listVersions();
    fault.exec(
      "CREATE TRIGGER fail_restore BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT, 'simulated restore failure'); END;",
    );
    assert.throws(() => store.restoreVersion(1, before), /simulated restore failure/);
    assert.deepEqual(store.listVersions(), history);
    assert.equal(store.historyState('resume').checkpoints.length, 0);
    assert.deepEqual(workspace.readWorkspace('resume'), before);
  } finally {
    fault.close();
    store.close();
    workspace.close();
  }
});

test('a changed refinement cannot publish a version or consume the new instruction', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'career-p04-refine-')), 'workspace.sqlite');
  const workspace = new WorkspaceStore(path);
  const store = new AiStore(path, vault);
  try {
    const connection = store.saveConnection(input);
    workspace.saveWorkspace('resume', {
      ...workspace.readWorkspace('resume'),
      document: '原正文',
      refinement: '第一次要求',
    });
    const old = workspace.readWorkspace('resume');
    workspace.saveWorkspace('resume', { ...old, refinement: '更新的要求' });
    assert.throws(
      () =>
        store.complete(
          {
            runId: 'refine-stale-input',
            revision: connection.revision,
            operation: 'refine',
            refinement: old.refinement,
            input: old,
          },
          connection,
          { document: '不能发布', suggestions: '', rationale: '' },
        ),
      /输入在生成期间已改变/,
    );
    assert.equal(store.listVersions().length, 0);
    assert.equal(workspace.readWorkspace('resume').refinement, '更新的要求');
    assert.equal(workspace.readWorkspace('resume').document, '原正文');
  } finally {
    store.close();
    workspace.close();
  }
});
