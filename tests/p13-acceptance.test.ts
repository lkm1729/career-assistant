import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AiService, publicAiDiagnostic } from '../electron/ai-service';
import { AiStore } from '../electron/ai-store';
import { WorkspaceStore } from '../electron/workspace-store';
import { MaterialStore } from '../electron/material-store';
import { MatchStore } from '../electron/matching';
import { ScoreStore } from '../electron/scoring';
import { workspaceIds, type WorkspaceId } from '../shared/contracts';
import type { GenerationRequest } from '../shared/ai';
import { emptyCapabilities, emptyParameters } from '../shared/models';
import { nativeFixture } from './native-fixture';
import { responsesFixture } from './responses-fixture';

for (const protocol of ['chat-completions', 'responses', 'gemini', 'anthropic'] as const) {
  test(
    protocol +
      ' P13 full four-page selected/private multimodal, consent, failure and cancellation matrix',
    async () => {
      let answer = '';
      const mock =
        protocol === 'gemini' || protocol === 'anthropic'
          ? await nativeFixture(() => answer)
          : await responsesFixture(() => answer);
      const baseUrl =
        typeof mock.baseUrl === 'string'
          ? mock.baseUrl
          : mock.baseUrl(protocol as 'gemini' | 'anthropic');
      const dir = mkdtempSync(join(tmpdir(), 'p13-matrix-')),
        db = join(dir, 'db');
      const workspace = new WorkspaceStore(db),
        store = new AiStore(db, { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() });
      const materials = new MaterialStore(db),
        scores = new ScoreStore(db),
        matches = new MatchStore(new DatabaseSync(db));
      const service = new AiService(store, workspace, materials, scores, matches);
      const ids: Partial<Record<WorkspaceId, string>> = {};
      try {
        const provider = store.registry.saveProvider({
          name: 'P13 fixture',
          baseUrl,
          apiKey: 'FAKE-P13-SECRET',
          protocol,
        });
        const model = store.registry.saveModel({
          providerId: provider.id,
          name: 'P13',
          modelId: 'fixture',
          protocol: 'inherit',
          capabilities: {
            ...emptyCapabilities(),
            images: 'supported',
            structuredOutput: 'supported',
          },
          parameterSupport: emptyParameters(),
          parameters: {},
        });
        for (const page of workspaceIds.filter((id) => id !== 'interview')) {
          store.registry.select(page, model.id, {}, store.registry.catalog().pages[page].revision);
          const file = join(dir, page + '.png');
          writeFileSync(file, 'synthetic');
          const [item] = await materials.importPaths(
            page,
            'resume',
            [file],
            async () => ({
              pages: [
                {
                  number: 1,
                  text: page + ' ONLY-SELECTED Python engineering',
                  source: 'image',
                  image: 'data:image/png;base64,AQID',
                  width: 1000,
                  height: 1400,
                  warnings: [],
                },
              ],
              totalPages: 1,
              warnings: [],
            }),
            new AbortController().signal,
          );
          ids[page] = item.id + ':p1';
          materials.update(page, item.id, item.revision, true);
          const privateFile = join(dir, page + '-PRIVATE-UNSELECTED-NAME.txt');
          writeFileSync(privateFile, 'DO-NOT-SEND');
          await materials.importPaths(
            page,
            'evidence',
            [privateFile],
            async () => ({
              pages: [{ number: 1, text: 'NEVER-SELECTED-TEXT', source: 'text', warnings: [] }],
              totalPages: 1,
              warnings: [],
            }),
            new AbortController().signal,
          );
          workspace.saveWorkspace(page, {
            ...workspace.readWorkspace(page),
            prompt: page + ' UNIQUE-INPUT Python required',
            document: page === 'match' || page === 'score' ? '' : page + ' prior body',
            resumeText: page === 'letter' ? 'letter pasted resume' : '',
            evidenceText: page + ' EVIDENCE',
          });
          workspace.savePrompt(page, 'not loaded', 'NEVER-SEND-PRESET-' + page);
        }
        const imageShape =
          protocol === 'gemini'
            ? 'inlineData'
            : protocol === 'anthropic'
              ? '"type":"image"'
              : protocol === 'responses'
                ? 'input_image'
                : 'image_url';
        function response(page: WorkspaceId, images: boolean) {
          if (page === 'match')
            return JSON.stringify({
              requirements: [
                {
                  id: 'r1',
                  requirement: 'Python',
                  hard: false,
                  status: 'met',
                  jobEvidence: [{ sourceId: 'job', quote: 'Python required' }],
                  evidence: [{ sourceId: ids.match, quote: 'Python engineering' }],
                  note: 'Verified fixture',
                },
              ],
              summary: 'matched',
              recommendation: 'apply',
              reasons: [],
              warnings: [],
            });
          if (page === 'score')
            return JSON.stringify({
              dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
                key,
                score: key === 'visual' && !images ? null : 80,
                evidence:
                  key === 'visual' && !images
                    ? []
                    : [{ sourceId: ids.score, quote: 'Python engineering' }],
                issues: [],
                suggestions: [],
              })),
              summary: 'scored',
              coveredPages: images ? [ids.score] : [],
              unreadablePages: [],
              conflicts: [],
            });
          return JSON.stringify({
            document: page + ' GENERATED',
            suggestions: 'local fixture',
            rationale: 'selected sources only',
          });
        }
        function prepare(page: WorkspaceId, images: boolean) {
          if (page === 'match') {
            const c = service.prepareMatch(images);
            return { id: c.runId, run: () => service.match(c) };
          }
          if (page === 'score') {
            const c = service.prepareScore(images);
            return { id: c.runId, run: () => service.score(c) };
          }
          if (page === 'interview') throw new Error('interview uses a separate workflow');
          const draft = workspace.readWorkspace(page),
            m = materials.manifest(page, images);
          const c: GenerationRequest = {
            page,
            runId: randomUUID(),
            revision: store.registry.credentials(page).connection.revision,
            input: {
              prompt: draft.prompt,
              systemPrompt: draft.systemPrompt,
              document: draft.document,
              ...(page === 'letter'
                ? { resumeText: draft.resumeText, evidenceText: draft.evidenceText }
                : {}),
            },
            materials: { revision: m.revision, sendImages: images },
          };
          return { id: c.runId, run: () => service.generate(c, () => {}) };
        }
        const counts = () => [
          store.listVersions('resume').length,
          store.listVersions('letter').length,
          scores.list().length,
          matches.list().length,
        ];
        for (const page of workspaceIds.filter((id) => id !== 'interview')) {
          for (const images of [true, false]) {
            answer = response(page, images);
            const c = prepare(page, images),
              before = mock.requests.length;
            const result = await c.run();
            assert.equal(mock.requests.length, before + 1);
            const body = JSON.stringify(mock.requests.at(-1)!.body);
            assert.ok(body.includes(page + ' ONLY-SELECTED'));
            for (const other of workspaceIds.filter((p) => p !== page))
              assert.ok(
                !body.includes(other + ' ONLY-SELECTED') && !body.includes(other + ' UNIQUE-INPUT'),
                other + ' leaked',
              );
            for (const forbidden of [
              'PRIVATE-UNSELECTED-NAME',
              'NEVER-SELECTED-TEXT',
              'NEVER-SEND-PRESET',
              'FAKE-P13-SECRET',
              'sameJobConfirmed',
            ])
              assert.ok(!body.includes(forbidden), forbidden + ' leaked');
            assert.equal(body.includes(imageShape), images);
            assert.equal(body.includes('AQID'), images);
            const persisted = JSON.stringify(result);
            assert.ok(!persisted.includes('FAKE-P13-SECRET') && !persisted.includes('AQID'));
            if (page === 'score')
              assert.equal(
                (result as { total: unknown }).total,
                images ? 80 : null,
                'O8 unselected sources do not block complete selected resumes; no-image runs stay partial',
              );
          }
          const history = counts(),
            draft = workspace.readWorkspace(page);
          answer = 'PRIVATE-PROVIDER-BODY not valid JSON';
          const bad = prepare(page, false);
          await assert.rejects(bad.run(), (error) => {
            assert.ok(!JSON.stringify(publicAiDiagnostic(error)).includes('PRIVATE-PROVIDER-BODY'));
            return true;
          });
          assert.deepEqual(counts(), history);
          assert.deepEqual(workspace.readWorkspace(page), draft);
          answer = response(page, false);
          mock.setMode('slow');
          const cancel = prepare(page, false),
            pending = cancel.run();
          setTimeout(() => service.cancel(cancel.id), 25);
          await assert.rejects(pending);
          mock.setMode('success');
          assert.deepEqual(counts(), history);
          assert.deepEqual(workspace.readWorkspace(page), draft);
          assert.equal(service.busy, false);
        }
        // All four pages must reject unknown image support before reaching the transport.
        store.registry.saveModel({
          ...model,
          capabilities: { ...model.capabilities, images: 'unsupported' },
        });
        const before = mock.requests.length;
        for (const page of workspaceIds.filter((id) => id !== 'interview')) {
          if (page === 'score' || page === 'match')
            assert.throws(() => prepare(page, true), /视觉能力/);
          else await assert.rejects(prepare(page, true).run(), /视觉能力/);
          answer = response(page, false);
          await prepare(page, false).run();
        }
        assert.equal(
          mock.requests.length,
          before + 4,
          'manual text-only fallback is one explicit call per page',
        );
        // Multi-job main-process gate cannot be bypassed by hiding renderer source metadata.
        const job = materials
          .importWeb('match', 'job', {
            url: 'https://jobs.example.com/other',
            title: 'Other role',
            text: 'Other role requires Python',
            warnings: [],
          })
          .at(-1)!;
        materials.update('match', job.id, job.revision, true);
        const c = service.prepareMatch(false),
          n = mock.requests.length;
        await assert.rejects(service.match({ ...c, sources: [] }), /确认/);
        assert.equal(mock.requests.length, n);
        answer = response('match', false);
        await service.match({ ...c, sameJobConfirmed: true });
        assert.ok(!JSON.stringify(mock.requests.at(-1)!.body).includes('sameJobConfirmed'));
        await assert.rejects(service.match(service.prepareMatch(false)), /确认/);
        const stale = { ...service.prepareMatch(false), sameJobConfirmed: true };
        const selected = materials.list('match').find((i) => i.id === job.id)!;
        materials.update('match', selected.id, selected.revision, false);
        await assert.rejects(service.match(stale), /变化/);
        const letterJob = materials
          .importWeb('letter', 'job', {
            url: 'https://jobs.example.com/role',
            title: 'Role',
            text: 'Python required',
            warnings: [],
          })
          .at(-1)!;
        materials.update('letter', letterJob.id, letterJob.revision, true);
        await assert.rejects(prepare('letter', false).run(), /确认/);
      } finally {
        service.cancelAll();
        materials.close();
        scores.close();
        matches.close();
        store.close();
        workspace.close();
        await mock.close();
      }
    },
  );
}
