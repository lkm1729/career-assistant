import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from '../electron/workspace-store';
import { AiStore } from '../electron/ai-store';
import { ScoreStore } from '../electron/scoring';
import { MatchStore } from '../electron/matching';
import { MaterialStore } from '../electron/material-store';
import { AiService } from '../electron/ai-service';
import { workspaceIds } from '../shared/contracts';
import { scoreDimensions, type ScoreRecord } from '../shared/scoring';
import { o3Legacy } from './o3-fixture';
export function o4Stores(path: string) {
  const workspace = new WorkspaceStore(path);
  const ai = new AiStore(path, {
    encrypt: (s) => Buffer.from('test:' + s),
    decrypt: (b) => b.toString().slice(5),
  });
  const scores = new ScoreStore(path);
  const matches = new MatchStore(new DatabaseSync(path));
  const materials = new MaterialStore(path);
  const service = new AiService(ai, workspace, materials, scores, matches);
  return {
    workspace,
    ai,
    scores,
    matches,
    materials,
    service,
    close() {
      service.cancelAll();
      materials.close();
      matches.close();
      scores.close();
      ai.close();
      workspace.close();
    },
  };
}
export function seedO4(path: string) {
  const f = o4Stores(path);
  try {
    for (const page of workspaceIds) {
      f.workspace.saveWorkspace(page, {
        ...f.workspace.readWorkspace(page),
        prompt: `${page} Python required`,
        document: `${page} Python projects`,
        refinement: `${page} keep refinement`,
        links: 'https://example.com/project',
        resumeText: `${page} source resume`,
        evidenceText: `${page} evidence`,
      });
      f.materials.importWeb(page, 'evidence', {
        url: 'https://example.com/project',
        text: `${page} independent fixture`,
        warnings: [],
      });
    }
    for (const page of ['resume', 'letter'] as const) {
      const draft = f.workspace.readWorkspace(page);
      f.ai.complete(
        { page, runId: randomUUID(), revision: 'fixture', input: draft },
        o3Legacy.connection,
        {
          document: `# ${page} generated result`,
          suggestions: `${page} unique advice`,
          rationale: `${page} unique rationale`,
        },
      );
    }
    const record: ScoreRecord = {
      id: 'o4-score-record',
      createdAt: '2026-09-18T00:00:00.000Z',
      mode: 'general',
      connection: o3Legacy.connection,
      input: {
        prompt: 'score Python required',
        document: 'score Python projects',
        systemPrompt: '',
      },
      sources: [],
      dimensions: scoreDimensions.map((d) => ({
        key: d.key,
        score: d.key === 'visual' ? null : 80,
        evidence: d.key === 'visual' ? [] : [{ sourceId: 'paste', quote: 'Python' }],
        issues: [],
        suggestions: ['fixture advice'],
      })),
      summary: 'O4 score summary',
      coveredPages: [],
      unreadablePages: [],
      conflicts: [],
      total: null,
      warnings: [],
      rubricVersion: 'resume-rubric-1',
    };
    f.scores.save(record);
    f.matches.save({ ...o3Legacy, id: 'o4-match-record', summary: 'O4 match summary' });
  } finally {
    f.close();
  }
}
