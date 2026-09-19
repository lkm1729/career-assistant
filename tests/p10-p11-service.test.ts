import { markdownMatchReport } from './match-report-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AiStore } from '../electron/ai-store';
import { WorkspaceStore } from '../electron/workspace-store';
import { MaterialStore } from '../electron/material-store';
import { MatchStore } from '../electron/matching';
import { AiService, publicAiDiagnostic } from '../electron/ai-service';
import { emptyCapabilities, emptyParameters } from '../shared/models';
import { nativeFixture } from './native-fixture';
import { responsesFixture } from './responses-fixture';
import { parseMatch } from '../shared/matching';
for (const protocol of ['chat-completions', 'responses', 'gemini', 'anthropic'] as const) {
  test(
    protocol +
      ': P10/P11 material wire, consent, source evidence, cancellation, stale inputs, history and reopen',
    async () => {
      let answer = '';
      let change: (() => void) | undefined;
      const reply = () => {
        change?.();
        change = undefined;
        return answer;
      };
      const mock =
        protocol === 'gemini' || protocol === 'anthropic'
          ? await nativeFixture(reply)
          : await responsesFixture(reply);
      const baseUrl =
        typeof mock.baseUrl === 'string'
          ? mock.baseUrl
          : mock.baseUrl(protocol as 'gemini' | 'anthropic');
      const dir = mkdtempSync(join(tmpdir(), 'career-p10p11-'));
      const path = join(dir, 'db');
      const file = join(dir, 'cv.pdf');
      writeFileSync(file, 'fictional parsed fixture');
      const workspace = new WorkspaceStore(path);
      const store = new AiStore(path, {
        encrypt: (s) => Buffer.from(s),
        decrypt: (b) => b.toString(),
      });
      const materials = new MaterialStore(path);
      const matches = new MatchStore(new DatabaseSync(path));
      const service = new AiService(store, workspace, materials, undefined, matches);
      try {
        const provider = store.registry.saveProvider({
          name: 'Local fixture',
          baseUrl,
          apiKey: 'FAKE-KEY',
          protocol,
        });
        const model = store.registry.saveModel({
          providerId: provider.id,
          name: 'Fixture model',
          modelId: 'model',
          protocol: 'inherit',
          capabilities: {
            ...emptyCapabilities(),
            images: 'supported',
            structuredOutput:
              protocol === 'anthropic' || protocol === 'chat-completions' ? 'supported' : 'unknown',
          },
          parameterSupport: emptyParameters(),
          parameters: {},
        });
        for (const page of ['match', 'letter'] as const) {
          store.registry.select(page, model.id, {}, store.registry.catalog().pages[page].revision);
          const [item] = await materials.importPaths(
            page,
            'resume',
            [file],
            async () => ({
              pages: [
                {
                  number: 1,
                  text: 'Python services built by candidate',
                  source: 'pdf',
                  image: 'data:image/png;base64,AQID',
                  warnings: [],
                },
              ],
              totalPages: 1,
              warnings: [],
            }),
            new AbortController().signal,
          );
          materials.update(page, item.id, item.revision, true);
          const job = materials
            .importWeb(page, 'job', {
              url: 'https://jobs.example.com/role',
              text: 'Python services required for the role',
              warnings: ['Fictional static snapshot'],
            })
            .find((i) => i.purpose === 'job')!;
          assert.equal(job.selected, false);
          materials.update(page, job.id, job.revision, true);
          workspace.saveWorkspace(page, {
            ...workspace.readWorkspace(page),
            evidenceText: 'Supplementary evidence',
          });
        }
        workspace.saveWorkspace('resume', {
          ...workspace.readWorkspace('resume'),
          prompt: 'NEVER-SEND-RESUME-PRIVATE',
        });
        workspace.saveWorkspace('score', {
          ...workspace.readWorkspace('score'),
          document: 'NEVER-SEND-SCORE-PRIVATE',
        });
        const confirmation = service.prepareMatch(true);
        const resume = confirmation.sources!.find((s) => s.purpose === 'resume')!,
          job = confirmation.sources!.find((s) => s.purpose === 'job')!;
        const result = {
          requirements: [
            {
              id: 'r1',
              requirement: 'Python services',
              hard: true,
              status: 'met',
              jobEvidence: [{ sourceId: job.id, quote: 'Python services required' }],
              evidence: [{ sourceId: resume.id, quote: 'Python services built' }],
              note: 'Evidence found',
            },
          ],
          summary: 'Evidence only',
          recommendation: 'apply',
          reasons: ['Relevant experience'],
          warnings: [],
          coverage: 66.7,
          hardGates: null,
        };
        answer =
          protocol === 'anthropic'
            ? '以下是岗位匹配结果：\n```JSON\n' +
              JSON.stringify(result) +
              '\n```\n以上分析仅基于提供资料。'
            : JSON.stringify(result);
        assert.equal(
          confirmation.outputMode,
          protocol === 'anthropic'
            ? 'anthropic-json-schema'
            : protocol === 'chat-completions'
              ? 'chat-json-schema'
              : 'prompt-json',
        );
        const record = await service.match({ ...confirmation, retainFailedResponse: true });
        assert.equal(service.takeMatchPreview(confirmation.runId), null);
        assert.ok(!JSON.stringify(record).includes('retainFailedResponse'));
        assert.equal(record.coverage, 100);
        assert.equal(matches.list().length, 1);
        assert.ok(record.materials);
        assert.ok(!JSON.stringify(record).includes('AQID'));
        assert.ok(!JSON.stringify(record).includes('FAKE-KEY'));
        const sent = JSON.stringify(mock.requests[0].body);
        if (protocol === 'anthropic') {
          const body = mock.requests[0].body;
          assert.equal(body.output_config?.format?.type, 'json_schema');
          assert.equal(body.output_config.format.schema.type, 'object');
        } else if (protocol === 'chat-completions') {
          assert.equal(mock.requests[0].body.response_format?.type, 'json_schema');
          assert.equal(mock.requests[0].body.response_format?.json_schema?.name, 'career_match');
        } else assert.equal(mock.requests[0].body.output_config, undefined);

        assert.ok(sent.includes('AQID'));
        assert.ok(!sent.includes('NEVER-SEND'));
        assert.ok(sent.includes(job.id));
        assert.equal(
          sent.split('Python services built by candidate').length - 1,
          1,
          'PDF text must be sent only once',
        );
        assert.ok(
          sent.includes(
            protocol === 'gemini'
              ? 'inlineData'
              : protocol === 'anthropic'
                ? '"type":"image"'
                : protocol === 'responses'
                  ? 'input_image'
                  : 'image_url',
          ),
        );
        await assert.rejects(service.match(confirmation), /已保存/);
        mock.setMode('incomplete');
        await assert.rejects(service.match(service.prepareMatch()), (error) => {
          assert.equal(
            publicAiDiagnostic(error).code,
            protocol === 'responses' ? 'AI_STREAM_INCOMPLETE' : 'AI_OUTPUT_LIMIT',
          );
          return true;
        });
        assert.equal(matches.list().length, 1);
        mock.setMode('success');
        answer = JSON.stringify({
          ...result,
          requirements: [
            { ...result.requirements[0], evidence: [{ sourceId: job.id, quote: 'Python' }] },
          ],
        });
        await assert.rejects(service.match(service.prepareMatch()), (error) => {
          const diagnostic = publicAiDiagnostic(error);
          assert.equal(diagnostic.code, 'AI_MATCH_SOURCE');
          assert.match(diagnostic.message, /requirements\[0\]\.evidence\[0\]\.sourceId/);
          assert.doesNotMatch(
            JSON.stringify(diagnostic),
            /FAKE-KEY|Python|当前配置、输入或操作状态不符合要求/,
          );
          return true;
        });
        assert.equal(matches.list().length, 1);
        answer = JSON.stringify(result);
        const stale = service.prepareMatch();
        const item = materials.list('match')[0];
        materials.update('match', item.id, item.revision, true);
        await assert.rejects(service.match(stale), /变化/);
        change = () =>
          workspace.saveWorkspace('match', {
            ...workspace.readWorkspace('match'),
            systemPrompt: 'changed',
          });
        await assert.rejects(service.match(service.prepareMatch()), /输入已变化/);
        mock.setMode('slow');
        const cancel = service.prepareMatch();
        const pending = service.match(cancel);
        setTimeout(() => service.cancel(cancel.runId), 30);
        await assert.rejects(pending);
        assert.equal(service.busy, false);
        assert.equal(matches.list().length, 1);
        mock.setMode('success');
        answer = JSON.stringify({
          document: '# Fictional cover letter',
          suggestions: 'Advice',
          rationale: 'Only provided evidence',
        });
        const letterRequest = () => ({
          page: 'letter' as const,
          runId: randomUUID(),
          revision: store.registry.connection('letter')!.revision,
          input: workspace.readWorkspace('letter'),
          materials: { revision: materials.manifest('letter', true).revision, sendImages: true },
        });
        const v1 = await service.generate(letterRequest(), () => {});
        assert.equal(v1.number, 1);
        assert.ok(v1.materials);
        const letterSent = JSON.stringify(mock.requests.at(-1)!.body);
        assert.ok(letterSent.includes('AQID'));
        assert.ok(letterSent.includes('Supplementary evidence'));
        assert.ok(!letterSent.includes(resume.id));
        assert.ok(!letterSent.includes('NEVER-SEND'));
        change = () =>
          workspace.saveWorkspace('letter', {
            ...workspace.readWorkspace('letter'),
            resumeText: 'Changed source',
          });
        await assert.rejects(
          service.generate(letterRequest(), () => {}),
          /改变/,
        );
        assert.equal(store.listVersions('letter').length, 1);
        change = () =>
          workspace.saveWorkspace('letter', {
            ...workspace.readWorkspace('letter'),
            evidenceText: 'Updated evidence',
          });
        await assert.rejects(
          service.generate(letterRequest(), () => {}),
          /改变/,
        );
        change = () => {
          const item = materials.list('letter')[0];
          materials.update('letter', item.id, item.revision, true);
        };
        await assert.rejects(
          service.generate(letterRequest(), () => {}),
          /变化/,
        );
        change = () => {
          store.registry.select(
            'letter',
            model.id,
            {},
            store.registry.catalog().pages.letter.revision,
          );
        };
        await assert.rejects(
          service.generate(letterRequest(), () => {}),
          /配置已变化/,
        );
        mock.setMode('slow');
        const letterCancel = letterRequest();
        const letterPending = service.generate(letterCancel, () => {});
        setTimeout(() => service.cancel(letterCancel.runId), 30);
        await assert.rejects(letterPending);
        mock.setMode('success');
        assert.equal(store.listVersions('letter').length, 1);
        workspace.saveWorkspace('letter', {
          ...workspace.readWorkspace('letter'),
          refinement: 'Make it concise',
        });
        const v2 = await service.generate(
          { ...letterRequest(), operation: 'refine', refinement: 'Make it concise' },
          () => {},
        );
        assert.equal(v2.number, 2);
        assert.equal(v2.parentNumber, 1);
        store.restoreVersion(1, workspace.readWorkspace('letter'), 'letter');
        store.deleteVersions('letter', [v2], workspace.readWorkspace('letter'));
        store.recoverVersions('letter', [v2]);
        mock.setMode('unauthorized');
        const before = workspace.readWorkspace('letter');
        await assert.rejects(
          service.generate(letterRequest(), () => {}),
          /401/,
        );
        assert.deepEqual(workspace.readWorkspace('letter'), before);
        const reopened = new WorkspaceStore(path);
        const reopenedMaterials = new MaterialStore(path);
        const reopenedMatches = new MatchStore(new DatabaseSync(path));
        assert.equal(reopened.readWorkspace('letter').resumeText, 'Changed source');
        assert.equal(reopened.readWorkspace('letter').evidenceText, 'Updated evidence');
        assert.equal(reopenedMaterials.list('letter').length, 2);
        assert.equal(reopenedMatches.list()[0].sources?.length, 2);
        reopened.close();
        reopenedMaterials.close();
        reopenedMatches.close();
        // The no-web/no-attachment path must use the same contract and diagnostics.
        if (protocol === 'anthropic' || protocol === 'chat-completions') {
          const staleMode = service.prepareMatch();
          const currentModel = store.registry.catalog().models.find((m) => m.id === model.id)!;
          store.registry.saveModel({
            ...currentModel,
            capabilities: { ...currentModel.capabilities, structuredOutput: 'unknown' },
          });
          const count = mock.requests.length;
          await assert.rejects(service.match(staleMode), /变化/);
          assert.equal(mock.requests.length, count);
          assert.equal(service.prepareMatch().outputMode, 'prompt-json');
        }
        mock.setMode('success');
        for (const item of materials.list('match'))
          materials.update('match', item.id, item.revision, false);
        workspace.saveWorkspace('match', {
          ...workspace.readWorkspace('match'),
          prompt: 'Python required',
          document: 'Python projects',
          evidenceText: '',
        });
        answer = JSON.stringify({
          ...result,
          requirements: [
            {
              ...result.requirements[0],
              jobEvidence: [{ sourceId: 'job', quote: 'Python' }],
              evidence: [{ sourceId: 'resume', quote: 'Python' }],
            },
          ],
        });
        const pasted = await service.match({
          ...service.prepareMatch(),
          outputMode:
            protocol === 'chat-completions' ? 'chat-json-schema' : 'anthropic-json-schema',
        });
        assert.equal(
          mock.requests.at(-1)!.body.output_config,
          undefined,
          'renderer cannot force provider schema',
        );
        assert.equal(
          mock.requests.at(-1)!.body.response_format,
          undefined,
          'renderer cannot force Chat schema',
        );
        assert.equal(pasted.coverage, 100);
        assert.equal(matches.list().length, 2);
        const pastedWire = JSON.stringify(mock.requests.at(-1)!.body);
        assert.ok(pastedWire.includes('岗位文字'));
        assert.ok(pastedWire.includes('简历文字'));
        assert.ok(!pastedWire.includes(resume.id));
        const beforeMatch = workspace.readWorkspace('match');
        answer = markdownMatchReport;
        for (const retainFailedResponse of [false, true]) {
          const c = { ...service.prepareMatch(), retainFailedResponse };
          const requestCount = mock.requests.length;
          await assert.rejects(service.match(c), (error) => {
            const d = publicAiDiagnostic(error);
            assert.equal(d.code, 'AI_MATCH_MARKDOWN');
            assert.doesNotMatch(JSON.stringify(d), /虚构测试|Python|JSON_ENVELOPE/);
            return true;
          });
          assert.equal(mock.requests.length, requestCount + 1);
          assert.equal(
            service.takeMatchPreview(c.runId)?.text,
            retainFailedResponse ? markdownMatchReport : undefined,
          );
          assert.deepEqual(workspace.readWorkspace('match'), beforeMatch);
          assert.equal(matches.list().length, 2);
        }

        const requestsBeforeInvalid = mock.requests.length;
        answer = 'PRIVATE-INVALID-JSON';
        const withoutConsent = service.prepareMatch();
        await assert.rejects(service.match(withoutConsent), (error) => {
          const d = publicAiDiagnostic(error);
          assert.equal(d.code, 'AI_MATCH_JSON');
          assert.ok(!JSON.stringify(d).includes('PRIVATE-INVALID-JSON'));
          return true;
        });
        assert.equal(mock.requests.length, requestsBeforeInvalid + 1, 'no automatic paid retry');
        assert.equal(service.takeMatchPreview(withoutConsent.runId), null);
        const optedIn = { ...service.prepareMatch(), retainFailedResponse: true };
        answer = 'PRIVATE-DIAGNOSTIC-RESPONSE FAKE-KEY <script>untrusted</script>';
        await assert.rejects(service.match(optedIn), (error) => {
          const diagnostic = publicAiDiagnostic(error);
          assert.match(diagnostic.message, /正文首部=其他文字/);
          assert.doesNotMatch(
            JSON.stringify(diagnostic),
            /PRIVATE-DIAGNOSTIC-RESPONSE|FAKE-KEY|script/,
          );
          return true;
        });
        assert.equal(service.hasMatchPreview(optedIn.runId), true);
        assert.equal(service.takeMatchPreview('wrong-run'), null);
        const preview = service.takeMatchPreview(optedIn.runId)!;
        assert.match(preview.text, /PRIVATE-DIAGNOSTIC-RESPONSE/);
        assert.doesNotMatch(preview.text, /FAKE-KEY/);
        assert.equal(service.takeMatchPreview(optedIn.runId), null);
        assert.ok(!JSON.stringify(mock.requests.at(-1)!.body).includes('retainFailedResponse'));
        assert.equal(mock.requests.length, requestsBeforeInvalid + 2);
        assert.equal(
          new AiService(store, workspace, materials, undefined, matches).takeMatchPreview(
            optedIn.runId,
          ),
          null,
        );
        const unviewed = { ...service.prepareMatch(), retainFailedResponse: true };
        await assert.rejects(service.match(unviewed));
        assert.equal(service.hasMatchPreview(unviewed.runId), true);
        service.prepareMatch();
        assert.equal(service.hasMatchPreview(unviewed.runId), false);
        const cancelled = { ...service.prepareMatch(), retainFailedResponse: true };
        mock.setMode('slow');
        const pendingPreview = service.match(cancelled);
        setTimeout(() => service.cancel(cancelled.runId), 30);
        await assert.rejects(pendingPreview);
        assert.equal(service.hasMatchPreview(cancelled.runId), false);
        mock.setMode('success');
        assert.deepEqual(workspace.readWorkspace('match'), beforeMatch);
        const stalePreview = { ...service.prepareMatch(), retainFailedResponse: true };
        change = () =>
          workspace.saveWorkspace('match', {
            ...workspace.readWorkspace('match'),
            prompt: 'Changed for stale preview',
          });
        await assert.rejects(service.match(stalePreview), /变化/);
        assert.equal(service.hasMatchPreview(stalePreview.runId), false);
        workspace.saveWorkspace('match', beforeMatch);
        for (const file of [path, path + '-wal'])
          if (existsSync(file))
            assert.ok(!readFileSync(file).includes(Buffer.from('PRIVATE-DIAGNOSTIC-RESPONSE')));

        assert.equal(workspace.readWorkspace('match').document, beforeMatch.document);
        assert.equal(matches.list().length, 2);
      } finally {
        matches.close();
        materials.close();
        store.close();
        workspace.close();
        await mock.close();
      }
    },
  );
}
test('match references reject empty evidence, role confusion, duplicate IDs and unsupported positives', () => {
  const requirement = {
    id: 'r',
    requirement: 'Python',
    hard: false,
    status: 'met',
    jobEvidence: [{ sourceId: 'job', quote: 'Python' }],
    evidence: [{ sourceId: 'resume', quote: 'Python' }],
    note: '',
  };
  const base = {
    requirements: [requirement],
    summary: '',
    recommendation: 'apply',
    reasons: [],
    warnings: [],
  };
  for (const evidence of [
    [],
    [{ sourceId: 'resume', quote: ' ' }],
    [{ sourceId: 'job', quote: 'Python' }],
  ])
    assert.throws(() =>
      parseMatch(
        JSON.stringify({ ...base, requirements: [{ ...requirement, evidence }] }),
        'Python',
        'Python',
      ),
    );
  assert.throws(() =>
    parseMatch(
      JSON.stringify({ ...base, requirements: [requirement, requirement] }),
      'Python',
      'Python',
    ),
  );
});
