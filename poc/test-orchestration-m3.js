const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const books = require('../src/extract/books');

// Testes de ORQUESTRAÇÃO do VitalSource (estabilização):
//   - um lançamento inicial por livro;
//   - detectFormat observa o leitor já aberto (sem navegar);
//   - extractEpub/extractPageid reutilizam o leitor (sem goto redundante);
//   - reader-auth → interrompe imediatamente (zero retries/relaunches/extração);
//   - unknown → espera e reavalia sem navegar; no máximo UM relaunch;
//   - relaunch que vira reader-auth → interrompe;
//   - failureType diferencia reader-auth / no-frames / no-text / unknown /
//     timeout / network.
// Usa mocks determinísticos (app/frames/fetch simulados) — NÃO depende do
// VitalSource live. Verifica contagens reais de goto()/relaunch/extração.

const OUT = path.join(__dirname, '..', 'audit-temp', 'ORCHESTRATION_RESULTS.json');
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

// ==================== Mocks determinísticos ====================

function runInPage(fn, ctx, args) {
  const src = fn.toString();
  const names = Object.keys(ctx);
  const vals = names.map((n) => ctx[n]);
  const runner = new Function(...names, 'ARGS', `return (${src}).apply(null, ARGS);`);
  return runner(...vals, args || []);
}

class FakeFrame {
  constructor(o = {}) {
    this.urlValue = o.url || '';
    this.locationHref = o.locationHref;
    this.text = o.text || '';
    this.attrs = o.attrs || {};
    this.width = o.width || '';
    this.fetchMap = o.fetchMap || {};
  }
  url() { return this.urlValue; }
  async evaluate(fn, ...args) {
    const ctx = {
      window: { frameElement: { getAttribute: (n) => (n in this.attrs ? this.attrs[n] : null) } },
      location: { href: this.locationHref != null ? this.locationHref : this.urlValue },
      document: { body: { innerText: this.text }, querySelectorAll: () => [] },
      getComputedStyle: () => ({ width: this.width }),
      fetch: async (u) => {
        const hit = this.fetchMap[String(u)];
        if (hit == null) return { ok: false, status: 404, text: async () => '' };
        return { ok: true, status: 200, text: async () => String(hit) };
      },
    };
    return runInPage(fn, ctx, args);
  }
}

class FakeWindow {
  constructor(o = {}) {
    this.urlValue = o.url || '';
    this.titleValue = o.title || '';
    this.bodyText = o.bodyText || '';
    this.buttons = o.buttons || [];
    this._frames = o.frames || [];
    this.gotoCount = 0;
    this.lastGoto = null;
    this.onGoto = o.onGoto || null;
  }
  url() { return this.urlValue; }
  async title() { return this.titleValue; }
  frames() { return this._frames; }
  setFrames(f) { this._frames = f; }
  async goto(url, opts) {
    this.gotoCount++;
    this.lastGoto = url;
    if (this.onGoto) await this.onGoto(this, url);
    return true;
  }
  async evaluate(fn, ...args) {
    const self = this;
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
    return { first: () => ({ click: async () => { const b = this.buttons.find((x) => x.sel === sel); if (!b) throw new Error('not-found'); if (b.onClick) b.onClick(); return true; } }) };
  }
}

class FakeApp {
  constructor(o = {}) { this.wins = o.windows || []; }
  windows() { return this.wins; }
}

// ==================== Constantes ====================

const EPUB_URL = 'https://jigsaw.minhabiblioteca.com.br/books/B/epub/OEBPS/Text/ch01.xhtml?favre=brett';
const PAGEID_URL = (p) => `https://jigsaw.minhabiblioteca.com.br/books/B/pageid/${p}?brand=vitalsource&create=true`;
const SHELL_URL = (p) => `https://app.minhabiblioteca.com.br/reader/books/B/pageid/${p}`;

function epubFrame(text) { return new FakeFrame({ url: EPUB_URL, text, attrs: { src: EPUB_URL, scrolling: 'no' }, width: '663px' }); }
function pageidFrame(p, text) { const u = PAGEID_URL(p); return new FakeFrame({ url: u, text, attrs: { src: u, scrolling: 'no' }, width: '663px' }); }

// ==================== Testes ====================

async function testOrchestration() {
  const G = 'O';
  const baseOpts = { observeTimeoutMs: 400, observeInterval: 40, waitContentTimeoutMs: 200, retryWaitContentTimeoutMs: 150, waitTimeoutMs: 200 };

  // O-1: EPUB normal — 1 lançamento, sem goto redundante, extração roda.
  {
    const win = new FakeWindow({ url: EPUB_URL, frames: [epubFrame(makeText('doc1'))] });
    const app = new FakeApp({ windows: [win] });
    const r = await books.extractBook({ app, win, launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=B', expected: { book: 'B', chapter: 1 }, opts: baseOpts });
    const ok = win.gotoCount === 1 && r.format === 'epub' && r.status !== 'unknown' && !(r.attempts || []).some((a) => a.includes('relaunch'));
    record({ id: G + '-1', title: 'EPUB normal: 1 lançamento, sem relaunch, extração executada', status: ok ? 'PASS' : 'FAIL', detail: `goto=${win.gotoCount} format=${r.format} status=${r.status} attempts=${JSON.stringify((r.attempts || []).slice(-3))}` });
  }

  // O-2: PAGEID normal — 1 lançamento, reutiliza o leitor, extração roda.
  {
    const win = new FakeWindow({ url: SHELL_URL(0), bodyText: 'Página 1 / 10', frames: [pageidFrame(0, makeText('p0'))], buttons: [{ sel: 'button[aria-label="Seguinte"]', text: 'Seguinte', onClick: () => {} }] });
    const app = new FakeApp({ windows: [win] });
    const r = await books.extractBook({ app, win, launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=B', expected: { book: 'B', chapter: 1 }, opts: baseOpts });
    const ok = win.gotoCount === 1 && r.format === 'pageid' && r.pages >= 1;
    record({ id: G + '-2', title: 'PAGEID normal: 1 lançamento, reutiliza o leitor, coleta de páginas', status: ok ? 'PASS' : 'FAIL', detail: `goto=${win.gotoCount} format=${r.format} pages=${r.pages} status=${r.status}` });
  }

  // O-3: reader-auth — interrompe IMEDIATAMENTE (zero retries/relaunches/extração).
  {
    const win = new FakeWindow({ url: 'https://login.vitalsource.com/logout', title: 'Sessão expirada', frames: [] });
    const app = new FakeApp({ windows: [win] });
    const r = await books.extractBook({ app, win, launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=B', expected: { book: 'B', chapter: 1 }, opts: baseOpts });
    const ok = win.gotoCount === 1 && r.failureType === 'reader-auth' && r.readerLoaded === false && r.status === 'inaccessible' && !(r.attempts || []).some((a) => a.includes('relaunch'));
    record({ id: G + '-3', title: 'reader-auth → interrompe: zero retries/relaunches, readerLoaded=false', status: ok ? 'PASS' : 'FAIL', detail: `goto=${win.gotoCount} failureType=${r.failureType} readerLoaded=${r.readerLoaded}` });
  }

  // O-4: unknown que se recupera SEM relaunch (frames aparecem após 40ms).
  {
    const win = new FakeWindow({ url: EPUB_URL, frames: [] });
    win.onGoto = (w) => { setTimeout(() => { w.setFrames([epubFrame(makeText('doc1'))]); }, 40); };
    const app = new FakeApp({ windows: [win] });
    const r = await books.extractBook({ app, win, launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=B', expected: { book: 'B', chapter: 1 }, opts: baseOpts });
    const ok = win.gotoCount === 1 && r.format === 'epub' && !(r.attempts || []).some((a) => a.includes('relaunch'));
    record({ id: G + '-4', title: 'unknown que se recupera → extrai SEM relaunch', status: ok ? 'PASS' : 'FAIL', detail: `goto=${win.gotoCount} format=${r.format} failureType=${r.failureType}` });
  }

  // O-5: unknown persistente → exatamente UM relaunch e falha com failureType.
  {
    const win = new FakeWindow({ url: 'https://ava.univesp.br', frames: [] });
    const app = new FakeApp({ windows: [win] });
    const r = await books.extractBook({ app, win, launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=B', expected: { book: 'B', chapter: 1 }, opts: baseOpts });
    const ok = win.gotoCount === 2 && r.status === 'inaccessible' && r.failureType != null && !(r.attempts || []).some((a) => a.startsWith('classificacao=epub') || a.startsWith('classificacao=pageid'));
    record({ id: G + '-5', title: 'unknown persistente → exatamente 1 relaunch, sem extração', status: ok ? 'PASS' : 'FAIL', detail: `goto=${win.gotoCount} failureType=${r.failureType} attempts=${JSON.stringify((r.attempts || []))}` });
  }

  // O-6: logout APÓS o relaunch → interrompe (failureType reader-auth).
  {
    const win = new FakeWindow({ url: 'https://ava.univesp.br', frames: [] });
    win.onGoto = (w, url) => { if (w.gotoCount > 1) { w.urlValue = 'https://login.vitalsource.com/logout'; w.titleValue = 'Sessão expirada'; } };
    const app = new FakeApp({ windows: [win] });
    const r = await books.extractBook({ app, win, launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=B', expected: { book: 'B', chapter: 1 }, opts: baseOpts });
    const ok = win.gotoCount === 2 && r.failureType === 'reader-auth' && r.status === 'inaccessible';
    record({ id: G + '-6', title: 'logout após o relaunch → interrompe (reader-auth)', status: ok ? 'PASS' : 'FAIL', detail: `goto=${win.gotoCount} failureType=${r.failureType} status=${r.status}` });
  }

  // O-7: no-frames — janelas sem frames → failureType no-frames.
  {
    const win = new FakeWindow({ url: 'https://ava.univesp.br', frames: [] });
    const app = new FakeApp({ windows: [win] });
    const r = await books.extractBook({ app, win, launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=B', expected: { book: 'B', chapter: 1 }, opts: baseOpts });
    const ok = r.failureType === 'no-frames' && r.status === 'inaccessible';
    record({ id: G + '-7', title: 'no-frames → failureType no-frames (diferenciado)', status: ok ? 'PASS' : 'FAIL', detail: `failureType=${r.failureType} status=${r.status}` });
  }

  // O-8: no-text — frame epub presente mas sem texto → failureType no-text.
  {
    const win = new FakeWindow({ url: EPUB_URL, frames: [epubFrame('')] });
    const app = new FakeApp({ windows: [win] });
    const r = await books.extractBook({ app, win, launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=B', expected: { book: 'B', chapter: 1 }, opts: baseOpts });
    const ok = r.failureType === 'no-text' && r.status === 'inaccessible';
    record({ id: G + '-8', title: 'no-text (frame epub sem texto) → failureType no-text', status: ok ? 'PASS' : 'FAIL', detail: `failureType=${r.failureType} status=${r.status} error=${r.error}` });
  }
}

(async () => {
  await testOrchestration();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO ORQUESTRAÇÃO ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
