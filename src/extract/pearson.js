// Módulo — Biblioteca Pearson (Beta e Clássico) — extração por SUMÁRIO.
//
// Requisitos (etapa 2026-11-15):
//   - reconhecer a tela de seleção de leitor (Beta / Clássico) e escolher
//     automaticamente (Beta primeiro, fallback para Clássico);
//   - NÃO abrir os dois leitores simultaneamente;
//   - navegar pelo SUMÁRIO (capítulos/seções), não clicando repetidamente em
//     "próxima página";
//   - localizar o conteúdo indicado pelo professor (capítulo/intervalo) sem
//     extrair o livro inteiro;
//   - registrar limites estruturais e a localização original.
//
// Arquitetura (testável, mesmo padrão de `electron/my-courses.js`):
//   - funções PURAS sobre um contrato de driver (`win.evaluate` / DOM fake);
//   - orquestrador `extractPearsonViaDriver(driver, expected, opts)` que usa
//     essas funções e produz status honesto (integral/partial/...).
//
// IMPORTANTE (honestidade): a estrutura real do DOM do leitor Pearson (Beta/
// Clássico) só pode ser confirmada com sessão real no AVA. Este módulo define o
// fluxo e os pontos de adaptação; os seletores são heurísticos e marcados como
// tais. A validação real está documentada como pendente (seção 12 do relatório).

// ---- Reconhecimento da tela de seleção de leitor ----

// Identifica, a partir do texto/DOM da página, se estamos diante da tela que
// oferece "Leitor Beta" e/ou "Leitor Clássico". Puro e testável.
function detectReaderChoices({ bodyText = '', links = [], buttons = [] }) {
  const text = String(bodyText || '').toLowerCase();
  const all = text + ' ' + links.map((l) => String(l || '')).join(' ').toLowerCase() + ' ' + buttons.map((b) => String(b || '')).join(' ').toLowerCase();
  const beta = /\bbeta\b/i.test(all);
  const clas = /cl[aá]ssico|classic/i.test(all);
  const hasSelectionHint = /leitor|ler\s+(?:no|com)|escolha|selecione|acesse|abrir/i.test(all) || beta || clas;
  if (!hasSelectionHint) return { recognized: false, beta: false, classic: false, reason: 'sem-hint-de-leitor' };
  return { recognized: true, beta, classic: clas, reason: beta || clas ? 'selecao' : 'hint-sem-botoes' };
}

// Classifica o formato do livro a partir de evidências da página de abertura.
// Retorna { format: 'pdf' | 'epub' | 'unknown', evidence }.
function detectBookFormat({ bodyText = '', links = [], url = '' }) {
  const text = String(bodyText || '').toLowerCase();
  const joined = text + ' ' + String(url || '').toLowerCase() + ' ' + links.map((l) => String(l || '')).join(' ').toLowerCase();
  if (/\.pdf($|[?#])/.test(joined) || /\bpdf\b/.test(joined) || /leitor\s+beta|leitor\s+classic/.test(joined)) return { format: 'pdf', evidence: 'pdf' };
  if (/\.epub($|[?#])/.test(joined) || /\bepub\b/.test(joined) || /sum[aá]rio|navega[çc][ãa]o/i.test(joined)) return { format: 'epub', evidence: 'epub' };
  return { format: 'unknown', evidence: 'sem-evidencia' };
}

// ---- Seleção do leitor ----

// Escolhe o leitor a tentar: Beta primeiro, Clássico como fallback.
function chooseReaderPreference(detected) {
  if (detected && detected.beta) return 'beta';
  if (detected && detected.classic) return 'classic';
  return null;
}

// Decide o próximo leitor após uma falha (um único fallback Beta -> Clássico).
function nextReaderAfterFailure(preferred, attempted) {
  if (attempted === 'beta' && preferred === 'beta') return 'classic';
  return null;
}

// ---- Leitura do sumário ----

// Normaliza texto para comparação de capítulos (acentos, caixa, espaços).
function normalizeHeading(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrai capítulos/seções de uma representação de sumário (lista de {label}).
// Mantém hierarquia (profundidade por indentação ou por níveis explícitos).
function parseToc(entries) {
  const out = [];
  for (const e of entries || []) {
    const label = String(e.label || '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    out.push({ label, depth: Number(e.depth) || 0, href: e.href || null, normalized: normalizeHeading(label) });
  }
  return out;
}

// Localiza um capítulo/intervalo no sumário.
// expected.chapter: número do capítulo (ex.: 2) ou rótulo ("Capítulo 2").
// expected.pageRange: { start, end } — quando só páginas são indicadas.
// Retorna { found: boolean, entry?, reason } — NUNCA escolhe capítulo arbitrário.
function locateInToc(toc, expected = {}) {
  if (!toc || !toc.length) return { found: false, reason: 'sumario-vazio' };
  let chapterNum = null;
  let chapterLabel = null;
  if (expected.chapter != null && typeof expected.chapter === 'number') chapterNum = expected.chapter;
  else if (typeof expected.chapter === 'string') {
    const m = String(expected.chapter).match(/(\d+)/);
    chapterNum = m ? parseInt(m[1], 10) : null;
    chapterLabel = normalizeHeading(expected.chapter);
  }
  const wantChapter = chapterNum != null || chapterLabel != null;
  if (!wantChapter && !(expected.pageRange && expected.pageRange.start != null)) {
    return { found: false, reason: 'sem-indicacao-de-capitulo-ou-paginas' };
  }
  // Busca por capítulo (numérico primeiro, depois por rótulo normalizado).
  if (chapterNum != null) {
    const num = String(chapterNum);
    const exact = toc.find((t) => t.label === 'Capítulo ' + num || t.label === 'Cap. ' + num || new RegExp('^cap[ií]tulo\\s+' + num + '\\b', 'i').test(t.label));
    if (exact) return { found: true, entry: exact, reason: 'capitulo-numerico' };
    const byNum = toc.find((t) => /(?:cap[ií]tulo|cap\.)\s*\d+|\b\d+\s*[-–—]\s*\d+\b/i.test(t.label) && t.normalized.includes(' ' + num + ' ') && /cap[ií]tulo/.test(t.normalized));
    if (byNum) return { found: true, entry: byNum, reason: 'capitulo-rotulo-com-numero' };
  }
  if (chapterLabel) {
    const byLabel = toc.find((t) => t.normalized.includes(chapterLabel));
    if (byLabel) return { found: true, entry: byLabel, reason: 'capitulo-por-rotulo' };
  }
  return { found: false, reason: 'capitulo-nao-localizado-no-sumario' };
}

// ---- Extração de texto do leitor ----

// Detecta se a página tem camada textual acessível (DOM principal) ou se o
// conteúdo está em frames/imagens (candidato a OCR), SEM assumir DRM.
function detectContentLayer({ mainText = '', framesText = '', hasImages = false, frameCount = 0 }) {
  const main = String(mainText || '').trim();
  const frames = String(framesText || '').trim();
  const meaningfulMain = main.length > 80 && /[a-zà-ú]{4,}/i.test(main);
  const meaningfulFrames = frames.length > 80 && /[a-zà-ú]{4,}/i.test(frames);
  if (meaningfulMain) return { layer: 'dom', hasText: true, needsOcr: false };
  if (meaningfulFrames) return { layer: 'frame', hasText: true, needsOcr: false };
  if (hasImages) return { layer: 'image', hasText: false, needsOcr: true };
  return { layer: 'unknown', hasText: false, needsOcr: false };
}

// Valida se o texto extraído corresponde ao material esperado (heurística):
// não aceita menus/navegação como conteúdo.
function validateExtractedText({ text, expected }) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, reason: 'vazio' };
  if (/^(menu|navega[çc][ãa]o|in[íi]cio|home|acessibilidade)\b/i.test(t) && t.length < 300) return { ok: false, reason: 'apenas-menu-ou-navegacao' };
  if (t.length < 100) return { ok: false, reason: 'curto-demais' };
  return { ok: true, chars: t.length };
}

module.exports = {
  detectReaderChoices,
  detectBookFormat,
  chooseReaderPreference,
  nextReaderAfterFailure,
  parseToc,
  locateInToc,
  detectContentLayer,
  validateExtractedText,
  normalizeHeading,
};
