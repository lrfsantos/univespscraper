// Módulo 1 — Extração de páginas HTML e conteúdo textual do AVA (Etapa 3).
// Opera sobre uma janela do Playwright (Page) já autenticada no AVA.
//
// IMPORTANTE (distinção de fidelidade):
// - `pageStatus` refere-se APENAS à fidelidade do TEXTO HTML da página.
// - Os recursos associados (PDFs, vídeos, livros) têm status PRÓPRIO,
//   calculados pelos Módulos 2-4. pageStatus NÃO representa o status dos
//   materiais incorporados ou vinculados.
// NUNCA classifica conteúdo não validado como integral.

const PDF_RE = /\.pdf($|[?#])/i;
const YT_RE = /youtube\.com|youtu\.be|youtube-nocookie/i;
const { htmlToMarkdown } = require('./html');

// Textos que NÃO são conteúdo real (erros, incompatibilidade, acesso).
const ERROR_RE =
  /n[ãa]o \u00e9 mais compat[ií]vel|navegador n[ãa]o compat[ií]vel|ver navegadores compat[ií]veis|baixar bookshelf|forbidden|acesso negado|n[ãa]o autorizado|n[ãa]o foi poss[ií]vel|erro (ao|no|de)|p[aá]gina n[ãa]o encontrada|not found|internal server error|essa p[aá]gina/i;

// Sinais de carregamento incompleto / conteúdo dinâmico não validado.
const LOAD_WARN_RE =
  /carregando|carregando\.\.\.|loading|skeleton|aguarde|por favor aguarde|preparando o conte[úu]do/i;

// Verificações básicas de presença de conteúdo (NÃO provam completude).
function basicChecks({ title, text, hasScope, httpStatus }) {
  return {
    httpOk: httpStatus && httpStatus < 400,
    hasScope: !!hasScope,
    hasText: !!((text || '').trim()),
    textMinLen: (text || '').trim().length >= 20,
  };
}

function statusFor({ title, text, hasScope, httpStatus, loadWarnings }) {
  if (httpStatus === 404) return 'not_found';
  if (httpStatus && httpStatus >= 400) return 'inaccessible';
  if (!title && !text) return 'not_found';
  // Sinais explícitos registrados pelo extrator (escopo sem texto, carga dinâmica)
  // têm precedência: conteúdo carregado/truncado/ausente → partial.
  if (loadWarnings && loadWarnings.length) return 'partial';
  const t = (text || '').trim();
  if (!t) return 'inaccessible';
  if (ERROR_RE.test(t)) return 'inaccessible';
  // Sinais de carregamento incompleto → nunca integral sem ressalvas.
  if (LOAD_WARN_RE.test(t)) return 'partial';
  // Seção 4.3: NUNCA declarar integral apenas por "20+ caracteres + seletor de
  // escopo" quando faltam evidências. Exige evidência ESTRUTURAL real de conversão
  // (múltiplas linhas, heading, lista, tabela, blockquote) OU texto substancial
  // (>= 80 caracteres, já que parágrafo único legítimo não tem marca estrutural).
  const structural = /(^|\n)(#{1,6} |[-*] |\d+\. |\| |> )/.test(t) || /\n\n/.test(t);
  if (hasScope && t.length >= 20 && (structural || t.length >= 80)) return 'integral';
  if (t.length >= 20) return 'partial';
  return 'inaccessible';
}

async function extractPage(win, url) {
  const result = {
    url,
    pageStatus: 'inaccessible', // fidelidade do TEXTO HTML (não dos recursos)
    status: null,               // alias mantido p/ compatibilidade (deprecated)
    text: '',
    title: '',
    hasScope: false,
    httpStatus: null,
    checks: null,               // verificações básicas (não provam completude)
    loadWarnings: [],           // sinais de carga incompleta
    links: [],
    iframes: [],
    resources: { pdfs: [], videos: [], status: 'pending' }, // recursos têm status próprio (Módulos 2-4)
  };
  try {
    const resp = await win.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    result.httpStatus = resp && resp.status ? resp.status() : null;
    await win.waitForTimeout(2500);

    const data = await win.evaluate(() => {
      const scopeEl = document.querySelector('.ava-scope') || document.querySelector('[role="main"]');
      const hasScope = !!scopeEl;
      const scope = scopeEl || document.body;
      // Serializa o HTML REAL do escopo principal (não o innerText) para a
      // conversão ESTRUTURAL → Markdown em Node (seção 4).
      const html = scope ? scope.outerHTML : '';
      const title = document.title || '';
      const links = [];
      const seen = new Set();
      (scope ? scope.querySelectorAll('a') : []).forEach((a) => {
        const t = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
        const h = a.href || '';
        if (!h || seen.has(h)) return;
        seen.add(h);
        links.push({ text: t, url: h });
      });
      const iframes = [];
      (scope ? scope.querySelectorAll('iframe') : []).forEach((f) => { if (f.src) iframes.push(f.src); });
      return { html, title, hasScope, links, iframes };
    });

    result.title = data.title || '';
    result.hasScope = data.hasScope;
    result.links = data.links || [];
    result.iframes = data.iframes || [];
    // Conversão estrutural real do HTML do escopo (headings/listas/tabelas/etc.).
    result.text = htmlToMarkdown(data.html || '', { baseUrl: url });
    result.sourceHtml = data.html || '';

    // Sinais de carga incompleta no texto extraído
    const t = result.text.trim();
    if (t && LOAD_WARN_RE.test(t)) {
      result.loadWarnings.push('texto contém sinais de carregamento dinâmico não validado');
    }
    // Se o escopo existe mas não há conteúdo textual estruturado, há evidência de
    // falha de conversão/carga — nunca integral (seção 4.3).
    if (result.hasScope && !t) {
      result.loadWarnings.push('escopo encontrado sem conteúdo textual estrutural extraído');
    }

    for (const l of result.links) {
      if (PDF_RE.test(l.url)) result.resources.pdfs.push(l);
      else if (YT_RE.test(l.url)) result.resources.videos.push({ ...l, type: 'youtube' });
    }
    for (const fr of result.iframes) {
      if (YT_RE.test(fr)) result.resources.videos.push({ text: '', url: fr, type: 'youtube' });
    }

    result.pageStatus = statusFor(result);
    result.status = result.pageStatus; // alias p/ compatibilidade
    result.checks = basicChecks(result);
  } catch (e) {
    result.pageStatus = 'inaccessible';
    result.status = 'inaccessible';
    result.error = e.message;
  }
  return result;
}

module.exports = { extractPage, statusFor, basicChecks };
