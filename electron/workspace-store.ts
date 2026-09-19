import { WorkbenchStore, workbenchTransaction, writeWorkbench } from './workbench-store';
import { randomUUID } from 'node:crypto';
import { AiError } from '../shared/ai';
import type { PromptPreset } from '../shared/prompts';
import { DatabaseSync } from 'node:sqlite';
import { assertWorkspaceId, validateDraft, validatePreferences } from '../shared/validation.js';
import {
  workspaceIds,
  emptyWorkspace,
  type WorkspaceDraft,
  type WorkspaceId,
  type Preferences,
  type Snapshot,
} from '../shared/contracts.js';

export class WorkspaceStore {
  private db: DatabaseSync;
  readonly workbench: WorkbenchStore;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prompt_presets (id TEXT PRIMARY KEY, page TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(page,name));`);
    this.workbench = new WorkbenchStore(this.db);
  }
  readWorkspace(id: WorkspaceId): WorkspaceDraft {
    assertWorkspaceId(id);
    const row = this.db.prepare('SELECT payload FROM drafts WHERE id = ?').get(id);
    return row ? validateDraft(JSON.parse(String(row.payload))) : emptyWorkspace(id);
  }
  saveWorkspace(id: WorkspaceId, draft: WorkspaceDraft): WorkspaceDraft {
    assertWorkspaceId(id);
    const saved = { ...validateDraft(draft), updatedAt: new Date().toISOString() };
    workbenchTransaction(this.db, () => {
      const before = this.readWorkspace(id);
      this.db
        .prepare(
          'INSERT INTO drafts (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
        )
        .run(id, JSON.stringify(saved));
      if (
        (id === 'resume' || id === 'letter') &&
        (before.document !== saved.document ||
          before.currentVersionNumber !== saved.currentVersionNumber)
      )
        writeWorkbench(this.db, id);
    });
    return saved;
  }
  load(): Snapshot {
    const workspaces = Object.fromEntries(
      workspaceIds.map((id) => [id, this.readWorkspace(id)]),
    ) as Snapshot['workspaces'];
    const row = this.db.prepare('SELECT payload FROM preferences WHERE id = 1').get();
    return {
      workspaces,
      preferences: row
        ? validatePreferences(JSON.parse(String(row.payload)))
        : { theme: 'system', activeTab: 'resume' },
    };
  }
  savePreferences(preferences: Preferences) {
    this.db
      .prepare(
        'INSERT INTO preferences (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      )
      .run(JSON.stringify(validatePreferences(preferences)));
  }
  listPrompts(page: WorkspaceId): PromptPreset[] {
    assertWorkspaceId(page);
    return this.db
      .prepare('SELECT id,page,name,text,createdAt FROM prompt_presets WHERE page=? ORDER BY rowid')
      .all(page) as unknown as PromptPreset[];
  }
  savePrompt(page: WorkspaceId, name: string, text: string): PromptPreset[] {
    assertWorkspaceId(page);
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80 ||
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 100000
    )
      throw new AiError('提示词副本名称需1–80字，正文需1–100000字。');
    const existing = this.listPrompts(page);
    if (existing.some((p) => p.name === name.trim()))
      throw new AiError('本页已有同名副本，请换一个名称；不会覆盖旧副本。');
    if (existing.length >= 20) throw new AiError('本页最多保存20份提示词副本；未覆盖既有内容。');
    this.db
      .prepare('INSERT INTO prompt_presets(id,page,name,text,createdAt) VALUES(?,?,?,?,?)')
      .run(randomUUID(), page, name.trim(), text, new Date().toISOString());
    return this.listPrompts(page);
  }
  close() {
    this.db.close();
  }
}
