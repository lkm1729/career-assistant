import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { AiError } from '../shared/ai';
import {
  materialLimits,
  type FileImportDraft,
  type TransferredFile,
  type FilePurposeAssignment,
  type MaterialPage,
} from '../shared/materials';
import { assertMaterialPage, assertPurpose } from './material-store';

export type ImportSource = { path: string } | TransferredFile;

/** Native dialog paths or bounded transferred bytes; never renderer-supplied paths. */
export class FileImportDrafts {
  private drafts = new Map<
    MaterialPage,
    { id: string; created: number; paths: Map<string, ImportSource> }
  >();
  constructor(private now: () => number = Date.now) {}
  create(page: MaterialPage, paths: string[]): FileImportDraft {
    assertMaterialPage(page);
    if (!paths.length || paths.length > materialLimits.files)
      throw new AiError('单次请选择1至16个文件。');
    return this.createSources(
      page,
      paths.map((path) => ({ path })),
    );
  }
  createTransferred(page: MaterialPage, files: TransferredFile[]): FileImportDraft {
    assertMaterialPage(page);
    if (!Array.isArray(files) || !files.length || files.length > materialLimits.files)
      throw new AiError('单次请选择1至16个文件。');
    const sources = files.map((file) => {
      if (
        !file ||
        typeof file.name !== 'string' ||
        file.name.length > 255 ||
        /[\\/\x00-\x1f]/.test(file.name) ||
        !/\.(pdf|docx|txt|md|png|jpe?g|webp)$/i.test(file.name)
      )
        throw new AiError('文件名称或格式无效；支持 PDF、DOCX、TXT/MD、PNG/JPEG/WebP。');
      if (
        !(file.bytes instanceof Uint8Array) ||
        !file.bytes.byteLength ||
        file.bytes.byteLength > materialLimits.fileBytes
      )
        throw new AiError('文件为空或超过12 MiB，请拆分后重试。');
      return { name: file.name, bytes: Uint8Array.from(file.bytes) };
    });
    return this.createSources(page, sources);
  }
  private createSources(page: MaterialPage, sources: ImportSource[]): FileImportDraft {
    for (const [key, value] of this.drafts)
      if (this.now() - value.created > 15 * 60 * 1000) this.drafts.delete(key);
    const draft = {
      id: randomUUID(),
      created: this.now(),
      paths: new Map(sources.map((source) => [randomUUID(), source])),
    };
    this.drafts.set(page, draft);
    return {
      id: draft.id,
      files: [...draft.paths].map(([id, path]) => ({
        id,
        name: 'path' in path ? basename(path.path) : path.name,
      })),
    };
  }
  take(page: MaterialPage, id: string, assignments: FilePurposeAssignment[]) {
    assertMaterialPage(page);
    const draft = this.drafts.get(page);
    if (!draft || draft.id !== id || this.now() - draft.created > 15 * 60 * 1000)
      throw new AiError('文件选择已过期或不属于本页，请重新选择文件。');
    if (
      !Array.isArray(assignments) ||
      !assignments.length ||
      assignments.length > materialLimits.files
    )
      throw new AiError('请选择有效的待导入文件。');
    const seen = new Set<string>();
    const entries = assignments.map((a) => {
      assertPurpose(a?.purpose);
      const path = draft.paths.get(a.id);
      if (!path || seen.has(a.id)) throw new AiError('文件不在本次选择中或存在重复项。');
      seen.add(a.id);
      return { ...path, purpose: a.purpose };
    });
    this.drafts.delete(page);
    return entries;
  }
  discard(page: MaterialPage, id: string) {
    assertMaterialPage(page);
    if (this.drafts.get(page)?.id === id) this.drafts.delete(page);
  }
}
