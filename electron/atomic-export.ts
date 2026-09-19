import { writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, basename, join } from 'node:path';
interface ExportIO {
  writeFile(
    path: string,
    text: string,
    options: { encoding: 'utf8'; flag: 'wx'; flush: true },
  ): Promise<void>;
  rename(source: string, target: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
export async function atomicExport(
  target: string,
  text: string,
  io: ExportIO = { writeFile, rename, unlink },
) {
  // Stage alongside the destination so the final rename stays on the same volume.
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    await io.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', flush: true });
    await io.rename(temporary, target);
  } catch (error) {
    await io.unlink(temporary).catch(() => {});
    throw error;
  }
}
