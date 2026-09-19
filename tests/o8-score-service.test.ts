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
import { responsesFixture } from './responses-fixture';
import { nativeFixture } from './native-fixture';

for (const protocol of ['chat-completions', 'responses', 'gemini', 'anthropic'] as const) {
  test(`O8 ${protocol}: two-page low-quality/OCR warning input scores, aliases persist, omission stays partial, no retry`, async () => {
    let answer = '';
    const mock =
      protocol === 'gemini' || protocol === 'anthropic'
        ? await nativeFixture(() => answer)
        : await responsesFixture(() => answer);
    const baseUrl =
      typeof mock.baseUrl === 'string'
        ? mock.baseUrl
        : mock.baseUrl(protocol as 'gemini' | 'anthropic');
    const dir = mkdtempSync(join(tmpdir(), 'o8-service-')),
      path = join(dir, 'db');
    const ws = new WorkspaceStore(path);
    const ai = new AiStore(path, {
      encrypt: (text) => Buffer.from('fake:' + text),
      decrypt: (b) => b.toString().slice(5),
    });
    const materials = new MaterialStore(path),
      scores = new ScoreStore(path);
    const service = new AiService(ai, ws, materials, scores);
    try {
      const provider = ai.registry.saveProvider({
        name: 'O8 fixture',
        baseUrl,
        protocol,
        apiKey: 'FAKE-O8-SECRET',
      });
      const model = ai.registry.saveModel({
        providerId: provider.id,
        name: 'Fixture',
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
      ai.registry.select('score', model.id, {}, ai.registry.catalog().pages.score.revision);
      const file = join(dir, 'cv.pdf');
      writeFileSync(file, 'fixture');
      const [resume] = await materials.importPaths(
        'score',
        'resume',
        [file],
        async () => ({
          totalPages: 2,
          warnings: [],
          pages: [1, 2].map((number) => ({
            number,
            text: 'Fictional work',
            source: 'pdf',
            image: 'data:image/png;base64,AQID',
            width: 500,
            height: 650,
            warnings: [
              number === 1
                ? '页面像素较低，可能模糊；请补充清晰原图。'
                : '本机 OCR 失败，保留原页面；可手动补充文字，不会改用云端解析。',
            ],
          })),
        }),
        new AbortController().signal,
      );
      materials.update('score', resume.id, resume.revision, true);
      materials.importText('score', 'evidence', {
        title: 'SECRET-UNSELECTED',
        text: 'SECRET-UNSELECTED body',
      });
      const wireId = protocol === 'anthropic' ? 's1' : resume.id;
      const output = {
        dimensions: ['content', 'relevance', 'visual', 'expression'].map((key) => ({
          key,
          score: 80,
          evidence: [{ sourceId: `${wireId}:p1`, quote: 'Fictional work' }],
          issues: [],
          suggestions: [],
        })),
        summary: 'Fixture',
        coveredPages: [`${wireId}:p1`, `${wireId}:p2`],
        unreadablePages: [],
        conflicts: [],
      };
      answer = JSON.stringify(output);
      const complete = await service.score(service.prepareScore(true));
      assert.equal(complete.total, 80);
      assert.deepEqual(complete.coveredPages, [`${resume.id}:p1`, `${resume.id}:p2`]);
      assert.deepEqual(complete.completeness?.reasons, []);
      assert.equal(complete.completeness?.policyVersion, 'score-completeness-2');
      const wire = JSON.stringify(mock.requests[0].body);
      assert.ok(wire.includes('AQID'));
      assert.ok(!wire.includes('SECRET-UNSELECTED'));
      assert.ok(!wire.includes('FAKE-O8-SECRET'));
      assert.equal(mock.requests.length, 1);
      output.coveredPages.pop();
      answer = JSON.stringify(output);
      const partial = await service.score(service.prepareScore(true));
      assert.equal(partial.total, null);
      assert.deepEqual(
        partial.completeness?.reasons.map((r) => r.code),
        ['MODEL_COVERAGE_MISSING'],
      );
      assert.equal(mock.requests.length, 2);
      output.dimensions[0].evidence[0].sourceId = 'NOT-SENT:p1';
      answer = JSON.stringify(output);
      await assert.rejects(service.score(service.prepareScore(true)));
      assert.equal(mock.requests.length, 3);
      assert.equal(scores.list().length, 2);
      const reopened = new ScoreStore(path);
      try {
        assert.deepEqual(
          reopened.list().map((r) => r.completeness),
          [partial.completeness, complete.completeness],
        );
      } finally {
        reopened.close();
      }
    } finally {
      scores.close();
      materials.close();
      ai.close();
      ws.close();
      await mock.close();
    }
  });
}
