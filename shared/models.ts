import type { AiDiagnostic } from './diagnostics';
import { AiError, protocolEndpoint, protocols, type Protocol, type ConnectionInfo } from './ai';
import type { WorkspaceId } from './contracts';
export type Capability = 'unknown' | 'supported' | 'unsupported';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export interface Parameters {
  temperature?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: ReasoningEffort;
}
export interface ParameterSupport {
  temperature: boolean;
  maxCompletionTokens: boolean;
  reasoningEffort: boolean;
}
export interface Capabilities {
  images: Capability;
  files: Capability;
  structuredOutput: Capability;
}
export interface ProviderInput {
  id?: string;
  revision?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: Protocol;
}
export interface ProviderInfo {
  id: string;
  revision: string;
  name: string;
  baseUrl: string;
  endpoint: string;
  hasKey: boolean;
  test?: Omit<TestReceipt, 'kind'>;
  protocol: Protocol;
}
export interface TestReceipt {
  kind: 'text' | 'image';
  ok: boolean;
  checkedAt: string;
  revision: string;
  message: string;
  diagnostic?: AiDiagnostic;
}
export interface ModelInput {
  id?: string;
  revision?: string;
  providerId: string;
  modelId: string;
  name: string;
  protocol: 'inherit' | Protocol;
  capabilities: Capabilities;
  parameterSupport: ParameterSupport;
  parameters: Parameters;
}
export interface ModelInfo extends Omit<ModelInput, 'id' | 'revision'> {
  id: string;
  revision: string;
  tests: TestReceipt[];
}
export interface PageModelSettings {
  modelId: string | null;
  overrides: Parameters;
  revision: string;
}
export interface Catalog {
  providers: ProviderInfo[];
  models: ModelInfo[];
  pages: Record<WorkspaceId, PageModelSettings>;
}
export interface DeleteRequest {
  kind: 'providers' | 'models';
  items: { id: string; revision: string }[];
}
export type RegistryReply =
  { ok: true; catalog: Catalog } | { ok: false; message: string; diagnostic?: AiDiagnostic };
export interface RegistryBridge {
  catalog(): Promise<Catalog>;
  saveProvider(input: ProviderInput): Promise<RegistryReply>;
  saveModel(input: ModelInput): Promise<RegistryReply>;
  deleteItems(request: DeleteRequest): Promise<RegistryReply>;
  selectModel(
    page: WorkspaceId,
    modelId: string | null,
    overrides: Parameters,
    revision: string,
  ): Promise<RegistryReply>;
  testModel(
    modelId: string,
    revision: string,
    kind: 'text' | 'image',
  ): Promise<{ ok: boolean; message: string; diagnostic?: AiDiagnostic }>;
  testProvider(
    providerId: string,
    revision: string,
  ): Promise<{ ok: boolean; message: string; diagnostic?: AiDiagnostic }>;
  discoverModels(
    providerId: string,
    revision: string,
    session?: string,
  ): Promise<import('./discovery').DiscoveryReply>;
  importModels(session: string, ids: string[]): Promise<RegistryReply>;
  cancelTest(): Promise<void>;
}
export const emptyParameters = (): ParameterSupport => ({
  temperature: false,
  maxCompletionTokens: false,
  reasoningEffort: false,
});
export const emptyCapabilities = (): Capabilities => ({
  images: 'unknown',
  files: 'unknown',
  structuredOutput: 'unknown',
});
export function checkedString(value: unknown, label: string, max = 256): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new AiError(`${label}无效。`);
  return value.trim();
}
export function checkedId(value: unknown): string {
  return checkedString(value, '标识', 100);
}
export function validateParameters(value: unknown): Parameters {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiError('参数设置无效。');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !['temperature', 'maxCompletionTokens', 'reasoningEffort'].includes(key),
    )
  )
    throw new AiError('包含不支持的高级参数。');
  const result: Parameters = {};
  if (input.temperature !== undefined) {
    if (
      typeof input.temperature !== 'number' ||
      !Number.isFinite(input.temperature) ||
      input.temperature < 0 ||
      input.temperature > 2
    )
      throw new AiError('温度应在 0–2 之间。');
    result.temperature = input.temperature;
  }
  if (input.maxCompletionTokens !== undefined) {
    if (
      typeof input.maxCompletionTokens !== 'number' ||
      !Number.isSafeInteger(input.maxCompletionTokens) ||
      input.maxCompletionTokens < 1 ||
      input.maxCompletionTokens > 1_000_000
    )
      throw new AiError('输出上限应为 1–1000000 的整数，实际限制由模型决定。');
    result.maxCompletionTokens = input.maxCompletionTokens;
  }
  if (input.reasoningEffort !== undefined) {
    if (!['low', 'medium', 'high'].includes(input.reasoningEffort as string))
      throw new AiError('推理强度无效。');
    result.reasoningEffort = input.reasoningEffort as ReasoningEffort;
  }
  return result;
}
export function effectiveParameters(
  model: Pick<ModelInfo, 'parameters' | 'parameterSupport'>,
  overrides: Parameters,
): Parameters {
  const merged = { ...model.parameters, ...overrides };
  const result: Parameters = {};
  if (model.parameterSupport.temperature && merged.temperature !== undefined)
    result.temperature = merged.temperature;
  if (model.parameterSupport.maxCompletionTokens && merged.maxCompletionTokens !== undefined)
    result.maxCompletionTokens = merged.maxCompletionTokens;
  if (model.parameterSupport.reasoningEffort && merged.reasoningEffort !== undefined)
    result.reasoningEffort = merged.reasoningEffort;
  return result;
}
export function wireParameters(params: Parameters, protocol: Protocol = 'chat-completions') {
  const valid = validateParameters(params);
  if (protocol === 'gemini' || protocol === 'anthropic') {
    if (valid.reasoningEffort !== undefined)
      throw new AiError('Gemini / Anthropic 暂不支持通用推理强度映射，请移除该参数后重试。');
    if (protocol === 'anthropic') {
      if (valid.temperature !== undefined && valid.temperature > 1)
        throw new AiError('Anthropic 的温度应在 0–1 之间。');
      return {
        max_tokens: valid.maxCompletionTokens ?? 4096,
        ...(valid.temperature === undefined ? {} : { temperature: valid.temperature }),
      };
    }
    return {
      ...(valid.temperature === undefined ? {} : { temperature: valid.temperature }),
      ...(valid.maxCompletionTokens === undefined
        ? {}
        : { maxOutputTokens: valid.maxCompletionTokens }),
    };
  }
  if (protocol === 'responses') {
    if (valid.maxCompletionTokens !== undefined && valid.maxCompletionTokens < 16)
      throw new AiError('Responses 的输出上限至少为 16 tokens，请调整模型默认值或本页覆盖。');
    return {
      ...(valid.temperature === undefined ? {} : { temperature: valid.temperature }),
      ...(valid.maxCompletionTokens === undefined
        ? {}
        : { max_output_tokens: valid.maxCompletionTokens }),
      ...(valid.reasoningEffort === undefined
        ? {}
        : { reasoning: { effort: valid.reasoningEffort } }),
    };
  }
  return {
    ...(valid.temperature === undefined ? {} : { temperature: valid.temperature }),
    ...(valid.maxCompletionTokens === undefined
      ? {}
      : { max_completion_tokens: valid.maxCompletionTokens }),
    ...(valid.reasoningEffort === undefined ? {} : { reasoning_effort: valid.reasoningEffort }),
  };
}
export function resolvedConnection(catalog: Catalog, page: WorkspaceId): ConnectionInfo | null {
  const selection = catalog.pages[page];
  const model = catalog.models.find((item) => item.id === selection.modelId);
  const provider = catalog.providers.find((item) => item.id === model?.providerId);
  if (!model || !provider) return null;
  return modelConnection(provider, model, selection.overrides, selection.revision);
}
export function modelConnection(
  provider: ProviderInfo,
  model: ModelInfo,
  overrides: Parameters = {},
  pageRevision = '',
): ConnectionInfo {
  return {
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    endpoint: protocolEndpoint(provider.baseUrl, provider.protocol, model.modelId),
    modelId: model.modelId,
    modelName: model.name,
    protocol: provider.protocol,
    hasKey: provider.hasKey,
    revision: ['provider-protocol-v1', provider.revision, model.revision, pageRevision].join(':'),
    providerId: provider.id,
    modelConfigId: model.id,
    parameters: {
      ...(provider.protocol === 'anthropic' ? { maxCompletionTokens: 4096 } : {}),
      ...effectiveParameters(model, overrides),
    },
  };
}
export function validateProvider(input: ProviderInput): ProviderInput {
  if (!input || !protocols.includes(input.protocol)) throw new AiError('请选择受支持的接口协议。');
  const name = checkedString(input.name, '供应商名称', 100);
  const baseUrl = checkedString(input.baseUrl, 'Base URL', 2048);
  protocolEndpoint(baseUrl, input.protocol);
  if (
    typeof input.apiKey !== 'string' ||
    input.apiKey.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(input.apiKey)
  )
    throw new AiError('密钥格式无效。');
  return {
    id: input.id ? checkedId(input.id) : undefined,
    revision: input.revision,
    name,
    baseUrl,
    protocol: input.protocol,
    apiKey: input.apiKey.trim(),
  };
}
export function validateModel(input: ModelInput): ModelInput {
  if (!input || !['inherit', ...protocols].includes(input.protocol))
    throw new AiError('模型协议无效。');
  const modelId = checkedString(input.modelId, '模型 ID');
  const name = checkedString(input.name, '模型名称', 100);
  const providerId = checkedId(input.providerId);
  const capabilities = emptyCapabilities();
  const parameterSupport = emptyParameters();
  for (const key of Object.keys(capabilities) as (keyof Capabilities)[]) {
    const value = input.capabilities?.[key];
    if (!['unknown', 'supported', 'unsupported'].includes(value))
      throw new AiError('能力标记无效。');
    capabilities[key] = value;
  }
  for (const key of Object.keys(parameterSupport) as (keyof ParameterSupport)[]) {
    if (typeof input.parameterSupport?.[key] !== 'boolean') throw new AiError('参数能力设置无效。');
    parameterSupport[key] = input.parameterSupport[key];
  }
  const parameters = validateParameters(input.parameters);
  for (const key of Object.keys(parameters) as (keyof Parameters)[])
    if (!parameterSupport[key]) throw new AiError('请先启用对应参数支持，或移除该默认值。');
  return {
    id: input.id ? checkedId(input.id) : undefined,
    revision: input.revision,
    providerId,
    modelId,
    name,
    // Retain the legacy input shape, but provider is the single source of protocol.
    protocol: 'inherit',
    capabilities,
    parameterSupport,
    parameters,
  };
}

export function assertModelProtocol(
  model: Pick<ModelInput, 'parameters' | 'parameterSupport'>,
  protocol: Protocol,
  overrides: Parameters = {},
) {
  if ((protocol === 'gemini' || protocol === 'anthropic') && model.parameterSupport.reasoningEffort)
    throw new AiError('此原生协议暂不支持通用推理强度，请先关闭模型的推理强度参数支持。');
  wireParameters(effectiveParameters(model, overrides), protocol);
}

/** Models-list transport/authentication probe, not a generation or capability test. */
export function providerProbeEndpoint(baseUrl: string, protocol: Protocol): string {
  const url = new URL(protocolEndpoint(baseUrl, protocol, 'probe-model'));
  url.search = '';
  url.pathname =
    url.pathname.replace(
      /\/(?:chat\/completions|responses|messages|models\/[^/]+:streamGenerateContent)$/,
      '',
    ) + '/models';
  return url.href;
}
