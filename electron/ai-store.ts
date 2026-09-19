import { writeWorkbench } from './workbench-store';
import { DocumentHistory, versionTable } from './document-history.js';
import { type WritingPage, type VersionReference } from '../shared/ai.js';
import { ConnectionRegistry } from './connection-registry.js';
import { DatabaseSync } from 'node:sqlite';
import {
  AiError,
  validateConnection,
  type ConnectionInput,
  type ConnectionInfo,
  type ResumeVersion,
  type ResumeResult,
  type GenerationRequest,
} from '../shared/ai.js';
import { emptyWorkspace } from '../shared/contracts.js';
import { validateDraft } from '../shared/validation.js';
export interface SecretVault {
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}
export class AiStore {
  private db: DatabaseSync;
  readonly registry: ConnectionRegistry;
  private history: DocumentHistory;
  constructor(
    path: string,
    private vault: SecretVault,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS ai_connection (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL, encrypted_key BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS resume_versions (number INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);`);
    this.registry = new ConnectionRegistry(this.db, this.vault);
    this.history = new DocumentHistory(this.db);
  }
  getConnection(): ConnectionInfo | null {
    return this.registry.connection('resume');
  }
  // Compatibility entry points for the P02 service tests. New UI uses the registry API.
  saveConnection(raw: ConnectionInput): ConnectionInfo {
    const input = validateConnection(raw);
    const old = this.getConnection();
    const provider = old?.providerId
      ? this.registry.catalog().providers.find((p) => p.id === old.providerId)
      : null;
    const savedProvider = this.registry.saveProvider({
      id: provider?.id,
      revision: provider?.revision,
      name: input.providerName,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      protocol: 'chat-completions',
    });
    const model = old?.modelConfigId
      ? this.registry.catalog().models.find((m) => m.id === old.modelConfigId)
      : null;
    const savedModel = this.registry.saveModel({
      id: model?.id,
      revision: model?.revision,
      providerId: savedProvider.id,
      modelId: input.modelId,
      name: input.modelName,
      protocol: 'inherit',
      capabilities: model?.capabilities ?? {
        images: 'unknown',
        files: 'unknown',
        structuredOutput: 'unknown',
      },
      parameterSupport: model?.parameterSupport ?? {
        temperature: false,
        maxCompletionTokens: false,
        reasoningEffort: false,
      },
      parameters: model?.parameters ?? {},
    });
    this.registry.select(
      'resume',
      savedModel.id,
      {},
      this.registry.catalog().pages.resume.revision,
    );
    return this.getConnection()!;
  }
  credentials() {
    return this.registry.credentials('resume');
  }
  removeConnection() {
    const current = this.getConnection();
    if (!current) return;
    const p = this.registry.catalog().providers.find((p) => p.id === current.providerId)!;
    this.registry.deleteItems({ kind: 'providers', items: [{ id: p.id, revision: p.revision }] });
  }
  listVersions(page: WritingPage = 'resume'): ResumeVersion[] {
    return this.history.list(page);
  }
  hasRun(page: WritingPage, runId: string) {
    return !!this.db.prepare(`SELECT 1 FROM ${versionTable(page)} WHERE run_id=?`).get(runId);
  }
  historyState(page: WritingPage) {
    return this.history.state(page);
  }
  deleteVersions(
    page: WritingPage,
    items: VersionReference[],
    expected: import('../shared/contracts').WorkspaceDraft,
  ) {
    this.history.delete(page, items, expected);
  }
  recoverVersions(page: WritingPage, items: VersionReference[]) {
    this.history.recover(page, items);
  }
  recoverDraft(
    page: WritingPage,
    id: string,
    expected: import('../shared/contracts').WorkspaceDraft,
  ) {
    this.history.recoverDraft(page, id, expected);
  }
  purgeVersions(page: WritingPage, items: VersionReference[]) {
    this.history.purge(page, items);
  }
  deleteDrafts(page: WritingPage, ids: string[]) {
    this.history.deleteDrafts(page, ids);
  }
  complete(
    request: GenerationRequest,
    connection: ConnectionInfo,
    result: ResumeResult,
    materials?: unknown,
  ): ResumeVersion {
    const page = request.page ?? 'resume';
    const table = versionTable(page);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db
        .prepare(`SELECT number,payload FROM ${table} WHERE run_id=?`)
        .get(request.runId);
      if (existing) {
        this.db.exec('COMMIT');
        return (
          this.history.list(page).find((version) => version.number === Number(existing.number)) ?? {
            ...JSON.parse(String(existing.payload)),
            number: Number(existing.number),
          }
        );
      }
      const row = this.db.prepare('SELECT payload FROM drafts WHERE id=?').get(page);
      const draft = row ? validateDraft(JSON.parse(String(row.payload))) : emptyWorkspace(page);
      if (
        draft.prompt !== request.input.prompt ||
        draft.systemPrompt !== request.input.systemPrompt ||
        draft.document !== request.input.document ||
        (page === 'letter' &&
          ((draft.resumeText ?? '') !== (request.input.resumeText ?? '') ||
            (draft.evidenceText ?? '') !== (request.input.evidenceText ?? ''))) ||
        (request.operation === 'refine' && draft.refinement !== (request.refinement ?? ''))
      )
        throw new AiError('正文输入在生成期间已改变，未覆盖当前草稿。请确认后重试。');
      const createdAt = new Date().toISOString();
      const operation = request.operation ?? 'generate';
      const parentNumber = draft.currentVersionNumber;
      const value = {
        ...result,
        ...(materials ? { materials } : {}),
        runId: request.runId,
        createdAt,
        connection,
        input: request.input,
        operation,
        refinement: operation === 'refine' ? (request.refinement ?? '') : '',
        parentNumber,
        sourceNumber: null,
      };
      const inserted = this.db
        .prepare(`INSERT INTO ${table} (run_id,payload) VALUES (?,?)`)
        .run(request.runId, JSON.stringify(value));
      const nextNumber = Number(inserted.lastInsertRowid);
      const saved = {
        ...draft,
        document: result.document,
        refinement: '',
        updatedAt: createdAt,
        currentVersionNumber: nextNumber,
      };
      this.db
        .prepare(
          'INSERT INTO drafts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        )
        .run(page, JSON.stringify(saved));
      writeWorkbench(this.db, page);
      this.db.exec('COMMIT');
      return { ...value, number: nextNumber, displayNumber: this.history.list(page).length };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  restoreVersion(
    number: number,
    expectedDraft: import('../shared/contracts.js').WorkspaceDraft,
    page: WritingPage = 'resume',
  ): ResumeVersion {
    return this.history.restore(page, number, expectedDraft);
  }
  close() {
    this.db.close();
  }
}
