const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const books = require('../src/extract/books');
const ep = require('../src/extract/epub-structure');

// Testes de PRODUÇÃO da Fase 3 (consolidação EPUB/PAGEID).
// Exercitam as funções de ORQUESTRAÇÃO reais (extractEpubViaAdapter e
// extractPageidViaSync) com leitores simulados realistas + fixtures de estrutura
// EPUB 2/3. Nenhum conteúdo protegido real é gravado (tudo sintético).

const OUT = path.join(__dirname, '..', 'audit-temp', 'PRODUCTION_RESULTS.json');
const results = [];
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');

// Sanitiza a SAÍDA NA GERAÇÃO: caminhos locais temporários (com os dois
// separadores e com escapes JSON) são substituídos por <TEMP> — nunca chegam ao
// JSON versionado.
const TMP_PREFIXES = [
  os.tmpdir(),
  os.tmpdir().replace(/\\/g, '/'),
  os.tmpdir().replace(/\\/g, '\\\\'), // escape JSON de backslash (\ -> \\)
  os.tmpdir().replace(/\\/g, '/').replace(/\//g, '\\/'),
];
function sanitizeDetail(s) {
  let out = String(s == null ? '' : s);
  for (const t of TMP_PREFIXES) out = out.split(t).join('<TEMP>');
  return out;
}

function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

const makeText = (label, paras = 12, words = 40) =>
  Array.from({ length: paras }, (_, i) => `${label} paragrafo ${i}: ` + Array.from({ length: words }, (_, j) => `palavra${i}_${j}`).join(' ')).join('\n\n');

// ==================== Fixtures EPUB (estrutura) ====================

const OPF_TEMPLATE = (manifestItems, spineIds) =>
  `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Fixture</dc:title></metadata><manifest>${manifestItems}</manifest><spine>${spineIds.map((i) => `<itemref idref="${i}"/>`).join('')}</spine></package>`;

const ITEM = (id, href, mt) => `<item id="${id}" href="${href}" media-type="${mt}"/>`;

function pkgDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'epubp-'));
  fs.mkdirSync(path.join(d, 'META-INF'), { recursive: true });
  fs.writeFileSync(path.join(d, 'META-INF', 'container.xml'),
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  return d;
}

// ---- EPUB 2 (NCX) ----
const dirEpub2 = pkgDir();
fs.writeFileSync(path.join(dirEpub2, 'content.opf'), OPF_TEMPLATE(
  [ITEM('nav', 'toc.ncx', 'application/x-dtbncx+xml'),
   ITEM('ch1', 'Text/ch01.xhtml', 'application/xhtml+xml'),
   ITEM('ch1a', 'Text/ch01a.xhtml', 'application/xhtml+xml'),
   ITEM('ch2', 'Text/ch02.xhtml', 'application/xhtml+xml')],
  ['ch1', 'ch1a', 'ch2']));
fs.writeFileSync(path.join(dirEpub2, 'toc.ncx'),
  `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint id="c1" playOrder="1"><navLabel><text>Capítulo 1</text></navLabel><content src="Text/ch01.xhtml"/>
    <navPoint id="c1s1" playOrder="2"><navLabel><text>1.1 Subcapítulo</text></navLabel><content src="Text/ch01a.xhtml"/></navPoint>
  </navPoint>
  <navPoint id="c2" playOrder="3"><navLabel><text>Capítulo 2</text></navLabel><content src="Text/ch02.xhtml"/></navPoint>
</navMap></ncx>`);

// ---- EPUB 3 (nav.xhtml com epub:type="toc" + um nav de landmarks para confundir) ----
const dirEpub3 = pkgDir();
fs.writeFileSync(path.join(dirEpub3, 'content.opf'), OPF_TEMPLATE(
  [ITEM('nav', 'nav.xhtml', 'application/xhtml+xml'),
   ITEM('ch1', 'Text/ch01.xhtml', 'application/xhtml+xml'),
   ITEM('ch2', 'Text/ch02.xhtml', 'application/xhtml+xml')],
  ['ch1', 'ch2']));
fs.writeFileSync(path.join(dirEpub3, 'nav.xhtml'),
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>TOC</title></head><body>
  <nav epub:type="toc"><h1>Sumário</h1><ol>
    <li><a href="Text/ch01.xhtml#sec1">Capítulo 1</a>
      <ol><li><a href="Text/ch01.xhtml#sec1-1">1.1 Subcapítulo</a></li></ol>
    </li>
    <li><a href="Text/ch02.xhtml">Capítulo 2</a></li>
  </ol></nav>
  <nav epub:type="landmarks"><ol><li><a href="Text/ch01.xhtml">Começar</a></li></ol></nav>
  </body></html>`);

// ---- EPUB 3 com nav em subdiretório e caminhos relativos aninhados ----
const dirSub = pkgDir();
fs.mkdirSync(path.join(dirSub, 'nav'), { recursive: true });
fs.mkdirSync(path.join(dirSub, 'chapters', 'part1'), { recursive: true });
fs.writeFileSync(path.join(dirSub, 'content.opf'), OPF_TEMPLATE(
  [ITEM('nav', 'nav/nav.xhtml', 'application/xhtml+xml'),
   ITEM('ch1', 'chapters/part1/c01.xhtml', 'application/xhtml+xml'),
   ITEM('ch2', 'chapters/part2/c02.xhtml', 'application/xhtml+xml')],
  ['ch1', 'ch2']));
fs.mkdirSync(path.join(dirSub, 'chapters', 'part2'), { recursive: true });
fs.writeFileSync(path.join(dirSub, 'chapters', 'part2', 'c02.xhtml'), '<html><body><p>c02</p></body></html>');
fs.writeFileSync(path.join(dirSub, 'nav', 'nav.xhtml'),
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="toc"><ol>
    <li><a href="../chapters/part1/c01.xhtml">Capítulo 1</a></li>
    <li><a href="../chapters/part2/c02.xhtml">Capítulo 2</a></li>
  </ol></nav></body></html>`);

// ---- Colisão de basename: Text/chapter01.xhtml e Appendix/chapter01.xhtml ----
const dirCollision = pkgDir();
fs.mkdirSync(path.join(dirCollision, 'Text'), { recursive: true });
fs.mkdirSync(path.join(dirCollision, 'Appendix'), { recursive: true });
fs.writeFileSync(path.join(dirCollision, 'content.opf'), OPF_TEMPLATE(
  [ITEM('nav', 'toc.ncx', 'application/x-dtbncx+xml'),
   ITEM('ch1', 'Text/chapter01.xhtml', 'application/xhtml+xml'),
   ITEM('ch2', 'Text/chapter02.xhtml', 'application/xhtml+xml'),
   ITEM('ap1', 'Appendix/chapter01.xhtml', 'application/xhtml+xml')],
  ['ch1', 'ch2', 'ap1']));
fs.writeFileSync(path.join(dirCollision, 'toc.ncx'),
  `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="c1"><navLabel><text>Capítulo 1</text></navLabel><content src="Text/chapter01.xhtml"/></navPoint>
  <navPoint id="c2"><navLabel><text>Capítulo 2</text></navLabel><content src="Text/chapter02.xhtml"/></navPoint>
</navMap></ncx>`);

// ---- Malformado / ausente / sem capítulos ----
const dirBad = pkgDir();
fs.writeFileSync(path.join(dirBad, 'content.opf'), OPF_TEMPLATE([], []));
fs.writeFileSync(path.join(dirBad, 'toc.ncx'), 'isso nao eh xml <navPoint'); // malformado

// ==================== Testes de estrutura EPUB 2/3 (3.1/3.4) ====================

function testEpubStructure() {
  const G = 'S';
  // EPUB 2 NCX: hierarquia + caminhos resolvidos (3.1)
  const p2 = ep.parseEpubPackage(dirEpub2);
  const nav2 = p2.pkg.nav;
  const ok2 = p2.ok && nav2.length === 3 &&
    nav2[0].label === 'Capítulo 1' && nav2[0].depth === 0 && nav2[0].href.endsWith(path.join('Text', 'ch01.xhtml')) &&
    nav2[1].label === '1.1 Subcapítulo' && nav2[1].depth === 1 &&
    nav2[2].label === 'Capítulo 2';
  record({ id: G + '-ncx', title: 'EPUB 2 (NCX): hierarquia e caminhos resolvidos', status: ok2 ? 'PASS' : 'FAIL', detail: `nav=${JSON.stringify(nav2.map((n) => ({ l: n.label, d: n.depth })))}` });
  // EPUB 3 nav.xhtml: só o nav toc, hierarquia, fragmento removido do caminho
  const p3 = ep.parseEpubPackage(dirEpub3);
  const nav3 = p3.pkg.nav;
  const ok3 = p3.ok && nav3.length === 3 &&
    nav3[0].label === 'Capítulo 1' && nav3[0].depth === 0 && /ch01\.xhtml$/.test(nav3[0].href) && !/sec1/.test(nav3[0].href) &&
    nav3[1].label === '1.1 Subcapítulo' && nav3[1].depth === 1 &&
    nav3[2].label === 'Capítulo 2' && !nav3.some((n) => n.label === 'Começar');
  record({ id: G + '-nav3', title: 'EPUB 3 (nav.xhtml): só toc, hierarquia, fragmento removido, landmarks ignorados', status: ok3 ? 'PASS' : 'FAIL', detail: `nav=${JSON.stringify(nav3.map((n) => ({ l: n.label, d: n.depth, h: n.href })))}` });
  // Caminhos relativos em subdiretórios (nav em nav/, docs em chapters/partX/)
  const pS = ep.parseEpubPackage(dirSub);
  const okS = pS.ok && pS.pkg.nav.length === 2 && pS.pkg.nav[0].href.endsWith(path.join('chapters', 'part1', 'c01.xhtml'));
  record({ id: G + '-sub', title: 'Caminhos relativos em subdiretórios resolvidos corretamente', status: okS ? 'PASS' : 'FAIL', detail: `nav0.href=${pS.pkg.nav[0] && pS.pkg.nav[0].href}` });
  // Malformado
  const pBad = ep.parseEpubPackage(dirBad);
  const okBad = pBad.ok === false;
  record({ id: G + '-bad', title: 'Pacote/NCX malformado não quebra (ok=false)', status: okBad ? 'PASS' : 'FAIL', detail: JSON.stringify({ ok: pBad.ok, reason: pBad.reason }) });
  // Sem capítulos identificáveis (nav sem "Capítulo N")
  const pNC = ep.parseEpubPackage(dirEpub2);
  const bndNC = ep.findChapterBoundary({ pkg: pNC.pkg, chapter: 9 });
  record({ id: G + '-nochap', title: 'Capítulo inexistente na navegação → limite não identificável', status: bndNC.boundaryKnown === false ? 'PASS' : 'FAIL', detail: `boundaryKnown=${bndNC.boundaryKnown} reason=${bndNC.reason}` });
  // Colisão de basename (3.4): Text/chapter01.xhtml vs Appendix/chapter01.xhtml
  const pC = ep.parseEpubPackage(dirCollision);
  const bndC = ep.findChapterBoundary({ pkg: pC.pkg, chapter: 1 });
  const vC = ep.validateChapterExtraction({ pkg: pC.pkg, chapter: 1, extractedDocIds: ['Text/chapter01.xhtml'] });
  const vCbasename = ep.validateChapterExtraction({ pkg: pC.pkg, chapter: 1, extractedDocIds: ['chapter01.xhtml'] });
  const okC = bndC.boundaryKnown && bndC.chapterIds.length === 1 && vC.endOk === true && vCbasename.endOk === false;
  record({ id: G + '-collision', title: 'Colisão de basename: caminho completo casa; basename ambíguo NÃO casa', status: okC ? 'PASS' : 'FAIL', detail: `chapterIds=${bndC.chapterIds} vcPath=${vC.endOk} vcBasename=${vCbasename.endOk}` });
  // Multi-XHTML estrutural (3.3): cap. 1 = [ch1, ch1a] (EPUB2) — docs esperados
  const b2 = ep.findChapterBoundary({ pkg: p2.pkg, chapter: 1 });
  const vAll = ep.validateChapterExtraction({ pkg: p2.pkg, chapter: 1, extractedDocIds: ['Text/ch01.xhtml', 'Text/ch01a.xhtml'] });
  const vMissing = ep.validateChapterExtraction({ pkg: p2.pkg, chapter: 1, extractedDocIds: ['Text/ch01.xhtml'] });
  const vRep = ep.validateChapterExtraction({ pkg: p2.pkg, chapter: 1, extractedDocIds: ['Text/ch01.xhtml', 'Text/ch01.xhtml', 'Text/ch01a.xhtml'] });
  const vOther = ep.validateChapterExtraction({ pkg: p2.pkg, chapter: 1, extractedDocIds: ['Text/ch01.xhtml', 'Text/ch02.xhtml'] });
  record({ id: G + '-multidoc', title: 'Multi-XHTML: 2 docs → integral; falta doc → partial; repetido → ok; outro capítulo → partial', status: (b2.chapterIds.length === 2 && vAll.endOk && !vMissing.endOk && vRep.endOk && !vOther.endOk) ? 'PASS' : 'FAIL', detail: `ids=${b2.chapterIds} all=${vAll.endOk} missing=${vMissing.endOk} rep=${vRep.endOk} other=${vOther.endOk}` });
}

// ==================== Orquestração EPUB de produção (5.1) ====================

// Leitor EPUB SIMULADO com adaptador realista (docs sequenciais, navegação de
// capítulo e de documento, pacote injetado).
class FakeEpubReader {
  constructor({ docs, packageRes, chapterNav = {}, nextDocAdvance = true }) {
    this.docs = docs;            // [{url, text}]
    this.pos = 0;
    this.packageRes = packageRes; // { ok, pkg } | { ok:false, reason }
    this.chapterNav = chapterNav; // { capítulo: índice do doc de destino }
    this.nextDocAdvance = nextDocAdvance;
    this.navChapterCalls = [];
  }
  async waitContent() {
    const d = this.docs[this.pos];
    return d && (d.text || '').trim().length >= 500 ? { url: d.url, text: d.text } : null;
  }
  async readActive() { const d = this.docs[this.pos]; return { url: d.url, text: d.text }; }
  async navigateChapter(n) {
    this.navChapterCalls.push(n);
    const t = this.chapterNav[n];
    if (t != null && t >= 0 && t < this.docs.length) { this.pos = t; return true; }
    return false;
  }
  async navigateNextDoc() {
    if (this.nextDocAdvance && this.pos < this.docs.length - 1) { this.pos++; const d = this.docs[this.pos]; return { changed: true, doc: { url: d.url, text: d.text } }; }
    return { changed: false, doc: null };
  }
  async fetchPackage() { return this.packageRes; }
  async expandToc() { return false; }
}

const BASE = 'https://jigsaw.minhabiblioteca.com.br/books/9788597028089/epub/OEBPS/';
const docUrl = (p) => BASE + p + '?favre=brett';

function pkgMulti() {
  return ep.parsePackageFromXml({
    opfXml: OPF_TEMPLATE(
      [ITEM('ch01a', 'Text/ch01a.xhtml', 'application/xhtml+xml'),
       ITEM('ch01b', 'Text/ch01b.xhtml', 'application/xhtml+xml'),
       ITEM('ch02', 'Text/ch02.xhtml', 'application/xhtml+xml')],
      ['ch01a', 'ch01b', 'ch02']),
    ncxXml: `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint id="c1"><navLabel><text>Capítulo 1</text></navLabel><content src="Text/ch01a.xhtml"/></navPoint>
      <navPoint id="c2"><navLabel><text>Capítulo 2</text></navLabel><content src="Text/ch02.xhtml"/></navPoint></navMap></ncx>`,
    baseUrl: BASE,
  });
}

function pkgSingle() {
  return ep.parsePackageFromXml({
    opfXml: OPF_TEMPLATE(
      [ITEM('ch01', 'Text/ch01.xhtml', 'application/xhtml+xml'),
       ITEM('ch02', 'Text/ch02.xhtml', 'application/xhtml+xml')],
      ['ch01', 'ch02']),
    ncxXml: `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint id="c1"><navLabel><text>Capítulo 1</text></navLabel><content src="Text/ch01.xhtml"/></navPoint>
      <navPoint id="c2"><navLabel><text>Capítulo 2</text></navLabel><content src="Text/ch02.xhtml"/></navPoint></navMap></ncx>`,
    baseUrl: BASE,
  });
}

function pkgNoBoundary() {
  // pacote com spine mas nav sem rótulos de capítulo → boundaryKnown=false
  return ep.parsePackageFromXml({
    opfXml: OPF_TEMPLATE(
      [ITEM('ch01', 'Text/ch01.xhtml', 'application/xhtml+xml'),
       ITEM('ch02', 'Text/ch02.xhtml', 'application/xhtml+xml')],
      ['ch01', 'ch02']),
    ncxXml: `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint id="a"><navLabel><text>Introdução</text></navLabel><content src="Text/ch01.xhtml"/></navPoint>
      <navPoint id="b"><navLabel><text>Conclusão</text></navLabel><content src="Text/ch02.xhtml"/></navPoint></navMap></ncx>`,
    baseUrl: BASE,
  });
}

async function testEpubProduction() {
  const G = 'E';
  const expected = { book: 'F', chapter: 1 };

  // E-1: capítulo de 1 XHTML, pacote ok, limite estrutural → integral.
  {
    const r = new FakeEpubReader({ docs: [{ url: docUrl('Text/ch01.xhtml'), text: makeText('doc1') }, { url: docUrl('Text/ch02.xhtml'), text: makeText('doc2') }], packageRes: { ok: true, pkg: pkgSingle().pkg }, chapterNav: { 1: 0, 2: 1 } });
    const x = await books.extractEpubViaAdapter(r, expected, {});
    record({ id: G + '-1', title: 'Capítulo de 1 XHTML, pacote ok → integral', status: x.status === 'integral' ? 'PASS' : 'FAIL', detail: `status=${x.status} endOk=${x.validation && x.validation.endOk} chapterOk=${x.validation && x.validation.chapterOk}` });
  }

  // E-2: capítulo multi-XHTML (2 docs) ambos capturados → integral.
  {
    const r = new FakeEpubReader({ docs: [{ url: docUrl('Text/ch01a.xhtml'), text: makeText('doc1a') }, { url: docUrl('Text/ch01b.xhtml'), text: makeText('doc1b') }, { url: docUrl('Text/ch02.xhtml'), text: makeText('doc2') }], packageRes: { ok: true, pkg: pkgMulti().pkg }, chapterNav: { 1: 0, 2: 2 } });
    const x = await books.extractEpubViaAdapter(r, expected, {});
    const cap = x.structural && x.structural.capturedDocIds;
    record({ id: G + '-2', title: 'Capítulo multi-XHTML (2 docs) ambos capturados → integral', status: x.status === 'integral' && cap && cap.length === 2 ? 'PASS' : 'FAIL', detail: `status=${x.status} captured=${JSON.stringify(cap)} expected=${x.structural.expectedDocCount}` });
  }

  // E-3: multi-XHTML com documento faltando (navegação não avança) → partial.
  {
    const r = new FakeEpubReader({ docs: [{ url: docUrl('Text/ch01a.xhtml'), text: makeText('doc1a') }, { url: docUrl('Text/ch02.xhtml'), text: makeText('doc2') }], packageRes: { ok: true, pkg: pkgMulti().pkg }, chapterNav: { 1: 0, 2: 1 }, nextDocAdvance: false });
    const x = await books.extractEpubViaAdapter(r, expected, {});
    record({ id: G + '-3', title: 'Falta documento obrigatório (navegação não avança) → partial', status: x.status === 'partial' && x.structural.capturedDocIds.length === 1 ? 'PASS' : 'FAIL', detail: `status=${x.status} captured=${JSON.stringify(x.structural.capturedDocIds)} expected=${x.structural.expectedDocCount}` });
  }

  // E-4: documento repetido → dedup (sem duplicar conteúdo).
  {
    const r = new FakeEpubReader({ docs: [{ url: docUrl('Text/ch01a.xhtml'), text: makeText('doc1a') }, { url: docUrl('Text/ch01a.xhtml'), text: makeText('doc1a') }, { url: docUrl('Text/ch02.xhtml'), text: makeText('doc2') }], packageRes: { ok: true, pkg: pkgMulti().pkg }, chapterNav: { 1: 0, 2: 2 } });
    // navigateNextDoc volta ao mesmo doc na 1ª chamada (duplicate) e depois não avança
    let calls = 0;
    r.navigateNextDoc = async () => {
      calls++;
      if (calls === 1) { const d = r.docs[0]; return { changed: true, doc: { url: d.url, text: d.text } }; }
      return { changed: false, doc: null };
    };
    const x = await books.extractEpubViaAdapter(r, expected, {});
    record({ id: G + '-4', title: 'Documento repetido → dedup (sem duplicar)', status: x.structural.capturedDocIds.length === 1 && x.text.split('[DOC Text/ch01a.xhtml]').length - 1 === 1 ? 'PASS' : 'FAIL', detail: `captured=${JSON.stringify(x.structural.capturedDocIds)} status=${x.status}` });
  }

  // E-5: navegação para capítulo sem mudança de documento → não confirmado (não integral).
  {
    const r = new FakeEpubReader({ docs: [{ url: docUrl('Text/other.xhtml'), text: makeText('docother') }], packageRes: { ok: true, pkg: pkgSingle().pkg }, chapterNav: { 1: 0, 2: 0 } });
    const x = await books.extractEpubViaAdapter(r, expected, {});
    record({ id: G + '-5', title: 'Navegação ao capítulo sem mudança de documento → não confirmado', status: x.status !== 'integral' ? 'PASS' : 'FAIL', detail: `status=${x.status} chapterOk=${x.validation && x.validation.chapterOk}` });
  }

  // E-6: pacote disponível mas limite não confirmável → fallback NÃO confirma (partial).
  {
    const r = new FakeEpubReader({ docs: [{ url: docUrl('Text/chapter01.xhtml'), text: makeText('doc1') }, { url: docUrl('Text/chapter02.xhtml'), text: makeText('doc2') }], packageRes: { ok: true, pkg: pkgNoBoundary().pkg }, chapterNav: { 1: 0, 2: 1 } });
    const x = await books.extractEpubViaAdapter(r, expected, {});
    record({ id: G + '-6', title: 'Pacote ok mas limite não confirmável → fallback NÃO confirma (partial)', status: x.status === 'partial' && x.validation.endOk === false ? 'PASS' : 'FAIL', detail: `status=${x.status} endOk=${x.validation && x.validation.endOk} packageUsed=${x.structural.packageUsed} boundaryKnown=${x.structural.structVal && x.structural.structVal.boundaryKnown}` });
  }

  // E-7: pacote indisponível → fallback de navegação confirma (doc muda p/ cap. seguinte).
  {
    const r = new FakeEpubReader({ docs: [{ url: docUrl('Text/chapter01.xhtml'), text: makeText('doc1') }, { url: docUrl('Text/chapter02.xhtml'), text: makeText('doc2') }], packageRes: { ok: false, reason: 'pacote-epub-indisponivel' }, chapterNav: { 1: 0, 2: 1 } });
    const x = await books.extractEpubViaAdapter(r, expected, {});
    record({ id: G + '-7', title: 'Pacote indisponível → navegação confirma limite → integral', status: x.status === 'integral' ? 'PASS' : 'FAIL', detail: `status=${x.status} endOk=${x.validation && x.validation.endOk} packageUsed=${x.structural.packageUsed}` });
  }

  // E-8: conteúdo atualizado antes de a identidade ser confirmada (documento errado) → não associa.
  {
    // O doc ativo é o capítulo 2 (identidade errada) mas com texto "Capítulo 1";
    // sem navegação válida que mude o documento, NÃO pode ser confirmado como cap. 1.
    const r = new FakeEpubReader({ docs: [{ url: docUrl('Text/ch02.xhtml'), text: 'Capítulo 1 ' + makeText('errado') }], packageRes: { ok: false, reason: 'x' }, chapterNav: { 1: 0, 2: 0 } });
    const x = await books.extractEpubViaAdapter(r, expected, {});
    record({ id: G + '-8', title: 'Texto do cap. 1 mas identidade de documento do cap. 2 → não integral', status: x.status !== 'integral' ? 'PASS' : 'FAIL', detail: `status=${x.status} chapterOk=${x.validation && x.validation.chapterOk}` });
  }
}

// ==================== Orquestração PAGEID de produção (5.2) ====================

// Driver pageid SIMULADO com script de estado (permite induzir corridas C/D).
class ScriptedPageidDriver {
  constructor({ stateSeq, frames, chapterPages = {}, nextResult = true }) {
    this.stateSeq = stateSeq || [() => ({ pageid: 22, printed: 45 })];
    this.stateCall = 0;
    this.framesFn = frames;
    this.toc = chapterPages;
    this.nextResult = nextResult;
  }
  async state() { const f = this.stateSeq[Math.min(this.stateCall, this.stateSeq.length - 1)]; this.stateCall++; return f(); }
  async frames() { return typeof this.framesFn === 'function' ? this.framesFn() : this.framesFn; }
  async next() { return this.nextResult; }
  async chapterPages() { return this.toc; }
}

function P(text, pageid = 0) {
  return { identity: { pageid, pages: pageid }, active: true, text, chars: text.length, hash: sha(text.trim()), frameId: pageid };
}

async function testPageidProduction() {
  const G = 'P';
  const expected = { book: 'F', chapter: 1 };

  // P-1 (Caso F): pageid ZERO é identidade válida e preservada.
  {
    const txt = makeText('zero');
    const drv = new ScriptedPageidDriver({ stateSeq: [() => ({ pageid: 0, printed: 23 })], frames: [P(txt, 0)], chapterPages: { 1: 23, 2: 46 } });
    const x = await books.extractPageidViaSync(drv, expected, { maxPages: 3 });
    const pid0 = x.audit.some((a) => a.pageid === 0 && a.status === 'accepted');
    record({ id: G + '-1', title: 'PAGEID zero aceito como identidade válida', status: x.pages === 1 && pid0 && x.text.includes('zero') ? 'PASS' : 'FAIL', detail: `pages=${x.pages} pid0Accepted=${pid0} status=${x.status}` });
  }

  // P-2 (Caso C): estado "pisca" 45→46→45 entre leituras → descarta a tentativa
  // inconsistente e captura a página 45 quando o estado assenta.
  {
    const t45 = makeText('p45');
    const seq = [() => ({ pageid: 45, printed: 23 }), () => ({ pageid: 46, printed: 24 }), () => ({ pageid: 45, printed: 23 }), () => ({ pageid: 45, printed: 23 }), () => ({ pageid: 45, printed: 23 })];
    const drv = new ScriptedPageidDriver({ stateSeq: seq, frames: [P(t45, 45)], chapterPages: { 1: 23, 2: 46 } });
    const x = await books.extractPageidViaSync(drv, expected, { maxPages: 3 });
    record({ id: G + '-2', title: 'Estado muda entre leituras (Caso C) → descarta tentativa inconsistente', status: x.discardedCount >= 1 && x.pages === 1 && x.text.includes('p45') ? 'PASS' : 'FAIL', detail: `discards=${x.discardedCount} pages=${x.pages} temP45=${x.text.includes('p45')}` });
  }

  // P-3 (Caso D): frame corresponde à página esperada, mas o estado muda DURANTE a
  // captura (st2→st3) → descarta a captura e re-sincroniza.
  {
    const t45 = makeText('p45');
    // syncCaptureFrame: st1=45, st2=45 (consistente), escolhe frame 45, st3=46 → descarta; depois assenta em 45
    const seq = [() => ({ pageid: 45, printed: 23 }), () => ({ pageid: 45, printed: 23 }), () => ({ pageid: 46, printed: 24 }), () => ({ pageid: 45, printed: 23 }), () => ({ pageid: 45, printed: 23 })];
    const drv = new ScriptedPageidDriver({ stateSeq: seq, frames: [P(t45, 45)], chapterPages: { 1: 23, 2: 46 } });
    const x = await books.extractPageidViaSync(drv, expected, { maxPages: 3 });
    record({ id: G + '-3', title: 'Estado muda durante a captura (Caso D) → captura descartada e re-sincronizada', status: x.discardedCount >= 1 && x.pages === 1 && x.text.includes('p45') ? 'PASS' : 'FAIL', detail: `discards=${x.discardedCount} pages=${x.pages} temP45=${x.text.includes('p45')}` });
  }

  // P-4 (Caso E): dois frames com identidade ambígua → falha conservadora.
  {
    const drv = new ScriptedPageidDriver({ stateSeq: [() => ({ pageid: 22, printed: 45 })], frames: [P(makeText('a'), 22), P(makeText('b'), 22)], chapterPages: { 1: 23, 2: 46 } });
    const x = await books.extractPageidViaSync(drv, expected, { maxPages: 3 });
    record({ id: G + '-4', title: 'Dois frames com identidade ambígua (Caso E) → conservador', status: x.ambiguousCount >= 1 && x.status !== 'integral' ? 'PASS' : 'FAIL', detail: `ambiguous=${x.ambiguousCount} status=${x.status}` });
  }
}

(async () => {
  testEpubStructure();
  await testEpubProduction();
  await testPageidProduction();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results: results.map((r) => ({ ...r, title: sanitizeDetail(r.title), detail: sanitizeDetail(r.detail) })), summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO PRODUÇÃO ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
  // limpeza
  for (const d of [dirEpub2, dirEpub3, dirSub, dirCollision, dirBad]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

