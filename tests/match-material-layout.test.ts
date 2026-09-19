import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiService, publicAiDiagnostic } from '../electron/ai-service';
import { AiStore } from '../electron/ai-store';
import { MaterialStore } from '../electron/material-store';
import { MatchStore } from '../electron/matching';
import { WorkspaceStore } from '../electron/workspace-store';
import { defaultPrompts } from '../shared/contracts';
import { matchFormatInstruction } from '../shared/matching';
import { emptyCapabilities, emptyParameters } from '../shared/models';
import { nativeFixture } from './native-fixture';
import { responsesFixture } from './responses-fixture';
import { markdownMatchReport } from './match-report-fixture';

// Only synthetic content: mirror observed input lengths/layout, never private text.
// These tests verify message construction and stream preservation, NOT model obedience.
const jobText = 'Python required. ' + 'Fictional job data. '.repeat(300).slice(0, 4167 - 17);
const resumeText = 'Python projects. ' + 'Fictional resume data. '.repeat(300).slice(0, 4662 - 17);
const excludedJob = 'UNSELECTED-JOB-MUST-NOT-LEAK';
const image = 'data:image/png;base64,AQID'; // Transport fixture, not image recognition.
for (const protocol of ['chat-completions', 'anthropic', 'gemini'] as const) {
  for (const jobLayout of ['pasted', 'web-material'] as const) {
    for (const sendImages of [false, true]) {
      test(`${protocol}/${jobLayout}/images=${sendImages}: long job + PDF-only resume retain every source and output byte`, async () => {
        assert.equal(jobText.length, 4167);
        assert.equal(resumeText.length, 4662);
        let answer = '';
        const native =
          protocol === 'chat-completions' ? undefined : await nativeFixture(() => answer);
        const mock = native ?? (await responsesFixture(() => answer));
        native?.setMode('compatible');
        const baseUrl =
          typeof mock.baseUrl === 'string'
            ? mock.baseUrl
            : mock.baseUrl(protocol as 'anthropic' | 'gemini');
        const dir = mkdtempSync(join(tmpdir(), 'career-match-layout-'));
        const path = join(dir, 'db');
        const file = join(dir, 'fictional-resume.pdf');
        writeFileSync(file, 'synthetic parser fixture, not a real PDF');
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
            name: 'Loopback only',
            baseUrl,
            protocol,
            apiKey: 'FAKE-LAYOUT-KEY',
          });
          const model = store.registry.saveModel({
            providerId: provider.id,
            modelId: protocol === 'gemini' ? 'gemini-fixture' : 'claude-sonnet-5',
            name: 'Local fixture',
            protocol: 'inherit',
            capabilities: {
              ...emptyCapabilities(),
              images: 'supported',
              structuredOutput: 'supported',
            },
            parameterSupport: { ...emptyParameters(), maxCompletionTokens: true },
            parameters: { maxCompletionTokens: 128000 },
          });
          store.registry.select(
            'match',
            model.id,
            {},
            store.registry.catalog().pages.match.revision,
          );
          const [resume] = await materials.importPaths(
            'match',
            'resume',
            [file],
            async () => ({
              pages: [{ number: 1, text: resumeText, image, source: 'pdf', warnings: [] }],
              totalPages: 1,
              warnings: [],
            }),
            new AbortController().signal,
          );
          materials.update('match', resume.id, resume.revision, true);
          const web = materials
            .importWeb('match', 'job', {
              url: 'https://example.com/fictional-job',
              text: jobLayout === 'web-material' ? jobText : excludedJob,
              warnings: [],
            })
            .find((item) => item.purpose === 'job')!;
          if (jobLayout === 'web-material') materials.update('match', web.id, web.revision, true);
          workspace.saveWorkspace('match', {
            ...workspace.readWorkspace('match'),
            prompt: jobLayout === 'pasted' ? jobText : '',
            document: '',
            evidenceText: '',
          });
          for (const page of ['resume', 'score', 'letter'] as const)
            workspace.saveWorkspace(page, {
              ...workspace.readWorkspace(page),
              document: 'OTHER-PAGE-MUST-NOT-LEAK',
            });
          const before = workspace.readWorkspace('match');
          const confirmation = service.prepareMatch(sendImages);
          assert.equal(confirmation.input.systemPrompt, defaultPrompts.match);
          assert.equal(
            confirmation.input.resume,
            '',
            'empty pasted resume is not an empty PDF resume',
          );
          assert.equal(confirmation.materials!.imageCount, sendImages ? 1 : 0);
          const jobSource = jobLayout === 'pasted' ? 'job' : `${web.id}:p1`;
          const resumeSource = `${resume.id}:p1`;
          const valid = JSON.stringify({
            requirements: [
              {
                id: 'r1',
                requirement: 'Python',
                hard: true,
                status: 'met',
                jobEvidence: [{ sourceId: jobSource, quote: 'Python required.' }],
                evidence: [{ sourceId: resumeSource, quote: 'Python projects.' }],
                note: 'Only synthetic citations',
              },
            ],
            summary: 'Synthetic match',
            recommendation: 'apply',
            reasons: [],
            warnings: [],
          });
          const assertRequest = () => {
            const body = mock.requests.at(-1)!.body;
            const serialized = JSON.stringify(body);
            assert.doesNotMatch(
              serialized,
              /UNSELECTED-JOB-MUST-NOT-LEAK|OTHER-PAGE-MUST-NOT-LEAK/,
            );
            assert.equal(
              serialized.split(resumeText).length - 1,
              1,
              'PDF text once, not omitted or duplicated',
            );
            assert.equal(serialized.split(jobText).length - 1, 1, 'job text once');
            const messages = protocol === 'gemini' ? body.contents : body.messages;
            const user = messages.find((message: { role: string }) => message.role === 'user');
            const parts = protocol === 'gemini' ? user.parts : user.content;
            const textParts = parts
              .filter((part: { text?: string }) => typeof part.text === 'string')
              .map((part: { text: string }) => part.text);
            assert.match(textParts[0], /本次任务：岗位匹配度评估/);
            assert.match(textParts[0], /为空只表示未粘贴文字/);
            assert.match(textParts[0], /purpose=resume/);
            assert.match(textParts.at(-1)!, /最终回复只能是一个 JSON 对象/);
            assert.match(
              textParts.at(-1)!,
              /requirements.*summary.*recommendation.*reasons.*warnings/,
            );
            assert.match(textParts.at(-1)!, /不得输出独立的 Markdown 报告/);
            assert.equal(
              parts.at(-1).type ?? 'text',
              'text',
              'output instruction follows the final image',
            );
            const payload = JSON.parse(textParts[1]);
            assert.equal(payload.job, jobLayout === 'pasted' ? jobText : '');
            assert.equal(payload.resume, '');
            assert.deepEqual(
              payload.sources.map((source: { id: string }) => source.id).sort(),
              [jobSource, resumeSource].sort(),
            );
            const records = textParts.slice(2, -1).map((part: string) => JSON.parse(part));
            assert.equal(
              records.find((part: { sourceId: string }) => part.sourceId === resumeSource).text,
              resumeText,
            );
            const system =
              protocol === 'gemini'
                ? body.systemInstruction.parts.map((part: { text: string }) => part.text).join('\n')
                : protocol === 'anthropic'
                  ? body.system.map((part: { text: string }) => part.text).join('\n')
                  : body.messages.find((message: { role: string }) => message.role === 'system')
                      .content;
            assert.ok(system.includes(matchFormatInstruction(confirmation.outputMode)));
            const imageParts = parts.filter(
              (part: { type?: string; inlineData?: unknown }) =>
                part.type === 'image' || part.type === 'image_url' || part.inlineData,
            );
            assert.equal(imageParts.length, sendImages ? 1 : 0);
            if (protocol === 'anthropic')
              assert.equal(body.output_config.format.type, 'json_schema');
            if (protocol === 'chat-completions')
              assert.equal(body.response_format.type, 'json_schema');
          };
          for (const response of [valid, `匹配结果如下：\n\`\`\`json\n${valid}\n\`\`\``]) {
            answer = response;
            const result = await service.match(service.prepareMatch(sendImages));
            assert.equal(result.coverage, 100);
            assert.equal(result.requirements[0].evidence[0].sourceId, resumeSource);
            assertRequest();
          }
          const saved = matches.list();
          answer = markdownMatchReport;
          const failed = { ...service.prepareMatch(sendImages), retainFailedResponse: true };
          await assert.rejects(service.match(failed), (error) => {
            assert.equal(publicAiDiagnostic(error).code, 'AI_MATCH_MARKDOWN');
            return true;
          });
          assertRequest();
          assert.equal(
            service.takeMatchPreview(failed.runId)!.text,
            markdownMatchReport,
            'transport never converts JSON into Markdown or drops a block',
          );
          assert.equal(mock.requests.length, 3, 'one request per explicit run, no repair/retry');
          assert.deepEqual(matches.list(), saved);
          assert.deepEqual(workspace.readWorkspace('match'), before);
        } finally {
          service.cancelAll();
          workspace.close();
          store.close();
          materials.close();
          matches.close();
          await mock.close();
        }
      });
    }
  }
}
