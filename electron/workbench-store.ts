import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AiError } from '../shared/ai';
import { emptyWorkspace, type WorkspaceDraft, type WorkspaceId } from '../shared/contracts';
import { assertWorkspaceId, validateDraft } from '../shared/validation';
import type { WorkbenchSnapshot, AssessmentSnapshot } from '../shared/workbench';

type Undo =
  | { document: string; currentVersionNumber: number | null }
  | { id: string; assessment?: AssessmentSnapshot | null };
interface State {
  assessment?: AssessmentSnapshot | null;
  revision: string;
  currentId: string | null;
  undo: Undo | null;
}
export function initWorkbench(db: DatabaseSync) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS workbench_results (page TEXT PRIMARY KEY, payload TEXT NOT NULL);',
  );
}
export function writeWorkbench(
  db: DatabaseSync,
  page: WorkspaceId,
  currentId: string | null = null,
  undo: Undo | null = null,
  assessment: AssessmentSnapshot | null = null,
) {
  assertWorkspaceId(page);
  if (currentId && !assessment && (page === 'score' || page === 'match' || page === 'interview')) {
    const row = db
      .prepare(`SELECT payload FROM ${assessmentTable(page)} WHERE id=?`)
      .get(currentId);
    if (row) assessment = { page, record: JSON.parse(String(row.payload)) };
  }
  db.prepare(
    'INSERT INTO workbench_results VALUES (?,?) ON CONFLICT(page) DO UPDATE SET payload=excluded.payload',
  ).run(page, JSON.stringify({ revision: randomUUID(), currentId, undo, assessment }));
}
export function workbenchTransaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = action();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function assessmentTable(page: WorkspaceId) {
  if (page !== 'score' && page !== 'match' && page !== 'interview')
    throw new AiError('评估工作区无效。');
  return page === 'score'
    ? 'score_records'
    : page === 'match'
      ? 'match_records'
      : 'interview_records';
}
export class WorkbenchStore {
  constructor(private db: DatabaseSync) {
    initWorkbench(db);
    db.exec(
      'CREATE TABLE IF NOT EXISTS document_checkpoints (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);',
    );
  }
  private state(page: WorkspaceId): State | null {
    assertWorkspaceId(page);
    const row = this.db.prepare('SELECT payload FROM workbench_results WHERE page=?').get(page);
    return row ? JSON.parse(String(row.payload)) : null;
  }
  private draft(page: WorkspaceId): WorkspaceDraft {
    const row = this.db.prepare('SELECT payload FROM drafts WHERE id=?').get(page);
    return row
      ? validateDraft(JSON.parse(String(row.payload)))
      : validateDraft(emptyWorkspace(page));
  }
  private current(page: WorkspaceId, state: State | null): string | null {
    if (page === 'resume' || page === 'letter') return null;
    // Missing row means legacy installation: preserve its latest-result behavior ONCE.
    // A persisted explicit null means cleared, never fall back to the latest record.
    if (state) return state.currentId;
    const table = assessmentTable(page);
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      return null;
    const row = this.db.prepare(`SELECT id FROM ${table} ORDER BY rowid DESC LIMIT 1`).get();
    return row ? String(row.id) : null;
  }
  inspect(page: WorkspaceId): WorkbenchSnapshot {
    const state = this.state(page);
    const draft = this.draft(page);
    const currentId = this.current(page, state);
    let assessment = state?.assessment ?? null;
    if (
      !assessment &&
      currentId &&
      (page === 'score' || page === 'match' || page === 'interview')
    ) {
      const row = this.db
        .prepare(`SELECT payload FROM ${assessmentTable(page)} WHERE id=?`)
        .get(currentId);
      if (row) assessment = { page, record: JSON.parse(String(row.payload)) };
    }
    return {
      page,
      assessment,
      revision: state?.revision ?? 'initial',
      draft,
      currentId,
      hasResult:
        page === 'resume' || page === 'letter'
          ? !!draft.document || draft.currentVersionNumber !== null
          : currentId !== null,
      canUndo: !!state?.undo,
    };
  }
  private checked(expected: WorkbenchSnapshot) {
    if (!expected || typeof expected !== 'object') throw new AiError('清空确认无效。');
    const current = this.inspect(expected.page);
    if (
      expected.revision !== current.revision ||
      JSON.stringify(validateDraft(expected.draft)) !== JSON.stringify(current.draft)
    )
      throw new AiError('工作台在确认后已改变，未清空或覆盖任何内容，请重新确认。');
    return current;
  }
  private saveDraft(page: WorkspaceId, draft: WorkspaceDraft) {
    this.db
      .prepare(
        'INSERT INTO drafts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(page, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
  }
  clear(expected: WorkbenchSnapshot) {
    return workbenchTransaction(this.db, () => {
      const current = this.checked(expected);
      if (!current.hasResult) throw new AiError('当前没有可清空的成果；已有恢复备份保持不变。');
      const { page, draft } = current;
      if (page === 'resume' || page === 'letter') {
        // Full checkpoint is retained for existing history recovery; immediate Undo below
        // restores only the output fields so newer input edits are not rolled back.
        this.db
          .prepare('INSERT INTO document_checkpoints VALUES (?,?,?,?)')
          .run(randomUUID(), page, new Date().toISOString(), JSON.stringify(draft));
        this.saveDraft(page, { ...draft, document: '', currentVersionNumber: null });
        writeWorkbench(this.db, page, null, {
          document: draft.document,
          currentVersionNumber: draft.currentVersionNumber,
        });
      } else
        writeWorkbench(this.db, page, null, {
          id: current.currentId!,
          assessment: current.assessment,
        });
      return this.inspect(page);
    });
  }
  undo(expected: WorkbenchSnapshot) {
    return workbenchTransaction(this.db, () => {
      const current = this.checked(expected);
      const undo = this.state(current.page)?.undo;
      if (!undo || current.hasResult) throw new AiError('清空恢复状态已变化，请从本页记录恢复。');
      if ('document' in undo) {
        const page = current.page;
        if (page !== 'resume' && page !== 'letter') throw new AiError('恢复工作区无效。');
        // A version may have been moved to trash while the workbench was empty.
        if (
          undo.currentVersionNumber !== null &&
          this.db
            .prepare('SELECT 1 FROM deleted_document_versions WHERE workspace=? AND number=?')
            .get(page, undo.currentVersionNumber)
        )
          throw new AiError('原工作版本已在回收站，请先从本页记录恢复该版本；备份仍保留。');
        const table = page === 'resume' ? 'resume_versions' : 'letter_versions';
        const number = undo.currentVersionNumber;
        const versionExists =
          number === null || !!this.db.prepare(`SELECT 1 FROM ${table} WHERE number=?`).get(number);
        this.saveDraft(page, {
          ...current.draft,
          ...undo,
          currentVersionNumber: versionExists ? number : null,
        });
        writeWorkbench(this.db, page);
      } else {
        if (!undo.assessment) this.assertRecord(current.page, undo.id);
        writeWorkbench(this.db, current.page, undo.id, null, undo.assessment);
      }
      return this.inspect(current.page);
    });
  }
  private assertRecord(page: WorkspaceId, id: string) {
    if (
      typeof id !== 'string' ||
      !id ||
      id.length > 100 ||
      !this.db.prepare(`SELECT 1 FROM ${assessmentTable(page)} WHERE id=?`).get(id)
    )
      throw new AiError('找不到本页评估记录，未改变当前结果。');
  }
  /** Delete one explicitly selected set atomically; preserve inputs and unrelated Undo. */
  deleteHistory(page: 'score' | 'match' | 'interview', ids: string[], revision: string) {
    const table = assessmentTable(page);
    return workbenchTransaction(this.db, () => {
      const state = this.state(page);
      const currentId = this.current(page, state);
      if (typeof revision !== 'string' || revision !== (state?.revision ?? 'initial'))
        throw new AiError('历史列表已变化，请刷新后重新确认。');
      if (!Array.isArray(ids) || !ids.length) throw new AiError('请选择要删除的历史记录。');
      const unique = new Set<string>();
      const find = this.db.prepare(`SELECT 1 FROM ${table} WHERE id=?`);
      for (const id of ids) {
        if (typeof id !== 'string' || !id || id.length > 100 || unique.has(id) || !find.get(id))
          throw new AiError('历史记录重复、不属于本页或已不存在，请刷新后重新确认。');
        unique.add(id);
      }
      const assessment = this.inspect(page).assessment ?? null;
      let undo = state?.undo ?? null;
      if (undo && 'id' in undo && !undo.assessment) {
        const row = this.db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(undo.id);
        if (row) undo = { ...undo, assessment: { page, record: JSON.parse(String(row.payload)) } };
      }
      const remove = this.db.prepare(`DELETE FROM ${table} WHERE id=?`);
      for (const id of unique) remove.run(id);
      // The workbench is a separate local copy, never a hidden history row.
      writeWorkbench(this.db, page, currentId, undo, assessment);
      return { deleted: unique.size };
    });
  }
  select(page: 'score' | 'match' | 'interview', id: string, revision: string) {
    return workbenchTransaction(this.db, () => {
      const current = this.inspect(page);
      if (current.revision !== revision) throw new AiError('当前结果已变化，请刷新后重新选择。');
      this.assertRecord(page, id);
      writeWorkbench(this.db, page, id);
      return this.inspect(page);
    });
  }
}
