// Módulo — OCR para PDFs digitalizados (camada de decisão e qualidade).
//
// Escopo REAL desta rodada (honestidade): implementar a camada DETERMINÍSTICA e
// testável de decisão e validação de qualidade do OCR. A execução efetiva de OCR
// (motor de reconhecimento) é PLUGGABLE e NÃO é executada nesta máquina (não há
// evidência de que um motor empacotado no Electron/Windows funcione aqui). O
// relatório marca a execução real como PENDENTE (seção 12 do prompt).
//
// CAMINHO PRIMÁRIO PARA OS LEITORES PEARSON (descobertas reais 2026-11-18,
// ver DESCOBERTAS-PEARSON-2026-11-18.md): o "vendor OCR" já embutido nos
// próprios leitores é a fonte primária de texto —
//   - Beta: `alt` de img[class^="PdfImageView_pageImage"];
//   - Clássico: `aria-label` de #divBookMark na resposta do XHR /Leitor/pagination.
// Ambos cobrem texto comum e tabelas (fórmulas matemáticas saem corrompidas no
// `alt` — limitação do próprio leitor). tesseract.js sobre a imagem da página
// (`page-N.jpg`, URL assinada do CDN) é o FALLBACK para páginas sem vendor OCR
// suficiente. SEM soluções pagas. Este módulo segue sendo APENAS decisão/
// qualidade: identify pages without text layer, validate quality; NÃO contém
// motor de reconhecimento.
//
// Decisões implementadas (puras e testáveis):
//   - identificar páginas SEM camada textual (candidatas a OCR);
//   - decidir QUAIS páginas precisam de OCR (evitar OCR desnecessário);
//   - validar a QUALIDADE do texto reconhecido (vazio, curto, ilegível,
//     caracteres de substituição, repetição anormal, ordem, paginação);
//   - produzir status honesto por página (PASS/PARTIAL/FAIL).
//
// Contrato do motor de OCR (injetável, não acoplado):
//   async ocrPage({ pageIndex, imageBuffer, lang }) -> { text, confidence }
// O módulo NÃO importa nenhum motor; o fluxo de produção (pdfs.js) fica
// responsável por prover um motor real quando disponível.

// ---- Detecção de páginas escaneadas ----

// Limiar de texto mínimo para considerar que uma página TEM camada textual
// (um PDF digitalizado costuma retornar poucos ou nenhum caractere).
const MIN_TEXT_CHARS = 40;

// Classifica cada página: 'text' (tem camada textual suficiente) | 'scanned'
// (candidata a OCR) | 'unknown' (sem dados).
function classifyPageText(page) {
  const chars = Number(page && page.chars != null ? page.chars : String(page && page.text || '').length);
  if (page && page.error) return { needsOcr: false, kind: 'unknown', reason: 'erro-pagina', chars };
  if (chars >= MIN_TEXT_CHARS) return { needsOcr: false, kind: 'text', chars };
  if (chars === 0) return { needsOcr: true, kind: 'scanned', reason: 'sem-texto', chars };
  return { needsOcr: true, kind: 'scanned', reason: 'texto-insuficiente', chars };
}

// Decide, para um lote de páginas, quais devem passar por OCR.
// Evita rodar OCR em PDF que já tem camada textual boa em todas as páginas.
function planOcr(pages) {
  const perPage = (pages || []).map((p, i) => ({ pageIndex: p.pageIndex != null ? p.pageIndex : i + 1, ...classifyPageText(p) }));
  const toOcr = perPage.filter((p) => p.needsOcr).map((p) => p.pageIndex);
  const withText = perPage.filter((p) => !p.needsOcr && p.kind === 'text').length;
  const allScanned = toOcr.length === (pages || []).length && (pages || []).length > 0;
  return { perPage, toOcr, withText, allScanned, needsOcr: toOcr.length > 0 };
}

// ---- Validação de qualidade do texto reconhecido ----

// Caracteres de substituição típicos de OCR ruim.
const REPLACEMENT_RE = /[\uFFFD\u25A1\u25A0\u2588]/g;

// Detecção de caracteres ilegíveis: proporção de caracteres "estranhos".
function countSuspiciousChars(text) {
  const t = String(text || '');
  const repl = (t.match(REPLACEMENT_RE) || []).length;
  const alpha = (t.match(/[a-zA-Zà-úÀ-Ú]/g) || []).length;
  return { replacement: repl, alpha, total: t.length };
}

// Repetição anormal de linhas (OCR que repete o mesmo bloco).
function detectLineRepetition(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 20);
  const seen = new Map();
  for (const l of lines) seen.set(l, (seen.get(l) || 0) + 1);
  const dupLines = [];
  for (const [l, n] of seen) if (n > 1) dupLines.push({ length: l.length, count: n });
  return dupLines;
}

// Valida a qualidade do resultado de OCR de uma página.
// Retorna { status: 'PASS'|'PARTIAL'|'FAIL', reason?, confidence? }.
function validateOcrQuality({ text, confidence = null }) {
  const t = String(text || '').trim();
  if (!t) return { status: 'FAIL', reason: 'pagina-vazia' };
  if (t.length < MIN_TEXT_CHARS) return { status: 'PARTIAL', reason: 'texto-curto', chars: t.length };
  const susp = countSuspiciousChars(t);
  if (susp.replacement > 0 && susp.replacement / Math.max(1, t.length) > 0.05) {
    return { status: 'PARTIAL', reason: 'caracteres-de-substituicao', replacement: susp.replacement };
  }
  // Proporção absurdamente baixa de letras em relação ao total → ilegível.
  if (t.length > 0 && susp.alpha / t.length < 0.1) {
    return { status: 'PARTIAL', reason: 'poucas-letras-ilegivel', alpha: susp.alpha, total: t.length };
  }
  const reps = detectLineRepetition(t);
  if (reps.length > 0 && reps.some((r) => r.count >= 3)) {
    return { status: 'PARTIAL', reason: 'repeticao-anormal-de-linhas', count: reps.length };
  }
  if (confidence != null && confidence < 0.5) return { status: 'PARTIAL', reason: 'confianca-baixa', confidence };
  return { status: 'PASS', confidence };
}

// Compõe o texto OCR de um lote preservando a ORDEM e separação de páginas.
function composeOcrPages(ocrResults) {
  const sorted = [...(ocrResults || [])].sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));
  const parts = [];
  for (const r of sorted) {
    const t = String(r.text || '').trim();
    if (t) parts.push(`[página ${r.pageIndex}]\n${t}`);
  }
  return parts.join('\n\n');
}

module.exports = {
  MIN_TEXT_CHARS,
  classifyPageText,
  planOcr,
  countSuspiciousChars,
  detectLineRepetition,
  validateOcrQuality,
  composeOcrPages,
};
