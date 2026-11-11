const crypto = require('crypto');
const books = require('../src/extract/books');

// Testes da CORREÇÃO OBRIGATÓRIA de expected.pageRange (seção 4.3): o intervalo de
// páginas declarado pelo AVA deve REALMENTE participar da navegação e validação no
// leitor pageid (seleção pela paginação impressa, fim do intervalo, páginas
// ausentes, tratamento conservador, capítulo+páginas simultâneos). Determinísticos,
// dirigidos por um leitor pageid SIMULADO; nunca integral sem confirmação.

const OUT = require('path').join(__dirname, '..', 'audit-temp', 'PAGERANGE_RESULTS.json');
const fs = require('fs');
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

// Leitor pageid simulado simples: navega por uma SEQUÊNCIA de páginas
// (pageid + página IMPRESSA), com frame de conteúdo sempre coerente.
class SimpleReader {
  constructor(pages, tocPages) {
    this.seq = pages; // [{pageid, printed, text}]
    this.idx = 0;
    this.tocPages = tocPages || {};
  }
  async state() { const p = this.seq[this.idx]; return { pageid: p.pageid, printed: p.printed }; }
  async frames() {
    const p = this.seq[this.idx];
    return [{ identity: { pageid: p.pageid, pages: p.pageid }, active: true, text: p.text, chars: p.text.length, hash: sha(p.text.trim()), frameId: p.pageid }];
  }
  async next() { if (this.idx < this.seq.length - 1) { this.idx++; return true; } return false; }
  async chapterPages() { return this.tocPages; }
}

function pages(from, to, textFor) {
  const out = [];
  for (let printed = from; printed <= to; printed++) out.push({ pageid: printed, printed, text: textFor(printed) });
  return out;
}
// Conteúdo distinto por página, suficiente e sem repetições (para integral).
const txt = (n) => Array.from({ length: 5 }, (_, k) => `Paragrafo ${n}.${k}: conteúdo distinto da pagina impressa ${n} do material de exemplo, com vocabulário variado e sem repetição exata entre parágrafos para validação honesta.`).join('\n\n') + '\n\n';

function groupR() {
  const G = 'R';
  const jobs = [];

  // R-1: intervalo [10,12] confirmado — começa ANTES do início (9), captura só 10-12
  //      e para ao passar do fim (13).
  jobs.push((async () => {
    const r = new SimpleReader(pages(9, 13, txt));
    const expected = { hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const printedCaptured = (x.text.match(/\[PÁGINA impressa (\d+)\]/g) || []).map((m) => parseInt(m.match(/\d+/)[0], 10));
    const ok = x.validation.pageRangeOk === true && x.rangeEndConfirmed === true && x.rangeStartConfirmed === true && x.rangeMissingPages === 0 && printedCaptured.join(',') === '10,11,12' && x.steps.includes('pagina-limite-intervalo');
    record({ id: G + '-1', title: '4.3: intervalo de páginas confirmado — captura exatamente 10..12 pela paginação impressa e para no fim', status: ok ? 'PASS' : 'FAIL', detail: `capturadas=${printedCaptured.join(',')} rangeOk=${x.validation.pageRangeOk} steps=${x.steps.join('|')}` });
  })());

  // R-2: página AUSENTE dentro do intervalo (salto 10 → 12) → não confirmado.
  jobs.push((async () => {
    const seq = pages(9, 9, txt).concat(pages(10, 10, txt), pages(12, 13, txt));
    const r = new SimpleReader(seq);
    const expected = { hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const ok = x.validation.pageRangeOk === false && x.rangeMissingPages >= 1 && x.validation.warnings.some((w) => w.includes('paginas-ausentes-no-intervalo'));
    record({ id: G + '-2', title: '4.3: página ausente no intervalo (salto) → intervalo NÃO confirmado (conservador)', status: ok ? 'PASS' : 'FAIL', detail: `ausentes=${x.rangeMissingPages} rangeOk=${x.validation.pageRangeOk}` });
  })());

  // R-3: início do intervalo nunca alcançado → não confirmado, nunca integral.
  jobs.push((async () => {
    const r = new SimpleReader(pages(1, 3, txt));
    const expected = { hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const ok = x.rangeStartConfirmed === false && x.validation.pageRangeOk !== true && x.status !== 'integral';
    record({ id: G + '-3', title: '4.3: início do intervalo não alcançado → conservador (não integral)', status: ok ? 'PASS' : 'FAIL', detail: `startConfirmed=${x.rangeStartConfirmed} rangeOk=${x.validation.pageRangeOk} status=${x.status}` });
  })());

  // R-4: capítulo E intervalo declarados juntos — ambos preservados; o fim do
  //      intervalo (12) é o limite que encerra (o capítulo seguinte começa em 50).
  jobs.push((async () => {
    const r = new SimpleReader(pages(9, 14, txt), { 2: 50 });
    const expected = { chapter: 1, hasChapter: true, hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const ok = x.rangeEndConfirmed === true && x.validation.pageRangeOk === true && x.reachedChapterEnd === false && x.steps.includes('pagina-limite-intervalo');
    record({ id: G + '-4', title: '4.3: capítulo + intervalo simultâneos — o intervalo encerra sem perder o capítulo', status: ok ? 'PASS' : 'FAIL', detail: `rangeOk=${x.validation.pageRangeOk} chapterOk=${x.validation.chapterOk} reachedChapterEnd=${x.reachedChapterEnd}` });
  })());

  return Promise.all(jobs);
}

(async () => {
  await groupR();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO INTERVALO DE PÁGINAS (4.3) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
