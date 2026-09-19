import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { WorkspaceStore } from '../electron/workspace-store';
import { MaterialStore } from '../electron/material-store';
import { ScoreStore } from '../electron/scoring';
import { AiService } from '../electron/ai-service';
import { emptyCapabilities, emptyParameters } from '../shared/models';
import { nativeFixture } from './native-fixture';
import { responsesFixture } from './responses-fixture';
for (const protocol of ['chat-completions', 'responses', 'gemini', 'anthropic'] as const) {
  test(
    protocol +
      ' P08/P09: actual service wire images, independent history, invalid result, stale consent and vision fallback',
    async () => {
      let answer = JSON.stringify({
        document: '# generated',
        suggestions: 'advice',
        rationale: 'sources',
      });
      const mock =
        protocol === 'gemini' || protocol === 'anthropic'
          ? await nativeFixture(() => answer)
          : await responsesFixture(() => answer);
      const baseUrl =
        typeof mock.baseUrl === 'string'
          ? mock.baseUrl
          : mock.baseUrl(protocol as 'gemini' | 'anthropic');
      const dir = mkdtempSync(join(tmpdir(), 'material-score-'));
      const path = join(dir, 'db');
      const file = join(dir, 'cv.png');
      writeFileSync(file, 'fictional bytes');
      const workspace = new WorkspaceStore(path);
      const store = new AiStore(path, {
        encrypt: (s) => Buffer.from('fake:' + s),
        decrypt: (b) => b.toString().slice(5),
      });
      const materials = new MaterialStore(path);
      const scores = new ScoreStore(path);
      const service = new AiService(store, workspace, materials, scores);
      try {
        const provider = store.registry.saveProvider({
          name: 'fixture',
          baseUrl,
          apiKey: 'FAKE-KEY',
          protocol,
        });
        const model = store.registry.saveModel({
          providerId: provider.id,
          name: 'model',
          modelId: 'model',
          protocol: 'inherit',
          capabilities: {
            ...emptyCapabilities(),
            images: 'supported',
            structuredOutput: 'supported',
          },
          parameterSupport: emptyParameters(),
          parameters: {},
        });
        for (const page of ['resume', 'score'] as const) {
          store.registry.select(page, model.id, {}, store.registry.catalog().pages[page].revision);
          const [item] = await materials.importPaths(
            page,
            'resume',
            [file],
            async () => ({
              pages: [
                {
                  number: 1,
                  text: 'Source evidence',
                  image: 'data:image/png;base64,AQID',
                  source: 'image',
                  warnings: [],
                  width: 1000,
                  height: 1400,
                },
              ],
              totalPages: 1,
              warnings: [],
            }),
            new AbortController().signal,
          );
          materials.update(page, item.id, item.revision, true);
        }
        workspace.saveWorkspace('resume', {
          ...workspace.readWorkspace('resume'),
          prompt: 'RESUME-PRIVATE',
        });
        workspace.saveWorkspace('letter', {
          ...workspace.readWorkspace('letter'),
          prompt: 'LETTER-PRIVATE',
        });
        const manifest = materials.manifest('resume', true);
        const v = await service.generate(
          {
            runId: 'material-run-1',
            revision: store.getConnection()!.revision,
            input: workspace.readWorkspace('resume'),
            materials: { revision: manifest.revision, sendImages: true },
          },
          () => {},
        );
        assert.ok(v.materials);
        assert.equal(store.listVersions().length, 1);
        const first = JSON.stringify(mock.requests[0].body);
        assert.ok(first.includes('AQID'));
        assert.ok(!first.includes('LETTER-PRIVATE'));
        const expected =
          protocol === 'gemini'
            ? 'inlineData'
            : protocol === 'anthropic'
              ? '"type":"image"'
              : protocol === 'responses'
                ? 'input_image'
                : 'image_url';
        assert.ok(first.includes(expected));
        const id = materials.list('score')[0].id + ':p1';
        const output = (images: boolean) => ({
          dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
            key,
            score: key === 'visual' && !images ? null : 80,
            evidence:
              key === 'visual' && !images ? [] : [{ sourceId: id, quote: 'Source evidence' }],
            issues: [],
            suggestions: ['Improve evidence'],
            example: null,
          })),
          summary: 'priorities',
          coveredPages: images ? [id] : [],
          unreadablePages: [],
          conflicts: [],
        });
        answer = JSON.stringify(output(true));
        const confirmed = service.prepareScore(true);
        assert.equal(
          confirmed.outputMode,
          protocol === 'gemini'
            ? 'gemini-json-schema'
            : protocol === 'anthropic'
              ? 'anthropic-json-schema'
              : 'prompt-json',
        );
        const full = await service.score(confirmed);
        assert.equal(full.total, 80);
        assert.equal(full.mode, 'general');
        const scoreWire = JSON.stringify(mock.requests[1].body);
        assert.ok(scoreWire.includes(expected));
        assert.ok(scoreWire.includes('allowedEvidenceSources'));
        assert.ok(scoreWire.includes('allowedVisualPages'));
        if (protocol === 'gemini') {
          const cfg = mock.requests[1].body.generationConfig;
          assert.equal(cfg.responseMimeType, 'application/json');
          assert.deepEqual(
            cfg.responseJsonSchema.properties.dimensions.items.properties.evidence.items.properties
              .sourceId.enum,
            [id],
          );
          assert.equal(mock.requests[0].body.generationConfig.responseJsonSchema, undefined);
        } else assert.ok(!scoreWire.includes('responseJsonSchema'));
        assert.ok(!scoreWire.includes('RESUME-PRIVATE'));
        assert.ok(!scoreWire.includes('LETTER-PRIVATE'));
        workspace.saveWorkspace('score', {
          ...workspace.readWorkspace('score'),
          prompt: 'Engineer',
        });
        answer = JSON.stringify(output(false));
        const partial = await service.score(service.prepareScore(false));
        assert.equal(partial.total, null);
        assert.equal(partial.mode, 'targeted');
        assert.ok(!JSON.stringify(mock.requests[2].body).includes('AQID'));
        answer = 'invalid structured response';
        await assert.rejects(service.score(service.prepareScore(false)));
        assert.equal(scores.list().length, 2);
        assert.equal(service.busy, false);
        const stale = service.prepareScore(false);
        const item = materials.list('score')[0];
        materials.update('score', item.id, item.revision, false);
        const count = mock.requests.length;
        await assert.rejects(service.score(stale));
        assert.equal(mock.requests.length, count);
        materials.update('score', item.id, materials.list('score')[0].revision, true);
        store.registry.saveModel({ ...model, capabilities: emptyCapabilities() });
        assert.throws(() => service.prepareScore(true), /视觉能力/);
        assert.equal(service.prepareScore(false).outputMode, 'prompt-json');
        if (protocol === 'gemini') {
          answer = JSON.stringify(output(false));
          await service.score(service.prepareScore(false));
          const body = mock.requests.at(-1)!.body;
          assert.equal(body.generationConfig.responseJsonSchema, undefined);
        }
        assert.equal(store.listVersions('letter').length, 0);
        assert.equal(store.listVersions().length, 1);
        assert.ok(!JSON.stringify(scores.list()).includes('FAKE-KEY'));
        const reopened = new ScoreStore(path);
        assert.equal(reopened.list().length, protocol === 'gemini' ? 3 : 2);
        reopened.close();
      } finally {
        scores.close();
        materials.close();
        store.close();
        workspace.close();
        await mock.close();
      }
    },
  );
}
