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

const crypto = require('crypto');
const ep = require('./epub-structure');

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

function sha256(s) {
  return crypto.createHash('sha256').update(s || '').digest('hex');
}

function countParas(s) {
  return (s || '').split(/\n{2,}/).filter((p) => p.trim()).length;
}

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

// ---- Associação PAGEID: frame ativo × página (Issue B) ----

// Sinal observado no leitor Minha Biblioteca (pageid): o frame ATIVO (página do
// livro exibida) tem scrolling="no" e largura fixa (~663px, margin auto); os
// frames de prefetch/cache têm scrolling="yes" e width 100%. Puro e testável.
function isActiveFrameStyle({ scrolling, width }) {
  return scrolling === 'no' && !!width && width !== '100%' && width !== 'auto';
}

// Classifica um conjunto de frames de conteúdo em ativo/prefetch. Puro.
// frames: [{ id, active }] (active = resultado de isActiveFrameStyle).
function classifyContentFrames(frames) {
  const actives = (frames || []).filter((f) => f.active);
  if (actives.length === 1) return { status: 'ok', active: actives[0], count: frames.length };
  if (actives.length === 0) return { status: 'ambiguous', reason: 'sem-frame-ativo-identificavel', count: frames.length };
  return { status: 'ambiguous', reason: 'multiplos-frames-ativos', count: frames.length };
}

// Associa o conteúdo do frame ativo à página exibida, mantendo rastreabilidade.
// Puro e testável. seenHashes: Map<`${printedPage}|${hash}` , printedPage> —
// a deduplicação é POR IDENTIDADE (página + hash): remove repetições dentro da
// mesma página sem apagar a associação quando o MESMO conteúdo ocorre em páginas
// distintas (origem preservada).
function associateActivePage({ frames, printedPage, seenHashes }) {
  const cls = classifyContentFrames(frames);
  if (cls.status !== 'ok') {
    return { accepted: false, ambiguous: true, reason: cls.reason, text: '', audit: { printedPage, status: 'rejected', reason: cls.reason, frameId: null, hash: null, chars: 0 } };
  }
  const t = (cls.active.text || '').trim();
  const hash = sha256(t);
  const key = `${printedPage}|${hash}`;
  const dupOf = seenHashes.get(key);
  seenHashes.set(key, printedPage);
  return {
    accepted: !!t && dupOf === undefined,
    ambiguous: false,
    frameId: cls.active.id,
    hash,
    chars: t.length,
    text: t,
    audit: { printedPage, frameId: cls.active.id, origin: 'active-frame', hash, chars: t.length, status: dupOf === undefined ? 'accepted' : 'duplicate' },
  };
}

// Lê, no leitor real, o frame de conteúdo e seu estilo (para isActiveFrameStyle).
async function readContentFrameStyles(app) {
  const out = [];
  for (const { frame, url } of await collectFrames(app)) {
    const m = url.match(/pages\/(\d+)\/content/);
    if (!m) continue;
    const style = await frame.evaluate(() => {
      const el = window.frameElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { scrolling: el.getAttribute('scrolling'), width: cs.width };
    }).catch(() => null);
    const text = await frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    out.push({ id: m[1], url, text: text || '', active: style ? isActiveFrameStyle(style) : false });
  }
  return out;
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
    { timeoutMs: 35000, interval: 1500 }
  );
  if (found) return found;

  // Sem frame de conteúdo: verifica se é leitor bvirtual (canvas/DRM) ou
  // redirecionamento de sessão do leitor (VitalSource login/logout — ocorre com
  // sessão expirada ou limite de dispositivos). Distingue dos casos conhecidos;
  // só 'unknown' se nada for reconhecido. Inclui URL/título de janelas, pois o
  // redirect de sessão pode aparecer no título, não em URL de frame.
  const urls = (await collectFrames(app)).map((f) => f.url);
  const winInfo = [];
  for (const w of allWindows(app)) {
    try { winInfo.push(w.url()); } catch { /* ignore */ }
    try { winInfo.push(await w.title()); } catch { /* ignore */ }
  }
  const anyUrl = urls.concat(winInfo).join(' ');
  if (PLATAFORMA_BV_RE.test(anyUrl)) {
    const m = anyUrl.match(/plataforma\.bvirtual|leitor\.bvirtual|\/Leitor\//);
    return { format: m && m[0].includes('leitor.') ? 'bvleitor' : 'bvpdf', readerUrl: null };
  }
  if (/(vitalsource|logout|sess[aã]o expirou|session expired)/i.test(anyUrl)) {
    return { format: 'reader-auth', readerUrl: null };
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
// expected pode conter: reachedChapterEnd, epubBoundaryConfirmed, maxPagesHit,
// chapterPageRangeConfirmed, startChapterPage, nextChapterPage, ambiguousPages,
// unexpectedContent.
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
    ambiguousPages: 0,
    unexpectedContent: [],
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
  if (!v.startOk) v.warnings.push('inicio-nao-validado');

  const paras = t.split(/\n{2,}/).filter((p) => p.trim());
  v.midOk = v.length >= 3000 && paras.length >= 8;
  if (!v.midOk) v.warnings.push('meio-nao-validado');

  if (kind === 'pageid') {
    v.endOk = !!expected && !!expected.reachedChapterEnd;
    if (!v.endOk) v.warnings.push(expected && expected.maxPagesHit ? 'fim-nao-confirmado-limite-de-paginas' : 'fim-de-capitulo-nao-confirmado');
  } else {
    // Issue A: fim do capítulo EPUB exige evidência ESTRUTURAL (limite alcançado),
    // nunca apenas pontuação final. Pontuação é registrada apenas como nota.
    v.endOk = !!expected && !!expected.epubBoundaryConfirmed;
    v.endPunctuationNote = endsAtSentenceBoundary(t);
    if (!v.endOk) v.warnings.push('fim-capitulo-nao-confirmado-estruturalmente');
  }

  if (expected && expected.ambiguousPages) {
    v.ambiguousPages = expected.ambiguousPages;
    v.warnings.push(`paginas-com-associacao-ambigua (${expected.ambiguousPages})`);
  }
  if (expected && Array.isArray(expected.unexpectedContent) && expected.unexpectedContent.length) {
    v.unexpectedContent = expected.unexpectedContent.slice(0, 20);
    v.warnings.push(`conteudo-de-outro-capitulo/pagina-incluido (${expected.unexpectedContent.length})`);
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
    } else if (kind === 'epub' && expected.epubChapterConfirmed) {
      // Capítulo EPUB confirmado pela identidade estrutural (idref/documento do
      // capítulo esperado no leitor) — não pelo título do livro.
      v.chapterOk = true;
    } else {
      const capRe = new RegExp(`cap[ií]tulo\\s*${expected.chapter}\\b`, 'i');
      v.chapterOk = capRe.test(t);
      if (!v.chapterOk) v.warnings.push(`capitulo-${expected.chapter}-nao-confirmado-no-texto`);
    }
  }
  // O título do livro pode aparecer no sumário/cabeçalho sem que o capítulo
  // solicitado tenha sido extraído. Nunca use expected.book para aprovar
  // chapterOk; capítulo exige evidência própria (estrutura ou faixa de páginas).

  return v;
}

// ---- Status honesto ----

// `integral` exige EVIDÊNCIA POSITIVA de todas as validações (começo, meio, fim
// estrutural, capítulo quando esperado, sem páginas ambíguas, sem conteúdo de
// outro capítulo, sem repetições e sem avisos). Ausência de validação ou qualquer
// falha comprovada rebaixa o status — nunca `integral` por omissão.
function statusForBook({ format, validation, readerLoaded, chapterNotFound, expected }) {
  if (!readerLoaded) return 'inaccessible';
  if (format === 'bvpdf' || format === 'bvleitor') return 'inaccessible'; // conteúdo em canvas/DRM
  if (chapterNotFound) return 'not_found';
  if (!validation.hasText) return 'not_found';
  if (!validation.noNonsense) return 'inaccessible';

  const chapterRequired = !!(expected && expected.chapter);
  const integral =
    validation.hasText &&
    validation.noNonsense &&
    validation.startOk &&
    validation.midOk &&
    validation.endOk &&
    (!chapterRequired || validation.chapterOk === true) &&
    (!validation.ambiguousPages || validation.ambiguousPages === 0) &&
    (!validation.unexpectedContent || validation.unexpectedContent.length === 0) &&
    (!validation.repetitions || validation.repetitions.length === 0) &&
    Array.isArray(validation.warnings) &&
    validation.warnings.length === 0;
  return integral ? 'integral' : 'partial';
}

// ---- Extração EPUB (ex.: Chiavenato) ----

// Extrai identidade estrutural do documento EPUB a partir da URL:
//   doc  = arquivo XHTML (Text/<doc>.xhtml)
//   idref = item do spine (vnd.vst.idref=...)
function parseEpubDocIdentity(url) {
  const doc = (url.match(/epub\/OEBPS\/Text\/([^\/?#]+)\.xhtml/i) || [])[1] || null;
  const idref = (url.match(/idref=([A-Za-z0-9_.-]+)/i) || [])[1] || (url.match(/vnd\.vst\.idref%3D([^\]%]+)/i) || [])[1] || null;
  return { doc, idref };
}

// Lê o documento EPUB ativo (frame de conteúdo com mais texto) e sua identidade.
async function readEpubActiveDocument(app) {
  let best = { text: '', url: '', doc: null, idref: null };
  for (const { frame, url } of await collectFrames(app)) {
    if (!EPUB_CONTENT_RE.test(url)) continue;
    try {
      const txt = await frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
      if (txt && txt.trim().length > best.text.length) best = { text: txt, url, ...parseEpubDocIdentity(url) };
    } catch { /* frame indisponível */ }
  }
  return best;
}

// Navega para um capítulo via sumário acessível do leitor ("Acesse Capítulo N ...").
async function navigateEpubViaToc(app, chapter) {
  const capRe = new RegExp(`cap[ií]tulo\\s*${chapter}\\b`, 'i');
  for (const w of allWindows(app)) {
    try {
      const ok = await w.evaluate((re) => {
        const els = [...document.querySelectorAll('button, [role="button"], a')];
        const norm = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        let target = els.find((el) => /^acesse\b/i.test(norm(el)) && re.test(norm(el)));
        if (!target) target = els.find((el) => re.test(norm(el)));
        if (target) { target.click(); return true; }
        return false;
      }, capRe).catch(() => false);
      if (ok) return true;
    } catch { /* ignore */ }
  }
  return false;
}

// Decisão pura de confirmação do LIMITE estrutural do capítulo EPUB (Issue A).
// Navegou-se para o capítulo N+1 via sumário do leitor; a evidência estrutural é a
// MUDANÇA DE IDENTIDADE do documento ativo (doc/idref) para o documento do
// capítulo N+1. O texto "Capítulo N+1" no cabeçalho é apenas confiança extra
// (headingMatches) — não é exigido, pois os documentos podem começar com outro
// texto (ex.: "O QUE VEREMOS ADIANTE"). Testável: puro, sem leitor.
function confirmEpubBoundaryDecision({ beforeDoc, beforeUrl, nextDocIdent, nextHead, chapter }) {
  const before = beforeDoc || parseEpubDocIdentity(beforeUrl || '');
  const ident = nextDocIdent || {};
  const nextRe = chapter != null ? new RegExp(`chapter0*${chapter}\\b|cap[ií]tulo\\s*${chapter}\\b`, 'i') : null;
  const docChanged = (ident.doc !== undefined && before.doc !== undefined && ident.doc !== before.doc) ||
    (!!ident.doc && before.doc !== ident.doc) ||
    (!!ident.idref && before.idref !== undefined && ident.idref !== before.idref);
  const nextDocMatches = !!(nextRe && ((ident.doc && nextRe.test(ident.doc)) || (ident.idref && nextRe.test(ident.idref))));
  const headingMatches = !!(nextRe && nextHead && nextRe.test(String(nextHead)));
  const confirmed = docChanged && nextDocMatches;
  const reason = !nextRe ? 'sem-capitulo-esperado' : !docChanged ? 'documento-nao-mudou' : !nextDocMatches ? 'documento-seguinte-nao-identificado' : 'limite-estrutural-confirmado';
  return { confirmed, docChanged, nextDocMatches, headingMatches, nextDoc: ident.doc, nextIdref: ident.idref, beforeDoc: before.doc, beforeIdref: before.idref, reason };
}

// Extrai o capítulo esperado com validação ESTRUTURAL do limite (Issue A):
//   - identifica o documento/idref do capítulo no leitor;
//   - confirma o limite navegando para o capítulo seguinte e verificando que o
//     documento muda e começa com o próximo capítulo;
//   - NUNCA usa pontuação final como prova de integridade.
async function extractEpub(app, win, launchUrl, expected) {
  const attempts = [];
  const audit = [];

  // 1) Aguarda o leitor carregar com conteúdo significativo.
  let res = await poll(
    app,
    async () => {
      const d = await readEpubActiveDocument(app);
      const t = (d.text || '').trim();
      if (t.length >= 500 && !FRONT_RE.test(t.slice(0, 300))) return d;
      return null;
    },
    { timeoutMs: 35000, interval: 2000 }
  );

  if (!res) {
    attempts.push('espera-inicial-sem-conteudo');
    for (const w of allWindows(app)) {
      try { await w.locator('button:has-text("Expandir tudo")').first().click({ timeout: 3000 }).catch(() => {}); } catch { /* ignore */ }
    }
    if (expected && expected.chapter) await navigateEpubViaToc(app, expected.chapter);
    res = await poll(
      app,
      async () => {
        const d = await readEpubActiveDocument(app);
        const t = (d.text || '').trim();
        if (t.length >= 500 && !FRONT_RE.test(t.slice(0, 300))) return d;
        return null;
      },
      { timeoutMs: 25000, interval: 2000 }
    );
    if (res) attempts.push('retry-navegacao-ok');
    else attempts.push('retry-navegacao-sem-conteudo');
  } else {
    attempts.push('espera-inicial');
  }

  if (!res) {
    return {
      url: launchUrl, format: 'epub', status: 'inaccessible', text: '', chars: 0,
      readerLoaded: false, readerUrl: null, attempts, validation: validateContent({ text: '', expected, kind: 'epub' }), error: 'leitor-nao-carregou-conteudo',
    };
  }

  // 2) Captura o texto do capítulo ANTES de navegar para o próximo (limite).
  const chapterText = (res.text || '').trim();
  const ident = parseEpubDocIdentity(res.url);
  audit.push({ doc: ident.doc, idref: ident.idref, status: 'accepted', origin: 'epub-content-frame', hash: sha256(chapterText), chars: chapterText.length });

  // 3) Confirmação do capítulo por identidade estrutural (doc/idref) — nunca pelo
  //    título do livro. Se o documento inicial não for o esperado, navega no sumário.
  let epubChapterConfirmed = false;
  const chapterRe = expected.chapter != null ? new RegExp(`chapter0*${expected.chapter}\\b|cap[ií]tulo\\s*${expected.chapter}\\b`, 'i') : null;
  if (ident.doc && chapterRe && chapterRe.test(ident.doc)) epubChapterConfirmed = true;
  if (ident.idref && chapterRe && chapterRe.test(ident.idref)) epubChapterConfirmed = true;
  if (!epubChapterConfirmed && expected.chapter) {
    const clicked = await navigateEpubViaToc(app, expected.chapter);
    if (clicked) {
      const after = await poll(
        app,
        async () => {
          const d = await readEpubActiveDocument(app);
          const t = (d.text || '').trim();
          if (t.length >= 500 && t !== chapterText) return d;
          return null;
        },
        { timeoutMs: 20000, interval: 2000 }
      );
      if (after) {
        res = after;
        const t2 = (res.text || '').trim();
        const id2 = parseEpubDocIdentity(res.url);
        if (id2.doc && chapterRe && chapterRe.test(id2.doc)) epubChapterConfirmed = true;
        if (id2.idref && chapterRe && chapterRe.test(id2.idref)) epubChapterConfirmed = true;
        audit.push({ doc: id2.doc, idref: id2.idref, status: 'accepted', origin: 'epub-toc-navigation', hash: sha256(t2), chars: t2.length });
      }
    }
  }

  // 4) Confirmação do LIMITE estrutural: navega para o capítulo N+1 e verifica que
  //    o documento ativo muda para o documento do capítulo N+1 (identidade
  //    doc/idref). A correspondência do TEXTO ("Capítulo N+1" no cabeçalho) é
  //    apenas confiança extra no audit — não é exigida, pois os documentos de
  //    capítulo podem começar com outro texto (ex.: "O QUE VEREMOS ADIANTE").
  //    Sem essa confirmação estrutural, endOk=false.
  let epubBoundaryConfirmed = false;
  let nextDocIdent = null;
  const beforeUrl = res.url;
  const beforeDoc = parseEpubDocIdentity(beforeUrl);
  if (expected && expected.chapter) {
    const nextClicked = await navigateEpubViaToc(app, expected.chapter + 1);
    if (nextClicked) {
      const after = await poll(
        app,
        async () => {
          const d = await readEpubActiveDocument(app);
          const t = (d.text || '').trim();
          if (t.length >= 500 && d.url !== beforeUrl) return d;
          return null;
        },
        { timeoutMs: 20000, interval: 2000 }
      );
      if (after) {
        nextDocIdent = parseEpubDocIdentity(after.url);
        const nextHead = (after.text || '').trim().slice(0, 200);
        const decision = confirmEpubBoundaryDecision({
          beforeDoc, beforeUrl, nextDocIdent, nextHead, chapter: expected.chapter + 1,
        });
        epubBoundaryConfirmed = decision.confirmed;
        audit.push({ doc: nextDocIdent.doc, idref: nextDocIdent.idref, status: epubBoundaryConfirmed ? 'boundary-next-chapter' : 'boundary-not-confirmed', origin: 'epub-next-chapter-navigation', docChanged: decision.docChanged, nextDocMatches: decision.nextDocMatches, headingMatches: decision.headingMatches, reason: decision.reason, hash: sha256((after.text || '').trim().slice(0, 400)), chars: (after.text || '').length });
      }
    }
  }

  const chapterNotFound = !!(expected && expected.chapter && !epubChapterConfirmed);
  const unexpectedContent = [];
  if (expected && expected.chapter) {
    const nextHeadingRe = new RegExp(`cap[ií]tulo\\s*${expected.chapter + 1}\\b`, 'i');
    if (nextHeadingRe.test(chapterText.slice(0, 300))) unexpectedContent.push('cabecalho-do-proximo-capitulo-no-extraido');
  }

  const validation = validateContent({
    text: chapterText,
    expected: { ...expected, epubBoundaryConfirmed, epubChapterConfirmed, ambiguousPages: 0, unexpectedContent },
    kind: 'epub',
  });

  return {
    url: launchUrl,
    format: 'epub',
    status: statusForBook({ format: 'epub', validation, readerLoaded: true, chapterNotFound, expected }),
    text: chapterText,
    chars: chapterText.length,
    source: 'epub',
    readerUrl: res.url,
    readerLoaded: true,
    attempts,
    validation,
    chapterNotFound,
    structural: { ident, nextDocIdent, epubBoundaryConfirmed, epubChapterConfirmed, audit },
    error: null,
  };
}

// ---- Extração pageid (ex.: Hisrich) ----

// Estado VERIFICÁVEL da página: pageid (URL principal, 0-based) e página impressa
// (rótulo do chrome). Ambos avançam deterministicamente na navegação.
async function getCurrentPageState(app) {
  let pageid = null;
  for (const w of allWindows(app)) {
    try {
      const m = w.url().match(/pageid\/(\d+)/);
      if (m) { pageid = parseInt(m[1], 10); break; }
    } catch { /* ignore */ }
  }
  const printed = await getCurrentPrintedPage(app);
  return { pageid, printed };
}

// Aguarda uma mudança VERIFICÁVEL do estado da página (pageid/label) — não um
// tempo fixo. Retorna true se mudou dentro do prazo.
async function waitPageChange(app, prevState, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await getCurrentPageState(app);
    if (s.pageid != null && prevState.pageid != null && s.pageid !== prevState.pageid) return true;
    if (s.printed != null && prevState.printed != null && s.printed !== prevState.printed) return true;
    await waitTimeout(400);
  }
  return false;
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
// ou o limite de páginas (maxPages). Issue B: o conteúdo é associado SOMENTE ao
// frame ATIVO (página exibida), nunca aos frames de prefetch; a navegação aguarda
// mudança verificável do estado (pageid/label) e cada página mantém trilha
// auditável (página, frameId, origem, hash, validação). Associações ambíguas
// impedem `integral`.
async function extractPageid(app, win, launchUrl, expected, opts = {}) {
  const maxPages = opts.maxPages || 120;
  const steps = [];
  const audit = [];
  const trace = Array.isArray(opts.trace) ? opts.trace : null;
  let readerLoaded = false;

  await win.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const loaded = await poll(
    app,
    async () => {
      const frames = await readContentFrameStyles(app);
      const cls = classifyContentFrames(frames);
      return cls.status === 'ok' && cls.active.text && cls.active.text.trim().length > 0 ? true : null;
    },
    { timeoutMs: 35000, interval: 2000 }
  );
  readerLoaded = !!loaded;

  if (!readerLoaded) {
    return {
      url: launchUrl, format: 'pageid', status: 'inaccessible', text: '', chars: 0,
      readerLoaded: false, readerUrl: null, steps, attempts: ['leitor-nao-carregou'], error: 'leitor-nao-carregou',
      validation: validateContent({ text: '', expected, kind: 'pageid' }), audit: [],
    };
  }

  const nextChapter = expected && expected.chapter ? new RegExp(`(?:^|\\n)\\s*Cap[ií]tulo\\s*${expected.chapter + 1}\\b`, 'i') : null;
  const tocPages = await getTocChapterPages(app);
  const nextChapterPage = expected && expected.chapter ? tocPages[expected.chapter + 1] : null;
  const startChapterPage = expected && expected.chapter ? tocPages[expected.chapter] : null;
  const seenHashes = new Map();
  const collected = [];
  const unexpectedContent = [];
  let reachedChapterEnd = false;
  let maxPagesHit = false;
  let ambiguousCount = 0;
  let rawCharsTotal = 0;
  let uniqueCharsTotal = 0;

  let prevState = await getCurrentPageState(app);
  for (let i = 0; i < maxPages; i++) {
    const curPage = prevState.printed;
    // Fim do capítulo: chegou à página impressa onde começa o próximo capítulo
    // (fonte mais confiável: sumário do leitor).
    if (nextChapterPage && curPage != null && curPage >= nextChapterPage) {
      reachedChapterEnd = true; steps.push('pagina-limite-capitulo'); break;
    }

    const frames = await readContentFrameStyles(app);
    if (trace) {
      for (const f of frames) {
        rawCharsTotal += (f.text || '').length;
        trace.push({ step: i, kind: 'frame', page: curPage, frameId: f.id, active: f.active, chars: (f.text || '').length, paras: countParas(f.text), isDup: seenHashes.has(`${curPage}|${sha256((f.text || '').trim())}`), sha256: sha256((f.text || '').trim()), head: (f.text || '').slice(0, 40) });
      }
    }

    const assoc = associateActivePage({ frames, printedPage: curPage, seenHashes });
    audit.push(assoc.audit);
    if (assoc.ambiguous) {
      ambiguousCount++;
      steps.push(assoc.reason);
    } else if (assoc.accepted) {
      collected.push({ page: curPage, text: assoc.text });
      uniqueCharsTotal += assoc.chars;
    }

    // Fallback (sem TOC): cabeçalho "Capítulo N+1" no início de uma página.
    if (!nextChapterPage && collected.length >= 2 && nextChapter && frames.some((f) => nextChapter.test(f.text))) {
      reachedChapterEnd = true; steps.push('cabecalho-capitulo-seguinte'); break;
    }

    const ok = await clickNextPage(app);
    if (!ok) { steps.push('sem-botao-seguinte'); break; }
    const changed = await waitPageChange(app, prevState, 8000);
    if (!changed) { steps.push('sem-mudanca-de-pagina'); break; }
    prevState = await getCurrentPageState(app);
  }
  if (!reachedChapterEnd && collected.length >= maxPages) { maxPagesHit = true; steps.push('limite-de-paginas'); }

  // Conteúdo do próximo capítulo indevidamente incluído?
  if (collected.length && nextChapter) {
    const last = collected[collected.length - 1];
    if (nextChapter.test(last.text.slice(0, 300))) unexpectedContent.push('cabecalho-do-proximo-capitulo-no-ultimo-bloco');
  }

  if (trace) trace.push({
    kind: 'summary',
    steps: steps.slice(),
    collectedPages: collected.length,
    rawCharsTotal,
    uniqueCharsTotal,
    uniqueParas: countParas(collected.map((p) => p.text).join('\n\n')),
    reachedChapterEnd,
    maxPagesHit,
    ambiguousCount,
    startChapterPage,
    nextChapterPage,
    pageSequence: collected.map((p) => p.page),
    collectedHashes: collected.map((p) => ({ page: p.page, chars: p.text.trim().length, sha256: sha256(p.text.trim()) })),
  });

  const text = collected.map((p) => `\n[PÁGINA ${p.page ? 'impressa ' + p.page : '?'}]\n${p.text}`).join('\n\n');
  // Confirma o capítulo pela FAIXA de páginas impressas do sumário (23..45 => cap. 1)
  // quando o TOC foi lido e o fim do capítulo foi alcançado.
  const chapterPageRangeConfirmed = !!(nextChapterPage && reachedChapterEnd);
  const validation = validateContent({
    text,
    expected: { ...expected, reachedChapterEnd, maxPagesHit, chapterPageRangeConfirmed, startChapterPage, nextChapterPage, ambiguousPages: ambiguousCount, unexpectedContent },
    kind: 'pageid',
  });

  return {
    url: launchUrl,
    format: 'pageid',
    status: statusForBook({ format: 'pageid', validation, readerLoaded, chapterNotFound: false, expected }),
    text,
    chars: text.trim().length,
    source: 'pageid',
    readerUrl: null,
    readerLoaded,
    steps,
    attempts: ['navegacao-paginas'],
    validation,
    audit,
    ambiguousCount,
    unexpectedContent,
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
  const attempts = [];
  let det = null;
  // O leitor restaura a última posição e monta os frames de conteúdo de forma
  // assíncrona; um primeiro carregamento pode não expor os frames a tempo. Tenta
  // até DETECT_RETRIES vezes com goto fresco — sem isso, 'unknown' vira um
  // 'inaccessible' falso (erro de leitor, não de conteúdo).
  for (let i = 0; i < 3; i++) {
    det = await detectFormat(app, win, launchUrl);
    if (det.format !== 'unknown' && det.format !== 'reader-auth') { attempts.push(`detectado=${det.format}`); break; }
    attempts.push(`tentativa-${i + 1}-sem-frames-de-conteudo${det.format === 'reader-auth' ? '-sessao-leitor' : ''}`);
    await waitTimeout(3000);
  }
  const base = { url: launchUrl, format: det.format, expected, attempts };

  if (det.format === 'epub') {
    const r = await extractEpub(app, win, launchUrl, expected);
    return { ...r, attempts: [...attempts, ...(r.attempts || [])] };
  }
  if (det.format === 'pageid') {
    const r = await extractPageid(app, win, launchUrl, expected, opts);
    return { ...r, attempts: [...attempts, ...(r.attempts || [])] };
  }
  if (det.format === 'bvpdf' || det.format === 'bvleitor' || det.format === 'reader-auth') {
    const err = det.format === 'reader-auth' ? 'sessao-do-leitor-nao-autorizada' : 'conteudo-em-canvas/DRM-nao-extraivel';
    return {
      ...base, status: 'inaccessible', text: '', chars: 0, source: det.format, readerLoaded: true,
      readerUrl: det.readerUrl, error: err,
      validation: validateContent({ text: '', expected, kind: 'epub' }),
    };
  }
  return {
    ...base, status: 'inaccessible', text: '', chars: 0, source: 'unknown', readerLoaded: false,
    readerUrl: null, error: 'formato-de-leitor-nao-reconhecido',
    validation: validateContent({ text: '', expected, kind: 'epub' }),
  };
}

module.exports = {
  extractBook,
  detectFormat,
  validateContent,
  statusForBook,
  detectRepetitions,
  isActiveFrameStyle,
  classifyContentFrames,
  associateActivePage,
  parseEpubDocIdentity,
  endsAtSentenceBoundary,
  readEpubActiveDocument,
  navigateEpubViaToc,
  getCurrentPageState,
  readContentFrameStyles,
  waitPageChange,
  collectFrames,
  confirmEpubBoundaryDecision,
};
