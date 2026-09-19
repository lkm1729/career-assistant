import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { seedO4, o4Stores } from './o4-fixture';
import { o3Legacy } from './o3-fixture';
export const sourceId = 'ae2a264b-ef9d-4f3c-9b4c-a31608ff5dd1:p1';
export const sourceName = '当时使用的项目简历与完整经历.pdf';
export function seedO9() {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/o9-desktop-'));
  const path = join(dir, 'workspace.sqlite');
  seedO4(path);
  const f = o4Stores(path);
  const snapshot = {
    items: [
      { id: sourceId.split(':')[0], name: sourceName, selected: true, pages: [{ number: 1 }] },
      { id: 'private', name: 'PRIVATE-UNSELECTED', selected: false, pages: [{ number: 1 }] },
    ],
  };
  try {
    for (const page of ['resume', 'letter'] as const)
      f.ai.complete(
        { page, runId: randomUUID(), revision: 'fixture', input: f.workspace.readWorkspace(page) },
        o3Legacy.connection,
        {
          document:
            `# ${page} 项目成果\n\n依据 ${sourceId}\n\n` +
            '## 真实经历\n\n- **项目成果**：完成可核实的工作。\n\n'.repeat(30),
          suggestions: `## 建议\n- 核对 ${sourceId}`,
          rationale: `依据 ${sourceId}`,
        },
        snapshot,
      );
    const old = f.scores.list()[0];
    f.scores.save({
      ...old,
      id: 'o9-legacy',
      sources: undefined,
      dimensions: old.dimensions.map((d) => ({
        ...d,
        evidence: [
          { sourceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:p3', quote: 'Legacy exact quote' },
        ],
      })),
    });
    f.scores.save({
      ...old,
      id: 'o9-score',
      sources: snapshot,
      summary: `## 评估总结\n依据 ${sourceId}`,
      dimensions: old.dimensions.map((d) => ({
        ...d,
        evidence: [{ sourceId, quote: 'Exact evidence text ' + '完整经历内容 '.repeat(50) }],
        suggestions: [`核对 ${sourceId}`],
      })),
    });
    f.matches.save({
      ...o3Legacy,
      id: 'o9-match',
      materials: snapshot,
      summary: `结果依据 ${sourceId}`,
      requirements: o3Legacy.requirements.map((q) => ({
        ...q,
        evidence: [{ sourceId, quote: 'TypeScript' }],
      })),
    });
  } finally {
    f.close();
  }
  return dir;
}
