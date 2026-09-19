import type { ConnectionInfo } from './ai';
import type { AiDiagnostic } from './diagnostics';
import type { HistoryBulkDeleteReply } from './ai';
import type { MaterialManifest } from './materials';
export const rubricVersion = 'resume-rubric-1';
export const scoreDimensions = [
  { key: 'content', name: '内容完整性与成果证据', weight: 30 },
  { key: 'relevance', name: '岗位或职业方向相关性', weight: 30 },
  { key: 'visual', name: '结构、视觉排版与可读性', weight: 20 },
  { key: 'expression', name: '表达准确性与专业性', weight: 20 },
] as const;
export interface ScoreDimension {
  key: (typeof scoreDimensions)[number]['key'];
  score: number | null;
  evidence: { sourceId: string; quote: string }[];
  issues: string[];
  suggestions: string[];
  example?: string;
}
export interface ScoreBlockReason {
  code:
    | 'RESUME_PAGES_MISSING'
    | 'ORIGINAL_LAYOUT_REQUIRED'
    | 'RESUME_IMAGES_MISSING'
    | 'MODEL_PAGES_UNREADABLE'
    | 'MODEL_COVERAGE_MISSING'
    | 'DIMENSIONS_INCOMPLETE'
    | 'EVIDENCE_CONFLICT';
  message: string;
  action: string;
}
export interface ScoreCompleteness {
  policyVersion: 'score-completeness-2';
  expectedPages: number;
  parsedPages: number;
  sentImagePages: number;
  modelCoveredPages: number;
  reasons: ScoreBlockReason[];
}
export interface ScoreResult {
  /** Optional for records saved before O8; never recompute legacy scores on display. */
  completeness?: ScoreCompleteness;
  dimensions: ScoreDimension[];
  summary: string;
  coveredPages: string[];
  unreadablePages: string[];
  conflicts: string[];
  total: number | null;
  warnings: string[];
  rubricVersion: string;
}
export interface ScoreFailurePreview {
  runId: string;
  text: string;
  truncated: boolean;
  expiresAt: number;
}
export interface ScoreConfirmation {
  /** Explicit one-run consent; never stored or forwarded to the model. */
  retainFailedResponse?: boolean;
  sameJobConfirmed?: boolean;
  workbenchRevision?: string;
  runId: string;
  revision: string;
  connection: ConnectionInfo;
  input: { prompt: string; systemPrompt: string; document: string };
  materials: MaterialManifest;
  sendImages: boolean;
  outputMode?: 'prompt-json' | 'gemini-json-schema' | 'anthropic-json-schema';
}
export interface ScoreRecord extends ScoreResult {
  id: string;
  createdAt: string;
  mode: 'general' | 'targeted';
  connection: ConnectionInfo;
  input: ScoreConfirmation['input'];
  sources: unknown;
}
export type ScoreReply<T> =
  { ok: true; value: T } | { ok: false; diagnostic: AiDiagnostic; previewAvailable?: boolean };
export interface ScoreBridge {
  takeFailedPreview(runId: string): Promise<ScoreFailurePreview | null>;
  discardFailedPreview(runId: string): Promise<void>;
  prepare(sendImages: boolean): Promise<ScoreReply<ScoreConfirmation>>;
  run(confirmation: ScoreConfirmation): Promise<ScoreReply<ScoreRecord>>;
  cancel(runId: string): Promise<void>;
  history(): Promise<ScoreRecord[]>;
  deleteMany(ids: string[], revision: string): Promise<HistoryBulkDeleteReply>;
}

/** Only selected material snapshots determine whether an attached job makes scoring targeted. */
export function scoreMode(
  input: Pick<ScoreConfirmation, 'input' | 'materials'>,
): ScoreRecord['mode'] {
  return input.input.prompt.trim() || input.materials.items.some((item) => item.purpose === 'job')
    ? 'targeted'
    : 'general';
}
