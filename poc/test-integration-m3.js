const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const books = require('../src/extract/books');
const ep = require('../src/extract/epub-structure');

// Testes de INTEGRAÇÃO do follow-up (Issues A/B do commit 053ffc6).
// - Issue B: mecanismo COMPLETO de sincronização página x frame
//   (extractPageidViaSync) dirigido por um leitor SIMULADO realista
//   (identidade por URL/src, corrida de atualização, pageid != página impressa).
// - Issue A: integração extração x validação estrutural
//   (applyEpubStructuralValidation + parsePackageFromXml), pacote por string.
// Nenhum conteúdo protegido real é gravado.

const OUT = path.join(__dirname, '..', 'audit-temp', 'INTEGRATION_RESULTS.json');
const results = [];
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');

function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

// Simula o leitor VitalSource pageid: identidade de frame na URL/src (pageid/N),
// página exibida no topo (pageid/N) e PÁGINA IMPRESSA diferente (printed = pageid+23).
// Timers reais exercitam a corrida de sincronização de forma assíncrona.
class FakePageidReader {
  constructor({ initialPageid, initialPrinted, chapterPages = {}, nextResult = true }) {
    this.pageid = initialPageid;
    this.printed = initialPrinted;
    this.tocPages = chapterPages || {};
    this.nextResult = nextResult;
    this.frameList = []; // frames { identity:{pageid,pages}, active, text } (permite duplicados p/ ambigüidade)
    this.timers = [];
    this.nextCalls = 0;
  }
  async state() { this._fire(); return { pageid: this.pageid, printed: this.printed }; }
  async frames() {
    this._fire();
    return this.frameList.map((f) => ({ identity: f.identity, active: f.active, text: f.text, chars: f.text.length, hash: sha(f.text.trim()), frameId: f.identity.pages }));
  }
  async next() { this.nextCalls++; return this.nextResult; }
  async chapterPages() { return this.tocPages; }
  _fire() { const now = Date.now(); for (const t of [...this.timers]) if (t.at <= now) { this.timers = this.timers.filter((x) => x !== t); t.fn(); } }
  schedule(ms, fn) { this.timers.push({ at: Date.now() + ms, fn }); }
  setPage(pageid, printed) { this.pageid = pageid; this.printed = printed; }
  setFrame(identity, text, active) { this.frameList.push({ identity: { pageid: identity, pages: identity }, active, text }); }
  replaceFrame(identity, text, active) { this.frameList = this.frameList.filter((f) => f.identity.pageid !== identity); this.frameList.push({ identity: { pageid: identity, pages: identity }, active, text }); }
  clearFrames() { this.frameList.length = 0; }
}

const P45 = 'Conteudo da pagina 45 impressa do capitulo um. '.repeat(4);
const P46 = 'Conteudo da pagina 46 impressa do capitulo um. '.repeat(4);
const P46B = 'Outro candidato de conteudo da pagina 46 impressa. '.repeat(4);

async function issueB() {
  const group = 'B';
  const expected = { book: 'F', chapter: 1 };
  const TOC = { 1: 23, 2: 46 };
  const TOC50 = { 1: 23, 2: 50 };
  const opts = { maxPages: 8 };

  // B-1: página 45 ativa e página 46 em prefetch → somente 45 capturada.
  await (async () => {
    const r = new FakePageidReader({ initialPageid: 22, initialPrinted: 45, chapterPages: TOC });
    r.setFrame(22, P45, true);
    r.setFrame(23, P46, false);
    r.next = async () => { r.setPage(23, 46); r.setFrame(23, P46, true); return true; };
    const x = await books.extractPageidViaSync(r, expected, opts);
    record({ id: group + '-1', title: 'Página 45 ativa e página 46 em prefetch → somente 45 capturada', status: x.pages === 1 && x.text.includes('pagina 45') && !x.text.includes('pagina 46') ? 'PASS' : 'FAIL', detail: `pages=${x.pages} temP46=${x.text.includes('pagina 46')}` });
  })();

  // B-2 (CORRIDA): interface mostra 46 mas frame ainda tem conteúdo 45 → captura aguarda.
  await (async () => {
    const r = new FakePageidReader({ initialPageid: 22, initialPrinted: 45, chapterPages: TOC50 });
    r.setFrame(22, P45, true);
    r.next = async () => {
      r.setPage(23, 46);
      r.setFrame(23, P45, true);
      r.schedule(900, () => r.replaceFrame(23, P46, true));
      return true;
    };
    const x = await books.extractPageidViaSync(r, expected, opts);
    const p46 = (x.text.match(/\[PÁGINA impressa 46\]\n([\s\S]*?)(?=\n\[PÁGINA|$)/) || [])[1] || '';
    record({ id: group + '-2', title: 'CORRIDA: interface 46, frame ainda 45 → captura aguarda', status: x.pages === 2 && x.text.includes('pagina 45') && x.text.includes('pagina 46') && !p46.includes('pagina 45') ? 'PASS' : 'FAIL', detail: `pages=${x.pages} bloco46Contem45=${p46.includes('pagina 45')} status=${x.status}` });
  })();

  // B-3 (CORRIDA INVERSA): frame muda antes do número exibido → captura aguarda.
  await (async () => {
    const r = new FakePageidReader({ initialPageid: 22, initialPrinted: 45, chapterPages: TOC50 });
    r.setFrame(22, P45, true);
    r.next = async () => {
      r.setFrame(23, P46, true);
      r.schedule(900, () => r.setPage(23, 46));
      return true;
    };
    const x = await books.extractPageidViaSync(r, expected, opts);
    const p46 = (x.text.match(/\[PÁGINA impressa 46\]\n([\s\S]*?)(?=\n\[PÁGINA|$)/) || [])[1] || '';
    record({ id: group + '-3', title: 'CORRIDA INVERSA: frame 46 antes do número exibido → captura aguarda', status: x.pages === 2 && x.text.includes('pagina 45') && x.text.includes('pagina 46') && !p46.includes('pagina 45') ? 'PASS' : 'FAIL', detail: `pages=${x.pages} bloco46Contem45=${p46.includes('pagina 45')} status=${x.status}` });
  })();

  // B-4: página e frame correspondem → captura aprovada.
  await (async () => {
    const r = new FakePageidReader({ initialPageid: 22, initialPrinted: 45, chapterPages: TOC50 });
    r.setFrame(22, P45, true);
    r.next = async () => { r.setPage(23, 46); r.setFrame(23, P46, true); return true; };
    const x = await books.extractPageidViaSync(r, expected, opts);
    record({ id: group + '-4', title: 'Página e frame correspondem → captura aprovada', status: x.pages === 2 && x.text.includes('pagina 45') && x.text.includes('pagina 46') ? 'PASS' : 'FAIL', detail: `pages=${x.pages} tem45=${x.text.includes('pagina 45')} tem46=${x.text.includes('pagina 46')}` });
  })();

  // B-5: frame contém conteúdo antigo (nunca atualiza) → captura rejeitada.
  await (async () => {
    const r = new FakePageidReader({ initialPageid: 22, initialPrinted: 45, chapterPages: TOC50 });
    r.setFrame(22, P45, true);
    r.next = async () => { r.setPage(23, 46); r.setFrame(23, P45, true); return true; };
    const x = await books.extractPageidViaSync(r, expected, opts);
    record({ id: group + '-5', title: 'Frame com conteúdo antigo (nunca atualiza) → captura rejeitada', status: x.pages === 1 && !x.text.includes('pagina 46') && x.steps.includes('frame-sem-conteudo-atualizado') ? 'PASS' : 'FAIL', detail: `pages=${x.pages} steps=${x.steps.join(',')}` });
  })();

  // B-6: dois frames candidatos (mesma identidade) → associação ambígua.
  await (async () => {
    const r = new FakePageidReader({ initialPageid: 22, initialPrinted: 45, chapterPages: TOC50 });
    r.setFrame(22, P45, true);
    r.next = async () => { r.setPage(23, 46); r.setFrame(23, P46, true); r.setFrame(23, P46B, true); return true; };
    const x = await books.extractPageidViaSync(r, expected, opts);
    record({ id: group + '-6', title: 'Dois frames candidatos (mesma identidade) → associação ambígua', status: x.ambiguousCount >= 1 ? 'PASS' : 'FAIL', detail: `ambiguousCount=${x.ambiguousCount}` });
  })();

  // B-7: nenhum frame identificável para a página exibida → rejeitada.
  await (async () => {
    const r = new FakePageidReader({ initialPageid: 22, initialPrinted: 45, chapterPages: TOC50 });
    r.setFrame(22, P45, true);
    r.next = async () => { r.setPage(23, 46); r.setFrame(24, P46, false); return true; };
    const x = await books.extractPageidViaSync(r, expected, opts);
    record({ id: group + '-7', title: 'Nenhum frame identificável → associação rejeitada', status: x.pages === 1 && x.steps.includes('sem-frame-identificavel') ? 'PASS' : 'FAIL', detail: `pages=${x.pages} steps=${x.steps.join(',')}` });
  })();

  // B-8: página seguinte pertence ao capítulo seguinte → não incluir no capítulo atual.
  await (async () => {
    const r = new FakePageidReader({ initialPageid: 22, initialPrinted: 45, chapterPages: TOC });
    r.setFrame(22, P45, true);
    r.next = async () => { r.setPage(23, 46); r.setFrame(23, P46, true); return true; };
    const x = await books.extractPageidViaSync(r, expected, opts);
    record({ id: group + '-8', title: 'Página seguinte (46) do capítulo seguinte → não incluída', status: x.reachedChapterEnd && x.pages === 1 && !x.text.includes('pagina 46') ? 'PASS' : 'FAIL', detail: `pages=${x.pages} reachedChapterEnd=${x.reachedChapterEnd} temP46=${x.text.includes('pagina 46')}` });
  })();
}

// ==================== Integração EPUB estrutural (Issue A) ====================

const OPF_XML = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Fixture</dc:title></metadata><manifest>
<item id="front" href="Text/front.xhtml" media-type="application/xhtml+xml"/>
<item id="ch01a" href="Text/ch01a.xhtml" media-type="application/xhtml+xml"/>
<item id="ch01b" href="Text/ch01b.xhtml" media-type="application/xhtml+xml"/>
<item id="ch02" href="Text/ch02.xhtml" media-type="application/xhtml+xml"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
</manifest><spine toc="ncx"><itemref idref="front"/><itemref idref="ch01a"/><itemref idref="ch01b"/><itemref idref="ch02"/></spine></package>`;

const NCX_XML = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
<navPoint id="p1"><navLabel><text>Front</text></navLabel><content src="Text/front.xhtml"/></navPoint>
<navPoint id="c1"><navLabel><text>Capítulo 1</text></navLabel><content src="Text/ch01a.xhtml"/></navPoint>
<navPoint id="c2"><navLabel><text>Capítulo 2</text></navLabel><content src="Text/ch02.xhtml"/></navPoint>
</navMap></ncx>`;

function issueA() {
  const group = 'A';
  // O parser por string é a porta de entrada da produção: o OPF/nav chegam ao
  // frame via fetch (mesma origem jigsaw) — parsePackageFromXml NÃO toca em disco.
  const parsed = ep.parsePackageFromXml({ opfXml: OPF_XML, ncxXml: NCX_XML });
  record({ id: group + '-parse', title: 'Pacote EPUB por string (produção por URL) é parseado', status: parsed.ok && parsed.pkg.spine.length === 4 && parsed.pkg.nav.length === 3 ? 'PASS' : 'FAIL', detail: `ok=${parsed.ok} spine=${parsed.pkg ? parsed.pkg.spine.length : 0} nav=${parsed.pkg ? parsed.pkg.nav.length : 0}` });

  const pkg = parsed.pkg;

  // A-1: capítulo 1 em 2 documentos, ambos extraídos → integral-valid (endOk=true).
  {
    const st = books.applyEpubStructuralValidation({ pkg, chapter: 1, extractedDocIds: ['Text/ch01a.xhtml', 'Text/ch01b.xhtml'] });
    record({ id: group + '-1', title: 'Cap. 1 em 2 docs, ambos extraídos → integral-valid', status: st.used && st.endOk && st.status === 'integral-valid' ? 'PASS' : 'FAIL', detail: `used=${st.used} endOk=${st.endOk} chapterIds=${st.chapterIds.join(',')}` });
  }

  // A-2: falta documento esperado do capítulo → endOk=false (nunca integral).
  {
    const st = books.applyEpubStructuralValidation({ pkg, chapter: 1, extractedDocIds: ['Text/ch01a.xhtml'] });
    record({ id: group + '-2', title: 'Falta documento esperado do capítulo → endOk=false', status: st.used && !st.endOk && !st.allChapterItemsExtracted ? 'PASS' : 'FAIL', detail: `allChapterItemsExtracted=${st.allChapterItemsExtracted} endOk=${st.endOk}` });
  }

  // A-3: documento do capítulo seguinte incluído → endOk=false (nextChapterIncluded).
  {
    const st = books.applyEpubStructuralValidation({ pkg, chapter: 1, extractedDocIds: ['Text/ch01a.xhtml', 'Text/ch01b.xhtml', 'Text/ch02.xhtml'] });
    record({ id: group + '-3', title: 'Documento do capítulo seguinte incluído → endOk=false', status: st.used && !st.endOk && st.nextChapterIncluded ? 'PASS' : 'FAIL', detail: `nextChapterIncluded=${st.nextChapterIncluded} endOk=${st.endOk}` });
  }

  // A-4: pacote indisponível → used=false (produção cai para navegação complementar).
  {
    const st = books.applyEpubStructuralValidation({ pkg: null, chapter: 1, extractedDocIds: ['Text/ch01a.xhtml'] });
    record({ id: group + '-4', title: 'Pacote indisponível → used=false (navegação complementar)', status: st.used === false && st.boundaryKnown === false ? 'PASS' : 'FAIL', detail: `used=${st.used} boundaryKnown=${st.boundaryKnown}` });
  }

  // A-5: capítulo sem próximo na navegação → boundaryKnown=false → não confirma.
  {
    const opf1 = OPF_XML.replace(/<itemref idref="ch02"\/>/, '');
    const p1 = ep.parsePackageFromXml({ opfXml: opf1, ncxXml: NCX_XML });
    const st = books.applyEpubStructuralValidation({ pkg: p1.pkg, chapter: 1, extractedDocIds: ['Text/ch01a.xhtml', 'Text/ch01b.xhtml'] });
    record({ id: group + '-5', title: 'Sem próximo capítulo na navegação → limite não identificável', status: st.used === false && st.boundaryKnown === false ? 'PASS' : 'FAIL', detail: `boundaryKnown=${st.boundaryKnown} reason=${st.reason}` });
  }
}

(async () => {
  issueA();
  await issueB();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO INTEGRAÇÃO ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });