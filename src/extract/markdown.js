// Módulo 6 — Escritores Markdown por recurso (seção 4 do plano de lançamento).
// Cada recurso compatível gera um documento `.md` individual e COMPLETO, com o
// conteúdo ORIGINAL obtido (nunca resumido/reescrito) e metadados de origem,
// rastreabilidade e fidelidade. Funções PURAS (entrada -> string), testáveis com
// fixtures sintéticas. Não inventa dados: campos ausentes são registrados como
// ausentes/desconhecidos, nunca preenchidos por suposição.

const PKG = require('../../package.json');
const EXTRACTOR_VERSION = PKG && PKG.version ? PKG.version : 'desconhecida';

// Metadados do extrator para rastreabilidade. `commit` só existe quando fornecido
// no build (variável de ambiente) ou nos testes — nunca inventado.
function extractorMeta(over = {}) {
  return {
    version: over.version || EXTRACTOR_VERSION,
    commit: over.commit || process.env.UNIVESP_EXTRACTOR_COMMIT || 'desconhecido',
    extractedAt: over.extractedAt || new Date().toISOString(),
  };
}

function line(k, v) {
  return `- ${k}: ${v == null || v === '' ? '—' : v}`;
}

function boolTxt(v) {
  return v === true ? 'sim' : v === false ? 'não' : '—';
}

// ---------- 4.1 Documento de página HTML ----------
function renderPageDocument({ entry, course, week, meta = {} }) {
  const m = extractorMeta(meta);
  const rows = [
    '# Documento de página (HTML do AVA)',
    '',
    line('Nome do recurso', entry.text || entry.id),
    line('Disciplina', course && (course.title || course.code || course.id)),
    line('Semana', week && (week.name || week.id)),
    line('Rótulo no AVA', entry.text),
    line('URL original', entry.url),
    line('Título HTML', entry.title),
    line('Data da extração', m.extractedAt),
    line('Status', entry.status),
    line('Autor/autoria', null),
    '',
    '## Conteúdo textual integral obtido',
    '',
    (entry.pageContent || '').trim() || '_Sem conteúdo textual extraído._',
  ];
  if (Array.isArray(entry.embedded) && entry.embedded.length) {
    rows.push('', '## Recursos incorporados descobertos nesta página', '');
    for (const e of entry.embedded) {
      rows.push(`- [${e.status}] ${e.text || e.id} (${e.kind}): ${e.url}`);
    }
  }
  if (Array.isArray(entry.loadWarnings) && entry.loadWarnings.length) {
    rows.push('', '## Observações de fidelidade', '');
    for (const w of entry.loadWarnings) rows.push(`- ${w}`);
  }
  rows.push('', '## Rastreabilidade', '');
  rows.push(line('Versão do extrator', m.version));
  rows.push(line('Commit do extrator', m.commit));
  rows.push('');
  return rows.join('\n');
}

// ---------- 4.2 Documento de PDF ----------
// Distinção obrigatória: número da página no ARQUIVO (pageIndex) × número
// IMPRESSO (printedPagination.detected[pageIndex-1]) × página NÃO identificada.
function renderPdfDocument({ entry, course, week, meta = {} }) {
  const m = extractorMeta(meta);
  const pages = Array.isArray(entry.pages) ? entry.pages : [];
  const printed = (entry.printedPagination && entry.printedPagination.detected) || [];
  const withText = pages.filter((p) => p.text && p.text.trim().length > 0).length;
  const withoutText = pages.filter((p) => !p.text || !p.text.trim().length).length;
  const withError = pages.filter((p) => p.error).length;
  const info = entry.info || {};
  const rows = [
    '# Documento de PDF',
    '',
    line('Disciplina', course && (course.title || course.code || course.id)),
    line('Semana', week && (week.name || week.id)),
    line('Nome do recurso no AVA', entry.text || entry.id),
    line('URL de origem', entry.url),
    line('Nome original do arquivo', entry.pdfFile),
    (entry.pdfFile ? `- PDF original (relativo): [Abrir o arquivo PDF](${encodeURI(entry.pdfFile)})` : 'PDF original (relativo): não preservado'),
    line('Tamanho (bytes)', entry.bytes),
    line('SHA-256 do PDF baixado', entry.sha256),
    line('Título (metadados do arquivo)', info.Title || info.title),
    line('Autor (metadados do arquivo)', info.Author || info.author),
    line('Total de páginas do arquivo', entry.totalPagesArquivo),
    line('Páginas efetivamente analisadas', pages.length),
    line('Páginas com texto', withText),
    line('Páginas sem texto', withoutText),
    line('Páginas com erro', withError),
    line('Paginação impressa (confiabilidade declarada)', (entry.printedPagination && entry.printedPagination.reliable) || 'none'),
    line('Data da extração', m.extractedAt),
    line('Status de fidelidade', entry.status),
    line('Observações e limitações', entry.error ? `falha no PDF: ${entry.error}` : null),
    '',
  ];
  if (pages.length === 0) {
    rows.push('_Não foi possível extrair texto por página deste PDF._');
  }
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const printedNum = printed[i];
    const num = p.pageIndex != null ? p.pageIndex : i + 1;
    const label = printedNum != null
      ? `## Página do arquivo ${num} (página impressa ${printedNum})`
      : `## Página do arquivo ${num} (página impressa não identificada)`;
    rows.push(label, '');
    if (p.error) {
      rows.push(`_Erro ao extrair esta página: ${p.error}_`, '');
    } else {
      rows.push((p.text || '').trim() || '_Página sem texto extraível (ex.: página escaneada). Não é reivindicada extração integral._', '');
    }
  }
  rows.push('## Rastreabilidade', '');
  rows.push(line('Versão do extrator', m.version));
  rows.push(line('Commit do extrator', m.commit));
  rows.push('');
  return rows.join('\n');
}

// ---------- 4.3 Documento de livro digital / EPUB / PAGEID ----------
function renderReadingDocument({ entry, course, week, meta = {} }) {
  const m = extractorMeta(meta);
  const expected = entry.expected || {};
  const rows = [
    '# Documento de leitura (livro digital)',
    '',
    line('Disciplina', course && (course.title || course.code || course.id)),
    line('Semana', week && (week.name || week.id)),
    line('Nome da leitura', entry.text || entry.id),
    line('Livro', expected.book || entry.bookName),
    line('Autor', entry.author),
    line('Edição/ano', entry.edition),
    line('Editora', entry.publisher),
    line('URL de origem', entry.url),
    line('Capítulo solicitado pelo AVA', expected.hasChapter ? expected.chapter : (expected.chapter != null ? expected.chapter : 'não declarado')),
    line('Intervalo de páginas solicitado pelo AVA', expected.hasPageRange ? `${expected.pageRange.start}${expected.pageRange.end != null ? ` a ${expected.pageRange.end}` : ''}` : 'não declarado'),
    line('Status', entry.status),
    line('Formato detectado', entry.format || entry.subKind),
    line('Data da extração', m.extractedAt),
    line('Evidência de começo/meio/fim', entry.evidenceNotes || null),
    line('Evidência do limite estrutural do capítulo', entry.endOk === true ? 'confirmado' : (entry.endOk === false ? 'não confirmado' : '—')),
    line('Intervalo de páginas declarado confirmado', entry.pageRangeOk === true ? 'sim' : (entry.pageRangeOk === false ? 'não (conservador)' : '—')),
    line('Faixa de páginas extraída', entry.pageRangeNote),
    line('Páginas identificadas', entry.identifiedPages != null ? entry.identifiedPages : null),
    line('Documentos XHTML capturados (EPUB)', entry.xhtmlDocs != null ? entry.xhtmlDocs : null),
    line('Observações de sincronização', entry.syncNotes || null),
    line('Limitações', entry.reason || entry.failureType || null),
    '',
  ];
  const body = (entry.bookText || '').trim();
  if (body) {
    rows.push('## Conteúdo acadêmico extraído', '');
    rows.push(body, '');
  } else {
    rows.push('_Conteúdo não extraído integralmente._', '');
  }
  rows.push('## Rastreabilidade', '');
  rows.push(line('Versão do extrator', m.version));
  rows.push(line('Commit do extrator', m.commit));
  rows.push('');
  return rows.join('\n');
}

// ---------- 4.4 Documento de videoaula ----------
// A transcrição (quando disponível) é preservada INTEGRALMENTE, na ordem dos
// segmentos e com os timestamps — nunca resumida nem corrigida por inferência.
function renderVideoDocument({ entry, course, week, meta = {} }) {
  const m = extractorMeta(meta);
  const segments = Array.isArray(entry.segments) ? entry.segments : [];
  const rows = [
    '# Documento de videoaula',
    '',
    line('Disciplina', course && (course.title || course.code || course.id)),
    line('Semana', week && (week.name || week.id)),
    line('Título da videoaula', entry.text || entry.id),
    line('URL original', entry.url),
    line('Plataforma', entry.isYoutube ? 'YouTube' : (entry.platform || 'não reconhecida')),
    line('ID do vídeo', entry.videoId),
    line('Origem do vídeo', entry.sourcePage ? `incorporado na página: ${entry.sourcePage}` : 'link direto'),
    line('Data da extração', m.extractedAt),
    line('Disponibilidade de transcrição', boolTxt(entry.transcriptAvailable)),
    line('Idioma da transcrição', entry.transcriptLang),
    line('Tipo de legenda', entry.captionType || '—'),
    line('Quantidade de segmentos', segments.length || (entry.transcript ? 1 : 0)),
    line('Duração estimada', entry.duration),
    line('Status', entry.status),
    line('Motivo de indisponibilidade', entry.transcriptNote || null),
    line('Versão/commit do extrator', `${m.version} (${m.commit})`),
    '',
  ];
  if (segments.length) {
    rows.push('## Transcrição (segmentos com timestamps, ordem preservada)', '');
    for (const s of segments) {
      const ts = s.offset != null ? formatTs(s.offset) : null;
      rows.push(`**[${ts}]** ${(s.text || '').trim()}`);
    }
    rows.push('');
  } else if (entry.transcript) {
    rows.push('## Transcrição', '');
    rows.push(entry.transcript, '');
  } else if (!entry.transcriptAvailable) {
    rows.push('_Transcrição não estava disponível. Nenhuma transcrição é inventada._', '');
  }
  rows.push('## Rastreabilidade', '');
  rows.push(line('Versão do extrator', m.version));
  rows.push(line('Commit do extrator', m.commit));
  rows.push('');
  return rows.join('\n');
}

function formatTs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '--:--';
  const total = Math.floor(n / 1000);
  const h = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

// ---------- 4.5 Recurso desconhecido / não suportado ----------
function renderUnsupportedDocument({ entry, course, week, meta = {} }) {
  const m = extractorMeta(meta);
  const rows = [
    '# Recurso não suportado',
    '',
    line('Nome', entry.text || entry.id),
    line('URL', entry.url),
    line('Origem na semana', week && (week.name || week.id)),
    line('Tipo não reconhecido', entry.note || 'recurso desconhecido'),
    line('Motivo', entry.reason || 'sem evidência suficiente de formato'),
    line('Status', entry.status || 'unsupported'),
    line('Orientação para acesso manual', 'Acesse o recurso diretamente no AVA pelo link acima; esta ferramenta não o extraiu.'),
    line('Data da extração', m.extractedAt),
    line('Versão/commit do extrator', `${m.version} (${m.commit})`),
    '',
  ];
  return rows.join('\n');
}

// Escolhe o escritor adequado ao tipo do recurso e devolve o Markdown.
function renderResourceMarkdown({ entry, course, week, meta = {} }) {
  const kind = entry && entry.kind;
  if (kind === 'page') return renderPageDocument({ entry, course, week, meta });
  if (kind === 'pdf') return renderPdfDocument({ entry, course, week, meta });
  if (kind === 'book') return renderReadingDocument({ entry, course, week, meta });
  if (kind === 'video') return renderVideoDocument({ entry, course, week, meta });
  return renderUnsupportedDocument({ entry, course, week, meta });
}

module.exports = {
  EXTRACTOR_VERSION,
  extractorMeta,
  renderPageDocument,
  renderPdfDocument,
  renderReadingDocument,
  renderVideoDocument,
  renderUnsupportedDocument,
  renderResourceMarkdown,
  formatTs,
};
