import { revealConfirmation } from './confirmation-preview';
import { markdownMatchReport } from './match-report-fixture';
import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MaterialStore } from '../electron/material-store';
import { pdfFixture } from './material-fixtures';
import { nativeFixture } from './native-fixture';
import { responsesFixture } from './responses-fixture';
import { captureWindow } from './capture-window';
const require = createRequire(import.meta.url);
for (const protocol of ['chat-completions', 'responses', 'gemini', 'anthropic'] as const) {
  test(
    protocol + ' P10/P11 PDF and synthetic web snapshot desktop acceptance',
    async ({}, info) => {
      test.setTimeout(180000);
      let answer = '';
      const mock =
        protocol === 'gemini' || protocol === 'anthropic'
          ? await nativeFixture(() => answer)
          : await responsesFixture(() => answer);
      const baseUrl =
        typeof mock.baseUrl === 'string'
          ? mock.baseUrl
          : mock.baseUrl(protocol as 'gemini' | 'anthropic');
      mkdirSync('.test-data', { recursive: true });
      const dir = mkdtempSync(resolve('.test-data/p10-p11-'));
      const pdf = join(dir, 'resume-fixture.pdf');
      writeFileSync(pdf, pdfFixture());
      // Synthetic web source: tests the saved snapshot/UI, not live website compatibility.
      const materials = new MaterialStore(join(dir, 'workspace.sqlite'));
      for (const page of ['match', 'letter'] as const)
        materials.importWeb(page, 'job', {
          url: 'https://jobs.example.com/role',
          text: 'CAREER RESUME and software engineering experience required.',
          warnings: ['Synthetic webpage fixture; no external website contacted.'],
        });
      materials.close();
      const env: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(process.env).filter((x): x is [string, string] => x[1] !== undefined),
        ),
        CAREER_TEST_MODE: '1',
        CAREER_TEST_DATA: dir,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.CAREER_DEV_URL;
      let app = await electron.launch({
        executablePath: require('electron'),
        args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
        env,
      });
      try {
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
        );
        let page = await app.firstWindow();
        await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
        await page.evaluate(
          async ({ baseUrl, protocol }) => {
            const api = window.career!;
            const p = await api.ai.registry.saveProvider({
              name: 'P10 fixture',
              baseUrl,
              apiKey: 'FAKE-E2E',
              protocol,
            });
            if (!p.ok) throw new Error('provider');
            const m = await api.ai.registry.saveModel({
              providerId: p.catalog.providers[0].id,
              name: 'P10 Model',
              modelId: 'fixture',
              protocol: 'inherit',
              capabilities: {
                images: 'supported',
                files: 'unknown',
                structuredOutput:
                  protocol === 'anthropic' || protocol === 'chat-completions'
                    ? 'supported'
                    : 'unknown',
              },
              parameterSupport: {
                temperature: false,
                maxCompletionTokens: false,
                reasoningEffort: false,
              },
              parameters: {},
            });
            if (!m.ok) throw new Error('model');
            for (const target of ['match', 'letter'] as const) {
              const catalog = await api.ai.registry.catalog();
              await api.ai.registry.selectModel(
                target,
                m.catalog.models[0].id,
                {},
                catalog.pages[target].revision,
              );
            }
            const snapshot = await api.load();
            await api.saveWorkspace('resume', {
              ...snapshot.workspaces.resume,
              prompt: 'NEVER-SEND-OTHER-PAGE',
            });
          },
          { baseUrl, protocol },
        );
        await page.reload();
        await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
        await app.evaluate(({ dialog }, file) => {
          dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths: [file],
          })) as typeof dialog.showOpenDialog;
        }, pdf);
        await page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }).click();
        await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
        await expect(
          page.getByRole('checkbox', { name: '发送资料 resume-fixture.pdf' }),
        ).toBeVisible({ timeout: 60000 });
        await page.getByRole('checkbox', { name: '发送资料 resume-fixture.pdf' }).check();
        await page.getByRole('checkbox', { name: '发送资料 网页 · jobs.example.com' }).check();
        await page.getByLabel('网页链接草稿').fill('https://127.0.0.1/');
        await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '确认访问网页', exact: true })).toBeVisible();

        expect(mock.requests).toHaveLength(0);
        await page
          .getByRole('dialog', { name: '确认访问网页', exact: true })
          .getByRole('button', { name: '取消', exact: true })
          .click();
        await page.getByRole('button', { name: '读取网页前确认', exact: true }).click();
        await page.getByRole('button', { name: '确认访问并读取', exact: true }).click();
        await expect(page.locator('.materials').getByRole('alert')).toContainText('只读取公开');
        expect(await page.evaluate(() => window.career!.materials.list('match'))).toHaveLength(2);
        await page.getByLabel('本次发送页面图像', { exact: false }).check();
        await page.getByLabel('本页补充证据文字').fill('LOCAL MATCH EVIDENCE');
        const sources = await page.evaluate(() => window.career!.materials.list('match'));
        const job = sources.find((i) => i.purpose === 'job')!,
          cv = sources.find((i) => i.purpose === 'resume')!;
        expect(cv.pages[0].text).toContain('CAREER RESUME');
        expect(cv.pages[0].image).toBeTruthy();
        answer = JSON.stringify({
          requirements: [
            {
              id: 'r1',
              requirement: 'CAREER RESUME',
              hard: true,
              status: 'met',
              jobEvidence: [{ sourceId: job.id + ':p1', quote: 'CAREER RESUME' }],
              evidence: [{ sourceId: cv.id + ':p1', quote: 'CAREER RESUME' }],
              note: 'Verifiable source',
            },
          ],
          summary: 'Verified match fixture',
          recommendation: 'apply',
          reasons: ['Documented experience'],
          warnings: [],
          coverage: 66.7,
          hardGates: null,
        });
        const plainAnswer = answer;
        if (protocol === 'anthropic') answer = '匹配结果如下：\n```json\n' + answer + '\n```';
        await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
        await revealConfirmation(page);
        await expect(page.getByRole('dialog', { name: '确认岗位匹配', exact: true })).toBeVisible();
        if (protocol === 'anthropic') {
          await expect(page.getByRole('dialog')).toContainText('最多等待30分钟');
          await expect(page.getByRole('dialog')).toContainText('连续10分钟无任何响应数据会停止');
        } else {
          await expect(page.getByRole('dialog')).not.toContainText('最多等待30分钟');
        }
        await expect(page.getByRole('dialog')).toContainText(
          protocol === 'anthropic'
            ? 'Anthropic 原生 JSON Schema'
            : protocol === 'chat-completions'
              ? 'Chat Completions JSON Schema'
              : '提示词 JSON',
        );
        await expect(page.getByRole('dialog')).toContainText('resume-fixture.pdf');
        await page.getByText('应用固定匹配指令（随本次发送）', { exact: true }).click();
        await expect(page.getByRole('dialog')).toContainText('本次任务：岗位匹配度评估');
        await expect(page.getByRole('dialog')).toContainText('最终回复只能是一个 JSON 对象');
        await expect(page.getByRole('dialog')).toContainText('为空只表示未粘贴文字');
        expect(mock.requests).toHaveLength(0);
        await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
        await expect(page.locator('.match-summary')).toContainText('Verified match fixture');
        await expect(page.locator('.match-summary')).toContainText('100%');
        expect(JSON.stringify(mock.requests[0].body)).not.toContain('NEVER-SEND-OTHER-PAGE');
        const matchBody = mock.requests[0].body;
        const matchUser =
          protocol === 'gemini'
            ? matchBody.contents.find((m: { role: string }) => m.role === 'user')
            : (protocol === 'responses' ? matchBody.input : matchBody.messages).find(
                (m: { role: string }) => m.role === 'user',
              );
        const matchParts = protocol === 'gemini' ? matchUser.parts : matchUser.content;
        expect(matchParts[0].text).toContain('本次任务：岗位匹配度评估');
        expect(matchParts.at(-1).text).toContain('最终回复只能是一个 JSON 对象');
        expect(matchParts.at(-1).text).toContain('不得输出独立的 Markdown 报告');
        const goodAnswer = answer;
        const invalid = JSON.parse(plainAnswer);
        if (protocol === 'anthropic')
          expect(mock.requests[0].body.output_config?.format?.type).toBe('json_schema');
        if (protocol === 'chat-completions')
          expect(mock.requests[0].body.response_format?.type).toBe('json_schema');
        // Replay the reported long Markdown shape without pretending it is verified JSON.
        answer = markdownMatchReport;
        const beforeReport = mock.requests.length;
        await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
        await revealConfirmation(page);
        await page
          .getByRole('checkbox', { name: '仅本次JSON失败时保留响应供本机临时查看' })
          .check();
        await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
        await expect(page.locator('.evaluation-panel').getByRole('alert')).toContainText(
          'AI_MATCH_MARKDOWN',
        );
        await expect(page.locator('.evaluation-panel').getByRole('alert')).not.toContainText(
          'JSON_ENVELOPE',
        );
        await expect(page.locator('.evaluation-panel').getByRole('alert')).not.toContainText(
          '虚构测试',
        );
        expect(await page.evaluate(() => window.career!.match.history())).toHaveLength(1);
        await expect(page.locator('.match-summary')).toContainText('Verified match fixture');
        await expect(
          page.getByRole('button', { name: '查看本次失败响应（仅本机）' }),
        ).toBeVisible();
        await page.getByRole('button', { name: '丢弃临时响应', exact: true }).click();
        expect(mock.requests).toHaveLength(beforeReport + 1);
        invalid.requirements[0].evidence[0].sourceId = job.id + ':p1';
        answer = JSON.stringify(invalid);
        await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
        await revealConfirmation(page);
        await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
        const alert = page.locator('.evaluation-panel').getByRole('alert');
        await expect(alert).toContainText('AI_MATCH_SOURCE');
        await expect(alert).toContainText('requirements[0].evidence[0].sourceId');
        await expect(alert).not.toContainText('当前配置、输入或操作状态不符合要求');
        await expect(alert).not.toContainText(job.id);
        expect(await page.evaluate(() => window.career!.match.history())).toHaveLength(1);
        await expect(page.locator('.match-summary')).toContainText('Verified match fixture');
        answer = '```json\n' + plainAnswer.slice(0, -1) + '\n```';
        const beforeInvalid = mock.requests.length;
        await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
        await revealConfirmation(page);
        await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
        await expect(alert).toContainText('AI_MATCH_JSON');
        await expect(alert).toContainText('JSON_SYNTAX');
        expect(mock.requests).toHaveLength(beforeInvalid + 1);
        expect(await page.evaluate(() => window.career!.match.history())).toHaveLength(1);
        await expect(page.getByRole('button', { name: '查看本次失败响应（仅本机）' })).toHaveCount(
          0,
        );
        answer = 'PRIVATE-DIAGNOSTIC-TEXT FAKE-E2E <img src="https://never-load.example/secret">';
        await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
        await revealConfirmation(page);
        const consent = page.getByRole('checkbox', {
          name: '仅本次JSON失败时保留响应供本机临时查看',
        });
        await expect(consent).not.toBeChecked();
        await consent.check();
        const diagnosticRequestCount = mock.requests.length;
        await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
        await expect(alert).toContainText('JSON_NOT_DOCUMENT');
        await expect(alert).toContainText('正文首部=其他文字');
        await expect(alert).not.toContainText('PRIVATE-DIAGNOSTIC-TEXT');
        await expect(page.getByLabel('本机临时响应纯文本')).toHaveCount(0);
        await page.getByRole('button', { name: '查看本次失败响应（仅本机）' }).click();
        await expect(page.getByRole('dialog')).toContainText('确认查看临时响应');
        await page.getByRole('button', { name: '暂不查看', exact: true }).click();
        await expect(page.getByLabel('本机临时响应纯文本')).toHaveCount(0);
        await page.getByRole('button', { name: '查看本次失败响应（仅本机）' }).click();
        await page.getByRole('button', { name: '我了解，仅在本机查看', exact: true }).click();
        const textPreview = page.getByLabel('本机临时响应纯文本');
        await expect(textPreview).toHaveValue(/PRIVATE-DIAGNOSTIC-TEXT/);
        await expect(textPreview).not.toHaveValue(/FAKE-E2E/);
        await expect(textPreview).toHaveValue(/API KEY REDACTED/);
        await expect(page.locator('img[src*="never-load"]')).toHaveCount(0);
        expect(mock.requests).toHaveLength(diagnosticRequestCount + 1);
        expect(JSON.stringify(mock.requests.at(-1)!.body)).not.toContain('retainFailedResponse');
        expect(await page.evaluate(() => window.career!.match.history())).toHaveLength(1);
        await page.getByRole('button', { name: '关闭并清除临时响应', exact: true }).click();
        await expect(textPreview).toHaveCount(0);
        await expect(page.getByRole('button', { name: '查看本次失败响应（仅本机）' })).toHaveCount(
          0,
        );
        // A separate unviewed failure is discarded when leaving the matching page.
        await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
        await revealConfirmation(page);
        await expect(consent).not.toBeChecked();
        await consent.check();
        await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
        await expect(
          page.getByRole('button', { name: '查看本次失败响应（仅本机）' }),
        ).toBeVisible();
        await page.getByRole('button', { name: '简历评分', exact: true }).click();
        await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
        await expect(page.getByRole('button', { name: '查看本次失败响应（仅本机）' })).toHaveCount(
          0,
        );
        answer = goodAnswer;
        mock.setMode('incomplete');
        await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
        await revealConfirmation(page);
        await expect(page.getByRole('dialog', { name: '确认岗位匹配', exact: true })).toContainText(
          '本次输出上限',
        );
        await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
        await expect(page.locator('.evaluation-panel').getByRole('alert')).toContainText(
          protocol === 'responses' ? 'AI_STREAM_INCOMPLETE' : 'AI_OUTPUT_LIMIT',
        );
        expect(await page.evaluate(() => window.career!.match.history())).toHaveLength(1);
        const start = mock.requests.length;
        mock.setMode('slow');
        await page.getByRole('button', { name: '评估匹配度', exact: true }).click();
        await revealConfirmation(page);
        await page.getByRole('button', { name: '确认发送并匹配', exact: true }).click();
        await expect.poll(() => mock.requests.length).toBe(start + 1);
        await page.getByRole('button', { name: '取消匹配', exact: true }).first().click();
        await expect(page.getByRole('button', { name: '评估匹配度', exact: true })).toBeEnabled();
        expect(await page.evaluate(() => window.career!.match.history())).toHaveLength(1);
        mock.setMode('success');
        // Real IPC security boundary: never attempt to contact the loopback URL.
        const blocked = await page.evaluate(() =>
          window.career!.materials.importUrl('match', 'job', 'https://127.0.0.1/'),
        );
        expect(blocked.ok).toBe(false);
        await page.getByRole('button', { name: '撰写求职信', exact: true }).click();
        await expect(
          page.getByRole('checkbox', { name: '发送资料 resume-fixture.pdf' }),
        ).toHaveCount(0);
        await page.getByRole('button', { name: '多选导入文件 / 图片', exact: true }).click();
        await page.getByRole('button', { name: '确认用途并导入', exact: true }).click();
        await expect(
          page.getByRole('checkbox', { name: '发送资料 resume-fixture.pdf' }),
        ).toBeVisible({ timeout: 60000 });
        await page.getByRole('checkbox', { name: '发送资料 resume-fixture.pdf' }).check();
        await page.getByRole('checkbox', { name: '发送资料 网页 · jobs.example.com' }).check();
        await page.getByLabel('求职信使用的简历正文').fill('LETTER OWN RESUME');
        await page.getByLabel('本页补充证据文字').fill('LETTER OWN EVIDENCE');
        answer = JSON.stringify({
          document: '# Letter acceptance\n\nDear hiring team,',
          suggestions: 'Only supplied facts',
          rationale: 'Independent sources',
        });
        await page.getByRole('button', { name: '生成求职信', exact: true }).click();
        await revealConfirmation(page);
        await expect(page.getByRole('dialog')).toContainText('LETTER OWN EVIDENCE');
        await page.getByRole('button', { name: '确认发送并生成', exact: true }).click();
        await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
        const letterSent = JSON.stringify(mock.requests.at(-1)!.body);
        expect(letterSent).not.toContain(cv.id);
        expect(letterSent).not.toContain('LOCAL MATCH EVIDENCE');
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(860, 900),
        );
        await page.evaluate(async () => {
          const s = await window.career!.load();
          await window.career!.savePreferences({ ...s.preferences, theme: 'dark' });
        });
        await page.reload();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.waitForTimeout(500);
        await captureWindow(app, info.outputPath('letter-dark.png'));
        await app.close();
        app = await electron.launch({
          executablePath: require('electron'),
          args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
          env,
        });
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
        );
        page = await app.firstWindow();
        await expect(page.getByLabel('当前正文版本')).toHaveText('正式版本 V1');
        await expect(page.getByLabel('求职信使用的简历正文')).toHaveValue('LETTER OWN RESUME');
        await page.getByRole('button', { name: '岗位匹配', exact: true }).click();
        await expect(page.locator('.match-summary')).toContainText('Verified match fixture');
        await page.locator('.evaluation-panel').scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await captureWindow(app, info.outputPath('match-history.png'));
      } finally {
        await app.close();
        await mock.close();
      }
    },
  );
}
