import type { ScoreRecord } from './scoring';
import type { MatchRecord } from './matching';
import type { WorkspaceDraft, WorkspaceId } from './contracts';
import type { AiDiagnostic } from './diagnostics';
export type AssessmentSnapshot =
  { page: 'score'; record: ScoreRecord } | { page: 'match'; record: MatchRecord };
export interface WorkbenchSnapshot {
  assessment?: AssessmentSnapshot | null;
  page: WorkspaceId;
  revision: string;
  draft: WorkspaceDraft;
  currentId: string | null;
  hasResult: boolean;
  canUndo: boolean;
}
export type WorkbenchReply =
  { ok: true; value: WorkbenchSnapshot } | { ok: false; diagnostic: AiDiagnostic };
export interface WorkbenchBridge {
  inspect(page: WorkspaceId): Promise<WorkbenchSnapshot>;
  clear(expected: WorkbenchSnapshot): Promise<WorkbenchReply>;
  undo(expected: WorkbenchSnapshot): Promise<WorkbenchReply>;
  select(page: 'score' | 'match', id: string, revision: string): Promise<WorkbenchReply>;
}
