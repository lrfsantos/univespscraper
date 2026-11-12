const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const books = require('../src/extract/books');
const ep = require('../src/extract/epub-structure');
const { parseExpectedFromResource } = require('../electron/discovery');
const { renderReadingDocument } = require('../src/extract/markdown');

// Testes da SEÇÃO 5 (P1 livros/pageRange): metadados REAIS (OPF/âncora, nunca
// inventados), distinção página solicitada/identificada/capturada/duplicada/
// confirmada/ausente, e o documento com metadados/origem/evidência/status.
// pageid é exercitado pela função de PRODUÇÃO extractPageidViaSync com um LEITOR
// SIMULADO na fronteira (determinístico); EPUB via fetchEpubPackageFromFetcher.

const OUT = path.join(__dirname, '..', 'audit-temp', 'BOOKS_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');

class SimpleReader {
  constructor(pages, tocPages) {
    this.seq = pages;
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
const txt = (n) => Array.from({ length: 5 }, (_, k) => `Paragrafo ${n}.${k}: conteúdo distinto da pagina impressa ${n} do material de exemplo, com vocabulário variado e sem repetição exata para validação honesta.`).join('\n\n') + '\n\n';

const OPF_XML = `<?xml version="1.0"?><package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Empreendedorismo: criação de novos negócios</dc:title>
  <dc:creator>Dornelas</dc:creator>
  <dc:publisher>Atlas</dc:publisher>
  <dc:date>2021-03-01</dc:date>
  <dc:language>pt-BR</dc:language>
</metadata></package>`;

(async () => {
  const G = 'B';

  // B-1: metadados REAIS do OPF (título/autor/editora/ano/idioma), nunca inventados.
  {
    const meta = ep.parseOpfMetadata(OPF_XML);
    const ok = meta.title.includes('Empreendedorismo') && meta.author === 'Dornelas' && meta.publisher === 'Atlas' && meta.year === '2021' && meta.language === 'pt-BR';
    record({ id: G + '-1', title: '5: parseOpfMetadata extrai título/autor/editora/ano/idioma REAIS do OPF', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(meta) });
  }

  // B-2: metadados AUSENTES no OPF -> null (não inventa); âncora AVA declara autor.
  {
    const empty = ep.parseOpfMetadata('<package/>');
    const expected = parseExpectedFromResource({ text: 'Texto-base - Empreendedorismo (Leia o Capítulo 1) | Dornelas' });
    const ok = empty.title === null && empty.author === null && expected.book === 'Empreendedorismo' && expected.chapter === 1 && expected.author === 'Dornelas';
    record({ id: G + '-2', title: '5: OPF sem metadados -> null; âncora AVA com "| Autor" expõe autor real', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ empty, expected }) });
  }

  // B-3: intervalo totalmente confirmado (início + fim observados) + distinção de páginas.
  {
    const r = new SimpleReader(pages(9, 13, txt));
    const expected = { hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const printed = (x.text.match(/\[PÁGINA impressa (\d+)\]/g) || []).map((m) => parseInt(m.match(/\d+/)[0], 10));
    const ok = x.validation.pageRangeOk === true && x.rangeStartConfirmed === true && x.rangeEndConfirmed === true && x.rangeMissingPages === 0 &&
      x.identifiedPages === 3 && x.capturedPages === 3 && x.duplicatePages === 0 && printed.join(',') === '10,11,12';
    record({ id: G + '-3', title: '5: intervalo [10..12] confirmado; identificadas=capturadas=3, duplicadas=0', status: ok ? 'PASS' : 'FAIL', detail: `ident=${x.identifiedPages} capt=${x.capturedPages} dup=${x.duplicatePages} cap=${printed.join(',')} ok=${x.validation.pageRangeOk}` });
  }

  // B-4: intervalo sem INÍCIO identificável (página 10 nunca observada; leitor começa em 11) -> não confirmado.
  {
    const r = new SimpleReader(pages(11, 13, txt));
    const expected = { hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const ok = x.validation.pageRangeOk === false && x.rangeStartConfirmed === false && x.status !== 'integral';
    record({ id: G + '-4', title: '5: início do intervalo nunca observado (página exata ausente) -> não confirmado, nunca integral', status: ok ? 'PASS' : 'FAIL', detail: `start=${x.rangeStartConfirmed} ok=${x.validation.pageRangeOk} status=${x.status}` });
  }

  // B-5: intervalo sem FIM identificável (página 12 nunca observada; leitor termina em 11) -> não confirmado.
  {
    const r = new SimpleReader(pages(10, 11, txt));
    const expected = { hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const ok = x.validation.pageRangeOk === false && x.rangeEndConfirmed === false && x.status !== 'integral';
    record({ id: G + '-5', title: '5: fim do intervalo nunca observado (página exata ausente) -> não confirmado', status: ok ? 'PASS' : 'FAIL', detail: `end=${x.rangeEndConfirmed} ok=${x.validation.pageRangeOk} status=${x.status}` });
  }

  // B-6: página AUSENTE dentro do intervalo -> não confirmado + aviso.
  {
    const seq = pages(9, 9, txt).concat(pages(10, 10, txt), pages(12, 13, txt));
    const r = new SimpleReader(seq);
    const expected = { hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const ok = x.validation.pageRangeOk === false && x.rangeMissingPages >= 1 && x.validation.warnings.some((w) => w.includes('paginas-ausentes'));
    record({ id: G + '-6', title: '5: página ausente no intervalo -> não confirmado com aviso explícito', status: ok ? 'PASS' : 'FAIL', detail: `ausentes=${x.rangeMissingPages} ok=${x.validation.pageRangeOk}` });
  }

  // B-7: páginas DUPLICADAS (paginação impressa repetida com conteúdo distinto) detectadas.
  {
    const dupSeq = [
      { pageid: 10, printed: 10, text: txt(10) },
      { pageid: 11, printed: 10, text: txt(10) + '\n\nSegundo bloco na mesma pagina impressa 10, com conteudo distinto.' },
      { pageid: 12, printed: 11, text: txt(11) },
      { pageid: 13, printed: 12, text: txt(12) },
    ];
    const r = new SimpleReader(dupSeq);
    const expected = { hasPageRange: true, pageRange: { start: 10, end: 12 } };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const ok = x.duplicatePages > 0 && x.capturedPages > x.identifiedPages;
    record({ id: G + '-7', title: '5: paginação duplicada detectada (capturadas > identificadas distintas)', status: ok ? 'PASS' : 'FAIL', detail: `ident=${x.identifiedPages} capt=${x.capturedPages} dup=${x.duplicatePages}` });
  }

  // B-8: fim de CAPÍTULO pela paginação do sumário (capítulo muda na página) -> parada honesta.
  {
    const r = new SimpleReader(pages(20, 25, txt), { 1: 20, 2: 25 });
    const expected = { chapter: 1 };
    const x = await books.extractPageidViaSync(r, expected, { maxPages: 20 });
    const ok = x.reachedChapterEnd === true && x.status !== 'inaccessible';
    record({ id: G + '-8', title: '5: limite de capítulo pela paginação do sumário (para ao chegar ao início do cap. 2)', status: ok ? 'PASS' : 'FAIL', detail: `fimCap=${x.reachedChapterEnd} status=${x.status}` });
  }

  // B-9: sincronização AMBÍGUA (dois frames de conteúdo com a mesma identidade) -> não inventa página.
  {
    const r = new SimpleReader(pages(10, 12, txt));
    const origFrames = r.frames.bind(r);
    r.frames = async () => {
      const p = r.seq[r.idx];
      return [
        { identity: { pageid: p.pageid, pages: p.pageid }, active: true, text: p.text, chars: p.text.length, hash: sha(p.text.trim()), frameId: p.pageid },
        { identity: { pageid: p.pageid, pages: p.pageid }, active: false, text: p.text, chars: p.text.length, hash: sha(p.text.trim()), frameId: p.pageid + 100 },
      ];
    };
    const x = await books.extractPageidViaSync(r, { hasPageRange: true, pageRange: { start: 10, end: 12 } }, { maxPages: 20 });
    const ok = x.ambiguousCount > 0 && x.status !== 'integral';
    record({ id: G + '-9', title: '5: associação de página ambígua (dois frames) não inventa conteúdo', status: ok ? 'PASS' : 'FAIL', detail: `status=${x.status} amb=${x.ambiguousCount}` });
  }

  // B-10: documento de leitura contém metadados reais, origem, evidência e status.
  {
    const md = renderReadingDocument({
      entry: {
        id: 'BOOK_01', text: 'Texto-base - Empreendedorismo', url: 'u',
        bookName: 'Empreendedorismo: criação de novos negócios', author: 'Dornelas', publisher: 'Atlas', edition: 'ano 2021',
        expected: { chapter: 1, hasChapter: true, book: 'Empreendedorismo', author: 'Dornelas', pageRange: { start: 10, end: 12 }, hasPageRange: true },
        status: 'integral', format: 'epub', pageRangeOk: true, pageRangeNote: '10..12', identifiedPages: 3, capturedPages: 3, duplicatePages: 0,
        endOk: true, metaOrigin: 'OPF do EPUB (metadados reais do pacote)', bookText: 'Conteúdo acadêmico do capítulo.',
      },
      course: { code: 'M1' }, week: { name: 'Semana 1' }, meta: {},
    });
    const ok = md.includes('Empreendedorismo: criação de novos negócios') && md.includes('Dornelas') && md.includes('Atlas') &&
      md.includes('Capítulo solicitado pelo AVA: 1') && md.includes('10 a 12') && md.includes('OPF do EPUB') &&
      md.includes('Páginas capturadas: 3') && md.includes('Páginas duplicadas (paginação repetida): 0');
    record({ id: G + '-10', title: '5: documento do livro traz metadados reais, origem, faixa e páginas capturadas/duplicadas', status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : 'camposAusentes=true' });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO LIVROS/pageRange (SEÇÃO 5) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
