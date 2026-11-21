const fs = require('fs');
const path = require('path');
const books = require('../src/extract/books');

// Testes de ADAPTADOR DOM (§9): as funções REAIS de produção
// (readPearsonTocFromPage + tryPearsonAutomation com o driver real win.evaluate)
// executadas sobre um DOM simulado mínimo (sem dependências novas — shim
// próprio). Não substitui sessão real no Electron (registrada como pendente);
// fecha parte da diferença entre orquestrador com driver falso e aplicação.

const OUT = path.join(__dirname, '..', 'audit-temp', 'PEARSON_ADAPTER_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}
const ok = (c) => (c ? 'PASS' : 'FAIL');
const TXT = (n) => `Pagina ${n}: empreendedorismo e gestão sustentável exigem planejamento cuidadoso do ciclo de inovação nas organizações contemporâneas, com foco no empreendedor social e local.`;

// ---- DOM simulado mínimo ----

function simpleMatch(el, s) {
  s = s.trim();
  const ci = / i$/i.test(s);
  if (ci) s = s.slice(0, -2);
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9-]*)?(?:#([\w-]+))?(?:\.([\w.-]+))?(?:\[(.+?)\])?$/);
  if (!m) return false;
  const [, tag, id, cls, attr] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (id && el.id !== id) return false;
  if (cls) {
    const c = String(el.className || '').split(/\s+/);
    for (const want of cls.split('.')) if (!c.includes(want)) return false;
  }
  if (attr) {
    const am = attr.match(/^([\w-]+)(?:([~^]?=)(.*))?$/);
    if (!am) return false;
    const [, name, op, raw] = am;
    const val = el.getAttribute(name);
    if (val == null) return false;
    if (op) {
      const v = String(raw || '').replace(/^"|"$/g, '');
      if (op === '=' && (ci ? String(val).toLowerCase() !== v.toLowerCase() : val !== v)) return false;
      if (op === '^=' && !String(val).startsWith(v)) return false;
    }
  }
  return true;
}

function matchAll(root, sel) {
  const out = [];
  const chains = String(sel || '').split(',').map((c) => c.trim().split(/\s+/)).filter(Boolean);
  const walk = (el, chain, idx) => {
    for (const c of el.children || []) {
      if (simpleMatch(c, chain[idx])) {
        if (idx === chain.length - 1) out.push(c);
        else walk(c, chain, idx + 1);
      } else {
        walk(c, chain, idx);
      }
    }
  };
  for (const chain of chains) walk(root, chain, 0);
  return out;
}

function mkEl(tag, props = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    id: props.id || '',
    className: props.className || '',
    attrs: props.attrs || {},
    children: props.children || [],
    textContent: props.text || '',
    innerText: props.text || '',
    clicked: false,
    getAttribute(n) {
      if (n === 'id') return this.id || null;
      if (n === 'class') return this.className || null;
      return this.attrs[n] != null ? this.attrs[n] : null;
    },
    querySelector(sel) { return matchAll(this, sel)[0] || null; },
    querySelectorAll(sel) { return matchAll(this, sel); },
    click() { this.clicked = true; },
  };
  return el;
}

// Instala o DOM como globais (as funções reais usam document/window/Event...).
function installDom(body) {
  global.document = {
    body,
    querySelector(s) { return matchAll(document.body, s)[0] || null; },
    querySelectorAll(s) { return matchAll(document.body, s); },
    getElementById(id) { return matchAll(document.body, '#' + id)[0] || null; },
  };
  global.HTMLInputElement = { prototype: {} };
  Object.defineProperty(global.HTMLInputElement.prototype, 'value', {
    get() { return this._value || ''; },
    set(v) { this._value = String(v); },
  });
  global.window = { HTMLInputElement: global.HTMLInputElement };
  global.Event = class { constructor(type, o) { this.type = type; this.bubbles = !!(o && o.bubbles); } };
  global.location = { href: 'https://ava.exemplo/leitor?code=abc123' };
}

// DOM do leitor Beta: seleção + sumário + navegação + imagens.
function betaDom({ chapterStart, chapterEnd }) {
  const input = mkEl('input', { id: 'input-navigate-read' });
  input._value = String(chapterStart);
  // accessor PRÓPRIO: as funções reais leem `inp.value`; o setter programático
  // usa HTMLInputElement.prototype.value.set.call(inp, ...) → grava _value.
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return this._value || ''; },
    set(v) { this._value = String(v); },
  });
  const ex = mkEl('div', { id: 'ExibicaoAtual', text: 'Página ' + chapterStart });
  const imgs = [mkEl('img', { className: 'PdfImageView_pageImage__x', attrs: { alt: TXT(chapterStart) } })];
  const items = [];
  const entryPages = { 0: chapterStart, 1: chapterEnd };
  for (let i = 0; i < 2; i++) {
    const it = mkEl('button', {
      id: 'summary-item-' + i,
      text: 'item ' + i,
      attrs: { 'aria-label': i === 0 ? 'Unidade 1: Fundamentos' : 'Unidade 2: Prática' },
    });
    // Simula o leitor: clicar no item navega (input/ExibicaoAtual/imagens).
    it.click = function () {
      this.clicked = true;
      const p = entryPages[i];
      input._value = String(p);
      ex.textContent = 'Página ' + p;
      imgs[0].attrs.alt = TXT(p);
    };
    items.push(it);
  }
  // Navegar pelo input também atualiza o leitor (dispatch dispara a mudança).
  input.dispatchEvent = function (ev) {
    if (ev && ev.type === 'change') {
      ex.textContent = 'Página ' + this._value;
      imgs[0].attrs.alt = TXT(parseInt(this._value, 10));
    }
  };
  const body = mkEl('body', {
    text: 'Escolha o leitor. Unidade 1: Fundamentos. Página ' + chapterStart,
    children: [
      mkEl('button', { id: 'pdf-novo', text: 'Leitor Beta' }),
      ...items,
      input,
      ex,
      ...imgs,
    ],
  });
  return { body, input, ex, imgs, items };
}

// XHR simulado para o fetchPaginationPage do driver real (Clássico).
function installXhrClassic() {
  global.XMLHttpRequest = class {
    open(m, u) { this._u = u; }
    send() {
      const m = String(this._u || '').match(/page=(\d+)/);
      const p = m ? parseInt(m[1], 10) : 0;
      this.status = 200;
      this.readyState = 4;
      this.responseURL = this._u || '';
      this.responseText = '<div id="divBookMark" aria-label="' + TXT(p) + '"></div>';
      this.onload();
    }
  };
  global.DOMParser = class {
    parseFromString(html) {
      const text = (String(html || '').match(/aria-label="([^"]*)"/) || [])[1] || '';
      return {
        querySelector: (sel) => (sel === '#divBookMark'
          ? mkEl('div', { id: 'divBookMark', attrs: { 'aria-label': text } })
          : null),
      };
    }
  };
}

// win falso: executa as funções reais contra o DOM global atual (1 argumento).
function fakeWin({ waitForTimeout }) {
  return {
    evaluate: (fn, arg) => Promise.resolve(fn(arg)),
    waitForTimeout: waitForTimeout ? waitForTimeout : async () => {},
  };
}

(async () => {
  // A1 — readPearsonTocFromPage Beta: itens #summary-item-N lidos direto.
  {
    const { body } = betaDom({ chapterStart: 3, chapterEnd: 8 });
    installDom(body);
    const attempts = [];
    const items = await books.readPearsonTocFromPage(fakeWin({}), true, attempts);
    const good = Array.isArray(items) && items.length === 2
      && items[0].id === 'summary-item-0' && items[0].aria === 'Unidade 1: Fundamentos'
      && items[1].id === 'summary-item-1';
    record({ id: 'A1', title: 'readPearsonTocFromPage (Beta) le os itens reais do sumario', status: ok(good), detail: `items=${items ? items.length : null}` });
  }

  // A2 — readPearsonTocFromPage Beta sem itens: abre o sumário e relê
  // (lógica de duas etapas do adaptador real).
  {
    const { body } = betaDom({ chapterStart: 3, chapterEnd: 8 });
    const opener = mkEl('button', { id: 'summary-btn', text: 'Sumário' });
    installDom(mkEl('body', { children: [opener] }));
    const attempts = [];
    let opened = false;
    const win = { evaluate: (fn, arg) => Promise.resolve(fn(arg)), waitForTimeout: async () => {} };
    // Simula o DOM mudando APÓS o clique de abertura (entre os dois evaluates).
    let first = true;
    win.evaluate = async (fn, arg) => {
      if (!first) { document.body = body; opened = true; }
      first = false;
      return fn(arg);
    };
    const read = await books.readPearsonTocFromPage(win, true, attempts);
    const good = opened && Array.isArray(read) && read.length === 2 && opener.clicked;
    record({ id: 'A2', title: 'readPearsonTocFromPage abre o sumario e relê (duas etapas)', status: ok(good), detail: `items=${read ? read.length : null} abriu=${opener.clicked}` });
  }

  // A3 — fluxo COMPLETO do adaptador real (tryPearsonAutomation): seleção
  // #pdf-novo → sumário → localização → navegação com confirmação → extração.
  {
    const { body, input } = betaDom({ chapterStart: 3, chapterEnd: 8 });
    installDom(body);
    const attempts = [];
    const r = await books.tryPearsonAutomation({
      app: { windows: () => [] },
      win: fakeWin({}),
      expected: { chapter: 'Unidade 1: Fundamentos' },
      opts: { attempts, pearsonMaxPages: 20 },
    });
    const good = r && r.ok === true && r.status === 'integral' && r.reader === 'beta'
      && r.pagesExtracted === 5 && r.pageStart === 3 && r.pageEnd === 8
      && (r.text || '').includes('Pagina 3:') && (r.text || '').includes('Pagina 7:')
      && itemsClicked(itemsOf(body), 0) && input._value === '7';
    record({ id: 'A3', title: 'Adaptador real (tryPearsonAutomation): fluxo Beta completo integral', status: ok(good), detail: `status=${r && r.status} failure=${r && r.failureType} pages=${r && r.pagesExtracted} attempts=${JSON.stringify(r && r.attempts)}` });
  }

  // A4 — Clássico: fluxo completo com XHR de paginação simulado (#divBookMark).
  {
    const { body } = betaDom({ chapterStart: 3, chapterEnd: 8 });
    installDom(body);
    installXhrClassic();
    // Remove os itens Beta: o leitor Clássico usa section.sumario li.box-capt.
    body.children = body.children.filter((c) => !/^summary-item-/.test(c.id || ''));
    body.children.push(
      mkEl('button', { id: 'pdf', text: 'Leitor Clássico' }),
      mkEl('a', { className: 'menu-links btn-sumario', text: 'Sumário' }),
      mkEl('section', {
        className: 'sumario',
        children: [mkEl('ul', {
          children: [5, 9].map((pg, i) => mkEl('li', {
            className: 'box-capt',
            attrs: { 'data-pagina': String(pg) },
            children: [mkEl('p', { id: i === 0 ? 'Unidade 1: Fundamentos' : 'Unidade 2: Prática', text: i === 0 ? 'Unidade 1: Fundamentos' : 'Unidade 2: Prática' })],
          })),
        })],
      })
    );
    const attempts = [];
    const r = await books.tryPearsonAutomation({
      app: { windows: () => [] },
      win: fakeWin({}),
      expected: { chapter: 'Unidade 1: Fundamentos' },
      opts: { attempts, pearsonMaxPages: 20, preferred: 'classic' },
    });
    const good = r && r.ok === true && r.status === 'integral' && r.reader === 'classic'
      && r.pagesExtracted === 4 && (r.text || '').includes('Pagina 5:') && (r.text || '').includes('Pagina 8:');
    record({ id: 'A4', title: 'Adaptador real Clássico: XHR pagination + #divBookMark integral', status: ok(good), detail: `status=${r && r.status} failure=${r && r.failureType} pages=${r && r.pagesExtracted} reader=${r && r.reader}` });
  }

  // A5 — rodada final: baseline de janelas capturado ANTES da seleção. Um popup
  // aberto pelo Beta é fechado no fallback; as duas janelas preexistentes
  // permanecem; as operações do leitor usam a janela do popup.
  {
    const { body } = betaDom({ chapterStart: 3, chapterEnd: 8 });
    installDom(body);
    const img = body.querySelector('img');
    const origGet = img.getAttribute.bind(img);
    img.getAttribute = (n) => (n === 'alt' ? '' : origGet(n)); // Beta falha: sem conteúdo útil
    const main = { evaluate: (fn, arg) => Promise.resolve(fn(arg)), waitForTimeout: async () => {} };
    const other = { id: 'preexistente', close: async () => { other.closed = true; } };
    let popupCalls = 0;
    const popup = {
      evaluate: (fn, arg) => { popupCalls++; return Promise.resolve(fn(arg)); },
      waitForTimeout: async () => {},
      close: async () => { popup.closed = true; },
    };
    const windows = [main, other];
    const app = { windows: () => windows.filter((w) => !w.closed) };
    const evaluateMain = (fn, arg) => {
      const r = fn(arg);
      if (String(fn).includes('pdf-novo') && !windows.includes(popup)) windows.push(popup);
      return Promise.resolve(r);
    };
    const r = await books.tryPearsonAutomation({
      app,
      win: { evaluate: evaluateMain, waitForTimeout: async () => {} },
      expected: { chapter: 'Unidade 1: Fundamentos' },
      opts: {},
    });
    const good = popup.closed === true && other.closed !== true && popupCalls > 0
      && app.windows().includes(other) && !app.windows().includes(popup)
      && r && String(r.failureType || '').startsWith('pearson-falhou-')
      && r.attempts.some((a) => a.startsWith('fallback-unico='));
    record({ id: 'A5', title: 'Baseline real: fecha so o popup do Beta no fallback, preserva preexistentes', status: ok(good), detail: `popupClosed=${popup.closed} popupCalls=${popupCalls} outras=${app.windows().length} failure=${r && r.failureType}` });
  }

  function itemsOf(body) { return matchAll(body, 'button[id^="summary-item-"]'); }
  function itemsClicked(items, i) { return !!(items[i] && items[i].clicked); }

  const fails = results.filter((r) => r.status !== 'PASS').length;
  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
  console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
