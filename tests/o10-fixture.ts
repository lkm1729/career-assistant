import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { o4Stores, seedO4 } from './o4-fixture';
import { o3Legacy } from './o3-fixture';

export function seedO10(count = 25) {
  mkdirSync('.test-data', { recursive: true });
  const dir = mkdtempSync(resolve('.test-data/o10-isolated-'));
  const path = join(dir, 'workspace.sqlite');
  seedO4(path);
  const f = o4Stores(path);
  try {
    for (const page of ['resume', 'letter'] as const) {
      for (let n = 0; n < count; n++)
        f.ai.complete(
          {
            page,
            runId: randomUUID(),
            revision: 'fixture',
            input: f.workspace.readWorkspace(page),
          },
          o3Legacy.connection,
          { document: `${page} version ${n + 2}`, suggestions: 'fixture', rationale: 'fixture' },
        );
      const versions = f.ai.listVersions(page);
      // Each call uses existing public soft-delete contract (up to 500).
      const old = versions.filter((v) => v.number !== count + 1);
      for (let i = 0; i < old.length; i += 500)
        f.ai.deleteVersions(page, old.slice(i, i + 500), f.workspace.readWorkspace(page));
      for (let n = 0; n < count; n++) {
        f.workspace.saveWorkspace(page, {
          ...f.workspace.readWorkspace(page),
          document: `${page} checkpoint ${n}`,
        });
        f.ai.restoreVersion(count + 1, f.workspace.readWorkspace(page), page);
      }
    }
    const score = f.scores.list()[0],
      match = f.matches.list()[0];
    for (let n = 1; n < count; n++) {
      f.scores.save({ ...score, id: `score-o10-${n}`, summary: `O10 score ${n}` });
      f.matches.save({ ...match, id: `match-o10-${n}`, summary: `O10 match ${n}` });
    }
  } finally {
    f.close();
  }
  return { dir, path };
}
