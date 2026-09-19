import { expect, type Page } from '@playwright/test';
import { dataDir, launch } from './o7-web-fixture';
import { seedO4 } from './o4-fixture';
import { join } from 'node:path';
export const o11Pages = [
  ['resume', '设计简历', '生成简历', '确认发送并生成'],
  ['score', '简历评分', '开始评分', '确认发送并评分'],
  ['match', '岗位匹配', '评估匹配度', '确认发送并匹配'],
  ['letter', '撰写求职信', '生成求职信', '确认发送并生成'],
] as const;
export async function configureO11(page: Page) {
  await page.evaluate(async () => {
    const api = window.career!;
    const snapshot = await api.load();
    const protocols = ['chat-completions', 'responses', 'gemini', 'anthropic'] as const;
    const ids = ['resume', 'score', 'match', 'letter'] as const;
    for (const [index, id] of ids.entries()) {
      const p = await api.ai.registry.saveProvider({
        name: `O11 ${id} Provider`,
        protocol: protocols[index],
        baseUrl: 'http://127.0.0.1:9',
        apiKey: 'O11-FAKE-KEY',
      });
      if (!p.ok) throw Error(p.message);
      const provider = p.catalog.providers.find((p) => p.name === `O11 ${id} Provider`)!;
      const m = await api.ai.registry.saveModel({
        providerId: provider.id,
        name: `O11 ${id} Model`,
        modelId: `o11-${id}`,
        protocol: 'inherit',
        capabilities: { images: 'supported', files: 'unknown', structuredOutput: 'unknown' },
        parameterSupport: { temperature: false, maxCompletionTokens: true, reasoningEffort: false },
        parameters: { maxCompletionTokens: 1024 },
      });
      if (!m.ok) throw Error(m.message);
      const model = m.catalog.models.find((m) => m.modelId === `o11-${id}`)!;
      const selected = await api.ai.registry.selectModel(
        id,
        model.id,
        { maxCompletionTokens: 2048 + index },
        m.catalog.pages[id].revision,
      );
      if (!selected.ok) throw Error(selected.message);
      await api.saveWorkspace(id, {
        ...snapshot.workspaces[id],
        prompt: `${id} O11 CURRENT-JOB`,
        document: `${id} O11 CURRENT-RESUME`,
        resumeText: `${id} O11 SOURCE-RESUME`,
        evidenceText: `${id} O11 EVIDENCE`,
      });
      const selectedMaterial = await api.materials.importText(id, 'evidence', {
        title: `${id} SELECTED`,
        text: 'Fictional selected evidence',
      });
      if (!selectedMaterial.ok) throw Error(selectedMaterial.diagnostic.message);
      const item = selectedMaterial.items.find((m) => m.name.includes('SELECTED'))!;
      const choice = await api.materials.select(id, item.id, item.revision, true);
      if (!choice.ok) throw Error(choice.diagnostic.message);
      const hidden = await api.materials.importText(id, 'evidence', {
        title: `${id} UNSELECTED-SECRET`,
        text: 'UNSELECTED-PRIVATE-BODY',
      });
      if (!hidden.ok) throw Error(hidden.diagnostic.message);
    }
  });
  await page.reload();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
}
export async function o11Fixture() {
  const dir = dataDir();
  seedO4(join(dir, 'workspace.sqlite'));
  const f = await launch(dir);
  await configureO11(f.page);
  return { ...f, dir };
}
