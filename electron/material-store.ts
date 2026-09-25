import type { ImportSource } from './material-file-drafts';
import { webUrl } from './web-material';
import type { PastedMaterial } from '../shared/materials';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { open } from 'node:fs/promises';
import { AiError } from '../shared/ai';
import {
  materialLimits as limits,
  type Material,
  type MaterialPage,
  type MaterialPurpose,
  type ParsedMaterial,
  type MaterialManifest,
  type MaterialSelection,
} from '../shared/materials';
import type { ChatContent } from './chat-completions';
export function assertMaterialPage(page: unknown): asserts page is MaterialPage {
  if (!['resume', 'score', 'match', 'letter', 'interview'].includes(String(page)))
    throw new AiError('此工作区尚未接入附件。');
}
export function assertPurpose(purpose: unknown): asserts purpose is MaterialPurpose {
  if (!['resume', 'job', 'evidence'].includes(String(purpose))) throw new AiError('资料用途无效。');
}
export class MaterialStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY,workspace TEXT NOT NULL,payload TEXT NOT NULL,original BLOB,removed INTEGER NOT NULL DEFAULT 0);`,
    );
  }
  list(page: MaterialPage): Material[] {
    assertMaterialPage(page);
    return this.db
      .prepare('SELECT payload FROM materials WHERE workspace=? AND removed=0 ORDER BY rowid')
      .all(page)
      .map((r) => JSON.parse(String(r.payload)));
  }
  async importPaths(
    page: MaterialPage,
    purpose: MaterialPurpose,
    paths: string[],
    parser: (kind: string, bytes: Buffer, signal: AbortSignal) => Promise<ParsedMaterial>,
    signal: AbortSignal,
  ) {
    assertMaterialPage(page);
    assertPurpose(purpose);
    return this.importAssignedPaths(
      page,
      paths.map((path) => ({ path, purpose })),
      parser,
      signal,
    );
  }
  async importAssignedPaths(
    page: MaterialPage,
    entries: (ImportSource & { purpose: MaterialPurpose })[],
    parser: (kind: string, bytes: Buffer, signal: AbortSignal) => Promise<ParsedMaterial>,
    signal: AbortSignal,
  ) {
    assertMaterialPage(page);
    if (
      !Array.isArray(entries) ||
      entries.length > limits.files ||
      this.list(page).length + entries.length > limits.files
    )
      throw new AiError(`每页最多 ${limits.files} 项资料，请先移除不需要的项。`);
    for (const entry of entries) {
      assertPurpose(entry?.purpose);
      if (
        'path' in entry
          ? typeof entry.path !== 'string'
          : !(entry.bytes instanceof Uint8Array) || typeof entry.name !== 'string'
      )
        throw new AiError('文件选择无效。');
    }
    for (const entry of entries) {
      const { purpose } = entry;
      const name = 'path' in entry ? basename(entry.path) : entry.name;
      if (signal.aborted) break;
      const item: Material = {
        id: randomUUID(),
        revision: randomUUID(),
        workspace: page,
        name,
        purpose,
        bytes: 0,
        sha256: '',
        createdAt: new Date().toISOString(),
        status: 'failed',
        selected: false,
        pages: [],
        totalPages: 0,
        warnings: [],
      };
      let bytes: Buffer | undefined;
      try {
        const kind = extname(name).slice(1).toLowerCase();
        if (!['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'].includes(kind))
          throw new AiError('不支持此格式；支持 PDF、DOCX、UTF-8 TXT/MD、PNG/JPEG/WebP。');
        if ('path' in entry) {
          const file = await open(entry.path, 'r');
          try {
            const stat = await file.stat();
            item.bytes = stat.size;
            if (!stat.isFile() || stat.size > limits.fileBytes || stat.size === 0)
              throw new AiError('文件为空、非普通文件或超过 12 MiB。');
            bytes = Buffer.alloc(stat.size + 1);
            let bytesRead = 0;
            while (bytesRead < bytes.length) {
              const read = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
              if (!read.bytesRead) break;
              bytesRead += read.bytesRead;
            }
            if (bytesRead !== stat.size) throw new AiError('读取期间文件发生变化，请重新导入。');
            bytes = bytes.subarray(0, bytesRead);
          } finally {
            await file.close();
          }
        } else {
          item.bytes = entry.bytes.byteLength;
          if (!item.bytes || item.bytes > limits.fileBytes)
            throw new AiError('文件为空或超过12 MiB。');
          bytes = Buffer.from(entry.bytes);
        }
        item.sha256 = createHash('sha256').update(bytes).digest('hex');
        const parsed = await parser(kind, bytes, signal);
        if (signal.aborted) break;
        if (!parsed.pages.length) throw new AiError('未取得可用页面。');
        let text = 0,
          images = 0;
        for (const sheet of parsed.pages) {
          text += sheet.text.length;
          images += sheet.image?.length ?? 0;
        }
        if (text > limits.text || images > (limits.imageBytes * 4) / 3)
          throw new AiError('解析内容超过文字或图片预算，请拆分文件；本项未选入发送。');
        Object.assign(item, parsed);
        item.status =
          parsed.pages.some((p) => !p.text.trim() && !p.image) ||
          parsed.totalPages > parsed.pages.length
            ? 'partial'
            : 'ready';
      } catch (error) {
        item.error =
          error instanceof AiError
            ? error.message
            : '本地读取失败，可能无权限、文件损坏或格式不符；原文件未修改。';
      }
      if (signal.aborted) break;
      const retained = Number(
        this.db
          .prepare(
            'SELECT COALESCE(SUM(length(CAST(payload AS BLOB))+COALESCE(length(original),0)),0) AS size FROM materials',
          )
          .get()!.size,
      );
      if (
        retained + Buffer.byteLength(JSON.stringify(item)) + (bytes?.length ?? 0) >
        limits.storedBytes
      )
        throw new AiError(
          '本机资料副本已达 512 MiB 上限（含已移除副本），已完成导入保留；请先备份资料，不能用反复移除绕过上限。',
        );
      this.db
        .prepare('INSERT INTO materials(id,workspace,payload,original) VALUES(?,?,?,?)')
        .run(item.id, page, JSON.stringify(item), bytes ?? null);
    }
    return this.list(page);
  }
  importWeb(
    page: MaterialPage,
    purpose: MaterialPurpose,
    source: {
      url: string;
      text: string;
      warnings: string[];
      title?: string;
      retrievedUrl?: string;
    },
  ) {
    assertMaterialPage(page);
    assertPurpose(purpose);
    if (this.list(page).length >= limits.files)
      throw new AiError('每页最多16项资料，请先移除不需要的项。');
    if (!source.text.trim() || source.text.length > limits.text)
      throw new AiError('网页文字为空或超出预算。');
    const item: Material = {
      id: randomUUID(),
      revision: randomUUID(),
      workspace: page,
      purpose,
      name: '网页 · ' + (source.title || new URL(source.url).hostname),
      sourceUrl: source.url,
      retrievedUrl: source.retrievedUrl,
      sourceTitle: source.title,
      sourceKind: 'web',
      bytes: Buffer.byteLength(source.text),
      sha256: createHash('sha256').update(source.text).digest('hex'),
      createdAt: new Date().toISOString(),
      status: 'partial',
      selected: false,
      totalPages: 1,
      pages: [{ number: 1, text: source.text, source: 'text', warnings: [] }],
      warnings: source.warnings,
    };
    const payload = JSON.stringify(item);
    const size = Number(
      this.db
        .prepare(
          'SELECT COALESCE(SUM(length(CAST(payload AS BLOB))+COALESCE(length(original),0)),0) AS size FROM materials',
        )
        .get()!.size,
    );
    if (size + Buffer.byteLength(payload) > limits.storedBytes)
      throw new AiError('本机资料副本达到存储上限；未保存新网页。');
    this.db
      .prepare('INSERT INTO materials(id,workspace,payload,original) VALUES(?,?,?,NULL)')
      .run(item.id, page, payload);
    return this.list(page);
  }
  importText(page: MaterialPage, purpose: MaterialPurpose, input: PastedMaterial) {
    assertMaterialPage(page);
    assertPurpose(purpose);
    if (
      !input ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 240 ||
      typeof input.text !== 'string' ||
      !input.text.trim() ||
      input.text.length > limits.text ||
      (input.sourceUrl !== undefined && typeof input.sourceUrl !== 'string')
    )
      throw new AiError('补充资料需要标题（最多240字）及正文（最多12万字）。');
    if (this.list(page).length >= limits.files)
      throw new AiError('每页最多16项资料，请先移除不需要的项。');
    const url = input.sourceUrl?.trim() ? webUrl(input.sourceUrl.trim()) : undefined;
    const item: Material = {
      id: randomUUID(),
      revision: randomUUID(),
      workspace: page,
      purpose,
      name: '本地补充 · ' + input.title.trim(),
      sourceTitle: input.title.trim(),
      sourceKind: 'pasted',
      sourceUrl: url ? url.origin + url.pathname : undefined,
      bytes: Buffer.byteLength(input.text),
      sha256: createHash('sha256').update(input.text).digest('hex'),
      createdAt: new Date().toISOString(),
      status: 'ready',
      selected: false,
      totalPages: 1,
      pages: [{ number: 1, text: input.text, source: 'text', warnings: [] }],
      warnings: [
        '用户本地粘贴补充；应用未访问或核验所填网页，不能当作自动读取成功。请核对原文和来源。',
      ],
    };
    const payload = JSON.stringify(item);
    const size = Number(
      this.db
        .prepare(
          'SELECT COALESCE(SUM(length(CAST(payload AS BLOB))+COALESCE(length(original),0)),0) AS size FROM materials',
        )
        .get()!.size,
    );
    if (size + Buffer.byteLength(payload) > limits.storedBytes)
      throw new AiError('本机资料副本达到存储上限；未保存补充资料。');
    this.db
      .prepare('INSERT INTO materials(id,workspace,payload,original) VALUES(?,?,?,NULL)')
      .run(item.id, page, payload);
    return this.list(page);
  }
  removeMany(page: MaterialPage, selections: MaterialSelection[]) {
    assertMaterialPage(page);
    if (
      !Array.isArray(selections) ||
      !selections.length ||
      selections.length > limits.files ||
      selections.some((s) => !s || typeof s.id !== 'string' || typeof s.revision !== 'string')
    )
      throw new AiError('请选择有效的待移除资料。');
    if (new Set(selections.map((s) => s.id)).size !== selections.length)
      throw new AiError('待移除资料不能重复。');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const items = this.list(page);
      const selected = selections.map((s) => {
        const item = items.find((i) => i.id === s.id && i.revision === s.revision);
        if (!item)
          throw new AiError('资料已变化或不属于当前工作区，请刷新后重新选择；本批未移除。');
        return item;
      });
      const update = this.db.prepare(
        'UPDATE materials SET payload=?,removed=1 WHERE id=? AND workspace=?',
      );
      for (const item of selected) {
        item.selected = false;
        item.revision = randomUUID();
        update.run(JSON.stringify(item), item.id, page);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.list(page);
  }
  setPurpose(page: MaterialPage, id: string, revision: string, purpose: MaterialPurpose) {
    assertMaterialPage(page);
    assertPurpose(purpose);
    const item = this.list(page).find((i) => i.id === id);
    if (!item || item.revision !== revision)
      throw new AiError('资料已变化或不属于当前工作区，请刷新。');
    if (item.purpose === purpose) return this.list(page);
    item.purpose = purpose;
    item.revision = randomUUID();
    this.db
      .prepare('UPDATE materials SET payload=? WHERE id=? AND workspace=? AND removed=0')
      .run(JSON.stringify(item), id, page);
    return this.list(page);
  }
  update(page: MaterialPage, id: string, revision: string, selected: boolean, remove = false) {
    assertMaterialPage(page);
    const item = this.list(page).find((i) => i.id === id);
    if (!item || item.revision !== revision)
      throw new AiError('资料已变化或不属于当前工作区，请刷新。');
    if (typeof selected !== 'boolean') throw new AiError('资料选择无效。');
    if (selected && item.status === 'failed') throw new AiError('解析失败的资料不能发送。');
    item.selected = selected;
    item.revision = randomUUID();
    this.db
      .prepare('UPDATE materials SET payload=?,removed=? WHERE id=? AND workspace=?')
      .run(JSON.stringify(item), remove ? 1 : 0, id, page);
    return this.list(page);
  }
  manifest(page: MaterialPage, sendImages: boolean): MaterialManifest {
    assertMaterialPage(page);
    if (typeof sendImages !== 'boolean') throw new AiError('图片发送选项无效。');
    const all = this.list(page);
    const selected = all.filter((i) => i.selected);
    // These warnings are sent to the provider. Never disclose unselected filenames/URLs.
    const omitted = all.filter((i) => !i.selected).length;
    const warnings = omitted ? [`未选中：${omitted} 项资料；其正文、名称与来源不发送。`] : [];
    const items = selected.map((i) => ({
      ...i,
      pages: i.pages.map((p) => ({ ...p, image: sendImages ? p.image : undefined })),
    }));
    if (!sendImages && selected.some((i) => i.pages.some((p) => p.image)))
      warnings.push('本次仅发送文字：页面图像未发送，无法完成视觉评价。');
    for (const i of items) {
      warnings.push(...i.warnings.map((w) => i.name + '：' + w));
      for (const p of i.pages)
        warnings.push(...p.warnings.map((w) => `${i.name} 第${p.number}页：${w}`));
    }
    const imageCount = items.reduce((n, i) => n + i.pages.filter((p) => p.image).length, 0);
    const textCount = items.reduce((n, i) => n + i.pages.reduce((a, p) => a + p.text.length, 0), 0);
    const imageBytes = items.reduce(
      (n, i) => n + i.pages.reduce((a, p) => a + (p.image?.length ?? 0) * 0.75, 0),
      0,
    );
    if (imageCount > limits.images || textCount > limits.text || imageBytes > limits.imageBytes)
      throw new AiError(
        '所选资料超过本次预算：最多 8 张图、12 MiB 图片、12万字。请取消部分选择或拆分文件，不会静默截断。',
      );
    if (items.some((i) => i.pages.every((p) => !p.text.trim() && !p.image)))
      throw new AiError('所选资料没有可发送文字；请启用图片或补充 UTF-8 文字。');
    const revision = createHash('sha256')
      .update(JSON.stringify({ sendImages, items: all.map((i) => [i.id, i.revision, i.selected]) }))
      .digest('hex');
    return { revision, items, warnings, imageCount, textCount };
  }
  checked(page: MaterialPage, revision: string, sendImages: boolean) {
    const m = this.manifest(page, sendImages);
    if (m.revision !== revision) throw new AiError('资料在确认后已变化，请重新核对发送内容。');
    return m;
  }
  close() {
    this.db.close();
  }
}
export function materialContent(manifest: MaterialManifest): Exclude<ChatContent, string> {
  const parts: Exclude<ChatContent, string> = [];
  for (const item of manifest.items)
    for (const page of item.pages) {
      parts.push({
        type: 'text',
        text: JSON.stringify({
          sourceId: `${item.id}:p${page.number}`,
          filename: item.name,
          purpose: item.purpose,
          page: page.number,
          source: page.source,
          warnings: page.warnings,
          text: page.text,
        }),
      });
      if (page.image) parts.push({ type: 'image_url', image_url: { url: page.image } });
    }
  return parts;
}
export function materialSnapshot(manifest: MaterialManifest) {
  return {
    ...manifest,
    items: manifest.items.map((i) => ({
      ...i,
      pages: i.pages.map(({ image, ...p }) => ({ ...p, imageSent: !!image })),
    })),
  };
}
