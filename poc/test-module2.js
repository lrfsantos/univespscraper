const fs = require('fs');
const path = require('path');
const { extractPdf } = require('../src/extract/pdfs');
const { createHttpClient } = require('../src/lib/http');

const OUT = path.join(__dirname, 'evidence', 'module2');
const TMP = path.join(OUT, 'tmp');

const PDFS = [
  { key: 'slides_videoaula1', title: 'S1 Videoaula 1 - Slides de Apoio', url: 'https://assets.univesp.br/disciplinas/ADM270/pdf/s1_slides_videoaula1.pdf' },
  { key: 'slides_videoaula2', title: 'S1 Videoaula 2 - Slides de Apoio', url: 'https://assets.univesp.br/disciplinas/ADM270/pdf/s1_slides_videoaula2.pdf' },
  { key: 'slides_videoaula3', title: 'S1 Videoaula 3 - Slides de Apoio', url: 'https://assets.univesp.br/disciplinas/ADM270/pdf/s1_slides_videoaula3.pdf' },
];

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const client = createHttpClient([]);
  const result = { test: 'module2', status: 'PENDING', pdfs: [] };
  for (const p of PDFS) {
    const filePath = path.join(TMP, p.key + '.pdf');
    const r = await extractPdf({ url: p.url, filePath, client, useElectronNet: false });
    r.key = p.key;
    r.title = p.title;
    result.pdfs.push(r);
    console.log(`- ${p.key}: ${r.status} | bytes=${r.bytes} | total=${r.totalPagesArquivo} | extraidas=${r.pagesExtracted} | pagImpressa=${JSON.stringify(r.printedPagination.detected.slice(0, 6))}`);
    fs.writeFileSync(path.join(TMP, p.key + '.txt'), (r.pages || []).map((pg) => `--- [pagina ${pg.pageIndex}] ---\n${pg.text}`).join('\n\n'));
  }
  result.status = 'ok';
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log('=== RESULTADO MÓDULO 2 ===');
  for (const r of result.pdfs) console.log(`  - ${r.key} [${r.status}] total=${r.totalPagesArquivo} extraidas=${r.pagesExtracted}/${r.totalPagesArquivo}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
