// Gera um PDF mínimo VÁLIDO com N páginas, cada uma com uma linha de texto.
// Usado como FIXTURE sintética para os extratores de produção (QA real).
// Layout determinístico (obrigatório para o catálogo referenciar Pages como obj 2):
//   1 catálogo | 2 Pages | 3 Font | 4,6,8,... conteúdos | 5,7,9,... páginas
function makePdf(pages) {
  const objs = new Array(pages.length * 2 + 3).fill(null);
  const contentId = (i) => 4 + i * 2;
  const pageId = (i) => 5 + i * 2;
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let i = 0; i < pages.length; i++) {
    const content = `BT /F1 12 Tf 72 720 Td (${pages[i].text}) Tj ET\n`;
    objs[contentId(i) - 1] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
    objs[pageId(i) - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId(i)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
  }
  objs[1] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const body = objs.map((o, idx) => `${idx + 1} 0 obj\n${o}\nendobj`);
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const b of body) { offsets.push(pdf.length); pdf += b + '\n'; }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { makePdf };
