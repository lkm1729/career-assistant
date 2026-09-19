import { zipSync, strToU8 } from 'fflate';
export function pdfFixture(pages = 1) {
  const objects: string[] = [];
  const add = (s: string) => {
    objects.push(s);
    return objects.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = add('');
    kids.push(page);
    const text = `BT /F1 24 Tf 50 730 Td (CAREER RESUME PAGE ${i}) Tj 0 -45 Td (Software engineer - delivered real projects) Tj ET`;
    const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    objects[page - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`;
  }
  objects[1] = `<< /Type /Pages /Count ${pages} /Kids [${kids.map((x) => x + ' 0 R').join(' ')}] >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((x) => String(x).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
export function docxFixture() {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Career resume DOCX original</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>Second page evidence</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
      ),
    }),
  );
}

/** One scanned page: image only, no PDF text layer. */
export function scannedPdfFixture(jpeg: Buffer, width: number, height: number) {
  const stream = 'q 612 0 0 459 0 0 cm /Scan Do Q';
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 459] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>',
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from('\nendstream'),
    ]),
    Buffer.from(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let size = chunks[0].length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(size);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      objects[i],
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    size += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets.map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`,
    ),
  );
  return Buffer.concat(chunks);
}
