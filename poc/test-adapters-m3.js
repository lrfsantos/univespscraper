const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const books = require('../src/extract/books');
const ep = require('../src/extract/epub-structure');

// Testes de ADAPTADORES REAIS da Fase 3 (follow-up da revisão).
// Cobrem o fluxo que a auditoria apontou como não testado:
//   A) parsePackageFromXml direto (NCX / nav.xhtml / ambos / subdiretório /
//      fragmentos / hierarquia / ausente / malformado / sem duplicação);
//   B) fetchEpubPackageFromFetcher (núcleo DI do fetch do pacote: frame ->
//      OPF -> manifest -> navegação -> parser -> pacote estrutural);
//   C) createEpubReaderAdapter + fetchEpubPackageFromReader via app/frames
//      simulados (DOM/fetch fixture);
//   D) readPageidFrames + createPageidDriver via app/frames simulados, e
//      syncCaptureFrame rejeitando estado não confirmado.
// Nenhuma fixture equivale a validação real do VitalSource (declarado no
// relatório). Tudo sintético.

const OUT = path.join(__dirname, '..', 'audit-temp', 'ADAPTERS_RESULTS.json');
const results = [];
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');

const TMP_PREFIXES = [
  os.tmpdir(),
  os.tmpdir().replace(/\\/g, '/'),
  os.tmpdir().replace(/\\/g, '\\\\'),
  os.tmpdir().replace(/\\/g, '/').replace(/\//g, '\\/'),
];
function sanitize(s) {
  let out = String(s == null ? '' : s);
  for (const t of TMP_PREFIXES) out = out.split(t).join('<TEMP>');
  return out;
}
function record(entry) {
  results.push({ ...entry, title: sanitize(entry.title), detail: sanitize(entry.detail) });
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

const makeText = (label, paras = 12, words = 40) =>
  Array.from({ length: paras }, (_, i) => `${label} paragrafo ${i}: ` + Array.from({ length: words }, (_, j) => `palavra${i}_${j}`).join(' ')).join('\n\n');

// ==================== Infraestrutura de DOM/frames simulados ====================

function runInPage(fn, ctx, args) {
  const src = fn.toString();
  const names = Object.keys(ctx);
  const vals = names.map((n) => ctx[n]);
  const runner = new Function(...names, 'ARGS', `return (${src}).apply(null, ARGS);`);
  return runner(...vals, args || []);
}

class FakeFrame {
  constructor(opts = {}) {
    this.urlValue = opts.url || '';
    this.text = opts.text || '';
    this.attrs = opts.attrs || {};
    this.width = opts.width || '';
    this.fetchMap = opts.fetchMap || {};
    this.fetchCalls = [];
    this.buttons = opts.buttons || [];
  }
  url() { return this.urlValue; }
  setUrl(u) { this.urlValue = u; }
  async evaluate(fn, ...args) {
    const frameElement = { getAttribute: (n) => (n in this.attrs ? this.attrs[n] : null) };
    const ctx = {
      window: { frameElement },
      document: { body: { innerText: this.text }, querySelectorAll: () => [] },
      getComputedStyle: () => ({ width: this.width }),
      fetch: async (u) => {
        this.fetchCalls.push(String(u));
        const hit = this.fetchMap[String(u)];
        if (hit == null) return { ok: false, status: 404, text: async () => '' };
        if (typeof hit === 'object' && 'ok' in hit) return { ok: hit.ok, status: hit.status || (hit.ok ? 200 : 500), text: async () => String(hit.text || '') };
        return { ok: true, status: 200, text: async () => String(hit) };
      },
    };
    return runInPage(fn, ctx, args);
  }
}

class FakeWindow {
  constructor(opts = {}) {
    this.urlValue = opts.url || '';
    this.bodyText = opts.bodyText || '';
    this.buttons = opts.buttons || [];
    this._frames = opts.frames || [];
  }
  url() { return this.urlValue; }
  frames() { return this._frames; }
  async evaluate(fn, ...args) {
    const ctx = {
      document: {
        body: { innerText: this.bodyText },
        querySelectorAll: () => this.buttons.map((b) => ({ innerText: b.text, textContent: b.text, click: () => { if (b.onClick) b.onClick(); } })),
      },
      window: {},
      getComputedStyle: () => ({ width: '' }),
      fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    };
    return runInPage(fn, ctx, args);
  }
  locator(sel) {
    return {
      first: () => ({
        click: async () => {
          const b = this.buttons.find((x) => x.sel === sel);
          if (!b) throw new Error('not-found');
          if (b.onClick) b.onClick();
          return true;
        },
      }),
    };
  }
}

class FakeApp {
  constructor(opts = {}) { this.wins = opts.windows || []; }
  windows() { return this.wins; }
}

// ==================== Fixtures EPUB (strings) ====================

const OPF_BASE = 'https://jigsaw.minhabiblioteca.com.br/books/B/epub/OEBPS/';
const CONTENT_1 = OPF_BASE + 'Text/ch01.xhtml?favre=brett';

const OPF = (manifestItems, spineIds, spineToc) =>
  `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">F</dc:title></metadata><manifest>${manifestItems}</manifest><spine${spineToc ? ` toc="${spineToc}"` : ''}>${spineIds.map((i) => `<itemref idref="${i}"/>`).join('')}</spine></package>`;
const ITEM = (id, href, mt, props) => `<item id="${id}" href="${href}" media-type="${mt}"${props ? ` properties="${props}"` : ''}/>`;

const OPF2 = OPF([ITEM('ncx', 'toc.ncx', 'application/x-dtbncx+xml'), ITEM('ch1', 'Text/ch01.xhtml', 'application/xhtml+xml'), ITEM('ch2', 'Text/ch02.xhtml', 'application/xhtml+xml')], ['ch1', 'ch2'], 'ncx');
const NCX2 = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="c1"><navLabel><text>Capítulo 1</text></navLabel><content src="Text/ch01.xhtml"/>
    <navPoint id="c1s1"><navLabel><text>1.1 Subcapítulo</text></navLabel><content src="Text/ch01a.xhtml"/></navPoint>
  </navPoint>
  <navPoint id="c2"><navLabel><text>Capítulo 2</text></navLabel><content src="Text/ch02.xhtml"/></navPoint>
</navMap></ncx>`;

const OPF3 = OPF([ITEM('nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'), ITEM('ch1', 'Text/ch01.xhtml', 'application/xhtml+xml'), ITEM('ch2', 'Text/ch02.xhtml', 'application/xhtml+xml')], ['ch1', 'ch2']);
const NAV3 = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="toc"><ol>
    <li><a href="Text/ch01.xhtml#sec1">Capítulo 1</a><ol><li><a href="Text/ch01.xhtml#sec1-1">1.1 Subcapítulo</a></li></ol></li>
    <li><a href="Text/ch02.xhtml">Capítulo 2</a></li>
  </ol></nav>
  <nav epub:type="landmarks"><ol><li><a href="Text/ch01.xhtml">Começar</a></li></ol></nav>
</body></html>`;

const OPF3SUB = OPF([ITEM('nav', 'nav/nav.xhtml', 'application/xhtml+xml', 'nav'), ITEM('ch1', 'chapters/part1/c01.xhtml', 'application/xhtml+xml'), ITEM('ch2', 'chapters/part2/c02.xhtml', 'application/xhtml+xml')], ['ch1', 'ch2']);
const NAV3SUB = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="toc"><ol>
    <li><a href="../chapters/part1/c01.xhtml">Capítulo 1</a></li>
    <li><a href="../chapters/part2/c02.xhtml">Capítulo 2</a></li>
  </ol></nav></body></html>`;

const OPF_DIFFNAME = OPF([ITEM('nav', 'toc.xhtml', 'application/xhtml+xml', 'nav'), ITEM('ch1', 'Text/ch01.xhtml', 'application/xhtml+xml'), ITEM('ch2', 'Text/ch02.xhtml', 'application/xhtml+xml')], ['ch1', 'ch2']);
const OPF_NONAV = OPF([ITEM('ch1', 'Text/ch01.xhtml', 'application/xhtml+xml'), ITEM('ch2', 'Text/ch02.xhtml', 'application/xhtml+xml')], ['ch1', 'ch2']);
const OPF_INCOMPLETE = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><manifest><item id="ch1" href="Text/ch01.xhtml" media-type="application/xhtml+xml"/></manifest><spine></spine></package>`;
const OPF_MIX = OPF([ITEM('ncx', 'toc.ncx', 'application/x-dtbncx+xml'), ITEM('nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'), ITEM('ch1', 'Text/ch01.xhtml', 'application/xhtml+xml'), ITEM('ch2', 'Text/ch02.xhtml', 'application/xhtml+xml')], ['ch1', 'ch2'], 'ncx');

const fmt = (nav) => JSON.stringify((nav || []).map((e) => ({ l: e.label, d: e.depth, h: e.href })));

const fetcherFrom = (map) => async (u) => {
  const hit = map[String(u)];
  if (hit == null) return { ok: false, status: 404 };
  if (typeof hit === 'object' && 'ok' in hit) return hit;
  return { ok: true, text: String(hit) };
};

// ==================== A) parsePackageFromXml direto ====================

function testParsePackage() {
  const G = 'A';
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF2, ncxXml: NCX2, baseUrl: OPF_BASE });
    const nav = p.pkg.nav;
    const ok = p.ok && nav.length === 3 && nav[0].depth === 0 && nav[1].depth === 1 && nav[2].depth === 0 && nav[0].label === 'Capítulo 1' && nav[1].label === '1.1 Subcapítulo' && nav[0].href === OPF_BASE + 'Text/ch01.xhtml';
    record({ id: G + '-1', title: 'Somente NCX → hierarquia e caminhos resolvidos', status: ok ? 'PASS' : 'FAIL', detail: fmt(nav) });
  }
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF3, navHtml: NAV3, baseUrl: OPF_BASE });
    const nav = p.pkg.nav;
    const noFrag = nav.every((e) => !String(e.href).includes('#'));
    const ok = p.ok && nav.length === 3 && nav[0].depth === 0 && nav[1].depth === 1 && noFrag && !nav.some((e) => e.label === 'Começar');
    record({ id: G + '-2', title: 'Somente nav.xhtml → toc (hierarquia), fragmentos removidos, landmarks ignorados', status: ok ? 'PASS' : 'FAIL', detail: fmt(nav) });
  }
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF_MIX, ncxXml: NCX2, navHtml: NAV3, baseUrl: OPF_BASE });
    const kinds = p.pkg.nav.map((e) => e.kind);
    const ok = p.ok && p.pkg.nav.length === 6 && kinds.filter((k) => k === 'ncx').length === 3 && kinds.filter((k) => k === 'nav').length === 3;
    record({ id: G + '-3', title: 'NCX + nav.xhtml simultâneos → ambos preservados (sem sobrescrita)', status: ok ? 'PASS' : 'FAIL', detail: `total=${p.pkg.nav.length} ncx=${kinds.filter((k) => k === 'ncx').length} nav3=${kinds.filter((k) => k === 'nav').length}` });
  }
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF3SUB, navHtml: NAV3SUB, baseUrl: OPF_BASE, navBase: OPF_BASE + 'nav/' });
    const ok = p.ok && p.pkg.nav.length === 2 && p.pkg.nav[0].href === OPF_BASE + 'chapters/part1/c01.xhtml';
    record({ id: G + '-4', title: 'nav.xhtml em subdiretório → hrefs resolvidos relativamente ao ARQUIVO de navegação', status: ok ? 'PASS' : 'FAIL', detail: fmt(p.pkg.nav) });
  }
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF3, navHtml: NAV3, baseUrl: OPF_BASE });
    const ok = p.ok && p.pkg.nav.every((e) => e.href && String(e.href).startsWith(OPF_BASE));
    record({ id: G + '-5', title: 'Caminho relativo ao OPF (Text/...) resolvido contra baseUrl', status: ok ? 'PASS' : 'FAIL', detail: fmt(p.pkg.nav) });
  }
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF3, navHtml: NAV3, baseUrl: OPF_BASE });
    const ok = p.ok && p.pkg.nav.every((e) => !String(e.href).includes('#'));
    record({ id: G + '-6', title: 'Fragmentos de URL removidos dos caminhos resolvidos', status: ok ? 'PASS' : 'FAIL', detail: fmt(p.pkg.nav) });
  }
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF2, ncxXml: NCX2, baseUrl: OPF_BASE });
    const nav = p.pkg.nav;
    const ok = nav.length === 3 && nav[0].depth === 0 && nav[1].depth === 1 && nav[2].depth === 0;
    record({ id: G + '-7', title: 'Hierarquia aninhada exata (profundidades e destinos por valor)', status: ok ? 'PASS' : 'FAIL', detail: fmt(nav) });
  }
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF_NONAV, baseUrl: OPF_BASE });
    const ok = p.ok && Array.isArray(p.pkg.nav) && p.pkg.nav.length === 0;
    record({ id: G + '-8', title: 'Sumário ausente → pacote ok, navegação vazia (sem limite confirmável)', status: ok ? 'PASS' : 'FAIL', detail: `nav.length=${p.pkg.nav.length}` });
  }
  {
    const p = ep.parsePackageFromXml({ opfXml: OPF2, navHtml: 'isto nao eh xml <nav', baseUrl: OPF_BASE });
    const ok = p.ok && Array.isArray(p.pkg.nav) && p.pkg.nav.length === 0;
    record({ id: G + '-9', title: 'Navegação malformada → pacote ok, navegação vazia (sem crash)', status: ok ? 'PASS' : 'FAIL', detail: `nav.length=${p.pkg.nav.length}` });
  }
  {
    // Conteúdo EPUB 3 entregue no campo ncxXml: navFromNcxXml não encontra navPoint ->
    // nada é tratado como NCX. É a prova de que nav3 NÃO pode ser silenciosamente
    // entregue ao parser NCX.
    const p = ep.parsePackageFromXml({ opfXml: OPF3, ncxXml: NAV3, baseUrl: OPF_BASE });
    const ok = p.ok && p.pkg.nav.length === 0;
    record({ id: G + '-10', title: 'Conteúdo nav.xhtml no campo NCX → NÃO é interpretado como NCX (vazio)', status: ok ? 'PASS' : 'FAIL', detail: `nav.length=${p.pkg.nav.length}` });
  }
  {
    // Sem duplicação estrutural: 3 li (1 aninhado) -> exatamente 3 entradas.
    const p = ep.parsePackageFromXml({ opfXml: OPF3, navHtml: NAV3, baseUrl: OPF_BASE });
    const ok = p.pkg.nav.length === 3;
    record({ id: G + '-11', title: 'collectNavList não duplica entradas em listas aninhadas (cada li uma vez)', status: ok ? 'PASS' : 'FAIL', detail: `nav.length=${p.pkg.nav.length} (esperado 3)` });
  }
}

// ==================== B) fetchEpubPackageFromFetcher (núcleo DI do pacote) ====================

async function testEpubAdapter() {
  const G = 'B';

  // B-1: EPUB 2 realista — OPF + NCX (spine toc descobre o NCX).
  {
    const map = { [OPF_BASE + 'content.opf']: OPF2, [OPF_BASE + 'toc.ncx']: NCX2 };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const ok = r.ok && r.navUsed === 'ncx' && r.navPresent && r.pkg.nav.length === 3 && r.pkg.spineToc === 'ncx' && r.pkg.nav[1].depth === 1;
    record({ id: G + '-1', title: 'EPUB 2 realista (OPF + NCX): localiza NCX pelo spine toc, hierarquia preservada', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} navUsed=${r.navUsed} nav=${r.pkg.nav.length} spineToc=${r.pkg.spineToc}` });
  }

  // B-2: EPUB 3 realista — OPF + nav.xhtml (properties="nav").
  {
    const map = { [OPF_BASE + 'content.opf']: OPF3, [OPF_BASE + 'nav.xhtml']: NAV3 };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const ok = r.ok && r.navUsed === 'nav3' && r.navPresent && r.pkg.nav.length === 3;
    record({ id: G + '-2', title: 'EPUB 3 realista (OPF + nav.xhtml): localiza nav por properties="nav"', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} navUsed=${r.navUsed} nav=${r.pkg.nav.length}` });
  }

  // B-3: EPUB 2 e EPUB 3 disponíveis simultaneamente — ambos preservados.
  {
    const map = { [OPF_BASE + 'content.opf']: OPF_MIX, [OPF_BASE + 'toc.ncx']: NCX2, [OPF_BASE + 'nav.xhtml']: NAV3 };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const kinds = r.pkg.nav.map((e) => e.kind);
    const ok = r.ok && r.ncxChars > 0 && r.navChars > 0 && r.pkg.nav.length === 6 && kinds.filter((k) => k === 'ncx').length === 3 && kinds.filter((k) => k === 'nav').length === 3;
    record({ id: G + '-3', title: 'EPUB 2 + EPUB 3 simultâneos → NCX e nav.xhtml preservados (sem sobrescrita, campos corretos)', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} ncxChars=${r.ncxChars} navChars=${r.navChars} total=${r.pkg.nav.length}` });
  }

  // B-4: EPUB 3 com nav em subdiretório — caminhos relativos ao ARQUIVO nav.
  {
    const map = { [OPF_BASE + 'content.opf']: OPF3SUB, [OPF_BASE + 'nav/nav.xhtml']: NAV3SUB };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const ok = r.ok && r.navUsed === 'nav3' && r.pkg.nav[0].href === OPF_BASE + 'chapters/part1/c01.xhtml';
    record({ id: G + '-4', title: 'EPUB 3 com nav em subdiretório → hrefs resolvidos ao diretório do nav', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} href=${r.pkg.nav[0].href}` });
  }

  // B-5: manifest aponta nome diferente de nav.xhtml (toc.xhtml com properties="nav").
  {
    const map = { [OPF_BASE + 'content.opf']: OPF_DIFFNAME, [OPF_BASE + 'toc.xhtml']: NAV3 };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const ok = r.ok && r.navUsed === 'nav3' && r.navPresent && r.pkg.nav.length === 3;
    record({ id: G + '-5', title: 'Manifest aponta para nome ≠ nav.xhtml (toc.xhtml, properties="nav")', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} navUsed=${r.navUsed} nav=${r.pkg.nav.length}` });
  }

  // B-6: manifest SEM navegação — pacote ok, mas navPresent=false.
  {
    const map = { [OPF_BASE + 'content.opf']: OPF_NONAV };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const ok = r.ok && !r.navPresent && r.navUsed === 'none' && r.pkg.nav.length === 0;
    record({ id: G + '-6', title: 'Manifest sem navegação → pacote ok, navegação vazia (limite não confirmável)', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} navUsed=${r.navUsed} navPresent=${r.navPresent}` });
  }

  // B-7: OPF válido mas nav inacessível (404) — navPresent=false, sem falsa confirmação.
  {
    const map = { [OPF_BASE + 'content.opf']: OPF3 };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const ok = r.ok && !r.navPresent && r.navUsed === 'none' && r.pkg.nav.length === 0;
    record({ id: G + '-7', title: 'OPF válido mas nav inacessível (404) → navegação vazia (conservador)', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} navUsed=${r.navUsed} navPresent=${r.navPresent}` });
  }

  // B-8: resposta HTTP inválida (OPF 500) — falha conservadora.
  {
    const map = { [OPF_BASE + 'content.opf']: { ok: false, status: 500, text: '' } };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const ok = !r.ok && r.reason === 'opf-indisponivel';
    record({ id: G + '-8', title: 'Resposta HTTP inválida (OPF 500) → opf-indisponivel', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} reason=${r.reason}` });
  }

  // B-9: pacote incompleto (OPF sem spine) — falha conservadora.
  {
    const map = { [OPF_BASE + 'content.opf']: OPF_INCOMPLETE };
    const r = await books.fetchEpubPackageFromFetcher(CONTENT_1, fetcherFrom(map));
    const ok = !r.ok && r.reason === 'opf-ausente-ou-invalido';
    record({ id: G + '-9', title: 'Pacote incompleto (OPF sem spine) → opf-ausente-ou-invalido', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} reason=${r.reason}` });
  }

  // ==================== C) createEpubReaderAdapter + fetchEpubPackageFromReader (app simulado) ====================
  const Gc = 'C';

  // C-1: adapter.fetchPackage() → fluxo completo frame->OPF->manifest->navegação->parser.
  {
    const frame = new FakeFrame({ url: CONTENT_1, text: makeText('doc1'), attrs: { src: CONTENT_1 }, width: '663px', fetchMap: { [OPF_BASE + 'content.opf']: OPF3, [OPF_BASE + 'nav.xhtml']: NAV3 } });
    const win = new FakeWindow({ url: OPF_BASE + 'Text/ch01.xhtml', frames: [frame], buttons: [] });
    const app = new FakeApp({ windows: [win] });
    const reader = books.createEpubReaderAdapter(app);
    const r = await reader.fetchPackage();
    const ok = r.ok && r.navUsed === 'nav3' && r.pkg.nav.length === 3;
    record({ id: Gc + '-1', title: 'createEpubReaderAdapter.fetchPackage() → fluxo real (frame, OPF, manifest, navegação, parser)', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} navUsed=${r.navUsed} nav=${r.pkg.nav.length}` });
  }

  // C-2: adapter.waitContent()/readActive() → documento ativo do frame EPUB.
  {
    const frame = new FakeFrame({ url: CONTENT_1, text: makeText('doc1'), attrs: { src: CONTENT_1 }, width: '663px' });
    const win = new FakeWindow({ url: OPF_BASE + 'Text/ch01.xhtml', frames: [frame], buttons: [] });
    const app = new FakeApp({ windows: [win] });
    const reader = books.createEpubReaderAdapter(app);
    const d = await reader.waitContent(5000);
    const a = await reader.readActive();
    const ok = !!d && d.url === CONTENT_1 && (d.text || '').length >= 500 && a.url === CONTENT_1;
    record({ id: Gc + '-2', title: 'createEpubReaderAdapter.waitContent/readActive → documento ativo com conteúdo', status: ok ? 'PASS' : 'FAIL', detail: `url=${d && d.url} chars=${d && (d.text || '').length}` });
  }

  // C-3: adapter.navigateChapter(2) → clica "Acesse Capítulo 2" no sumário.
  {
    const frame = new FakeFrame({ url: CONTENT_1, text: makeText('doc1'), attrs: { src: CONTENT_1 }, width: '663px' });
    const CONTENT_2 = OPF_BASE + 'Text/ch02.xhtml?favre=brett';
    let clicked = false;
    const win = new FakeWindow({ url: OPF_BASE + 'Text/ch01.xhtml', frames: [frame], buttons: [{ sel: '', text: 'Acesse Capítulo 2', onClick: () => { clicked = true; frame.setUrl(CONTENT_2); frame.text = makeText('doc2'); } }] });
    const app = new FakeApp({ windows: [win] });
    const reader = books.createEpubReaderAdapter(app);
    const okNav = await reader.navigateChapter(2);
    const ok = okNav === true && clicked;
    record({ id: Gc + '-3', title: 'createEpubReaderAdapter.navigateChapter → navega via sumário (Acesse Capítulo N)', status: ok ? 'PASS' : 'FAIL', detail: `clicked=${clicked} urlApos=${frame.urlValue}` });
  }

  // C-4: adapter.navigateNextDoc() → clica "Seguinte" e detecta a MUDANÇA do documento.
  {
    const frame = new FakeFrame({ url: CONTENT_1, text: makeText('doc1'), attrs: { src: CONTENT_1 }, width: '663px' });
    const CONTENT_2 = OPF_BASE + 'Text/ch01a.xhtml?favre=brett';
    const win = new FakeWindow({ url: OPF_BASE + 'Text/ch01.xhtml', frames: [frame], buttons: [{ sel: 'button[aria-label="Seguinte"]', text: 'Seguinte', onClick: () => setTimeout(() => { frame.setUrl(CONTENT_2); frame.text = makeText('doc1b'); }, 30) }] });
    const app = new FakeApp({ windows: [win] });
    const reader = books.createEpubReaderAdapter(app);
    const r = await reader.navigateNextDoc();
    const ok = r.changed === true && !!r.doc && r.doc.url === CONTENT_2;
    record({ id: Gc + '-4', title: 'createEpubReaderAdapter.navigateNextDoc → muda de documento (multi-XHTML)', status: ok ? 'PASS' : 'FAIL', detail: `changed=${r.changed} url=${r.doc && r.doc.url}` });
  }

  // C-5: adapter.expandToc() → clica "Expandir tudo".
  {
    const frame = new FakeFrame({ url: CONTENT_1, text: makeText('doc1'), attrs: { src: CONTENT_1 }, width: '663px' });
    let clicked = false;
    const win = new FakeWindow({ url: OPF_BASE + 'Text/ch01.xhtml', frames: [frame], buttons: [{ sel: 'button:has-text("Expandir tudo")', text: 'Expandir tudo', onClick: () => { clicked = true; } }] });
    const app = new FakeApp({ windows: [win] });
    const reader = books.createEpubReaderAdapter(app);
    const ok = await reader.expandToc();
    record({ id: Gc + '-5', title: 'createEpubReaderAdapter.expandToc → clica Expandir tudo', status: ok === true && clicked ? 'PASS' : 'FAIL', detail: `expandToc=${ok}` });
  }
}

// ==================== D) Adaptador PAGEID: readPageidFrames + createPageidDriver ====================

const SHELL = (p) => 'https://app.minhabiblioteca.com.br/reader/books/B/pageid/' + p;
const JIGSAW = (p) => 'https://jigsaw.minhabiblioteca.com.br/books/B/pageid/' + p + '?brand=vitalsource&create=true';
const PAGES_URL = (p) => 'https://jigsaw.minhabiblioteca.com.br/books/B/pages/' + p + '/content';

function pageidApp(pages) {
  let idx = 0;
  const frame = new FakeFrame({ url: JIGSAW(0), text: pages[0].text, attrs: { src: JIGSAW(0), scrolling: 'no' }, width: '663px' });
  const win = new FakeWindow({ url: SHELL(0), bodyText: 'Página ' + pages[0].printed + ' / 100', frames: [frame], buttons: [{ sel: 'button[aria-label="Seguinte"]', text: 'Seguinte', onClick: () => { idx = Math.min(idx + 1, pages.length - 1); frame.setUrl(JIGSAW(idx)); frame.text = pages[idx].text; win.bodyText = 'Página ' + pages[idx].printed + ' / 100'; win.urlValue = SHELL(idx); } }] });
  return new FakeApp({ windows: [win] });
}

async function testPageidAdapter() {
  const G = 'D';

  // D-1: URL de frame válida (jigsaw pageid) → incluído com identidade.
  {
    const frame = new FakeFrame({ url: JIGSAW(45), text: makeText('p45'), attrs: { src: JIGSAW(45), scrolling: 'no' }, width: '663px' });
    const app = new FakeApp({ windows: [new FakeWindow({ url: SHELL(45), frames: [frame], buttons: [] })] });
    const fr = await books.readPageidFrames(app);
    const ok = fr.length === 1 && fr[0].identity.pageid === 45 && fr[0].chars > 0;
    record({ id: G + '-1', title: 'readPageidFrames: URL de frame válida (jigsaw pageid) → identidade preservada', status: ok ? 'PASS' : 'FAIL', detail: `frames=${fr.length} pageid=${fr[0] && fr[0].identity.pageid}` });
  }

  // D-2: src válido mesmo com URL do frame neutra (about:blank) → incluído.
  {
    const frame = new FakeFrame({ url: 'about:blank', text: makeText('p45'), attrs: { src: JIGSAW(45), scrolling: 'no' }, width: '663px' });
    const app = new FakeApp({ windows: [new FakeWindow({ url: SHELL(45), frames: [frame], buttons: [] })] });
    const fr = await books.readPageidFrames(app);
    const ok = fr.length === 1 && fr[0].identity.pageid === 45;
    record({ id: G + '-2', title: 'readPageidFrames: src do iframe válido identifica o frame de conteúdo', status: ok ? 'PASS' : 'FAIL', detail: `frames=${fr.length} pageid=${fr[0] && fr[0].identity.pageid}` });
  }

  // D-3: frame shell/topo (URL do reader) → EXCLUÍDO.
  {
    const top = new FakeFrame({ url: SHELL(45), text: 'Minha Biblioteca', attrs: { src: '' }, width: '100%' });
    const app = new FakeApp({ windows: [new FakeWindow({ url: SHELL(45), frames: [top], buttons: [] })] });
    const fr = await books.readPageidFrames(app);
    const ok = fr.length === 0;
    record({ id: G + '-3', title: 'readPageidFrames: frame shell/topo (janela reader) NÃO é conteúdo', status: ok ? 'PASS' : 'FAIL', detail: `frames=${fr.length} (esperado 0)` });
  }

  // D-4: frame de conteúdo na forma pages/N/content → incluído.
  {
    const frame = new FakeFrame({ url: PAGES_URL(7), text: makeText('p7'), attrs: { src: '', scrolling: 'no' }, width: '663px' });
    const app = new FakeApp({ windows: [new FakeWindow({ url: SHELL(7), frames: [frame], buttons: [] })] });
    const fr = await books.readPageidFrames(app);
    const ok = fr.length === 1 && fr[0].identity.pages === 7;
    record({ id: G + '-4', title: 'readPageidFrames: forma pages/N/content reconhecida', status: ok ? 'PASS' : 'FAIL', detail: `frames=${fr.length} pages=${fr[0] && fr[0].identity.pages}` });
  }

  // D-5: dois frames com a MESMA identidade → ambos retornados (ambíguo na captura).
  {
    const a = new FakeFrame({ url: JIGSAW(22), text: makeText('a'), attrs: { src: JIGSAW(22), scrolling: 'no' }, width: '663px' });
    const b = new FakeFrame({ url: JIGSAW(22), text: makeText('b'), attrs: { src: JIGSAW(22), scrolling: 'yes' }, width: '100%' });
    const app = new FakeApp({ windows: [new FakeWindow({ url: SHELL(22), frames: [a, b], buttons: [] })] });
    const fr = await books.readPageidFrames(app);
    const ok = fr.length === 2 && fr.every((f) => f.identity.pageid === 22);
    record({ id: G + '-5', title: 'readPageidFrames: dois frames com a mesma identidade são retornados (ambíguo na captura)', status: ok ? 'PASS' : 'FAIL', detail: `frames=${fr.length}` });
  }

  // D-6: identidade PAGEID ZERO → aceita (não descartada por truthiness).
  {
    const frame = new FakeFrame({ url: JIGSAW(0), text: makeText('zero'), attrs: { src: JIGSAW(0), scrolling: 'no' }, width: '663px' });
    const app = new FakeApp({ windows: [new FakeWindow({ url: SHELL(0), frames: [frame], buttons: [] })] });
    const fr = await books.readPageidFrames(app);
    const ok = fr.length === 1 && fr[0].identity.pageid === 0;
    record({ id: G + '-6', title: 'readPageidFrames: identidade PAGEID zero aceita (== null, não truthiness)', status: ok ? 'PASS' : 'FAIL', detail: `frames=${fr.length} pageid=${fr[0] && fr[0].identity.pageid}` });
  }

  // D-7: identidade AUSENTE (frame não é de conteúdo) → excluído.
  {
    const frame = new FakeFrame({ url: 'https://jigsaw.minhabiblioteca.com.br/books/B/nav/toc.html', text: makeText('x'), attrs: { src: '' }, width: '100%' });
    const app = new FakeApp({ windows: [new FakeWindow({ url: SHELL(45), frames: [frame], buttons: [] })] });
    const fr = await books.readPageidFrames(app);
    const ok = fr.length === 0;
    record({ id: G + '-7', title: 'readPageidFrames: frame sem identidade (não-conteúdo) é excluído', status: ok ? 'PASS' : 'FAIL', detail: `frames=${fr.length} (esperado 0)` });
  }

  // D-8: frame de conteúdo SEM texto ainda → retornado com texto vazio (espera a atualização depois).
  {
    const frame = new FakeFrame({ url: JIGSAW(45), text: '', attrs: { src: JIGSAW(45), scrolling: 'no' }, width: '663px' });
    const app = new FakeApp({ windows: [new FakeWindow({ url: SHELL(45), frames: [frame], buttons: [] })] });
    const fr = await books.readPageidFrames(app);
    const ok = fr.length === 1 && fr[0].text === '' && fr[0].chars === 0;
    record({ id: G + '-8', title: 'readPageidFrames: frame sem texto retornado vazio (conteúdo atrasado é esperado na captura)', status: ok ? 'PASS' : 'FAIL', detail: `frames=${fr.length} chars=${fr[0] && fr[0].chars}` });
  }

  // D-9: createPageidDriver + extractPageidViaSync end-to-end (2 páginas capturadas).
  {
    const app = pageidApp([{ pageid: 0, printed: 23, text: makeText('p0') }, { pageid: 1, printed: 24, text: makeText('p1') }]);
    const driver = books.createPageidDriver(app);
    const x = await books.extractPageidViaSync(driver, { book: 'B', chapter: 1 }, { maxPages: 3 });
    const ok = x.pages === 2 && x.text.includes('p0') && x.text.includes('p1');
    record({ id: G + '-9', title: 'createPageidDriver + extractPageidViaSync: coleta real dos frames via app simulado', status: ok ? 'PASS' : 'FAIL', detail: `pages=${x.pages} discards=${x.discardedCount} pageids=${JSON.stringify(x.audit.filter((a) => a.status === 'accepted').map((a) => a.pageid))}` });
  }

  // D-10: estado do leitor AUSENTE não confirma captura mesmo com frame do pageid esperado.
  {
    const drv = {
      state: async () => ({ pageid: null, printed: null }),
      frames: async () => [{ identity: { pageid: 45, pages: 45 }, active: true, text: makeText('x'), chars: makeText('x').length, hash: sha(makeText('x').trim()), frameId: 45 }],
    };
    const s = await books.syncCaptureFrame(drv, { pageid: 45 }, null, 500);
    const ok = s.status !== 'captured' && s.discards > 0;
    record({ id: G + '-10', title: 'syncCaptureFrame: estado ausente NÃO confirma captura (frame do pageid esperado não basta)', status: ok ? 'PASS' : 'FAIL', detail: `status=${s.status} discards=${s.discards}` });
  }
}

// __CHUNK2__

(async () => {
  testParsePackage();
  await testEpubAdapter();
  await testPageidAdapter();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO ADAPTADORES ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
