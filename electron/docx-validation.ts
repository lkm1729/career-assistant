import { unzipSync, strFromU8 } from 'fflate';
import { AiError } from '../shared/ai';
export function validateDocx(bytes: Uint8Array) {
  let expanded = 0;
  const entries = unzipSync(bytes, {
    filter(entry) {
      expanded += entry.originalSize;
      if (expanded > 32000000 || entry.originalSize > 16000000)
        throw new AiError('DOCX 解压后超过限制，请简化或转换 PDF。');
      return true;
    },
  });
  if (!entries['word/document.xml']) throw new AiError('文件不是有效 DOCX。');
  for (const [name, content] of Object.entries(entries)) {
    if (/(?:vbaProject|embeddings|activeX)/i.test(name))
      throw new AiError('不支持包含宏、嵌入对象或活动控件的 DOCX，请转换为 PDF。');
    if (/\.(xml|rels)$/i.test(name)) {
      const text = strFromU8(content);
      if (/<!DOCTYPE|<!ENTITY|<w:altChunk/i.test(text))
        throw new AiError('DOCX 包含不支持的外部或嵌入内容，请转换为 PDF。');
      if (/TargetMode\s*=\s*["']External["']/i.test(text)) {
        // Hyperlinks are inert; embedded remote images/templates must not be fetched.
        if (/Type=["'][^"']*(?:image|attachedTemplate)["']/i.test(text))
          throw new AiError('DOCX 包含外部图片或模板，请先保存为本地 PDF。');
      }
    }
  }
}
