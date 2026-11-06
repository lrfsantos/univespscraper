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
// Frame de conteúdo pageid: URL pages/N/content (forma antiga) OU iframe jigsaw
// com identidade pageid (books/<id>/pageid/N?brand=vitalsource&create=true).
// A JANELA DE TOPO (app.minhabiblioteca.../reader/books/.../pageid/N) NÃO é
// conteúdo — fica excluída por exigir o host jigsaw ou a forma pages/N/content.
const PAGEID_CONTENT_RE = /\/pages\/\d+\/content|jigsaw\.minhabiblioteca\.com\.br\/books\/[^\/]+\/pageid\/\d+/i;
const PAGEID_FRAME_RE = /(?:pageid\/(\d+)|pages\/(\d+)\/content)/i;
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

// Aplica a validação ESTRUTURAL (Issue A) à extração: dados os documentos
// efetivamente extraídos e o pacote EPUB (manifest/spine/nav), decide se o
// capítulo é integral pela estrutura — não por pontuação nem por tamanho.
// Puro e testável. Resultado:
//   - used: true se o pacote foi usado (boundaryKnown=true) — passa a ser a
//     evidência mais forte; usa=false quando o pacote não permitir decisão.
//   - endOk: todos os documentos esperados do capítulo presentes E nenhum do
//     capítulo seguinte incluído.
function applyEpubStructuralValidation({ pkg, chapter, extractedDocIds }) {
  const st = ep.validateChapterExtraction({ pkg, chapter, extractedDocIds });
  return {
    used: st.boundaryKnown === true,
    boundaryKnown: st.boundaryKnown === true,
    endOk: st.endOk === true,
    allChapterItemsExtracted: st.allChapterItemsExtracted === true,
    nextChapterIncluded: st.nextChapterIncluded === true,
    chapterIds: st.chapterIds || [],
    nextChapterFirstId: st.nextChapterFirstId || null,
    status: st.status,
    reason: st.reason || null,
    label: st.label || null,
    nextLabel: st.nextLabel || null,
  };
}

// Busca o pacote EPUB real a partir do frame de conteúdo (mesma origem jigsaw),
// sem contornar DRM: apenas fetch same-origin de content.opf/package.opf e
// toc.ncx/nav.xhtml. Retorna { ok, pkg } quando o OPF válido for obtido.
async function fetchEpubPackageFromReader(app) {
  for (const { frame, url } of await collectFrames(app)) {
    if (!EPUB_CONTENT_RE.test(url)) continue;
    const base = url.replace(/\/Text\/[^?#]*.*$/, '/');
    const got = await frame.evaluate(async (baseUrl) => {
      const out = { opf: null, nav: null };
      for (const c of ['content.opf', 'package.opf']) {
        try {
          const r = await fetch(baseUrl + c, { credentials: 'include' });
          if (r.ok) { const t = await r.text(); if (/<spine/i.test(t) && /<manifest/i.test(t)) { out.opf = t; break; } }
        } catch { /* pacote não acessível por esta via */ }
      }
      if (out.opf) {
        for (const c of ['toc.ncx', 'nav.xhtml']) {
          try { const r = await fetch(baseUrl + c, { credentials: 'include' }); if (r.ok) out.nav = await r.text(); } catch { /* nav opcional */ }
        }
      }
      return out;
    }, base).catch(() => null);
    if (got && got.opf) {
      const parsed = ep.parsePackageFromXml({ opfXml: got.opf, ncxXml: got.nav });
      if (parsed.ok) return { ok: true, pkg: parsed.pkg, baseUrl: base, opfChars: got.opf.length, navChars: (got.nav || '').length };
    }
  }
  return { ok: false, reason: 'pacote-epub-indisponivel' };
}

// Caminho do documento EPUB relativo ao pacote a partir da URL do frame de
// conteúdo (ex.: "Text/chapter01.xhtml"). Retorna null se a URL não for de
// conteúdo EPUB.
function epubDocPathFromUrl(url) {
  const m = String(url || '').match(/\/epub\/OEBPS\/([^?#]+\.(?:x?html?))(?:[?#]|$)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

// Navega para o próximo documento dentro do capítulo (multi-XHTML). Considera a
// navegação bem-sucedida SOMENTE se o documento ativo mudou — o comando ter sido
// executado não basta. Retorna { changed, doc }.
async function navigateEpubNextDoc(app) {
  for (const w of allWindows(app)) {
    try {
      const ok = await w.locator('button[aria-label="Seguinte"]').first().click({ timeout: 3000 }).then(() => true).catch(() => false);
      if (!ok) continue;
      const beforeUrl = (await readEpubActiveDocument(app)).url;
      const after = await poll(
        app,
        async () => {
          const d = await readEpubActiveDocument(app);
          if (d.url && d.url !== beforeUrl && (d.text || '').trim().length >= 500) return d;
          return null;
        },
        { timeoutMs: 12000, interval: 2000 }
      );
      return { changed: !!after, doc: after };
    } catch { /* janela indisponível */ }
  }
  return { changed: false, doc: null };
}

// Espera o documento ATIVO do leitor mudar (não apenas a página impressa).
async function waitEpubDocChange(reader, prevDoc, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = await reader.readActive();
    if (d && d.url && d.url !== prevDoc.url && (d.text || '').trim().length >= 500) return d;
    await waitTimeout(1500);
  }
  return null;
}

// Adaptador do leitor EPUB (real ou simulado) usado pela orquestração de produção.
//   waitContent(timeoutMs)  -> { url, text } ou null
//   readActive()            -> { url, text }
//   navigateChapter(n)      -> boolean
//   navigateNextDoc()       -> { changed, doc }
//   fetchPackage()          -> { ok, pkg, ... }
//   expandToc()             -> boolean
function createEpubReaderAdapter(app) {
  return {
    waitContent: (timeoutMs) => poll(
      app,
      async () => {
        const d = await readEpubActiveDocument(app);
        const t = (d.text || '').trim();
        if (t.length >= 500 && !FRONT_RE.test(t.slice(0, 300))) return d;
        return null;
      },
      { timeoutMs, interval: 2000 }
    ),
    readActive: () => readEpubActiveDocument(app),
    navigateChapter: (chapter) => navigateEpubViaToc(app, chapter),
    navigateNextDoc: () => navigateEpubNextDoc(app),
    fetchPackage: () => fetchEpubPackageFromReader(app),
    expandToc: async () => {
      for (const w of allWindows(app)) {
        try { return await w.locator('button:has-text("Expandir tudo")').first().click({ timeout: 3000 }).then(() => true).catch(() => false); } catch { /* ignore */ }
      }
      return false;
    },
  };
}

// Extrai o capítulo esperado com validação ESTRUTURAL do limite (Issue A):
//   - identifica o documento/idref do capítulo no leitor;
//   - quando o PACOTE EPUB está acessível ao frame, usa manifest/spine/nav
//     (epub-structure) para confirmar capítulo e limite — evidência mais forte;
//   - senão, confirma o limite navegando para o capítulo seguinte e verificando a
//     mudança de identidade do documento (mecanismo complementar);
//   - NUNCA usa pontuação final como prova de integridade.
//
// Orquestração de produção com sincronização documental (3.2/3.3):
//   - cada captura é associada à identidade do documento que a produziu;
//   - após qualquer navegação, identidade E texto são revalidados (nunca se
//     reutiliza ident/texto de antes da navegação);
//   - navegação só é considerada bem-sucedida se o documento ativo mudou;
//   - coleta TODOS os documentos do capítulo (multi-XHTML) com dedup;
//   - a validação estrutural usa TODOS os docs capturados (não só o último);
//   - se faltar documento obrigatório ou o limite não for confirmado → parcial.
async function extractEpubViaAdapter(reader, expected, opts = {}) {
  const maxDocAdvances = opts.maxDocAdvances != null ? opts.maxDocAdvances : 3;
  const attempts = [];
  const audit = [];
  const trace = Array.isArray(opts.trace) ? opts.trace : null;

  // 1) Aguarda o leitor carregar com conteúdo significativo.
  let res = await reader.waitContent(35000);
  if (!res) {
    await reader.expandToc().catch(() => {});
    if (expected && expected.chapter) await reader.navigateChapter(expected.chapter);
    res = await reader.waitContent(25000);
    attempts.push(res ? 'retry-navegacao-ok' : 'retry-navegacao-sem-conteudo');
  } else {
    attempts.push('espera-inicial');
  }
  if (!res) {
    return {
      url: null, format: 'epub', status: 'inaccessible', text: '', chars: 0,
      readerLoaded: false, readerUrl: null, attempts, validation: validateContent({ text: '', expected, kind: 'epub' }), error: 'leitor-nao-carregou-conteudo', structural: { audit },
    };
  }

  // 2) Sincronização INICIAL: identidade e texto do documento ATIVO ATUAL.
  let cur = res;
  let ident = parseEpubDocIdentity(cur.url);
  let chapterText = (cur.text || '').trim();
  audit.push({ doc: ident.doc, idref: ident.idref, path: epubDocPathFromUrl(cur.url), status: 'accepted', origin: 'epub-content-frame', hash: sha256(chapterText), chars: chapterText.length });

  // 3) Confirmação do capítulo por identidade estrutural (doc/idref). Se o
  //    documento inicial não for o esperado, navega no sumário e RE-SINCRONIZA
  //    (identidade e texto revalidados — nunca reaproveita a captura anterior).
  const chapterRe = expected.chapter != null ? new RegExp(`chapter0*${expected.chapter}\\b|cap[ií]tulo\\s*${expected.chapter}\\b`, 'i') : null;
  let epubChapterConfirmed = !!(ident && chapterRe && ((ident.doc && chapterRe.test(ident.doc)) || (ident.idref && chapterRe.test(ident.idref))));
  if (!epubChapterConfirmed && expected.chapter) {
    const clicked = await reader.navigateChapter(expected.chapter);
    if (clicked) {
      // Wait curto: salto de capítulo costuma ser rápido; a confirmação definitiva
      // vem da estrutura (passo 5) quando o pacote está disponível.
      const after = await waitEpubDocChange(reader, cur, 5000);
      if (after && after.url !== cur.url) {
        cur = after;
        ident = parseEpubDocIdentity(cur.url);
        chapterText = (cur.text || '').trim();
        epubChapterConfirmed = !!(ident && chapterRe && ((ident.doc && chapterRe.test(ident.doc)) || (ident.idref && chapterRe.test(ident.idref))));
        audit.push({ doc: ident.doc, idref: ident.idref, path: epubDocPathFromUrl(cur.url), status: 'accepted', origin: 'epub-toc-navigation', hash: sha256(chapterText), chars: chapterText.length });
      } else {
        attempts.push('navegacao-capitulo-sem-mudanca-de-documento');
      }
    } else {
      attempts.push('navegacao-capitulo-nao-executada');
    }
  }

  // 4) Pacote estrutural (quando acessível ao frame de conteúdo).
  let structVal = null;
  let packageUsed = false;
  let packageUnavailableReason = null;
  const pkgRes = await reader.fetchPackage();
  if (pkgRes && pkgRes.ok && expected.chapter) {
    packageUsed = true;
    audit.push({ origin: 'epub-structural-package', ok: true, pkgChars: pkgRes.opfChars || 0, navChars: pkgRes.navChars || 0 });
  } else if (expected.chapter) {
    packageUnavailableReason = (pkgRes && pkgRes.reason) || 'pacote-epub-indisponivel';
    attempts.push('pacote-epub-indisponivel: ' + packageUnavailableReason);
  }

  // 5) CAPTURA MULTI-DOCUMENTO: registra cada documento efetivamente capturado,
  //    com dedup por caminho. Se a estrutura espera mais de um documento no
  //    capítulo, navega para coletá-los (limitado) sem incluir outros capítulos.
  const captured = new Map(); // resolvedPath(normalizado) -> { doc, path, text, hash }
  const addCapture = (d) => {
    const p = epubDocPathFromUrl(d.url);
    if (!p) return 'unidentifiable';
    const key = ep.normPath(ep.pkgResolve(pkgRes && pkgRes.pkg, p) || p);
    if (captured.has(key)) return 'duplicate';
    captured.set(key, { doc: d.doc || null, path: p, key, text: (d.text || '').trim(), hash: sha256((d.text || '').trim()) });
    return 'accepted';
  };
  let nextChapterFirstResolved = null;
  let expectedResolved = null;
  // Validação estrutural INICIAL (com o 1º documento) para conhecer os docs
  // esperados do capítulo ANTES da coleta multi-documento.
  if (packageUsed && expected.chapter) {
    const firstIds = [];
    const firstPath = epubDocPathFromUrl(cur.url);
    if (firstPath) firstIds.push(firstPath);
    structVal = applyEpubStructuralValidation({ pkg: pkgRes.pkg, chapter: expected.chapter, extractedDocIds: firstIds });
  }
  if (structVal && structVal.boundaryKnown) {
    expectedResolved = structVal.chapterIds.map((id) => (pkgRes.pkg.manifest[id] && pkgRes.pkg.manifest[id].href ? ep.normPath(ep.pkgResolve(pkgRes.pkg, pkgRes.pkg.manifest[id].href)) : null)).filter(Boolean);
    const nid = structVal.nextChapterFirstId;
    if (nid && pkgRes.pkg.manifest[nid]) nextChapterFirstResolved = ep.normPath(ep.pkgResolve(pkgRes.pkg, pkgRes.pkg.manifest[nid].href));
    // Confirmação de capítulo por EVIDÊNCIA ESTRUTURAL: o documento ativo pertence
    // ao conjunto de documentos do capítulo esperado (não depende do nome do arquivo).
    const firstPath = epubDocPathFromUrl(cur.url);
    if (firstPath && !epubChapterConfirmed) {
      const norm = ep.normPath(ep.pkgResolve(pkgRes.pkg, firstPath));
      if (expectedResolved.includes(norm)) {
        epubChapterConfirmed = true;
        audit.push({ origin: 'epub-structural-chapter', doc: norm, status: 'accepted' });
      }
    }
  }
  addCapture(cur);
  if (expectedResolved && expectedResolved.length > 1) {
    for (let i = 0; i < maxDocAdvances; i++) {
      const haveAll = expectedResolved.every((p) => captured.has(p));
      if (haveAll) { attempts.push('todos-documentos-do-capitulo-capturados'); break; }
      const adv = await reader.navigateNextDoc();
      if (!adv || !adv.changed || !adv.doc) { attempts.push('navegacao-proximo-documento-sem-mudanca'); break; }
      const p = epubDocPathFromUrl(adv.doc.url);
      if (!p) { attempts.push('proximo-documento-sem-caminho-identificavel'); break; }
      // compara sempre no espaço RESOLVIDO/normalizado (mesmo de expectedResolved)
      const norm = ep.normPath(ep.pkgResolve(pkgRes.pkg, p) || p);
      if (nextChapterFirstResolved && norm === nextChapterFirstResolved) { attempts.push('atingiu-inicio-proximo-capitulo'); break; }
      if (expectedResolved && !expectedResolved.includes(norm)) { attempts.push('documento-fora-do-capitulo: ' + p); break; }
      const st = addCapture(adv.doc);
      if (st === 'duplicate') continue;
      if (st === 'accepted') cur = adv.doc;
      else { attempts.push('captura-sem-identidade: ' + st); break; }
      if (trace) trace.push({ kind: 'doc-capture', path: p, chars: (adv.doc.text || '').length, hash: sha256((adv.doc.text || '').trim()) });
    }
  }

  // 6) Validação estrutural com TODOS os documentos capturados.
  const extractedDocIds = [...captured.values()].map((c) => c.path);
  let epubBoundaryConfirmed = false;
  let nextDocIdent = null;
  if (packageUsed && expected.chapter) {
    structVal = applyEpubStructuralValidation({ pkg: pkgRes.pkg, chapter: expected.chapter, extractedDocIds });
    if (structVal.boundaryKnown) {
      epubBoundaryConfirmed = structVal.endOk;
      if (!structVal.endOk) attempts.push('estrutura-epub-nao-confirma-integral');
    }
    audit.push({ origin: 'epub-structural-package', boundaryKnown: structVal.boundaryKnown, endOk: structVal.endOk, allChapterItemsExtracted: structVal.allChapterItemsExtracted, nextChapterIncluded: structVal.nextChapterIncluded, chapterIds: structVal.chapterIds, nextChapterFirstId: structVal.nextChapterFirstId, expectedDocCount: (structVal.chapterIds || []).length, capturedDocIds: extractedDocIds, capturedDocCount: extractedDocIds.length });
  }

  // 7) Mecanismo COMPLEMENTAR (limite): só quando o pacote não permitiu decisão
  //    estrutural. Nunca produz falsa confirmação se o pacote estava disponível
  //    mas o limite não era confirmável (packageUsed=true e boundaryKnown=false).
  if (!packageUsed || (structVal && !structVal.boundaryKnown)) {
    const beforeUrl = cur.url;
    const beforeDoc = parseEpubDocIdentity(beforeUrl);
    if (expected && expected.chapter) {
      const nextClicked = await reader.navigateChapter(expected.chapter + 1);
      if (nextClicked) {
        const after = await waitEpubDocChange(reader, cur, 20000);
        if (after && after.url !== cur.url) {
          nextDocIdent = parseEpubDocIdentity(after.url);
          const nextHead = (after.text || '').trim().slice(0, 200);
          const decision = confirmEpubBoundaryDecision({ beforeDoc, beforeUrl, nextDocIdent, nextHead, chapter: expected.chapter + 1 });
          if (!packageUsed) epubBoundaryConfirmed = decision.confirmed;
          audit.push({ doc: nextDocIdent.doc, idref: nextDocIdent.idref, status: epubBoundaryConfirmed ? 'boundary-next-chapter' : 'boundary-not-confirmed', origin: 'epub-next-chapter-navigation', docChanged: decision.docChanged, nextDocMatches: decision.nextDocMatches, headingMatches: decision.headingMatches, reason: decision.reason });
        } else {
          attempts.push('navegacao-limite-sem-mudanca-de-documento');
        }
      } else {
        attempts.push('navegacao-limite-nao-executada');
      }
    }
  }

  // 8) Texto final: concatenação dos documentos capturados (dedup; ordem de captura).
  const capturedList = [...captured.values()];
  const chapterTextFinal = capturedList.map((c) => `\n[DOC ${c.path}]\n${c.text}`).join('\n\n');
  const chapterNotFound = !!(expected && expected.chapter && !epubChapterConfirmed);
  const unexpectedContent = [];
  if (expected && expected.chapter) {
    const nextHeadingRe = new RegExp(`cap[ií]tulo\\s*${expected.chapter + 1}\\b`, 'i');
    if (nextHeadingRe.test(chapterTextFinal.slice(0, 400))) unexpectedContent.push('cabecalho-do-proximo-capitulo-no-extraido');
  }

  const validation = validateContent({
    text: chapterTextFinal,
    expected: { ...expected, epubBoundaryConfirmed, epubChapterConfirmed, ambiguousPages: 0, unexpectedContent },
    kind: 'epub',
  });

  return {
    url: null,
    format: 'epub',
    status: statusForBook({ format: 'epub', validation, readerLoaded: true, chapterNotFound, expected }),
    text: chapterTextFinal,
    chars: chapterTextFinal.trim().length,
    source: 'epub',
    readerUrl: cur.url,
    readerLoaded: true,
    attempts,
    validation,
    chapterNotFound,
    structural: { ident, nextDocIdent, epubBoundaryConfirmed, epubChapterConfirmed, packageUsed, packageUnavailableReason, structVal, capturedDocIds: extractedDocIds, expectedDocCount: (structVal && structVal.boundaryKnown ? structVal.chapterIds.length : null), audit },
    error: null,
  };
}

// Extrai o capítulo esperado no leitor real (EPUB) com a orquestração de produção.
async function extractEpub(app, win, launchUrl, expected, opts = {}) {
  await win.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const reader = createEpubReaderAdapter(app);
  const r = await extractEpubViaAdapter(reader, expected, opts);
  return { ...r, url: launchUrl };
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

// ---- Sincronização PAGEID: página exibida × frame de conteúdo (Issue B) ----

// Identidade de página de um frame pageid a partir da URL do frame e do src do
// iframe. Sinais observados no leitor real (VitalSource / Minha Biblioteca):
//   - topo:        .../reader/books/<id>/pageid/<N>          (NÃO é conteúdo)
//   - frame:       jigsaw.../books/<id>/pageid/<N>?brand=vitalsource&create=true
//   - (variante)   .../pages/<N>/content
// O `pageid` (0-based, igual ao do topo) é a identidade VERIFICÁVEL do frame; o
// número da PÁGINA IMPRESSA (chrome "Página N") NÃO é igual ao pageid.
function parsePageidFrameIdentity(url, src) {
  const hay = `${url || ''} ${src || ''}`;
  const m = PAGEID_FRAME_RE.exec(hay);
  if (!m) return { pageid: null, pages: null };
  return { pageid: m[1] != null ? parseInt(m[1], 10) : null, pages: m[2] != null ? parseInt(m[2], 10) : null };
}

// Decide se um frame é frame de CONTEÚDO pageid (e não o topo/shell). Puro.
function isPageidContentFrame(url, src) {
  const hay = `${url || ''} ${src || ''}`;
  return /\/pages\/\d+\/content/i.test(hay) || /jigsaw\.minhabiblioteca\.com\.br\/books\/[^\/]+\/pageid\/\d+/i.test(hay);
}

// Lê, no leitor real, os frames de conteúdo pageid com identidade, estilo e texto.
async function readPageidFrames(app) {
  const out = [];
  for (const { frame, url } of await collectFrames(app)) {
    const src = await frame.evaluate(() => { const el = window.frameElement; return el ? el.getAttribute('src') || '' : ''; }).catch(() => '');
    if (!isPageidContentFrame(url, src)) continue;
    const identity = parsePageidFrameIdentity(url, src);
    if (!identity.pageid && !identity.pages) continue;
    const style = await frame.evaluate(() => {
      const el = window.frameElement; if (!el) return null;
      const cs = getComputedStyle(el);
      return { scrolling: el.getAttribute('scrolling'), width: cs.width };
    }).catch(() => null);
    const text = await frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    out.push({
      url, src, identity,
      style,
      active: style ? isActiveFrameStyle(style) : false,
      text: text || '',
      chars: (text || '').length,
      hash: sha256((text || '').trim()),
      frameId: identity.pages != null ? identity.pages : identity.pageid,
    });
  }
  return out;
}

// Aguarda uma mudança VERIFICÁVEL do estado da página (pageid/label) no driver —
// não um tempo fixo. Retorna true se mudou dentro do prazo.
async function waitDriverChange(driver, prevState, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await driver.state();
    if (s.pageid != null && prevState.pageid != null && s.pageid !== prevState.pageid) return true;
    if (s.printed != null && prevState.printed != null && s.printed !== prevState.printed) return true;
    await waitTimeout(400);
  }
  return false;
}

// NÚCLEO da sincronização (Issue B): captura o conteúdo do frame da página EXIBIDA
// somente quando:
//   1. a página exibida (pageid do topo) tem um frame de conteúdo com identidade
//      compatível (pageid do frame == pageid exibido);
//   2. o conteúdo desse frame NÃO é o da página anterior (hash != prevHash) — ou
//      seja, a corrida "interface mostra a página N+1, mas o frame ainda tem a
//      página N" NUNCA atribui conteúdo antigo à página nova (e vice-versa);
//   3. há EXATAMENTE um frame candidato (múltiplos = ambíguo).
// Não usa setTimeout como garantia: espera o estado VERIFICÁVEL do frame atualizar.
// Testável: opera sobre um driver (leitor real ou simulado).
async function syncCaptureFrame(driver, expectedState, prevHash, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const st = await driver.state();
    const frames = await driver.frames();
    const content = frames.filter((f) => f.text && f.text.trim().length > 0);
    const byIdentity = content.filter((f) => f.identity && f.identity.pageid != null && f.identity.pageid === st.pageid);
    last = { st, byIdentity: byIdentity.length };
    if (byIdentity.length === 0) { await waitTimeout(400); continue; }
    if (byIdentity.length > 1) {
      return { status: 'ambiguous', pageid: st.pageid, printed: st.printed, reason: 'multiplos-frames-mesma-identidade', text: null, chars: 0, hash: null, audit: { pageid: st.pageid, printed: st.printed, status: 'ambiguous', reason: 'multiplos-frames-mesma-identidade', frames: byIdentity.map((f) => ({ identity: f.identity.pageid, hash: f.hash })) } };
    }
    const f = byIdentity[0];
    if (prevHash != null && f.hash === prevHash) { await waitTimeout(400); continue; }
    return { status: 'captured', pageid: st.pageid, printed: st.printed, text: f.text, chars: f.chars, hash: f.hash, frameId: f.frameId, identity: f.identity, active: f.active, reason: null, audit: { pageid: st.pageid, printed: st.printed, frameIdentity: f.identity, frameId: f.frameId, origin: 'identity-sync', activeStyle: f.active, hash: f.hash, chars: f.chars, status: 'accepted' } };
  }
  const reason = last && last.byIdentity > 0 ? 'frame-nao-atualizou-conteudo' : 'sem-frame-identificavel';
  return { status: 'rejected', pageid: last ? last.st.pageid : null, printed: last ? last.st.printed : null, text: null, chars: 0, hash: null, reason, audit: { pageid: last ? last.st.pageid : null, printed: last ? last.st.printed : null, status: 'rejected', reason } };
}

// Contrato do driver do leitor pageid (real ou simulado) usado pela extração.
//   state():        { pageid, printed }
//   frames():       frames de conteúdo com { identity:{pageid,pages}, active, text, chars, hash, frameId }
//   next():         Promise<boolean> — navega para a próxima página
//   chapterPages(): { capítulo: página impressa inicial }
function createPageidDriver(app) {
  return {
    state: () => getCurrentPageState(app),
    frames: () => readPageidFrames(app),
    next: () => clickNextPage(app),
    chapterPages: () => getTocChapterPages(app),
  };
}

// Extrai o capítulo esperado com SINCRONIZAÇÃO página×frame (Issue B): captura o
// estado inicial, navega, espera mudança verificável da página, espera o frame
// correspondente atualizar e captura só depois da confirmação de identidade.
async function extractPageidViaSync(driver, expected, opts = {}) {
  const maxPages = opts.maxPages || 120;
  const steps = [];
  const audit = [];
  const trace = Array.isArray(opts.trace) ? opts.trace : null;

  const initFrames = await driver.frames();
  const readerLoaded = initFrames.some((f) => f.text && f.text.trim().length > 0);
  if (!readerLoaded) {
    return {
      url: null, format: 'pageid', status: 'inaccessible', text: '', chars: 0,
      readerLoaded: false, readerUrl: null, steps, attempts: ['leitor-nao-carregou'], error: 'leitor-nao-carregou',
      validation: validateContent({ text: '', expected, kind: 'pageid' }), audit: [],
    };
  }

  const nextChapter = expected && expected.chapter ? new RegExp(`(?:^|\\n)\\s*Cap[ií]tulo\\s*${expected.chapter + 1}\\b`, 'i') : null;
  const tocPages = await driver.chapterPages();
  const nextChapterPage = expected && expected.chapter ? tocPages[expected.chapter + 1] : null;
  const startChapterPage = expected && expected.chapter ? tocPages[expected.chapter] : null;
  const collected = [];
  const unexpectedContent = [];
  let reachedChapterEnd = false;
  let maxPagesHit = false;
  let ambiguousCount = 0;
  let rawCharsTotal = 0;
  let uniqueCharsTotal = 0;
  let prevHash = null;

  let prevState = await driver.state();
  for (let i = 0; i < maxPages; i++) {
    const curPage = prevState.printed;
    if (nextChapterPage && curPage != null && curPage >= nextChapterPage) {
      reachedChapterEnd = true; steps.push('pagina-limite-capitulo'); break;
    }

    const sync = await syncCaptureFrame(driver, prevState, prevHash, 8000);
    audit.push(sync.audit);
    if (trace) trace.push({ step: i, kind: 'sync', pageid: sync.pageid, printed: sync.printed, status: sync.status, reason: sync.reason, chars: sync.chars || 0, hash: sync.hash, frameId: sync.frameId ?? null, activeStyle: sync.active ?? null });

    if (sync.status === 'ambiguous') {
      ambiguousCount++;
      steps.push('associacao-ambigua');
    } else if (sync.status === 'captured') {
      collected.push({ page: sync.printed, pageid: sync.pageid, text: sync.text });
      uniqueCharsTotal += sync.chars;
      rawCharsTotal += sync.chars;
      prevHash = sync.hash;
    } else {
      steps.push(sync.reason === 'frame-nao-atualizou-conteudo' ? 'frame-sem-conteudo-atualizado' : 'sem-frame-identificavel');
      break;
    }

    if (!nextChapterPage && collected.length >= 2 && nextChapter && sync.status === 'captured' && nextChapter.test(sync.text.slice(0, 300))) {
      reachedChapterEnd = true; steps.push('cabecalho-capitulo-seguinte'); break;
    }

    const ok = await driver.next();
    if (!ok) { steps.push('sem-botao-seguinte'); break; }
    const changed = await waitDriverChange(driver, prevState, 8000);
    if (!changed) { steps.push('sem-mudanca-de-pagina'); break; }
    prevState = await driver.state();
  }
  if (!reachedChapterEnd && collected.length >= maxPages) { maxPagesHit = true; steps.push('limite-de-paginas'); }

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
    pageidSequence: collected.map((p) => p.pageid),
    collectedHashes: collected.map((p) => ({ page: p.page, pageid: p.pageid, chars: p.text.trim().length, sha256: sha256(p.text.trim()) })),
  });

  const text = collected.map((p) => `\n[PÁGINA ${p.page ? 'impressa ' + p.page : '?'}]\n${p.text}`).join('\n\n');
  const chapterPageRangeConfirmed = !!(nextChapterPage && reachedChapterEnd);
  const validation = validateContent({
    text,
    expected: { ...expected, reachedChapterEnd, maxPagesHit, chapterPageRangeConfirmed, startChapterPage, nextChapterPage, ambiguousPages: ambiguousCount, unexpectedContent },
    kind: 'pageid',
  });

  return {
    url: null,
    format: 'pageid',
    status: statusForBook({ format: 'pageid', validation, readerLoaded, chapterNotFound: false, expected }),
    text,
    chars: text.trim().length,
    source: 'pageid',
    readerUrl: null,
    readerLoaded,
    steps,
    attempts: ['navegacao-paginas-sincronizada'],
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

// Extrai o capítulo esperado no leitor real com sincronização página×frame.
async function extractPageid(app, win, launchUrl, expected, opts = {}) {
  await win.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const loaded = await poll(
    app,
    async () => {
      const frames = await readPageidFrames(app);
      return frames.some((f) => f.text && f.text.trim().length > 0) ? true : null;
    },
    { timeoutMs: 35000, interval: 2000 }
  );
  if (!loaded) {
    return {
      url: launchUrl, format: 'pageid', status: 'inaccessible', text: '', chars: 0,
      readerLoaded: false, readerUrl: null, steps: [], attempts: ['leitor-nao-carregou'], error: 'leitor-nao-carregou',
      validation: validateContent({ text: '', expected, kind: 'pageid' }), audit: [],
    };
  }
  const driver = createPageidDriver(app);
  const r = await extractPageidViaSync(driver, expected, opts);
  return { ...r, url: launchUrl };
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
  allWindows,
  clickNextPage,
  getCurrentPrintedPage,
  parsePageidFrameIdentity,
  isPageidContentFrame,
  readPageidFrames,
  syncCaptureFrame,
  waitDriverChange,
  createPageidDriver,
  extractPageidViaSync,
  applyEpubStructuralValidation,
  fetchEpubPackageFromReader,
  extractEpubViaAdapter,
  createEpubReaderAdapter,
  epubDocPathFromUrl,
  navigateEpubNextDoc,
  waitEpubDocChange,
};
