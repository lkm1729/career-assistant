import type { AiDiagnostic } from './diagnostics';
export interface DiscoveredModel {
  id: string;
  name: string;
}
export interface DiscoveryResult {
  session: string;
  models: DiscoveredModel[];
  hasMore: boolean;
  pages: number;
}
export type DiscoveryReply =
  { ok: true; result: DiscoveryResult } | { ok: false; message: string; diagnostic: AiDiagnostic };
