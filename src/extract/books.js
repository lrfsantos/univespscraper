// Módulo 3 — Livros digitais / Minha Biblioteca (Etapa 3).
//
// Opera sobre o app Electron controlado por playwright-core._electron (UM ÚNICO
// Chromium), usando a janela do navegador JÁ autenticada no AVA. Isso evita a
// dependência de um Chromium separado do Playwright e mantém a sessão do login.
//
// Diferencia explicitamente (princípios de fidelidade):
//   - leitor carregado  ≠  livro acessível  ≠  conteúdo efetivamente extraído
//   - quantidade de caracteres  ≠  fidelidade do conteúdo
//   - `integral` exige validação de começo/meio/fim + sem repetições suspeitas
//   - `not_found` quando o recurso existe mas o capítulo/conteúdo esperado não
//     foi localizado; `inaccessible` quando o conteúdo não está exposto (DRM,
//     canvas) ou o leitor não carrega.
// Nunca contorna DRM, canvas ou controles de acesso: registra e segue.

// ---- Constantes / padrões ----

// Mensagens de erro/incompatibilidade que NÃO são conteúdo acadêmico.
const NONSENSE_RE =
  /n[ãa]o \u00e9 mais compat[ií]vel|navegador n[ãa]o compat[ií]vel|ver navegadores compat[ií]veis|baixar bookshelf|use um de nossos navegadores|para uma melhor experi[eê]ncia em nosso site|acesso negado|forbidden|n[ãa]o autorizado|erro (ao|no|de) carregar|n[ãa]o foi poss[ií]vel carregar/i;

// Páginas de abertura (front matter) que não são o conteúdo do capítulo.
const FRONT_RE = /capa|frontisp[ií]cio|p[aá]gina de rosto|cr[eé]ditos|sobre o autor|sum[aá]rio|copyright|direitos reservados/i;

const EPUB_CONTENT_RE = /\/epub\/OEBPS\/Text\//i;
const PAGEID_CONTENT_RE = /\/pages\/\d+\/content/i;
const PLATAFORMA_BV_RE = /plataforma\.bvirtual|leitor\.bvirtual|\/Leitor\//i;

// ---- Helpers de espera (evitam depender de tempos fixos) ----

function waitTimeout(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function allWindows(app) {
  try { return app.windows(); } catch { return []; }
}

// Coleta todas as janelas e frames do app (lida com leitor abrindo em nova janela).
async function collectFrames(app) {
  const out = [];
  for (const w of allWindows(app)) {
    try {
      for (const f of w.frames()) out.push({ win: w, frame: f, url: f.url() });
    } catch { /* janela fechando */ }
  }
  return out;
}

// Espera, sondando a cada `interval` até `deadlineMs`, até `pred` retornar algo
// truthy. Retorna o valor de `pred` ou null se o prazo esgotar.
async function poll(app, pred, { timeoutMs = 30000, interval = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let value = null;
  while (Date.now() < deadline) {
    try { value = await pred(); } catch { value = null; }
    if (value) return value;
    await waitTimeout(interval);
  }
  try { value = await pred(); } catch { value = null; }
  return value;
}

// ---- Detecção de formato do leitor ----

// Classifica o leitor após abertura do launchUrl. Retorna { format, readerUrl }.
// format: 'epub' | 'pageid' | 'bvpdf' | 'bvleitor' | 'unknown'
async function detectFormat(app, win, launchUrl) {
  await win.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const found = await poll(
    app,
    async () => {
      const frames = await collectFrames(app);
      const urls = frames.map((f) => f.url);
      if (urls.some((u) => EPUB_CONTENT_RE.test(u))) return { format: 'epub', readerUrl: urls.find((u) => EPUB_CONTENT_RE.test(u)) };
      if (urls.some((u) => PAGEID_CONTENT_RE.test(u))) return { format: 'pageid', readerUrl: urls.find((u) => PAGEID_CONTENT_RE.test(u)) };
      return null;
    },
    { timeoutMs: 30000, interval: 1500 }
  );
  if (found) return found;

  // Sem frame de conteúdo: verifica se é leitor bvirtual (canvas/DRM) ou desconhecido.
  const urls = (await collectFrames(app)).map((f) => f.url);
  const anyUrl = urls.join(' ');
  if (PLATAFORMA_BV_RE.test(anyUrl)) {
    const m = anyUrl.match(/plataforma\.bvirtual|leitor\.bvirtual|\/Leitor\//);
    return { format: m && m[0].includes('leitor.') ? 'bvleitor' : 'bvpdf', readerUrl: null };
  }
  return { format: 'unknown', readerUrl: null };
}

// ---- Validação de conteúdo (fidelidade) ----

function normalizePara(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Detecta repetições suspeitas: parágrafo longo (>120 chars) idêntico 2+ vezes.
function detectRepetitions(text) {
  const paras = (text || '').split(/\n{2,}/).map(normalizePara).filter((p) => p.length > 120);
  const seen = new Map();
  for (const p of paras) seen.set(p, (seen.get(p) || 0) + 1);
  const dup = [];
  for (const [p, n] of seen) if (n > 1) dup.push({ length: p.length, count: n, snippet: p.slice(0, 120) });
  return dup;
}

// Verifica se o texto termina em um limite provável de sentença (heurística de truncamento).
function endsAtSentenceBoundary(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return /[.!?…»"'\]”]$/.test(t);
}

// Valida começo/meio/fim e estrutura do conteúdo extraído.
// kind: 'epub' (capítulo inteiro em 1 frame) | 'pageid' (páginas navegadas)
function validateContent({ text, expected, kind }) {
  const v = {
    hasText: false,
    noNonsense: true,
    startOk: false,
    midOk: false,
    endOk: false,
    chapterOk: null,
    pageRangeNote: null,
    repetitions: [],
    warnings: [],
    length: 0,
  };
  if (!text || !text.trim()) return v;
  const t = text.trim();
  v.length = t.length;
  v.hasText = t.length >= 500;

  if (NONSENSE_RE.test(t)) { v.noNonsense = false; v.warnings.push('conteudo-e-mensagem-de-erro/incompatibilidade'); }

  const start = t.slice(0, 400);
  const meaningfulStart = (start.match(/[a-zà-ú]{4,}/gi) || []).length >= 15;
  v.startOk = meaningfulStart && !FRONT_RE.test(start);

  const paras = t.split(/\n{2,}/).filter((p) => p.trim());
  v.midOk = v.length >= 3000 && paras.length >= 8;

  if (kind === 'pageid') {
    v.endOk = !!expected && !!expected.reachedChapterEnd;
    if (!v.endOk) v.warnings.push(expected && expected.maxPagesHit ? 'fim-nao-confirmado-limite-de-paginas' : 'fim-de-capitulo-nao-confirmado');
  } else {
    v.endOk = endsAtSentenceBoundary(t);
    if (!v.endOk) v.warnings.push('possivel-truncamento-no-final');
  }

  v.repetitions = detectRepetitions(t);
  for (const r of v.repetitions) v.warnings.push(`repeticao-suspeita (${r.count}x, ${r.length} chars)`);

  if (expected && expected.chapter) {
    if (kind === 'pageid' && expected.chapterPageRangeConfirmed) {
      // Capítulo confirmado pela FAIXA de páginas impressas do sumário
      // (navegou da página inicial do capítulo N até o início do capítulo N+1).
      v.chapterOk = true;
      if (expected.startChapterPage && expected.nextChapterPage) {
        v.pageRangeNote = `${expected.startChapterPage}..${expected.nextChapterPage - 1}`;
      }
    } else {
      const capRe = new RegExp(`cap[ií]tulo\\s*${expected.chapter}\\b`, 'i');
      v.chapterOk = capRe.test(t);
      if (!v.chapterOk) v.warnings.push(`capitulo-${expected.chapter}-nao-confirmado-no-texto`);
    }
  }
  if (expected && expected.book) {
    const tokens = expected.book.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    if (tokens.length >= 2) {
      const bookRe = new RegExp(tokens.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i');
      if (bookRe.test(t)) v.chapterOk = true; // reforça que é o livro certo
    }
  }

  return v;
}

// ---- Status honesto ----

function statusForBook({ format, validation, readerLoaded, chapterNotFound }) {
  if (!readerLoaded) return 'inaccessible';
  if (format === 'bvpdf' || format === 'bvleitor') return 'inaccessible'; // conteúdo em canvas/DRM
  if (chapterNotFound) return 'not_found';
  if (!validation.hasText || !validation.noNonsense) {
    if (validation.length > 0 && !validation.noNonsense) return 'inaccessible';
    return 'not_found';
  }
  if (validation.warnings.length > 0) return 'partial';
  return 'integral';
}

// ---- Extração EPUB (ex.: Chiavenato) ----

// Obtém o texto do frame de conteúdo EPUB com o maior corpo significativo.
async function readEpubFrame(app) {
  let best = { text: '', url: '' };
  for (const { frame, url } of await collectFrames(app)) {
    if (!EPUB_CONTENT_RE.test(url)) continue;
    try {
      const txt = await frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
      if (txt && txt.trim().length > best.text.length) best = { text: txt, url };
    } catch { /* frame indisponível */ }
  }
  return best;
}

// Tenta navegar no sumário para o capítulo esperado (leitor EPUB da Minha Biblioteca).
async function navigateEpubToChapter(app, chapter) {
  const capRe = new RegExp(`^cap[ií]tulo\\s*${chapter}\\b`, 'i');
  for (const w of allWindows(app)) {
    try {
      const ok = await w.evaluate((re) => {
        const btns = [...document.querySelectorAll('button, [role="button"], a')];
        const target = btns.find((b) => re.test((b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim()));
        if (target) { target.click(); return true; }
        return false;
      }, capRe).catch(() => false);
      if (ok) return true;
    } catch { /* ignore */ }
  }
  return false;
}

async function extractEpub(app, win, launchUrl, expected) {
  const attempts = [];
  // 1ª tentativa: aguarda o frame de conteúdo carregar com texto significativo.
  let res = await poll(
    app,
    async () => {
      const { text, url } = await readEpubFrame(app);
      const t = (text || '').trim();
      if (t.length >= 500 && !FRONT_RE.test(t.slice(0, 300))) return { text, url, attempt: 'espera-inicial' };
      return null;
    },
    { timeoutMs: 35000, interval: 2000 }
  );

  if (!res) {
    attempts.push('espera-inicial-sem-conteudo');
    // Retry controlado: tenta expandir o sumário e navegar para o capítulo.
    for (const w of allWindows(app)) {
      try { await w.locator('button:has-text("Expandir tudo")').first().click({ timeout: 3000 }).catch(() => {}); } catch { /* ignore */ }
    }
    if (expected && expected.chapter) {
      await navigateEpubToChapter(app, expected.chapter);
    }
    res = await poll(
      app,
      async () => {
        const { text, url } = await readEpubFrame(app);
        const t = (text || '').trim();
        if (t.length >= 500 && !FRONT_RE.test(t.slice(0, 300))) return { text, url, attempt: 'retry-navegacao' };
        return null;
      },
      { timeoutMs: 25000, interval: 2000 }
    );
    if (res) attempts.push('retry-navegacao-ok');
    else attempts.push('retry-navegacao-sem-conteudo');
  } else {
    attempts.push(res.attempt);
  }

  if (!res) {
    return {
      url: launchUrl, format: 'epub', status: 'inaccessible', text: '', chars: 0,
      readerLoaded: false, readerUrl: null, attempts, validation: validateContent({ text: '', expected, kind: 'epub' }), error: 'leitor-nao-carregou-conteudo',
    };
  }

  // Após obter conteúdo significativo, se o capítulo esperado não apareceu no
  // texto, tenta navegar uma vez (capítulo errado = conteúdo possivelmente não é o pedido).
  const validation = validateContent({ text: res.text, expected, kind: 'epub' });
  let chapterNotFound = false;
  if (expected && expected.chapter && !validation.chapterOk) {
    const clicked = await navigateEpubToChapter(app, expected.chapter);
    if (clicked) {
      const after = await poll(
        app,
        async () => {
          const { text, url } = await readEpubFrame(app);
          const t = (text || '').trim();
          if (t.length >= 500 && t !== res.text) return { text, url };
          return null;
        },
        { timeoutMs: 20000, interval: 2000 }
      );
      if (after) res = after;
    }
    const finalValidation = validateContent({ text: res.text, expected, kind: 'epub' });
    if (!finalValidation.chapterOk) chapterNotFound = true;
  }

  const finalValidation = validateContent({ text: res.text, expected, kind: 'epub' });
  return {
    url: launchUrl,
    format: 'epub',
    status: statusForBook({ format: 'epub', validation: finalValidation, readerLoaded: true, chapterNotFound }),
    text: res.text,
    chars: res.text.trim().length,
    source: 'epub',
    readerUrl: res.url,
    readerLoaded: true,
    attempts,
    validation: finalValidation,
    chapterNotFound,
    error: null,
  };
}

// ---- Extração pageid (ex.: Hisrich) ----

// Lê os frames de conteúdo (/pages/N/content), excluindo o chrome do leitor
// (sumário, botões, margem) que polui a fidelidade. Retorna [{ id, text }].
// O leitor pode pré-carregar a página seguinte em outro frame — a deduplicação
// por texto é feita no chamador.
async function readPageContentFrames(app) {
  const out = [];
  const seenIds = new Set();
  for (const { frame, url } of await collectFrames(app)) {
    const m = url.match(/pages\/(\d+)\/content/);
    if (!m) continue;
    const id = m[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    try {
      const text = await frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
      out.push({ id, text: text || '' });
    } catch { /* frame indisponível */ }
  }
  return out;
}

// Lê o número da PÁGINA IMPRESSA atual do leitor (chrome: "Página N [/ M]").
async function getCurrentPrintedPage(app) {
  for (const w of allWindows(app)) {
    try {
      const m = await w.evaluate(() => {
        const t = document.body ? document.body.innerText : '';
        const mm = t.match(/P[áa]gina\s+(\d+)\s*\/\s*(\d+)/) || t.match(/P[áa]gina\s+(\d+)/);
        return mm ? parseInt(mm[1], 10) : null;
      }).catch(() => null);
      if (m != null) return m;
    } catch { /* ignore */ }
  }
  return null;
}

// Extrai do sumário do leitor a página impressa de início de cada capítulo
// (formato observado: "Capítulo N - título" + linha seguinte com o número).
async function getTocChapterPages(app) {
  for (const w of allWindows(app)) {
    try {
      const map = await w.evaluate(() => {
        const t = document.body ? document.body.innerText : '';
        const out = {};
        const re = /Cap[ií]tulo\s+(\d+)\s+[-–—]?[^\n]*\n+\s*(\d{1,4})\b/gm;
        let m;
        while ((m = re.exec(t))) out[parseInt(m[1], 10)] = parseInt(m[2], 10);
        return out;
      }).catch(() => null);
      if (map && Object.keys(map).length) return map;
    } catch { /* ignore */ }
  }
  return {};
}

async function clickNextPage(app) {
  for (const w of allWindows(app)) {
    try {
      const ok = await w.locator('button[aria-label="Seguinte"]').first().click({ timeout: 3000 }).then(() => true).catch(() => false);
      if (ok) return true;
    } catch { /* ignore */ }
  }
  return false;
}

// Extrai o capítulo esperado navegando página a página até o próximo capítulo
// ou o limite de páginas (maxPages). Nunca marca integral sem confirmar o fim.
async function extractPageid(app, win, launchUrl, expected, opts = {}) {
  const maxPages = opts.maxPages || 120;
  const pages = [];
  const steps = [];
  let readerLoaded = false;

  await win.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const loaded = await poll(
    app,
    async () => {
      const frames = await readPageContentFrames(app);
      if (frames.some((f) => f.text && f.text.trim().length > 0)) return true;
      return null;
    },
    { timeoutMs: 35000, interval: 2000 }
  );
  readerLoaded = !!loaded;

  if (!readerLoaded) {
    return {
      url: launchUrl, format: 'pageid', status: 'inaccessible', text: '', chars: 0,
      readerLoaded: false, readerUrl: null, steps, attempts: ['leitor-nao-carregou'], error: 'leitor-nao-carregou',
      validation: validateContent({ text: '', expected, kind: 'pageid' }),
    };
  }

  const nextChapter = expected && expected.chapter ? new RegExp(`(?:^|\\n)\\s*Cap[ií]tulo\\s*${expected.chapter + 1}\\b`, 'i') : null;
  const tocPages = await getTocChapterPages(app);
  const nextChapterPage = expected && expected.chapter ? tocPages[expected.chapter + 1] : null;
  const startChapterPage = expected && expected.chapter ? tocPages[expected.chapter] : null;
  const seenTexts = new Set();
  const collected = [];
  let reachedChapterEnd = false;
  let maxPagesHit = false;

  for (let i = 0; i < maxPages; i++) {
    const curPage = await getCurrentPrintedPage(app);
    // Fim do capítulo: chegou à página impressa onde começa o próximo capítulo
    // (fonte mais confiável: sumário do leitor).
    if (nextChapterPage && curPage != null && curPage >= nextChapterPage) {
      reachedChapterEnd = true; steps.push('pagina-limite-capitulo'); break;
    }
    // Coleta as páginas de conteúdo, deduplicando por texto (o leitor
    // pré-carrega a página seguinte — sem dedupe haveria conteúdo duplicado).
    const frames = await readPageContentFrames(app);
    let added = false;
    for (const f of frames) {
      const t = f.text.trim();
      if (!t || seenTexts.has(t)) continue;
      seenTexts.add(t);
      collected.push({ page: curPage, text: t });
      added = true;
    }
    // Fallback (sem TOC): cabeçalho "Capítulo N+1" no início de uma página.
    if (!nextChapterPage && collected.length >= 2 && nextChapter && frames.some((f) => nextChapter.test(f.text))) {
      reachedChapterEnd = true; steps.push('cabecalho-capitulo-seguinte'); break;
    }
    if (!added) { steps.push('sem-conteudo-novo'); break; }
    const ok = await clickNextPage(app);
    if (!ok) { steps.push('sem-botao-seguinte'); break; }
    await waitTimeout(2500);
  }
  if (!reachedChapterEnd && collected.length >= maxPages) { maxPagesHit = true; steps.push('limite-de-paginas'); }

  const text = collected.map((p) => `\n[PÁGINA ${p.page ? 'impressa ' + p.page : '?'}]\n${p.text}`).join('\n\n');
  // Confirma o capítulo pela FAIXA de páginas impressas do sumário (23..45 => cap. 1)
  // quando o TOC foi lido e o fim do capítulo foi alcançado.
  const chapterPageRangeConfirmed = !!(nextChapterPage && reachedChapterEnd);
  const validation = validateContent({
    text,
    expected: { ...expected, reachedChapterEnd, maxPagesHit, chapterPageRangeConfirmed, startChapterPage, nextChapterPage },
    kind: 'pageid',
  });

  return {
    url: launchUrl,
    format: 'pageid',
    status: statusForBook({ format: 'pageid', validation, readerLoaded, chapterNotFound: false }),
    text,
    chars: text.trim().length,
    source: 'pageid',
    readerUrl: null,
    readerLoaded,
    steps,
    attempts: ['navegacao-paginas'],
    validation,
    pages: collected.length,
    reachedChapterEnd,
    maxPagesHit,
    tocPages,
    error: null,
  };
}

// ---- Entrada principal ----

// expected: { book, chapter } — identificação esperada do material (para validação).
// opts: { maxPages } — limite de páginas do modo pageid.
async function extractBook({ app, win, launchUrl, expected = {}, opts = {} }) {
  const det = await detectFormat(app, win, launchUrl);
  const base = { url: launchUrl, format: det.format, expected };

  if (det.format === 'epub') {
    return extractEpub(app, win, launchUrl, expected);
  }
  if (det.format === 'pageid') {
    return extractPageid(app, win, launchUrl, expected, opts);
  }
  if (det.format === 'bvpdf' || det.format === 'bvleitor') {
    return {
      ...base, status: 'inaccessible', text: '', chars: 0, source: det.format, readerLoaded: true,
      readerUrl: det.readerUrl, attempts: [], error: 'conteudo-em-canvas/DRM-nao-extraivel',
      validation: validateContent({ text: '', expected, kind: det.format === 'pageid' ? 'pageid' : 'epub' }),
    };
  }
  return {
    ...base, status: 'inaccessible', text: '', chars: 0, source: 'unknown', readerLoaded: false,
    readerUrl: null, attempts: [], error: 'formato-de-leitor-nao-reconhecido',
    validation: validateContent({ text: '', expected, kind: 'epub' }),
  };
}

module.exports = { extractBook, detectFormat, validateContent, statusForBook, detectRepetitions };
