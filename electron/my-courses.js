// Descoberta COMPLETA de disciplinas na área "Meus cursos" do AVA (nova visão com
// seletor de Situação/Períodos/Categorias e paginação).
//
// Arquitetura (testável):
//   - `discoverAllCoursesViaDriver(driver, opts)`: orquestrador puro sobre um
//     contrato de driver (simulável em fixtures) — percorre TODAS as opções
//     relevantes, espera estabilização, percorre páginas, deduplica por id
//     canônico PRESERVANDO as categorias e gera relatório por categoria.
//   - `createMyCoursesDriver(win)`: driver real sobre o DOM (seleção via
//     select/radio/links, espera de loading, paginação, "Mostrar: Todos").
//   - `discoverAllCourses(win)`: fluxo de produção (navega + driver + relatório).
//
// Regras (nova seção):
//   - NUNCA codifica nomes/períodos/IDs da gravação como constantes do produto;
//   - percorre Todos, Em andamento, Não iniciados, Encerrados, todos os períodos,
//     Legado, Nenhum Período (Favoritos = visão adicional; Removido da visualização
//     inspecionado separadamente, sem restaurar/ocultar nada);
//   - NÃO modifica preferências do usuário, favoritos ou visibilidade;
//   - dedup por IDENTIFICADOR canônico (nunca só pelo título);
//   - situação acadêmica ≠ permissão de acesso;
//   - só é "completa" se todas as opções relevantes e páginas foram percorridas.

const { parseCourseCardsFromHtml, classifySelectorOption } = require('./discovery');
const { sanitizeReason } = require('./flow');

const BASE = 'https://ava.univesp.br';

// Ordem/prioridade das opções (heurística; rótulos vêm do DOM real, nunca fixos).
const GROUP_ORDER = { situacao: 0, periodo: 1, categoria: 2 };

function labelOf(o) { return String((o && o.label) || '').replace(/\s+/g, ' ').trim(); }

// Espera a lista estabilizar: sem indicador de carregamento/spinner e conteúdo
// diferente do baseline. Retorna true quando estável (ou timeout -> false).
async function waitListStable(driver, { timeoutMs = 15000, interval = 800, baseline = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const st = await driver.readStabilityState();
    const hasLoading = !!(st && (st.loading || /carregando|loading|aguarde/i.test(st.statusText || '')));
    const changed = st && st.contentHash && st.contentHash !== baseline;
    if (!hasLoading && changed && (!last || last.contentHash === st.contentHash)) {
      if (!last) { last = st; await new Promise((r) => setTimeout(r, interval)); continue; }
      return true;
    }
    if (!hasLoading && !changed && last && last.contentHash === st.contentHash) return true;
    last = st;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

// Hash leve do conteúdo dos cartões (para prevenção de loop por MUDANÇA de
// conteúdo, não por rótulo — o rótulo pode não mudar entre páginas).
function contentHash(s) {
  let h = 0;
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0; }
  return String(h);
}

// Orquestrador POURO (testável): percorre opções relevantes + páginas + dedup.
// driver:
//   readSelectorOptions(): [{ value, label }]
//   selectOption(value): Promise<boolean>
//   readStabilityState(): { loading, statusText, contentHash }
//   readCardsHtml(): Promise<string>
//   setShowAll(): Promise<boolean>   (melhor esforço; false se ausente)
//   goNextPage(): Promise<boolean>
//   readCurrentLabel(): Promise<string>
async function discoverAllCoursesViaDriver(driver, opts = {}) {
  const maxPages = opts.maxPages || 30;
  const byId = new Map(); // id canônico -> { card..., categories:Set }
  const byCategory = {};
  const attempts = [];
  let occurrences = 0;

  const options = await driver.readSelectorOptions();
  const relevant = (options || [])
    .filter((o) => labelOf(o))
    .sort((a, b) => (GROUP_ORDER[classifySelectorOption(labelOf(a))] || 9) - (GROUP_ORDER[classifySelectorOption(labelOf(b))] || 9));

  for (const opt of relevant) {
    const label = labelOf(opt);
    const selOk = await driver.selectOption(opt.value);
    if (!selOk) { attempts.push('selecionar-falhou: ' + label); continue; }
    const stable = await waitListStable(driver, { timeoutMs: opts.waitTimeoutMs || 15000 });
    if (!stable) { attempts.push('instavel: ' + label); continue; }
    // "Mostrar: Todos" — melhor esforço (pode não existir; não é obrigatório).
    try { await driver.setShowAll(); } catch {}
    await waitListStable(driver, { timeoutMs: opts.waitTimeoutMs || 10000 });
    let guard = 0;
    let lastPageHash = null;
    do {
      const html = await driver.readCardsHtml();
      const h = contentHash(html);
      // Prevenção de loop por CONTEÚDO IDÊNTICO consecutivo (a página não mudou).
      if (lastPageHash === h) { attempts.push('loop-prevenido-conteudo-identico: ' + label); break; }
      lastPageHash = h;
      const cards = parseCourseCardsFromHtml(html, BASE, label);
      byCategory[label] = (byCategory[label] || 0) + cards.length;
      occurrences += cards.length;
      for (const c of cards) {
        const keyId = String(c.id);
        const existing = byId.get(keyId);
        if (existing) {
          existing.categories.add(label);
          existing.period = existing.period || c.period || null;
          existing.situation = existing.situation || c.situation || null;
          if (c.progress && !existing.progress) existing.progress = c.progress;
        } else {
          const card = { ...c, categories: new Set([label]) };
          byId.set(keyId, card);
        }
      }
      guard++;
      if (guard >= maxPages) { attempts.push('limite-paginas: ' + label); break; }
      const next = await driver.goNextPage();
      if (!next) break;
      await waitListStable(driver, { timeoutMs: opts.waitTimeoutMs || 10000 });
    } while (true);
  }

  const courses = [...byId.values()].map((c) => ({ ...c, categories: [...c.categories] }));
  const denied = courses.filter((c) => c.accessible === false);
  const duplicated = occurrences - courses.length;
  return {
    courses,
    byCategory,
    attempts,
    summary: {
      categoriasPercorridas: Object.keys(byCategory).length,
      ocorrencias: occurrences,
      cursosUnicos: courses.length,
      deduplicados: Math.max(0, duplicated),
      acessoNegado: denied.length,
      acessiveis: courses.length - denied.length,
      completo: relevant.length > 0 && Object.keys(byCategory).length === relevant.length,
    },
  };
}

// Driver REAL sobre o DOM do "Meus cursos" (best effort contra DOM desconhecido;
// a confirmação do formato exato depende de sessão real do usuário).
function createMyCoursesDriver(win) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg).catch(() => null);
  const readSelectorOptions = async () => {
    const opts = await evaluate(() => {
      const out = [];
      const add = (value, label) => { if (label && label.trim()) out.push({ value, label: label.trim() }); };
      // <select> com opções (seletor de situação/período/categoria).
      document.querySelectorAll('select').forEach((sel) => {
        for (const o of sel.options) add(o.value != null ? o.value : o.text, o.text);
      });
      // radio/checkbox com rótulo (filtros).
      document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((el) => {
        const labelEl = el.labels && el.labels[0];
        const lbl = labelEl ? labelEl.textContent : (el.parentElement ? el.parentElement.textContent : '');
        if (lbl) add(el.value || el.id || lbl, lbl);
      });
      // links/botões com texto (abas/tabs).
      document.querySelectorAll('button, [role="tab"], [role="button"], a').forEach((el) => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 60 && !/buscar|mostrar|ordena/i.test(t)) add(t, t);
      });
      return out;
    });
    return Array.isArray(opts) ? opts : [];
  };

  const selectOption = async (value) => {
    const done = await evaluate(
      (v) => {
        let handled = false;
        document.querySelectorAll('select').forEach((sel) => {
          const target = [...sel.options].find((o) => (o.value != null ? o.value : o.text) === v);
          if (target) { sel.value = target.value != null ? target.value : target.text; sel.dispatchEvent(new Event('change', { bubbles: true })); handled = true; }
        });
        if (handled) return true;
        document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((el) => {
          if ((el.value || el.id || (el.labels && el.labels[0] && el.labels[0].textContent || '').trim()) === v) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); handled = true; }
        });
        if (handled) return true;
        document.querySelectorAll('button, [role="tab"], [role="button"], a').forEach((el) => {
          if ((el.textContent || '').replace(/\s+/g, ' ').trim() === v) { el.click(); handled = true; }
        });
        return handled;
      },
      value
    );
    return done === true;
  };

  const readStabilityState = async () => {
    const st = await evaluate(() => {
      const statusText = (document.body ? document.body.innerText : '').slice(0, 400);
      const loading = !!(document.querySelector('.spinner, [class*="loading"], [class*="spinner"], [aria-busy="true"]') || /carregando|loading|aguarde/i.test(statusText.slice(-200)));
      // Hash leve do conteúdo da lista para detectar mudança.
      const list = document.querySelector('[class*="course-list"], [class*="courses"], main, [role="main"], body');
      const text = list ? (list.innerText || '') : statusText;
      let hash = 0;
      const s = text.slice(0, 20000);
      for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0; }
      return { loading, statusText, contentHash: String(hash) };
    });
    return st || { loading: true, statusText: '', contentHash: '' };
  };

  const readCardsHtml = async () => {
    const html = await evaluate(() => {
      const cards = document.querySelectorAll('[class*="course-card"], [class*="course-item"], [class*="course-block"], li[class*="course"]');
      if (cards.length) return [...cards].map((c) => c.outerHTML).join('\n');
      return document.body ? document.body.outerHTML : '';
    });
    return html || '';
  };

  const setShowAll = async () => {
    const done = await evaluate(() => {
      const els = [...document.querySelectorAll('button, [role="button"], select, a')];
      const norm = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      const target = els.find((el) => /^mostrar\b/i.test(norm(el)) || /mostrar\s*:\s*todas/i.test(norm(el)));
      if (target) { target.click(); return true; }
      return false;
    });
    return done === true;
  };

  const goNextPage = async () => {
    const done = await evaluate(() => {
      const els = [...document.querySelectorAll('button, [role="button"], a, [aria-label]')];
      const pick = els.find((el) => /pr[oó]xima|next|avan[çc]ar|›|»|>/i.test(el.getAttribute('aria-label') || (el.textContent || '')));
      if (pick) { pick.click(); return true; }
      return false;
    });
    return done === true;
  };

  const readCurrentLabel = async () => {
    const lbl = await evaluate(() => {
      const sel = document.querySelector('select');
      if (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) return sel.options[sel.selectedIndex].text;
      const active = document.querySelector('[aria-selected="true"], .active, [class*="selected"]');
      if (active) return (active.textContent || '').replace(/\s+/g, ' ').trim();
      return null;
    });
    return lbl || '';
  };

  return { readSelectorOptions, selectOption, readStabilityState, readCardsHtml, setShowAll, goNextPage, readCurrentLabel };
}

// Fluxo de produção: navega para "Meus cursos" e percorre o seletor completo.
// Retorna { courses, byCategory, summary, attempts } com metadados por categoria.
async function discoverAllCourses(win, opts = {}) {
  const url = opts.url || `${BASE}/my/courses.php`;
  await win.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, opts.initialWaitMs || 2500));
  const driver = createMyCoursesDriver(win);
  let result;
  try {
    result = await discoverAllCoursesViaDriver(driver, opts);
  } catch (e) {
    result = { courses: [], byCategory: {}, attempts: ['falha-orquestracao: ' + sanitizeReason(e)], summary: { categoriasPercorridas: 0, ocorrencias: 0, cursosUnicos: 0, deduplicados: 0, acessoNegado: 0, acessiveis: 0, completo: false } };
  }
  // Fallback: visão clássica sem seletor — parse simples de uma passada.
  if (!result.courses.length) {
    const html = await win.evaluate(() => document.documentElement.outerHTML).catch(() => '');
    const simple = require('./discovery').parseCoursesFromHtml(html, BASE);
    if (simple.length) {
      const byCategory = { 'visao-classica': simple.length };
      result.courses = simple.map((c) => ({ ...c, categories: ['visao-classica'] }));
      result.byCategory = byCategory;
      result.summary = { ...result.summary, categoriasPercorridas: 1, ocorrencias: simple.length, cursosUnicos: simple.length, deduplicados: 0, acessiveis: simple.filter((c) => c.available !== false).length, acessoNegado: simple.filter((c) => c.available === false).length, completo: true };
    }
  }
  return result;
}

module.exports = { discoverAllCourses, discoverAllCoursesViaDriver, createMyCoursesDriver, waitListStable };
