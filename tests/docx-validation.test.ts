import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8, type Zippable } from 'fflate';
import { validateDocx } from '../electron/docx-validation';
import { docxFixture } from './material-fixtures';
test('DOCX preflight rejects active and external content, non-DOCX archives and expansion bombs', () => {
  assert.doesNotThrow(() => validateDocx(docxFixture()));
  const cases: Zippable[] = [
    { 'random.txt': strToU8('text') },
    { 'word/document.xml': strToU8('<!DOCTYPE evil>') },
    { 'word/document.xml': strToU8('<w:altChunk/>') },
    { 'word/document.xml': strToU8('<w:document/>'), 'word/vbaProject.bin': new Uint8Array(1) },
    {
      'word/document.xml': strToU8('<w:document/>'),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationship Type="image" TargetMode="External" Target="https://example.invalid/private"/>',
      ),
    },
    { 'word/document.xml': new Uint8Array(16000001) },
  ];
  for (const entries of cases) assert.throws(() => validateDocx(zipSync(entries)));
});
