import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { WorkspaceStore } from '../electron/workspace-store';
import { MaterialStore } from '../electron/material-store';
import { ScoreStore } from '../electron/scoring';
import { AiService } from '../electron/ai-service';
import { emptyCapabilities, emptyParameters } from '../shared/models';
import { responsesFixture } from './responses-fixture';

async function fixture() {
  const answer = JSON.stringify({
    dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
      key,
      score: key === 'visual' ? null : 80,
      evidence: key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'Fictional resume' }],
      issues: [],
      suggestions: [],
    })),
    summary: 'Fictional evaluation',
    coveredPages: [],
    unreadablePages: [],
    conflicts: [],
  });
  const mock = await responsesFixture(() => answer);
  const path = join(mkdtempSync(join(tmpdir(), 'o7-score-')), 'db');
  const workspace = new WorkspaceStore(path);
  const store = new AiStore(path, {
    encrypt: (s) => Buffer.from('fake:' + s),
    decrypt: (b) => b.toString().slice(5),
  });
  const materials = new MaterialStore(path);
  const scores = new ScoreStore(path);
  const service = new AiService(store, workspace, materials, scores);
  const provider = store.registry.saveProvider({
    name: 'O7 fixture',
    baseUrl: mock.baseUrl,
    apiKey: 'FAKE-KEY',
    protocol: 'responses',
  });
  const model = store.registry.saveModel({
    providerId: provider.id,
    name: 'Fixture',
    modelId: 'fixture',
    protocol: 'inherit',
    capabilities: emptyCapabilities(),
    parameterSupport: emptyParameters(),
    parameters: {},
  });
  store.registry.select('score', model.id, {}, store.registry.catalog().pages.score.revision);
  workspace.saveWorkspace('score', {
    ...workspace.readWorkspace('score'),
    document: 'Fictional resume',
  });
  function add(name: string, purpose: 'job' | 'evidence', selected = true) {
    const item = materials
      .importWeb('score', purpose, {
        url: `https://example.com/${name}`,
        title: name,
        text: `Fictional ${name} body`,
        warnings: [],
      })
      .at(-1)!;
    if (selected) materials.update('score', item.id, item.revision, true);
  }
  return {
    mock,
    materials,
    service,
    scores,
    add,
    workspace,
    close: async () => {
      scores.close();
      materials.close();
      store.close();
      workspace.close();
      await mock.close();
    },
  };
}

test('O7 selected job webpage alone chooses targeted score mode without sending unselected or cross-page sources', async () => {
  const f = await fixture();
  try {
    f.add('selected-job', 'job');
    f.add('selected-project', 'evidence');
    f.add('SECRET-UNSELECTED', 'job', false);
    f.materials.importWeb('resume', 'evidence', {
      url: 'https://example.com/PRIVATE-OTHER-PAGE',
      title: 'PRIVATE-OTHER-PAGE',
      text: 'PRIVATE-OTHER-PAGE body',
      warnings: [],
    });
    const record = await f.service.score(f.service.prepareScore(false));
    assert.equal(record.mode, 'targeted');
    assert.equal(record.total, null, 'text-only input must not acquire a visual score');
    const body = JSON.stringify(f.mock.requests[0].body);
    assert.ok(body.includes('targeted'));
    assert.ok(body.includes('selected-job'));
    assert.ok(body.includes('selected-project'));
    assert.ok(!body.includes('SECRET-UNSELECTED'));
    assert.ok(!body.includes('PRIVATE-OTHER-PAGE'));
    for (const item of f.materials.list('score').filter((i) => i.selected && i.purpose === 'job'))
      f.materials.update('score', item.id, item.revision, false);
    const general = await f.service.score(f.service.prepareScore(false));
    assert.equal(general.mode, 'general', 'project evidence does not imply a target job');
  } finally {
    await f.close();
  }
});

test('O7 multiple selected job sources require fresh explicit consent before any provider request', async () => {
  const f = await fixture();
  try {
    f.add('job-one', 'job');
    f.add('job-two', 'job');
    const confirmation = f.service.prepareScore(false);
    await assert.rejects(f.service.score(confirmation), /多份岗位来源/);
    assert.equal(f.mock.requests.length, 0);
    assert.equal(f.scores.list().length, 0);
    const accepted = { ...confirmation, sameJobConfirmed: true };
    const record = await f.service.score(accepted);
    assert.equal(record.mode, 'targeted');
    assert.equal(f.mock.requests.length, 1);
    const fresh = f.service.prepareScore(false);
    await assert.rejects(f.service.score(fresh), /多份岗位来源/);
    assert.equal(f.mock.requests.length, 1);
    const item = f.materials.list('score')[0];
    f.materials.setPurpose('score', item.id, item.revision, 'evidence');
    await assert.rejects(f.service.score({ ...fresh, sameJobConfirmed: true }), /确认后已变化/);
    assert.equal(f.mock.requests.length, 1);
  } finally {
    await f.close();
  }
});
