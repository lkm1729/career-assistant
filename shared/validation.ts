import {
  workspaceIds,
  type WorkspaceId,
  type WorkspaceDraft,
  type Preferences,
} from './contracts.js';
export function assertWorkspaceId(id: unknown): asserts id is WorkspaceId {
  if (typeof id !== 'string' || !workspaceIds.includes(id as WorkspaceId))
    throw new Error('Invalid workspace');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid input');
  return value as Record<string, unknown>;
}
export function validateDraft(input: unknown): WorkspaceDraft {
  const value = record(input);
  const limits = {
    prompt: 100_000,
    systemPrompt: 100_000,
    document: 500_000,
    refinement: 50_000,
    links: 20_000,
  };
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof value[key] !== 'string' || (value[key] as string).length > limit)
      throw new Error(`Invalid ${key}`);
  }
  if (
    value.resumeText !== undefined &&
    (typeof value.resumeText !== 'string' || value.resumeText.length > 500_000)
  )
    throw new Error('Invalid resumeText');
  if (
    value.evidenceText !== undefined &&
    (typeof value.evidenceText !== 'string' || value.evidenceText.length > 100_000)
  )
    throw new Error('Invalid evidenceText');
  if (
    value.updatedAt !== null &&
    (typeof value.updatedAt !== 'string' ||
      value.updatedAt.length > 40 ||
      !Number.isFinite(Date.parse(value.updatedAt)))
  )
    throw new Error('Invalid updatedAt');
  const currentVersionNumber = value.currentVersionNumber ?? null;
  if (
    currentVersionNumber !== null &&
    (typeof currentVersionNumber !== 'number' ||
      !Number.isSafeInteger(currentVersionNumber) ||
      currentVersionNumber < 1)
  )
    throw new Error('Invalid currentVersionNumber');
  return {
    prompt: value.prompt as string,
    systemPrompt: value.systemPrompt as string,
    document: value.document as string,
    refinement: value.refinement as string,
    links: value.links as string,
    resumeText: typeof value.resumeText === 'string' ? value.resumeText : '',
    evidenceText: typeof value.evidenceText === 'string' ? value.evidenceText : '',
    updatedAt: value.updatedAt as string | null,
    currentVersionNumber,
  };
}
export function validatePreferences(input: unknown): Preferences {
  const value = record(input);
  assertWorkspaceId(value.activeTab);
  if (!['light', 'dark', 'system'].includes(value.theme as string))
    throw new Error('Invalid theme');
  return { activeTab: value.activeTab, theme: value.theme as Preferences['theme'] };
}
