import type { WorkspaceId } from './contracts';
import type { AiDiagnostic } from './diagnostics';
export type MaterialPage = WorkspaceId;
export type MaterialPurpose = 'resume' | 'job' | 'evidence';
export const materialLimits = {
  fileBytes: 12 * 1024 * 1024,
  storedBytes: 512 * 1024 * 1024,
  files: 16,
  pages: 8,
  text: 120000,
  imageBytes: 12 * 1024 * 1024,
  images: 8,
  pixels: 20000000,
} as const;
export interface MaterialSheet {
  number: number;
  text: string;
  image?: string;
  width?: number;
  height?: number;
  source: 'text' | 'pdf' | 'image' | 'docx';
  ocr?: { confidence: number };
  warnings: string[];
}
export interface ParsedMaterial {
  pages: MaterialSheet[];
  totalPages: number;
  warnings: string[];
}
export interface Material extends ParsedMaterial {
  id: string;
  revision: string;
  workspace: MaterialPage;
  name: string;
  sourceUrl?: string;
  retrievedUrl?: string;
  sourceTitle?: string;
  sourceKind?: 'web' | 'pasted';
  purpose: MaterialPurpose;
  bytes: number;
  sha256: string;
  createdAt: string;
  status: 'ready' | 'partial' | 'failed';
  error?: string;
  selected: boolean;
}
export interface MaterialSelection {
  id: string;
  revision: string;
}
export interface MaterialManifest {
  revision: string;
  items: Material[];
  warnings: string[];
  imageCount: number;
  textCount: number;
}
export type MaterialReply =
  { ok: true; items: Material[] } | { ok: false; diagnostic: AiDiagnostic };
export interface PastedMaterial {
  title: string;
  text: string;
  sourceUrl?: string;
}
export interface TransferredFile {
  name: string;
  bytes: Uint8Array;
}
export interface FileImportDraft {
  id: string;
  files: { id: string; name: string }[];
}
export interface FilePurposeAssignment {
  id: string;
  purpose: MaterialPurpose;
}
export type FilePickReply =
  { ok: true; draft: FileImportDraft | null } | { ok: false; diagnostic: AiDiagnostic };
export interface MaterialBridge {
  stageFiles(page: MaterialPage, files: TransferredFile[]): Promise<FilePickReply>;
  pasteImage(page: MaterialPage): Promise<FilePickReply>;
  pickFiles(page: MaterialPage): Promise<FilePickReply>;
  importPickedFiles(
    page: MaterialPage,
    draftId: string,
    assignments: FilePurposeAssignment[],
  ): Promise<MaterialReply>;
  discardPickedFiles(page: MaterialPage, draftId: string): Promise<void>;
  setPurpose(
    page: MaterialPage,
    id: string,
    revision: string,
    purpose: MaterialPurpose,
  ): Promise<MaterialReply>;
  removeMany(page: MaterialPage, selections: MaterialSelection[]): Promise<MaterialReply>;
  importText(
    page: MaterialPage,
    purpose: MaterialPurpose,
    input: PastedMaterial,
  ): Promise<MaterialReply>;
  manifest(page: MaterialPage, sendImages: boolean): Promise<MaterialManifest>;
  list(page: MaterialPage): Promise<Material[]>;
  importFiles(page: MaterialPage, purpose: MaterialPurpose): Promise<MaterialReply>;
  importUrl(
    page: MaterialPage,
    purpose: MaterialPurpose,
    url: string,
    allowPublicDns?: boolean,
  ): Promise<MaterialReply>;
  cancelImport(): Promise<void>;
  select(
    page: MaterialPage,
    id: string,
    revision: string,
    selected: boolean,
  ): Promise<MaterialReply>;
  remove(page: MaterialPage, id: string, revision: string): Promise<MaterialReply>;
}
export function isMaterialPage(page: WorkspaceId): page is MaterialPage {
  return ['resume', 'score', 'match', 'letter', 'interview'].includes(page);
}
