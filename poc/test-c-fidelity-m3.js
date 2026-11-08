const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const books = require('../src/extract/books');

// Testes de REGRESSÃO das correções de fidelidade (Fase C):
//   C1) navigateEpubNextDoc — identidade/URL capturada ANTES do clique; novo
//       documento só é aceito se a identidade mudou (corrida);
//   C2) readEpubActiveDocument — NÃO seleciona só o frame com mais texto; vincula
//       ao documento ativo da janela; descarta sem identidade; ambíguo -> reliable:false;
//   C3) syncCaptureFrame — aceita identidade `pages/N/content` (identity.pages)
//       mesmo quando identity.pageid é null;
//   C4) limites configuráveis (maxDocAdvances/maxPages) são parâmetros e, ao
//       atingir o limite, o resultado é partial (nunca integral).
// Fixtures/DOM simulados; nada real; sem rede; determinístico.

const OUT = path.join(__dirname, '..', 'audit-temp', 'CFIDELITY_RESULTS.json');
const results = [];
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');
const TMP_PREFIXES = [os.tmpdir(), os.tmpdir().replace(/\\/g, '/'), os.tmpdir().replace(/\\/g, '\\\\')];
function sanitize(s) { let o = String(s == null ? '' : s); for (const t of TMP_PREFIXES) o = o.split(t).join('<TEMP>'); return o; }
function record(entry) {
  results.push({ ...entry, title: sanitize(entry.title), detail: sanitize(entry.detail) });
  console.log('[' + entry.status + '] ' + entry.id + ': ' + entry.title);
  if (entry.detail) console.log('    ', sanitize(entry.detail));
}

function runInPage(fn, ctx, args) {
  const src = fn.toString();
  const names = Object.keys(ctx);
  const vals = names.map((n) => ctx[n]);
  const runner = new Function(...names, 'ARGS', `return (${src}).apply(null, ARGS);`);
  return runner(...vals, args || []);
}

const OPF_BASE = 'https://jigsaw.minhabiblioteca.com.br/books/B/epub/OEBPS/';
const C1 = OPF_BASE + 'Text/ch01.xhtml?favre=brett';
const C2 = OPF_BASE + 'Text/ch02.xhtml?favre=brett';

const makeText = (label, paras = 12, words = 40) =>
  Array.from({ length: paras }, (_, i) => `${label} paragrafo ${i}: ` + Array.from({ length: words }, (_, j) => `palavra${i}_${j}`).join(' ')).join('\n\n');

class FakeFrame {
  constructor(o = {}) {
    this.urlValue = o.url || '';
    this.text = o.text || '';
    this.attrs = o.attrs || {};
    this.width = o.width || '';
    this.buttons = o.buttons || [];
  }
  url() { return this.urlValue; }
  setUrl(u) { this.urlValue = u; }
  async evaluate(fn, ...args) {
    const frameElement = { getAttribute: (n) => (n in this.attrs ? this.attrs[n] : null) };
    const ctx = {
      window: { frameElement },
      location: { href: this.urlValue },
      document: { body: { innerText: this.text }, querySelectorAll: () => [] },
      getComputedStyle: () => ({ width: this.width }),
    };
    return runInPage(fn, ctx, args);
  }
}

class FakeWindow {
  constructor(o = {}) { this.urlValue = o.url || ''; this._frames = o.frames || []; this.buttons = o.buttons || []; }
  url() { return this.urlValue; }
  frames() { return this._frames; }
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
  constructor(o = {}) { this.wins = o.windows || []; }
  windows() { return this.wins; }
}

(async () => {
  // ---- C1: navigateEpubNextDoc captura identidade ANTES do clique ----
  {
    const frame = new FakeFrame({ url: C1, text: makeText('doc1'), width: '663px' });
    const win = new FakeWindow({ url: OPF_BASE + 'Text/ch01.xhtml', frames: [frame], buttons: [{ sel: 'button[aria-label="Seguinte"]', text: 'Seguinte', onClick: () => setTimeout(() => { frame.setUrl(C2); frame.text = makeText('doc2'); }, 30) }] });
    const app = new FakeApp({ windows: [win] });
    const r = await books.navigateEpubNextDoc(app);
    const ok = r.changed === true && !!r.doc && r.doc.url === C2 && r.beforeUrl === C1;
    record({ id: 'C-1', title: 'C1: navigateEpubNextDoc captura identidade ANTES do clique e só aceita mudança verificável', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ changed: r.changed, beforeUrl: r.beforeUrl, doc: r.doc && r.doc.url }) });
  }

  // ---- C1 (corrida): clique sem mudança de documento -> changed:false ----
  {
    const frame = new FakeFrame({ url: C1, text: makeText('doc1'), width: '663px' });
    const win = new FakeWindow({ url: OPF_BASE + 'Text/ch01.xhtml', frames: [frame], buttons: [{ sel: 'button[aria-label="Seguinte"]', text: 'Seguinte', onClick: () => { /* não muda o documento */ } }] });
    const app = new FakeApp({ windows: [win] });
    const r = await books.navigateEpubNextDoc(app);
    const ok = r.changed === false;
    record({ id: 'C-1b', title: 'C1: clique sem mudança de documento NÃO é aceito como novo documento (corrida)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ changed: r.changed }) });
  }

  // ---- C2: frame antigo com MAIS texto não vence o documento ativo da janela ----
  {
    const oldFrame = new FakeFrame({ url: C2, text: makeText('doc_antigo_mais_texto', 40, 50), width: '663px' });
    const activeFrame = new FakeFrame({ url: C1, text: makeText('doc_ativo_menos_texto', 12, 20), width: '663px' });
    const win = new FakeWindow({ url: OPF_BASE + 'Text/ch01.xhtml', frames: [oldFrame, activeFrame] });
    const app = new FakeApp({ windows: [win] });
    const d = await books.readEpubActiveDocument(app);
    const ok = d && d.url === C1 && d.reliable === true && d.ambiguous === false;
    record({ id: 'C-2', title: 'C2: readEpubActiveDocument vincula ao documento ATIVO da janela (não só ao mais texto)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ url: d && d.url, doc: d && d.doc, reliable: d && d.reliable, chars: d && (d.text || '').length }) });
  }

  // ---- C2 (ambiguidade): dois documentos ativos sem casar com a janela -> reliable:false ----
  {
    const fA = new FakeFrame({ url: C1, text: makeText('docA', 12, 20), width: '663px' });
    const fB = new FakeFrame({ url: C2, text: makeText('docB', 12, 20), width: '663px' });
    const win = new FakeWindow({ url: 'https://app.minhabiblioteca.com.br/reader/books/B', frames: [fA, fB] });
    const app = new FakeApp({ windows: [win] });
    const d = await books.readEpubActiveDocument(app);
    // Ambos com conteúdo >= 500 e identidades divergentes, sem janela que case -> ambíguo
    const ok = d.ambiguous === true && d.reliable === false;
    record({ id: 'C-2b', title: 'C2: múltiplos documentos sem casar com a janela -> ambíguo (reliable:false, nunca integral)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ ambiguous: d.ambiguous, reliable: d.reliable }) });
  }

  // ---- C3: syncCaptureFrame aceita pages/N/content com identity.pageid null ----
  {
    const driver = {
      state: async () => ({ pageid: 7, printed: 23 }),
      frames: async () => [
        { url: 'https://jigsaw.minhabiblioteca.com.br/books/B/pages/7/content', src: 'https://jigsaw.minhabiblioteca.com.br/books/B/pages/7/content', identity: { pageid: null, pages: 7 }, active: true, text: makeText('pagina7'), chars: 400, hash: sha('pagina7'), frameId: 7 },
      ],
    };
    const s = await books.syncCaptureFrame(driver, { pageid: 7 }, null, 2000);
    const ok = s.status === 'captured' && s.frameId === 7 && (s.text || '').length > 0;
    record({ id: 'C-3', title: 'C3: syncCaptureFrame aceita identidade pages/N/content (pageid null) quando pages casa com a página esperada', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ status: s.status, frameId: s.frameId, chars: s.chars, reason: s.reason }) });
  }

  // ---- C4: maxDocAdvances configurável; ao atingir o limite sem fim confirmado -> parcial ----
  {
    // reader: capítulo com 2 docs esperados, mas o reader nunca avança -> limite.
    const mkReader = (max) => ({
      waitContent: async () => ({ url: C1, text: makeText('doc1') }),
      readActive: async () => ({ url: C1, text: makeText('doc1') }),
      navigateChapter: async () => true,
      navigateNextDoc: async () => ({ changed: false, doc: null, beforeUrl: C1 }),
      fetchPackage: async () => ({ ok: true, pkg: { spine: [], nav: [] }, pkgRes: { pkg: { spine: [], nav: [] } } }),
      expandToc: async () => true,
    });
    const r = await books.extractEpubViaAdapter(mkReader(1), { chapter: 1 }, { maxDocAdvances: 1 });
    const ok = r.status !== 'integral' && Array.isArray(r.attempts) && r.attempts.some((a) => /limite-maxDocAdvances|sem-mudanca/.test(a));
    record({ id: 'C-4', title: 'C4: limite configurável registrado; sem confirmação de fim -> não integral', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ status: r.status, attempts: r.attempts }) });
  }

  // ---- C4b: maxPages configurável no pageid ----
  {
    const mkDriver = (n) => ({
      state: async () => ({ pageid: 1, printed: 1 }),
      frames: async () => [{ url: 'https://jigsaw.minhabiblioteca.com.br/books/B/pageid/1', src: '', identity: { pageid: 1, pages: null }, active: true, text: makeText('p1'), chars: 400, hash: sha('p1'), frameId: 1 }],
      next: async () => true,
      chapterPages: async () => ({}),
    });
    const r = await books.extractPageidViaSync(mkDriver(1), { chapter: 1 }, { maxPages: 1 });
    const ok = r.maxPagesHit === true && r.status !== 'integral';
    record({ id: 'C-4b', title: 'C4: maxPages configurável; limite atingido registrado -> não integral', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ maxPagesHit: r.maxPagesHit, status: r.status, steps: r.steps }) });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO FIDELIDADE (C) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
