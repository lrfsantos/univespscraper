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
//
// ATUALIZAÇÃO (descobertas reais 2026-11-18): a tela de seleção REAL tem os
// botões `#pdf-novo` (Beta) e `#pdf` (Clássico). A presença desses ids é a
// evidência mais forte; o texto continua como fallback (e para testes).
// Parâmetro `ids`: ids de elementos presentes na página (array de strings).
function detectReaderChoices({ bodyText = '', links = [], buttons = [], ids = [] } = {}) {
  const idsNorm = (Array.isArray(ids) ? ids : []).map((x) => String(x)).filter(Boolean);
  const hasBetaId = idsNorm.indexOf('pdf-novo') !== -1;
  const hasClassicId = idsNorm.indexOf('pdf') !== -1;
  const text = String(bodyText || '').toLowerCase();
  const all = text + ' ' + links.map((l) => String(l || '')).join(' ').toLowerCase() + ' ' + buttons.map((b) => String(b || '')).join(' ').toLowerCase();
  const beta = /\bbeta\b/i.test(all);
  const clas = /cl[aá]ssico|classic/i.test(all);
  if (hasBetaId || hasClassicId) {
    return { recognized: true, beta: hasBetaId || beta, classic: hasClassicId || clas, reason: 'selecao-ids-reais' };
  }
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
// Campos opcionais preservados quando presentes na entrada:
//   - summaryItemIndex: índice N do botão real `#summary-item-N` (leitor Beta);
//   - dataPagina: página PDF do item `li.box-capt[data-pagina]` (leitor Clássico);
//   - active: item atual do sumário (marcador `SummaryItem_active`).
function parseToc(entries) {
  const out = [];
  for (const e of entries || []) {
    const label = String(e.label || '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const item = { label, depth: Number(e.depth) || 0, href: e.href || null, normalized: normalizeHeading(label) };
    if (e.summaryItemIndex != null) item.summaryItemIndex = e.summaryItemIndex;
    if (e.dataPagina != null) item.dataPagina = e.dataPagina;
    if (e.active) item.active = true;
    out.push(item);
  }
  return out;
}

// ---- Sumários com os seletores REAIS (descobertas 2026-11-18) ----

// Leitor Beta: itens são botões `button#summary-item-N` cujo texto visível pode
// vir truncado ("...") — o nome completo está em `aria-label`. Entrada real:
// [{ id: 'summary-item-0', text, aria, active }].
function parseTocFromSummaryItems(items) {
  const entries = [];
  for (const it of items || []) {
    const id = String((it && it.id) || '');
    const m = id.match(/^summary-item-(\d+)$/);
    const label = String((it && (it.aria || it.text)) || '').replace(/\s+/g, ' ').trim();
    if (!m || !label) continue;
    entries.push({ label, summaryItemIndex: parseInt(m[1], 10), active: !!(it && it.active), normalized: normalizeHeading(label) });
  }
  return parseToc(entries);
}

// Leitor Clássico: itens são `li.box-capt[data-pagina]` com `p[id]` = nome da
// seção e `p[aria-label="Acesse {nome}"]`. Entrada real:
// [{ dataPagina: 12, label: 'Unidade 1: Empreendedorismo' }].
function parseTocClassic(items) {
  const entries = [];
  for (const it of items || []) {
    const pagina = Number(it && it.dataPagina);
    const label = String((it && it.label) || '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(pagina) || !label) continue;
    entries.push({ label, dataPagina: pagina, normalized: normalizeHeading(label) });
  }
  return parseToc(entries);
}

// Classifica o NÍVEL ESTRUTURAL de um rótulo de sumário a partir de EVIDÊNCIA
// de numeração no próprio rótulo — nunca inventa profundidade (auditoria §6).
//   'unidade'     "Unidade N: {título}"
//   'capitulo'    "Capítulo N" / "Cap. N"
//   'subcapitulo' "N.M {título}" (numeração hierárquica sob o capítulo N)
//   'outro'       sem numeração reconhecida ("Referências", títulos livres).
// Retorna { level, num, subnum }. Puro e testável.
function classifyTocLevel(label) {
  const s = String(label || '').trim();
  let m = s.match(/^unidade\s+(\d+)\b/i);
  if (m) return { level: 'unidade', num: parseInt(m[1], 10), subnum: null };
  m = s.match(/^cap[ií]tulo\s+(\d+)\b/i) || s.match(/^cap\.\s*(\d+)\b/i);
  if (m) return { level: 'capitulo', num: parseInt(m[1], 10), subnum: null };
  m = s.match(/^(\d+)\.(\d+)\b/);
  if (m) return { level: 'subcapitulo', num: parseInt(m[1], 10), subnum: parseInt(m[2], 10) };
  return { level: 'outro', num: null, subnum: null };
}

// Fronteira de fim do capítulo: o PRÓXIMO item do sumário no MESMO nível
// estrutural (respeita a hierarquia — auditoria §6). Regras (evidência de
// numeração em classifyTocLevel; sem hierarquia disponível no DOM real, nada é
// inventado):
//   - subcapítulos "N.M" NUNCA encerram o capítulo "N" ao qual pertencem;
//   - capítulos/subcapítulos NUNCA encerram a unidade que os contém;
//   - entradas repetidas do mesmo rótulo (unidade dividida) são ignoradas;
//   - se a hierarquia não pode ser determinada, retorna `ambiguous: true` —
//     o chamador NÃO pode declarar extração integral (fail-closed).
// Retorna { index, endPage, ambiguous?, reason? } — endPage é a página PDF
// inicial do próximo item de fronteira (Clássico, `dataPagina`) ou null
// (Beta/indeterminado), caso em que o chamador aplica limite duro e status
// honesto.
function chapterEndBoundary(toc, entry) {
  const list = toc || [];
  const idx = list.indexOf(entry);
  if (!entry || idx === -1) return { index: list.length, endPage: null, ambiguous: true, reason: 'entrada-fora-do-sumario' };
  const self = classifyTocLevel(entry.label);
  for (let i = idx + 1; i < list.length; i++) {
    const t = list[i];
    if (t.normalized === entry.normalized) continue; // mesmo rótulo repetido
    const lv = classifyTocLevel(t.label);
    // Subcapítulo "N.M" pertence ao capítulo "N" atual: não é fronteira.
    if (self.level === 'capitulo' && lv.level === 'subcapitulo' && lv.num === self.num) continue;
    // Capítulo/subcapítulo pertence à unidade atual: não é fronteira dela.
    if (self.level === 'unidade' && (lv.level === 'capitulo' || lv.level === 'subcapitulo')) continue;
    return { index: i, endPage: t.dataPagina != null ? t.dataPagina : null, ambiguous: false };
  }
  // Sem item de fronteira: pode ser fim do livro OU hierarquia indeterminada.
  // Em ambos os casos a completude não fica comprovada — nunca integral.
  return { index: list.length, endPage: null, ambiguous: true, reason: self.level === 'outro' ? 'hierarquia-indeterminada' : 'sem-proximo-item-distinto' };
}

// Localiza um capítulo/intervalo no sumário SEM escolher arbitrariamente
// (auditoria §6): reúne TODAS as correspondências e decide por evidência —
//   - correspondência EXATA única → found;
//   - 2+ correspondências do mesmo critério (títulos duplicados, capítulos com
//     numeração semelhante, unidade e capítulo coincidentes) → `ambiguous`,
//     NUNCA a primeira ocorrência silenciosa;
//   - rótulos parcialmente semelhantes são marcados `approximate: true` (o
//     chamador trata como evidência mais fraca).
// expected.chapter: número do capítulo (ex.: 2) ou rótulo ("Capítulo 2").
// expected.pageRange: { start, end } — quando só páginas são indicadas.
// Retorna { found: boolean, entry?, reason, ambiguous?, matches? }.
//
// ATUALIZAÇÃO (descobertas reais 2026-11-18): os livros reais da UNIVESP usam
// "Unidade N: {título}" (não "Capítulo N"). A numeração por Unidade é reconhecida
// DEPOIS da numeração por Capítulo (compatibilidade com testes existentes).
// Com `pageRange` e um sumário do Clássico (itens com `dataPagina`), a localização
// usa a fronteira de página real; sem isso, falha fechada (sem escolha arbitrária).
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
  const ambiguous = (reason, n) => ({ found: false, ambiguous: true, reason, matches: n });
  // Busca por capítulo (numérico primeiro, depois por rótulo normalizado).
  if (chapterNum != null) {
    const num = String(chapterNum);
    const exact = toc.filter((t) => t.label === 'Capítulo ' + num || t.label === 'Cap. ' + num || new RegExp('^cap[ií]tulo\\s+' + num + '\\b', 'i').test(t.label));
    if (exact.length === 1) return { found: true, entry: exact[0], reason: 'capitulo-numerico' };
    if (exact.length > 1) return ambiguous('capitulo-duplicado-no-sumario', exact.length);
    const byNum = toc.filter((t) => /(?:cap[ií]tulo|cap\.)\s*\d+|\b\d+\s*[-–—]\s*\d+\b/i.test(t.label) && t.normalized.includes(' ' + num + ' ') && /cap[ií]tulo/.test(t.normalized));
    if (byNum.length === 1) return { found: true, entry: byNum[0], reason: 'capitulo-rotulo-com-numero', approximate: true };
    if (byNum.length > 1) return ambiguous('capitulo-ambiguo-no-sumario', byNum.length);
    // Livros reais UNIVESP/Pearson: "Unidade N: {título}".
    const byUnidade = toc.filter((t) => new RegExp('^unidade\\s+' + num + '\\b', 'i').test(t.label));
    if (byUnidade.length === 1) return { found: true, entry: byUnidade[0], reason: 'unidade-numerica' };
    if (byUnidade.length > 1) return ambiguous('unidade-duplicada-no-sumario', byUnidade.length);
  }
  if (chapterLabel) {
    const byLabel = toc.filter((t) => t.normalized.includes(chapterLabel));
    if (byLabel.length === 1) return { found: true, entry: byLabel[0], reason: 'capitulo-por-rotulo', approximate: true };
    if (byLabel.length > 1) return ambiguous('titulo-duplicado-no-sumario', byLabel.length);
  }
  // Intervalo de páginas com sumário que tem páginas reais (Clássico, `dataPagina`).
  // Exigência de fronteira EXATA: sem mapeamento real, não escolhe.
  if (!wantChapter && expected.pageRange && expected.pageRange.start != null) {
    const start = expected.pageRange.start;
    const byPage = toc.filter((t) => t.dataPagina != null && t.dataPagina === start);
    if (byPage.length === 1) return { found: true, entry: byPage[0], reason: 'paginas-data-pagina' };
    if (byPage.length > 1) return ambiguous('pagina-duplicada-no-sumario', byPage.length);
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
  parseTocFromSummaryItems,
  parseTocClassic,
  classifyTocLevel,
  chapterEndBoundary,
  locateInToc,
  detectContentLayer,
  validateExtractedText,
  normalizeHeading,
};
