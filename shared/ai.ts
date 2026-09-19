import { httpDiagnostic, type AiDiagnostic } from './diagnostics';
export const protocols = ['chat-completions', 'responses', 'gemini', 'anthropic'] as const;
export type Protocol = (typeof protocols)[number];
export const protocolLabel = (protocol: Protocol) =>
  ({
    'chat-completions': 'OpenAI Chat Completions',
    responses: 'OpenAI Responses',
    gemini: 'Gemini 原生协议',
    anthropic: 'Anthropic Messages',
  })[protocol];
export interface ConnectionInput {
  providerName: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  apiKey: string;
}
export interface ConnectionInfo {
  providerId?: string;
  modelConfigId?: string;
  parameters?: import('./models').Parameters;
  providerName: string;
  baseUrl: string;
  endpoint: string;
  modelId: string;
  modelName: string;
  protocol: Protocol;
  hasKey: boolean;
  revision: string;
}
export interface ResumeResult {
  document: string;
  suggestions: string;
  rationale: string;
}
export interface ResumeVersion extends ResumeResult {
  /** Dense visible ordinal; number remains the stable record identity. */
  displayNumber?: number;
  materials?: unknown;
  number: number;
  runId: string;
  createdAt: string;
  connection: ConnectionInfo;
  input: {
    prompt: string;
    systemPrompt: string;
    document: string;
    resumeText?: string;
    evidenceText?: string;
  };
  /** Exact adjustment instruction, or pending instruction preserved before restore. */
  refinement?: string;
  operation?: 'generate' | 'refine' | 'restore';
  parentNumber?: number | null;
  sourceNumber?: number | null;
}
export interface GenerationRequest {
  workbenchRevision?: string;
  /** One-run acknowledgement; main process recomputes the actual source list. */
  sameJobConfirmed?: boolean;
  materials?: { revision: string; sendImages: boolean };
  page?: WritingPage;
  runId: string;
  revision: string;
  input: {
    prompt: string;
    systemPrompt: string;
    document: string;
    resumeText?: string;
    evidenceText?: string;
  };
  operation?: 'generate' | 'refine';
  refinement?: string;
}
export interface AiEvent {
  runId: string;
  text: string;
}
export type AiReply =
  { ok: true; version: ResumeVersion } | { ok: false; message: string; diagnostic?: AiDiagnostic };
export type WritingPage = 'resume' | 'letter';
export function assertWritingPage(value: unknown): asserts value is WritingPage {
  if (value !== 'resume' && value !== 'letter') throw new AiError('正文工作区无效。');
}
export interface VersionReference {
  number: number;
  runId: string;
}
export interface DraftCheckpoint {
  id: string;
  createdAt: string;
  draft: import('./contracts').WorkspaceDraft;
}
export interface HistoryState {
  versions: ResumeVersion[];
  deleted: ResumeVersion[];
  checkpoints: DraftCheckpoint[];
}
export type HistoryBulkDeleteReply =
  { ok: true; deleted: number } | { ok: false; diagnostic: import('./diagnostics').AiDiagnostic };
export type HistoryReply =
  { ok: true; history: HistoryState } | { ok: false; message: string; diagnostic?: AiDiagnostic };
export interface AiBridge {
  getHistory(page: WritingPage): Promise<HistoryState>;
  restoreDocumentVersion(
    page: WritingPage,
    number: number,
    expectedDraft: import('./contracts').WorkspaceDraft,
  ): Promise<AiReply>;
  deleteVersions(
    page: WritingPage,
    items: VersionReference[],
    expectedDraft: import('./contracts').WorkspaceDraft,
  ): Promise<HistoryReply>;
  recoverVersions(page: WritingPage, items: VersionReference[]): Promise<HistoryReply>;
  purgeVersions(page: WritingPage, items: VersionReference[]): Promise<HistoryReply>;
  recoverDraft(
    page: WritingPage,
    checkpointId: string,
    expectedDraft: import('./contracts').WorkspaceDraft,
  ): Promise<HistoryReply>;
  deleteDrafts(page: WritingPage, checkpointIds: string[]): Promise<HistoryReply>;
  registry: import('./models').RegistryBridge;
  getConnection(): Promise<ConnectionInfo | null>;
  saveConnection(
    input: ConnectionInput,
  ): Promise<
    | { ok: true; connection: ConnectionInfo }
    | { ok: false; message: string; diagnostic?: AiDiagnostic }
  >;
  removeConnection(): Promise<{ ok: boolean; message?: string }>;
  testConnection(revision: string): Promise<{ ok: boolean; message: string }>;
  generateDocument(request: GenerationRequest): Promise<AiReply>;
  generateResume(request: GenerationRequest): Promise<AiReply>;
  cancelGeneration(runId: string): Promise<void>;
  listResumeVersions(): Promise<ResumeVersion[]>;
  restoreResumeVersion(
    number: number,
    expectedDraft: import('./contracts').WorkspaceDraft,
  ): Promise<
    { ok: true; version: ResumeVersion } | { ok: false; message: string; diagnostic?: AiDiagnostic }
  >;
  onGeneration(listener: (event: AiEvent) => void): () => void;
}
export class AiError extends Error {
  constructor(
    message: string,
    readonly diagnostic?: AiDiagnostic,
  ) {
    super(message);
  }
}
export function httpAiError(status: number): AiError {
  const diagnostic = httpDiagnostic(status);
  return new AiError(diagnostic.message, diagnostic);
}
export function chatEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AiError('Base URL 格式无效。');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AiError('地址仅支持 HTTP(S)，不能包含账号、密码、查询参数或片段。');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new AiError('远程供应商必须使用 HTTPS；HTTP 仅允许本机服务。');
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/(responses|messages|completions)$/.test(path) && !path.endsWith('/chat/completions')) {
    throw new AiError('本阶段仅支持 Chat Completions，请检查协议与地址。');
  }
  if (!path) path = '/v1';
  if (!path.endsWith('/chat/completions')) path += '/chat/completions';
  url.pathname = path;
  return url.href;
}
/** Final destination; model ID only affects Gemini's encoded path, never the origin. */
export function protocolEndpoint(value: string, protocol: Protocol, modelId?: string): string {
  if (!protocols.includes(protocol)) throw new AiError('接口协议无效。');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AiError('Base URL 格式无效。');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AiError(
      '地址仅支持 HTTP(S)，不能包含账号、密码、查询参数或片段。Gemini 的 alt=sse 由程序添加。',
    );
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new AiError('远程供应商必须使用 HTTPS；HTTP 仅允许本机服务。');
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/completions$/.test(path) && !path.endsWith('/chat/completions'))
    throw new AiError('旧 Completions 端点不受支持，请检查完整接口地址。');
  const native = path.match(/\/models\/([^/]+):streamGenerateContent$/);
  const suffix = /\/(chat\/completions|responses|messages)$/;
  const hadEndpoint = !!native || suffix.test(path);
  if (native) path = path.slice(0, native.index);
  else path = path.replace(suffix, '');
  if (!path && !hadEndpoint) path = protocol === 'gemini' ? '/v1beta' : '/v1';
  if (protocol === 'gemini') {
    let model = modelId?.trim();
    if (!model && native) {
      try {
        model = decodeURIComponent(native[1]);
      } catch {
        throw new AiError('Gemini 模型 ID 编码无效。');
      }
    }
    if (model?.startsWith('models/')) model = model.slice(7);
    if (model !== undefined && (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(model)))
      throw new AiError(
        'Gemini 模型 ID 只能包含字母、数字、点、下划线和连字符，可带 models/ 前缀。',
      );
    url.pathname =
      path +
      '/models/' +
      (model ? encodeURIComponent(model) : '{model}') +
      ':streamGenerateContent';
    url.searchParams.set('alt', 'sse');
    return url.href;
  }
  url.pathname =
    path +
    (protocol === 'responses'
      ? '/responses'
      : protocol === 'anthropic'
        ? '/messages'
        : '/chat/completions');
  return url.href;
}
export function validateConnection(input: ConnectionInput): ConnectionInput {
  if (!input || typeof input !== 'object') throw new AiError('连接配置无效。');
  for (const [name, max] of [
    ['providerName', 100],
    ['baseUrl', 2048],
    ['modelId', 256],
    ['modelName', 100],
    ['apiKey', 4096],
  ] as const) {
    const value = input[name];
    if (
      typeof value !== 'string' ||
      value.length > max ||
      /[\r\n\x00]/.test(value) ||
      (name !== 'apiKey' && !value.trim())
    )
      throw new AiError('请填写有效的供应商、地址和模型信息。');
  }
  chatEndpoint(input.baseUrl);
  return {
    providerName: input.providerName.trim(),
    baseUrl: input.baseUrl.trim(),
    modelId: input.modelId.trim(),
    modelName: input.modelName.trim(),
    apiKey: input.apiKey.trim(),
  };
}
