import type { Material, MaterialReply } from '../shared/materials';
import { messageDiagnostic, type AiDiagnostic } from '../shared/diagnostics';
export interface WebImportRow {
  url: string;
  status: 'pending' | 'reading' | 'ready' | 'failed' | 'cancelled' | 'skipped';
  diagnostic?: AiDiagnostic;
}
/** Only reads the explicitly confirmed list once. A failed URL does not discard siblings. */
export async function runWebBatch(
  urls: string[],
  read: (url: string) => Promise<MaterialReply>,
  cancelled: () => boolean,
  update: (rows: WebImportRow[]) => void,
  imported: (items: Material[]) => void,
): Promise<WebImportRow[]> {
  const rows: WebImportRow[] = urls.map((url) => ({ url, status: 'pending' }));
  const emit = () => update(rows.map((r) => ({ ...r })));
  emit();
  for (const row of rows) {
    if (cancelled()) {
      row.status = 'skipped';
      emit();
      continue;
    }
    row.status = 'reading';
    emit();
    let reply: MaterialReply;
    try {
      reply = await read(row.url);
    } catch {
      reply = {
        ok: false,
        diagnostic: messageDiagnostic('网页读取通信失败，请手动重试或本地补充。'),
      };
    }
    if (reply.ok) {
      row.status = 'ready';
      imported(reply.items);
    } else {
      row.status = cancelled() ? 'cancelled' : 'failed';
      row.diagnostic = reply.diagnostic;
    }
    emit();
  }
  return rows;
}
