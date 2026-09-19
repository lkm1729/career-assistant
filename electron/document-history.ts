import { initWorkbench, writeWorkbench } from './workbench-store';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  AiError,
  assertWritingPage,
  type WritingPage,
  type ResumeVersion,
  type VersionReference,
  type HistoryState,
} from '../shared/ai.js';
import { emptyWorkspace, type WorkspaceDraft } from '../shared/contracts.js';
import { validateDraft } from '../shared/validation.js';
export function versionTable(page: WritingPage) {
  assertWritingPage(page);
  return page === 'resume' ? 'resume_versions' : 'letter_versions';
}
export class DocumentHistory {
  constructor(private db: DatabaseSync) {
    initWorkbench(db);
    db.exec(`CREATE TABLE IF NOT EXISTS letter_versions (number INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_document_versions (workspace TEXT NOT NULL, number INTEGER NOT NULL, deleted_at TEXT NOT NULL, PRIMARY KEY(workspace,number));
      CREATE TABLE IF NOT EXISTS document_checkpoints (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);`);
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private draft(page: WritingPage): WorkspaceDraft {
    assertWritingPage(page);
    const row = this.db.prepare('SELECT payload FROM drafts WHERE id=?').get(page);
    return row ? validateDraft(JSON.parse(String(row.payload))) : emptyWorkspace(page);
  }
  private checkedDraft(page: WritingPage, expected: WorkspaceDraft): WorkspaceDraft {
    const draft = this.draft(page);
    if (JSON.stringify(draft) !== JSON.stringify(validateDraft(expected)))
      throw new AiError('草稿在确认后已改变，未覆盖任何内容。请重新确认。');
    return draft;
  }
  private saveDraft(page: WritingPage, value: WorkspaceDraft) {
    this.db
      .prepare(
        'INSERT INTO drafts(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(page, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }));
    writeWorkbench(this.db, page);
  }
  private checkpoint(page: WritingPage, draft: WorkspaceDraft) {
    this.db
      .prepare('INSERT INTO document_checkpoints VALUES (?,?,?,?)')
      .run(randomUUID(), page, new Date().toISOString(), JSON.stringify(draft));
  }
  list(page: WritingPage, deleted = false): ResumeVersion[] {
    const table = versionTable(page);
    const rows = this.db
      .prepare(
        `SELECT v.number,v.payload FROM ${table} v WHERE ${deleted ? '' : 'NOT'} EXISTS (SELECT 1 FROM deleted_document_versions d WHERE d.workspace=? AND d.number=v.number) ORDER BY v.number DESC`,
      )
      .all(page)
      .map((row) => ({ ...JSON.parse(String(row.payload)), number: Number(row.number) }));
    return rows.map((row, index) => ({
      ...row,
      displayNumber: deleted ? undefined : rows.length - index,
    }));
  }
  state(page: WritingPage): HistoryState {
    assertWritingPage(page);
    return {
      versions: this.list(page),
      deleted: this.list(page, true),
      checkpoints: this.db
        .prepare(
          'SELECT id,created_at,payload FROM document_checkpoints WHERE workspace=? ORDER BY rowid DESC',
        )
        .all(page)
        .map((row) => ({
          id: String(row.id),
          createdAt: String(row.created_at),
          draft: validateDraft(JSON.parse(String(row.payload))),
        })),
    };
  }
  restore(page: WritingPage, number: number, expected: WorkspaceDraft): ResumeVersion {
    assertWritingPage(page);
    if (!Number.isSafeInteger(number) || number < 1) throw new AiError('版本编号无效。');
    return this.transaction(() => {
      const draft = this.checkedDraft(page, expected);
      const version = this.list(page).find((v) => v.number === number);
      if (!version) throw new AiError('找不到要回滚的版本，可能已被删除；请先在回收站恢复。');
      if (
        draft.currentVersionNumber === number &&
        draft.document === version.document &&
        !draft.refinement
      )
        return version;
      this.checkpoint(page, draft);
      this.saveDraft(page, {
        ...draft,
        document: version.document,
        refinement: '',
        currentVersionNumber: number,
      });
      return version;
    });
  }
  recoverDraft(page: WritingPage, id: string, expected: WorkspaceDraft) {
    assertWritingPage(page);
    if (typeof id !== 'string' || id.length > 100) throw new AiError('草稿备份标识无效。');
    this.transaction(() => {
      const draft = this.checkedDraft(page, expected);
      const row = this.db
        .prepare('SELECT payload FROM document_checkpoints WHERE workspace=? AND id=?')
        .get(page, id);
      if (!row) throw new AiError('草稿备份不存在。');
      const backup = validateDraft(JSON.parse(String(row.payload)));
      // Recovering an old draft cannot leave an invisible/deleted current version pointer.
      if (
        backup.currentVersionNumber &&
        !this.list(page).some((v) => v.number === backup.currentVersionNumber)
      )
        backup.currentVersionNumber = null;
      this.checkpoint(page, draft);
      this.saveDraft(page, backup);
    });
  }
  private checkedItems(
    page: WritingPage,
    items: VersionReference[],
    deleted: boolean,
    maximum = 500,
  ) {
    assertWritingPage(page);
    if (!Array.isArray(items) || !items.length || items.length > maximum)
      throw new AiError(maximum === Infinity ? '请选择要操作的版本。' : '请选择 1–500 个版本。');
    const list = this.db
      .prepare(
        `SELECT v.number,v.run_id FROM ${versionTable(page)} v WHERE ${deleted ? '' : 'NOT'} EXISTS (SELECT 1 FROM deleted_document_versions d WHERE d.workspace=? AND d.number=v.number)`,
      )
      .all(page);
    const numbers = new Set<number>();
    const identities = new Map(list.map((v) => [Number(v.number), String(v.run_id)]));
    for (const item of items) {
      if (
        !item ||
        !Number.isSafeInteger(item.number) ||
        item.number < 1 ||
        typeof item.runId !== 'string' ||
        !identities.has(item.number) ||
        numbers.has(item.number) ||
        identities.get(item.number) !== item.runId
      )
        throw new AiError('版本列表已变化、重复或不存在，请刷新后重试。');
      numbers.add(item.number);
    }
    return numbers;
  }
  delete(page: WritingPage, items: VersionReference[], expected: WorkspaceDraft) {
    this.transaction(() => {
      const draft = this.checkedDraft(page, expected);
      const numbers = this.checkedItems(page, items, false);
      if (draft.currentVersionNumber && numbers.has(draft.currentVersionNumber))
        throw new AiError('不能删除当前工作版本，请先切换到其他版本。');
      const statement = this.db.prepare('INSERT INTO deleted_document_versions VALUES (?,?,?)');
      for (const number of numbers) statement.run(page, number, new Date().toISOString());
    });
  }
  recover(page: WritingPage, items: VersionReference[]) {
    this.transaction(() => {
      const numbers = this.checkedItems(page, items, true, Infinity);
      const statement = this.db.prepare(
        'DELETE FROM deleted_document_versions WHERE workspace=? AND number=?',
      );
      for (const number of numbers) statement.run(page, number);
    });
  }
  purge(page: WritingPage, items: VersionReference[]) {
    this.transaction(() => {
      const numbers = this.checkedItems(page, items, true, Infinity);
      const draft = this.draft(page);
      if (draft.currentVersionNumber && numbers.has(draft.currentVersionNumber))
        throw new AiError('不能永久删除当前工作版本，请先切换工作区。');
      const deleteVersion = this.db.prepare(`DELETE FROM ${versionTable(page)} WHERE number=?`);
      const deleteTrash = this.db.prepare(
        'DELETE FROM deleted_document_versions WHERE workspace=? AND number=?',
      );
      for (const number of numbers) {
        deleteVersion.run(number);
        deleteTrash.run(page, number);
      }
    });
  }
  deleteDrafts(page: WritingPage, checkpointIds: string[]) {
    assertWritingPage(page);
    this.transaction(() => {
      if (!Array.isArray(checkpointIds) || !checkpointIds.length)
        throw new AiError('请选择要删除的草稿备份。');
      const ids = new Set<string>();
      const find = this.db.prepare('SELECT 1 FROM document_checkpoints WHERE workspace=? AND id=?');
      for (const id of checkpointIds) {
        if (typeof id !== 'string' || !id || id.length > 100 || ids.has(id))
          throw new AiError('草稿备份列表已变化、重复或不存在，请刷新后重试。');
        if (!find.get(page, id))
          throw new AiError('草稿备份列表已变化、重复或不存在，请刷新后重试。');
        ids.add(id);
      }
      const statement = this.db.prepare(
        'DELETE FROM document_checkpoints WHERE workspace=? AND id=?',
      );
      for (const id of ids) statement.run(page, id);
    });
  }
}
