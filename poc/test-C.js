const fs = require('fs');
const path = require('path');
const { createHttpClient } = require('../src/lib/http');
const { downloadPdf, pdfText } = require('../src/lib/pdf');

// Teste C — PDF (ADM270, Semana 1)
// PDFs diretos em assets.univesp.br (Slides de Apoio das videoaulas).
// Critério: paginação impressa correta (não confundir com índice do visualizador);
// falhas de visualizadores canvas registradas recurso a recurso.

const OUT = path.join(__dirname, 'evidence', 'test-C');
const TMP = path.join(OUT, 'tmp');

const PDFS = [
  { title: 'S1 Videoaula 1 - Slides de Apoio', url: 'https://assets.univesp.br/disciplinas/ADM270/pdf/s1_slides_videoaula1.pdf' },
  { title: 'S1 Videoaula 2 - Slides de Apoio', url: 'https://assets.univesp.br/disciplinas/ADM270/pdf/s1_slides_videoaula2.pdf' },
  { title: 'S1 Videoaula 3 - Slides de Apoio', url: 'https://assets.univesp.br/disciplinas/ADM270/pdf/s1_slides_videoaula3.pdf' },
];

function log(ev, data) {
  const line = `[${new Date().toISOString()}] ${ev} ${data ? JSON.stringify(data) : ''}`;
  fs.appendFileSync(path.join(OUT, 'run.log'), line + '\n');
  console.log(line);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const started = Date.now();
  const result = { test: 'C', status: 'PENDING', pdfs: [], approval: [] };

  const client = createHttpClient([]); // assets.univesp.br é público, sem cookie de sessão

  for (const pdf of PDFS) {
    const res = { title: pdf.title, url: pdf.url };
    log('PROCESS', { title: pdf.title });
    try {
      const safe = pdf.title.replace(/[^a-zA-Z0-9]+/g, '_');
      const filePath = path.join(TMP, safe + '.pdf');
      const bytes = await downloadPdf({ client, url: pdf.url, filePath });
      res.bytes = bytes;

      const text = await pdfText(filePath);
      res.textLength = text ? text.length : 0;
      res.textSample = text ? text.slice(0, 300) : '';

      // Conta páginas impressas: usa o número de páginas do PDF (via pdf-parse getInfo -> total)
      try {
        const { PDFParse } = require('pdf-parse');
        const buf = fs.readFileSync(filePath);
        const doc = new PDFParse({ data: buf });
        await doc.load();
        const info = await doc.getInfo();
        res.pages = info && info.total !== undefined ? info.total : undefined;
        res.pagesInfo = info && info.info ? info.info : undefined;
        await doc.destroy();
      } catch (e) {
        res.pages = undefined;
        res.pagesError = e.message;
      }

      res.status = res.bytes > 0 && res.textLength > 0 ? 'extraido-integralmente' : 'inacessivel';
      log('PDF', { title: pdf.title, bytes: res.bytes, textLength: res.textLength, pages: res.pages, status: res.status });
    } catch (e) {
      res.status = 'inacessivel';
      res.reason = e.message;
      log('PDF-ERR', { title: pdf.title, error: e.message });
    }
    result.pdfs.push(res);
  }

  // Critérios
  const crit = {};
  crit.pdfsDownloaded = result.pdfs.every((p) => p.bytes > 0);
  crit.textExtracted = result.pdfs.some((p) => p.textLength > 0);
  crit.paginationCaptured = result.pdfs.some((p) => typeof p.pages === 'number' && p.pages > 0);
  crit.allClassified = result.pdfs.every((p) => ['extraido-integralmente', 'parcialmente-extraido', 'inacessivel', 'nao-encontrado'].includes(p.status));

  result.approval = Object.entries(crit).map(([k, v]) => ({ criterion: k, met: v }));
  result.status = Object.values(crit).every(Boolean) ? 'PASS' : 'FAIL';
  result.elapsedMs = Date.now() - started;

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log('\n=== RESULTADO TESTE C ===');
  console.log('Status:', result.status);
  for (const p of result.pdfs) console.log(`  - ${p.title}: ${p.status} (${p.bytes} bytes, ${p.textLength} chars, ${p.pages} páginas)`);
  for (const c of result.approval) console.log(`  * ${c.criterion}: ${c.met ? 'PASSOU' : 'FALHOU'}`);
  console.log('Elapsed:', (result.elapsedMs / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
