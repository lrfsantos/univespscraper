// Gera DOCUMENTOS DE EXEMPLO a partir dos ESCRITORES Markdown REAIS (seção 6.2).
// Nada aqui é redigido à mão: SAMPLE_*.md saem de renderResourceMarkdown; os
// INDEX/SOURCES/EXTRACTION_REPORT saem de buildCourseStructure/buildTopLevelDocs.
// Dados sintéticos (nunca material protegido). Timestamp FIXO para saída estável
// e commitável. Executar: node poc/generate-samples.js
const fs = require('fs');
const path = require('path');
const { renderResourceMarkdown, extractorMeta } = require('../src/extract/markdown');
const { buildCourseStructure, buildTopLevelDocs, safeName } = require('../electron/flow');

const OUT = path.join(__dirname, 'fixtures', 'generated-output');
const META = { version: '1.0.0', commit: 'sintetico-para-exemplo', extractedAt: '2026-11-08T12:00:00.000Z' };

// Entrada sintética de PÁGINA (conteúdo HTML do Moodle com recursos incorporados).
const pageEntry = {
  id: 'PAGE_01',
  kind: 'page',
  text: 'S1 Início — Apresentação da disciplina',
  url: 'https://ava.univesp.br/mod/page/view.php?id=101',
  status: 'integral',
  title: 'S1 Início — Apresentação',
  pageContent: [
    '# Introdução',
    '',
    'Bem-vindo à disciplina de Empreendedorismo e Inovação.',
    '',
    '- Objetivo da semana;',
    '- Leitura obrigatória do Capítulo 1.',
  ].join('\n'),
  loadWarnings: [],
  embedded: [
    { id: 'V_1', text: 'Videoaula 1', url: 'https://www.youtube.com/watch?v=aaa111', kind: 'video', status: 'video-com-transcricao' },
    { id: 'P_1', text: 'Slides', url: 'https://assets.univesp.br/ADM270/s1_slides.pdf', kind: 'pdf', status: 'integral' },
  ],
};

// Entrada sintética de PDF (separação por página + paginação impressa).
const pdfEntry = {
  id: 'PDF_01',
  kind: 'pdf',
  text: 'Slides da Semana 1',
  url: 'https://assets.univesp.br/ADM270/s1_slides.pdf',
  status: 'partial',
  bytes: 481230,
  sha256: 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899',
  pdfFile: 'PDF_01.pdf',
  totalPagesArquivo: 3,
  pagesExtracted: 2,
  printedPagination: { detected: [1, 2, null], reliable: 'partial' },
  info: { Title: 'Slides S1', Author: 'Equipe UNIVESP' },
  pages: [
    { pageIndex: 1, text: 'Empreendedorismo — Semana 1', chars: 30 },
    { pageIndex: 2, text: 'Definição de oportunidade', chars: 28 },
    { pageIndex: 3, text: '', chars: 0 },
  ],
  error: null,
};

// Entrada sintética de LIVRO (capítulo e intervalo de páginas declarados).
const readingEntry = {
  id: 'READING_01',
  kind: 'book',
  text: 'Texto-base - Empreendedorismo (Leia o Capítulo 1) | Autor',
  url: 'https://ava.univesp.br/mod/lti/launch.php?id=102',
  status: 'integral',
  format: 'pageid',
  expected: { chapter: 1, hasChapter: true, book: 'Empreendedorismo', pageRange: { start: 1, end: 25 }, hasPageRange: true },
  bookText: [
    '# Capítulo 1 — O empreendedor',
    '',
    'Conteúdo sintético de exemplo. O empreendedor identifica oportunidades...',
  ].join('\n'),
  chars: 120,
  endOk: true,
  identifiedPages: 4,
  evidenceNotes: 'começo/meio/fim confirmados; limite estrutural do capítulo confirmado',
  syncNotes: 'sincronização por identidade pageid estável',
  failureType: null,
  reason: null,
};

// Entrada sintética de VÍDEO (transcrição segmentada com timestamps).
const videoEntry = {
  id: 'VIDEO_01',
  kind: 'video',
  text: 'Videoaula 1 — Conceitos fundamentais',
  url: 'https://www.youtube.com/watch?v=bbb222',
  status: 'video-com-transcricao',
  videoId: 'bbb222',
  isYoutube: true,
  transcriptAvailable: true,
  transcriptLang: 'pt',
  transcriptNote: 'transcrição capturada',
  segments: [
    { offset: 0, text: 'Olá, sejam bem-vindos à primeira aula.' },
    { offset: 12000, text: 'Hoje vamos falar de conceitos fundamentais.' },
    { offset: 30000, text: 'Vamos começar.' },
  ],
  sourcePage: null,
};

// Entrada sintética de recurso NÃO SUPORTADO.
const unsupportedEntry = {
  id: 'UNKNOWN_01',
  kind: 'unknown',
  text: 'Arquivo sem formato reconhecido',
  url: 'https://ava.univesp.br/pluginfile.php/9/mod_data/conteudo.dat',
  status: 'unsupported',
  note: 'recurso desconhecido registrado (não ignorado silenciosamente)',
  reason: 'sem evidência suficiente de formato',
};

const course = { id: '101', code: 'ADM270', title: 'Empreendedorismo e Inovação', url: 'https://ava.univesp.br/course/view.php?id=101' };
const week = { id: '1', name: 'Semana 1' };

// 1) SAMPLE_*.md (flat, para inspeção) — produzidos pelos escritores REAIS.
const samples = [
  ['SAMPLE_PAGE.md', pageEntry],
  ['SAMPLE_PDF.md', pdfEntry],
  ['SAMPLE_READING.md', readingEntry],
  ['SAMPLE_VIDEO.md', videoEntry],
  ['SAMPLE_UNSUPPORTED.md', unsupportedEntry],
];
fs.mkdirSync(OUT, { recursive: true });
for (const [file, entry] of samples) {
  const md = renderResourceMarkdown({ entry, course, week, meta: META });
  fs.writeFileSync(path.join(OUT, file), md, 'utf8');
}

// 2) Estrutura do curso com os MESMOS recursos (escritores reais) + relatórios reais.
const courseDir = path.join(OUT, safeName(course.code || course.id));
const weekDir = path.join(courseDir, safeName(week.name));
for (const dir of ['videos', 'readings', 'supplementary']) fs.mkdirSync(path.join(weekDir, dir), { recursive: true });
const writeIn = (dir, entry) => fs.writeFileSync(path.join(weekDir, dir, `${entry.id}.md`), renderResourceMarkdown({ entry, course, week, meta: META }), 'utf8');
writeIn('', pageEntry);
writeIn('supplementary', pdfEntry);
writeIn('readings', readingEntry);
writeIn('videos', videoEntry);
writeIn('supplementary', unsupportedEntry);
fs.writeFileSync(path.join(weekDir, `${safeName(week.name)}.md`), `# Semana 1 — Empreendedorismo e Inovação (ADM270)\n\nDocumentos desta semana gerados pelos escritores reais.\n`, 'utf8');

const weeks = [{ id: week.id, name: week.name, resources: [pageEntry, pdfEntry, readingEntry, videoEntry, unsupportedEntry] }];
buildCourseStructure({ course, weeks, outputDir: OUT });
buildTopLevelDocs({ courses: [course], outputDir: OUT, resources: [pageEntry, pdfEntry, readingEntry, videoEntry, unsupportedEntry] });

console.log('Sample docs geradas em', OUT);
console.log(fs.readdirSync(OUT).join(', '));
