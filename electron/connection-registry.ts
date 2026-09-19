import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AiError, chatEndpoint, protocolEndpoint, type ConnectionInfo } from '../shared/ai.js';
import { workspaceIds, type WorkspaceId } from '../shared/contracts.js';
import { assertWorkspaceId } from '../shared/validation.js';
import {
  assertModelProtocol,
  checkedId,
  emptyCapabilities,
  emptyParameters,
  modelConnection,
  resolvedConnection,
  validateModel,
  validateParameters,
  wireParameters,
  validateProvider,
  type Catalog,
  type DeleteRequest,
  type ModelInfo,
  type ModelInput,
  type Parameters,
  type ProviderInfo,
  type ProviderInput,
  type TestReceipt,
} from '../shared/models.js';
import type { SecretVault } from './ai-store.js';
export class ConnectionRegistry {
  constructor(
    private db: DatabaseSync,
    private vault: SecretVault,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_providers(id TEXT PRIMARY KEY, metadata TEXT NOT NULL, encrypted_key BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_models(id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_page_models(page TEXT PRIMARY KEY, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_schema_migrations(name TEXT PRIMARY KEY);`);
    this.transaction(() => {
      for (const page of workspaceIds)
        db.prepare('INSERT OR IGNORE INTO ai_page_models VALUES (?,?)').run(
          page,
          JSON.stringify({ modelId: null, overrides: {}, revision: randomUUID() }),
        );
      const migrated = db.prepare("SELECT name FROM ai_schema_migrations WHERE name='p03'").get();
      const legacyTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_connection'")
        .get();
      const row = legacyTable
        ? db.prepare('SELECT metadata,encrypted_key FROM ai_connection WHERE id=1').get()
        : null;
      // A database opened by P03 can still receive a legacy row from a prior import; migrate it even when the marker exists.
      if (migrated && !row) return;
      if (row) {
        const legacy = JSON.parse(String(row.metadata)) as ConnectionInfo;
        const p: ProviderInfo = {
          id: randomUUID(),
          revision: randomUUID(),
          name: legacy.providerName,
          baseUrl: legacy.baseUrl,
          endpoint: chatEndpoint(legacy.baseUrl),
          hasKey: true,
          protocol: 'chat-completions',
        };
        const m: ModelInfo = {
          id: randomUUID(),
          revision: randomUUID(),
          providerId: p.id,
          modelId: legacy.modelId,
          name: legacy.modelName,
          protocol: 'inherit',
          capabilities: emptyCapabilities(),
          parameterSupport: emptyParameters(),
          parameters: {},
          tests: [],
        };
        db.prepare('INSERT INTO ai_providers VALUES (?,?,?)').run(
          p.id,
          JSON.stringify(p),
          row.encrypted_key,
        );
        this.writeModel(m);
        db.prepare("UPDATE ai_page_models SET metadata=? WHERE page='resume'").run(
          JSON.stringify({ modelId: m.id, overrides: {}, revision: randomUUID() }),
        );
        // Encrypted bytes have been copied in this transaction; remove the obsolete duplicate.
        db.prepare('DELETE FROM ai_connection WHERE id=1').run();
      }
      db.prepare("INSERT INTO ai_schema_migrations VALUES ('p03')").run();
    });
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  catalog(): Catalog {
    return {
      providers: this.db
        .prepare('SELECT metadata FROM ai_providers ORDER BY rowid')
        .all()
        .map((r) => JSON.parse(String(r.metadata))),
      models: this.db
        .prepare('SELECT metadata FROM ai_models ORDER BY rowid')
        .all()
        .map((r) => JSON.parse(String(r.metadata))),
      pages: Object.fromEntries(
        this.db
          .prepare('SELECT page,metadata FROM ai_page_models')
          .all()
          .map((r) => [String(r.page), JSON.parse(String(r.metadata))]),
      ) as Catalog['pages'],
    };
  }
  private provider(id: string): ProviderInfo {
    const p = this.catalog().providers.find((p) => p.id === id);
    if (!p) throw new AiError('供应商不存在，请刷新设置。');
    return p;
  }
  private model(id: string): ModelInfo {
    const m = this.catalog().models.find((m) => m.id === id);
    if (!m) throw new AiError('模型不存在，请重新选择。');
    return m;
  }
  private writeModel(m: ModelInfo) {
    this.db
      .prepare(
        'INSERT INTO ai_models VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id,metadata=excluded.metadata',
      )
      .run(m.id, m.providerId, JSON.stringify(m));
  }
  saveProvider(raw: ProviderInput): ProviderInfo {
    const input = validateProvider(raw);
    const old = input.id ? this.provider(input.id) : null;
    if (old && input.revision !== old.revision)
      throw new AiError('供应商配置已变化，请重新打开编辑。');
    if (!old && this.catalog().providers.length >= 100)
      throw new AiError('供应商数量达到上限 100。');
    const endpoint = protocolEndpoint(input.baseUrl, input.protocol);
    if (!input.apiKey && !old) throw new AiError('新供应商需要填写 API Key。');
    // Reject incompatible inherited models/overrides before changing the provider or its key.
    if (old) {
      const catalog = this.catalog();
      for (const model of catalog.models.filter((m) => m.providerId === old.id)) {
        const protocol = input.protocol;
        protocolEndpoint(input.baseUrl, protocol, model.modelId);
        assertModelProtocol(model, protocol);
        for (const selection of Object.values(catalog.pages))
          if (selection.modelId === model.id)
            assertModelProtocol(model, protocol, selection.overrides);
      }
    }
    const encrypted = input.apiKey
      ? this.vault.encrypt(input.apiKey)
      : this.db.prepare('SELECT encrypted_key FROM ai_providers WHERE id=?').get(old!.id)!
          .encrypted_key;
    const p: ProviderInfo = {
      id: old?.id ?? randomUUID(),
      revision: randomUUID(),
      name: input.name,
      baseUrl: input.baseUrl,
      endpoint,
      hasKey: true,
      test: old?.test,
      protocol: input.protocol,
    };
    this.db
      .prepare(
        'INSERT INTO ai_providers VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,encrypted_key=excluded.encrypted_key',
      )
      .run(p.id, JSON.stringify(p), encrypted);
    return p;
  }
  saveModel(raw: ModelInput): ModelInfo {
    const input = validateModel(raw);
    const provider = this.provider(input.providerId);
    const protocol = provider.protocol;
    protocolEndpoint(provider.baseUrl, protocol, input.modelId);
    assertModelProtocol(input, protocol);
    const old = input.id ? this.model(input.id) : null;
    if (old && (old.revision !== input.revision || old.providerId !== input.providerId))
      throw new AiError('模型配置已变化，或供应商归属不一致。');
    const all = this.catalog().models;
    if (!old && all.length >= 500) throw new AiError('模型数量达到上限 500。');
    if (
      all.some(
        (m) => m.id !== old?.id && m.providerId === input.providerId && m.modelId === input.modelId,
      )
    )
      throw new AiError('此供应商下已经存在相同模型 ID。');
    const m: ModelInfo = {
      ...input,
      id: old?.id ?? randomUUID(),
      revision: randomUUID(),
      tests: old?.tests ?? [],
    };
    // Validate surviving page overrides as well as model defaults before any write.
    for (const selection of Object.values(this.catalog().pages)) {
      if (selection.modelId !== m.id) continue;
      const overrides = { ...selection.overrides };
      for (const key of Object.keys(overrides) as (keyof Parameters)[])
        if (!m.parameterSupport[key]) delete overrides[key];
      assertModelProtocol(m, protocol, overrides);
    }
    this.transaction(() => {
      this.writeModel(m);
      // When a parameter is disabled, remove page overrides so enabling it later cannot revive hidden values.
      for (const [page, selection] of Object.entries(this.catalog().pages))
        if (selection.modelId === m.id) {
          const overrides = { ...selection.overrides };
          for (const key of Object.keys(overrides) as (keyof Parameters)[])
            if (!m.parameterSupport[key]) delete overrides[key];
          this.db
            .prepare('UPDATE ai_page_models SET metadata=? WHERE page=?')
            .run(JSON.stringify({ ...selection, overrides, revision: randomUUID() }), page);
        }
    });
    return m;
  }
  importDiscovered(providerId: string, revision: string, ids: string[]) {
    const provider = this.provider(checkedId(providerId));
    if (provider.revision !== revision) throw new AiError('供应商配置已变化，请重新获取列表。');
    const existing = this.catalog().models;
    const inputs = [...new Set(ids)]
      .filter((id) => !existing.some((m) => m.providerId === providerId && m.modelId === id))
      .map((modelId) => {
        const input = validateModel({
          providerId,
          modelId,
          name: modelId.slice(0, 100),
          protocol: 'inherit',
          capabilities: emptyCapabilities(),
          parameterSupport: emptyParameters(),
          parameters: {},
        });
        protocolEndpoint(provider.baseUrl, provider.protocol, input.modelId);
        return input;
      });
    if (existing.length + inputs.length > 500)
      throw new AiError('导入后模型数量超过上限 500；未导入任何模型。');
    this.transaction(() => {
      for (const input of inputs)
        this.writeModel({ ...input, id: randomUUID(), revision: randomUUID(), tests: [] });
    });
  }
  select(page: WorkspaceId, modelId: string | null, raw: Parameters, revision: string) {
    assertWorkspaceId(page);
    const overrides = validateParameters(raw);
    const current = this.catalog().pages[page];
    if (current.revision !== revision) throw new AiError('页面模型设置已变更，请刷新后重试。');
    if (modelId !== null) {
      const model = this.model(checkedId(modelId));
      const connection = modelConnection(this.provider(model.providerId), model, overrides);
      wireParameters(connection.parameters ?? {}, connection.protocol);
      for (const key of Object.keys(overrides) as (keyof Parameters)[])
        if (!model.parameterSupport[key]) throw new AiError('所选模型未启用该参数支持。');
    } else if (Object.keys(overrides).length) throw new AiError('请先选择模型再配置参数。');
    this.db
      .prepare('UPDATE ai_page_models SET metadata=? WHERE page=?')
      .run(JSON.stringify({ modelId, overrides, revision: randomUUID() }), page);
  }
  connection(page: WorkspaceId): ConnectionInfo | null {
    assertWorkspaceId(page);
    return resolvedConnection(this.catalog(), page);
  }
  modelConnection(id: string): ConnectionInfo {
    const m = this.model(checkedId(id));
    return modelConnection(this.provider(m.providerId), m);
  }
  credentials(page: WorkspaceId): { connection: ConnectionInfo; apiKey: string } {
    const connection = this.connection(page);
    if (!connection) throw new AiError('请为此标签页选择有效的模型。');
    return { connection, apiKey: this.key(connection.providerId!) };
  }
  modelCredentials(id: string) {
    const connection = this.modelConnection(id);
    return { connection, apiKey: this.key(connection.providerId!) };
  }
  providerCredentials(id: string) {
    const provider = this.provider(checkedId(id));
    return { provider, apiKey: this.key(provider.id) };
  }
  recordProviderTest(id: string, receipt: Omit<TestReceipt, 'kind'>) {
    const provider = this.provider(checkedId(id));
    if (provider.revision !== receipt.revision) throw new AiError('供应商配置已变化，请重新测试。');
    this.db
      .prepare('UPDATE ai_providers SET metadata=? WHERE id=?')
      .run(JSON.stringify({ ...provider, test: receipt }), id);
  }
  private key(providerId: string): string {
    try {
      const row = this.db
        .prepare('SELECT encrypted_key FROM ai_providers WHERE id=?')
        .get(providerId)!;
      return this.vault.decrypt(Buffer.from(row.encrypted_key as Uint8Array));
    } catch {
      throw new AiError('无法解密此电脑保存的密钥，请重新填写供应商密钥。');
    }
  }
  recordTest(id: string, receipt: TestReceipt) {
    if (this.modelConnection(id).revision !== receipt.revision)
      throw new AiError('配置已变化，测试结果不再有效。');
    const model = this.model(id);
    this.writeModel({
      ...model,
      tests: [...model.tests.filter((t) => t.kind !== receipt.kind), receipt],
    });
  }
  deleteItems(request: DeleteRequest) {
    if (
      !request ||
      !['providers', 'models'].includes(request.kind) ||
      !Array.isArray(request.items) ||
      !request.items.length ||
      request.items.length > 500
    )
      throw new AiError('删除请求无效。');
    const ids = request.items.map((item) => checkedId(item.id));
    if (new Set(ids).size !== ids.length) throw new AiError('删除列表包含重复项。');
    this.transaction(() => {
      const catalog = this.catalog();
      for (const item of request.items) {
        const record = request.kind === 'providers' ? this.provider(item.id) : this.model(item.id);
        if (record.revision !== item.revision) throw new AiError('待删除配置已变化，请重新确认。');
      }
      const models = catalog.models.filter((m) =>
        request.kind === 'models' ? ids.includes(m.id) : ids.includes(m.providerId),
      );
      for (const model of models) this.db.prepare('DELETE FROM ai_models WHERE id=?').run(model.id);
      if (request.kind === 'providers')
        for (const id of ids) this.db.prepare('DELETE FROM ai_providers WHERE id=?').run(id);
      for (const [page, selection] of Object.entries(catalog.pages))
        if (models.some((m) => m.id === selection.modelId)) {
          this.db
            .prepare('UPDATE ai_page_models SET metadata=? WHERE page=?')
            .run(JSON.stringify({ modelId: null, overrides: {}, revision: randomUUID() }), page);
        }
    });
  }
}
