import type { WorkspaceId } from './contracts';
import type { AiDiagnostic } from './diagnostics';
export interface PromptPreset {
  id: string;
  page: WorkspaceId;
  name: string;
  text: string;
  createdAt: string;
}
export interface PromptBridge {
  list(page: WorkspaceId): Promise<PromptPreset[]>;
  save(
    page: WorkspaceId,
    name: string,
    text: string,
  ): Promise<{ ok: true; items: PromptPreset[] } | { ok: false; diagnostic: AiDiagnostic }>;
}
