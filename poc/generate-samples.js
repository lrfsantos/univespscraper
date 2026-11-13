// Gera DOCUMENTOS DE EXEMPLO a partir do PIPELINE DE PRODUÇÃO (QA real — seção 11):
// cada amostra é produzida executando o EXTRATOR de produção sobre uma FIXTURE
// sintética (nunca um objeto Markdown pré-pronto, nunca material protegido):
//   - SAMPLE_PAGE.md      : fixture HTML -> conversor estrutural htmlToMarkdown -> statusFor -> escritor
//   - SAMPLE_PDF.md       : PDF sintético (gerador local) -> analyzePdf -> statusFor -> escritor
//   - SAMPLE_READING.md   : EPUB sintético (OPF+NCX+2 XHTML) -> extractEpubViaAdapter (produção) -> escritor
//   - SAMPLE_VIDEO.md     : vídeo + transcrição via fetch MOCKADO na fronteira -> extractVideo (produção) -> escritor
//   - SAMPLE_UNSUPPORTED.md : classificação real de recurso desconhecido -> escritor
// Identidade CONSISTENTE: a página embute o vídeo com o MESMO id do SAMPLE_VIDEO
// (corrige a inconsistência aaa111/bbb222 apontada na auditoria).
// Timestamp FIXO para saída estável e commitável. Executar: node poc/generate-samples.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { htmlToMarkdown } = require('../src/extract/html');
const { statusFor: pageStatusFor } = require('../src/extract/pages');
const { analyzePdf, statusFor: pdfStatusFor } = require('../src/extract/pdfs');
const { makePdf } = require('./fixtures/synthetic/make-pdf');
const { extractVideo } = require('../src/extract/videos');
const { classifyResource } = require('../electron/discovery');
const books = require('../src/extract/books');
const { renderResourceMarkdown, renderPdfDocument, renderReadingDocument, renderVideoDocument, renderUnsupportedDocument } = require('../src/extract/markdown');
const { buildCourseStructure, buildTopLevelDocs, safeName } = require('../electron/flow');

const OUT = path.join(__dirname, 'fixtures', 'generated-output');
const META = { version: '1.0.0', commit: 'sintetico-para-exemplo', extractedAt: '2026-11-08T12:00:00.000Z' };
const BASE = 'https://ava.univesp.br';

const course = { id: '101', code: 'ADM270', title: 'Empreendedorismo e Inovação', url: BASE + '/course/view.php?id=101' };
const week = { id: '1', name: 'Semana 1' };

// ID único de vídeo usado em TODAS as amostras (página + vídeo) — consistência.
// 11 caracteres (a lib youtube-transcript exige IDs de 11 chars).
const VIDEO_ID = 'VIDEO01abcd';

// ==================== 1) PÁGINA (HTML -> conversor estrutural) ====================
const PAGE_HTML = [
  '<html><head><title>Semana 1 — Apresentação</title></head><body>',
  '  <nav>Menu (não é conteúdo)</nav>',
  '  <div role="main" class="ava-scope">',
  '    <h1>Semana 1 — Apresentação</h1>',
  '    <p>Bem-vindo à disciplina de <strong>Empreendedorismo e Inovação</strong>.</p>',
  '    <h2>Objetivos</h2>',
  '    <ul>',
  '      <li>Compreender o conceito de oportunidade;</li>',
  '      <li>Conhecer o Capítulo 1 do texto-base.',
  '        <ul><li>Subitem da leitura.</li></ul>',
  '      </li>',
  '    </ul>',
  '    <p>Assista à <a href="https://www.youtube.com/watch?v=' + VIDEO_ID + '">videoaula 1</a> e revise os <a href="https://assets.univesp.br/ADM270/s1_slides.pdf">slides</a>.</p>',
  '    <table><tr><th>Fonte</th><th>Formato</th></tr><tr><td>Texto-base</td><td>Livro digital</td></tr></table>',
  '  </div>',
  '</body></html>',
].join('\n');

function buildPageEntry() {
  const text = htmlToMarkdown(PAGE_HTML, { baseUrl: BASE + '/mod/page/view.php?id=101' });
  const status = pageStatusFor({ title: 'Semana 1 — Apresentação', text, hasScope: true, httpStatus: 200, loadWarnings: [] });
  return {
    id: 'PAGE_01', kind: 'page', text: 'Semana 1 — Apresentação',
    url: BASE + '/mod/page/view.php?id=101', status, title: 'Semana 1 — Apresentação',
    pageContent: text, loadWarnings: [],
    embedded: [
      { id: 'V_1', text: 'Videoaula 1', url: 'https://www.youtube.com/watch?v=' + VIDEO_ID, kind: 'video', status: 'video-com-transcricao' },
      { id: 'P_1', text: 'Slides', url: 'https://assets.univesp.br/ADM270/s1_slides.pdf', kind: 'pdf', status: 'integral' },
    ],
  };
}

// ==================== 2) PDF (sintético válido -> analyzePdf) ====================

async function buildPdfEntry() {
  const pages = [
    { text: 'Empreendedorismo - Semana 1' },
    { text: 'Definicao de oportunidade' },
    { text: '' }, // 3ª página SEM texto (fidelidade: pág. sem conteúdo -> parcial)
  ];
  const buf = makePdf(pages);
  const analyze = await analyzePdf(buf);
  const status = pdfStatusFor({ ok: true, bytes: buf.length, analyze, pages: analyze.pages });
  return {
    id: 'PDF_01', kind: 'pdf', text: 'Slides da Semana 1',
    url: 'https://assets.univesp.br/ADM270/s1_slides.pdf', status,
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    pdfFile: 'PDF_01.pdf', totalPagesArquivo: analyze.totalPagesArquivo, pagesExtracted: analyze.pages.filter((p) => p.text && p.text.trim()).length,
    printedPagination: { detected: [1, 2, null], reliable: 'partial' },
    info: { Title: 'Slides S1', Author: 'Equipe UNIVESP' },
    pages: analyze.pages, error: null,
  };
}

// ==================== 3) LEITURA (EPUB sintético -> extractEpubViaAdapter) ====================
const OPF_BASE = 'https://jigsaw.minhabiblioteca.com.br/books/ADM270/epub/OEBPS/';
const OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Empreendedorismo</dc:title><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Dornelas</dc:creator><dc:publisher xmlns:dc="http://purl.org/dc/elements/1.1/">Atlas</dc:publisher><dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">2021</dc:date></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="ch1a" href="Text/ch01a.xhtml" media-type="application/xhtml+xml"/><item id="ch1b" href="Text/ch01b.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="Text/ch02.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="ch1a"/><itemref idref="ch1b"/><itemref idref="ch2"/></spine></package>`;
const NCX = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="c1"><navLabel><text>Capítulo 1</text></navLabel><content src="Text/ch01a.xhtml"/></navPoint><navPoint id="c1b"><navLabel><text>Capítulo 1.1</text></navLabel><content src="Text/ch01b.xhtml"/></navPoint><navPoint id="c2"><navLabel><text>Capítulo 2</text></navLabel><content src="Text/ch02.xhtml"/></navPoint></navMap></ncx>`;
const makeText = (label, paras = 10, words = 40) =>
  Array.from({ length: paras }, (_, i) => `${label} paragrafo ${i}: ` + Array.from({ length: words }, (_, j) => `palavra${i}_${j}`).join(' ')).join('\n\n');
const XHTML_DOCS = {
  'Text/ch01a.xhtml': `<html><body><h1>Capítulo 1 — O empreendedor</h1><p>${makeText('O empreendedor identifica oportunidades e mobiliza recursos', 10).replace(/\n\n/g, '</p><p>')}</p></body></html>`,
  'Text/ch01b.xhtml': `<html><body><h2>1.1 Subcapítulo</h2><p>${makeText('Detalhamento do subcapítulo com conteúdo sintético', 8).replace(/\n\n/g, '</p><p>')}</p></body></html>`,
  'Text/ch02.xhtml': `<html><body><h1>Capítulo 2 — Próximo capítulo</h1><p>Conteúdo do capítulo 2.</p></body></html>`,
};
const fetchMap = {
  [OPF_BASE + 'content.opf']: OPF,
  [OPF_BASE + 'toc.ncx']: NCX,
  [OPF_BASE + 'Text/ch01a.xhtml']: XHTML_DOCS['Text/ch01a.xhtml'],
  [OPF_BASE + 'Text/ch01b.xhtml']: XHTML_DOCS['Text/ch01b.xhtml'],
  [OPF_BASE + 'Text/ch02.xhtml']: XHTML_DOCS['Text/ch02.xhtml'],
};

function makeEpubReader() {
  const state = { doc: OPF_BASE + 'Text/ch01a.xhtml', idx: 0 };
  const docOrder = [OPF_BASE + 'Text/ch01a.xhtml', OPF_BASE + 'Text/ch01b.xhtml', OPF_BASE + 'Text/ch02.xhtml'];
  // Simula innerText do navegador: tags de bloco viram quebras de linha.
  const textOf = (u) => {
    const key = u.replace(OPF_BASE, '').split('?')[0];
    const html = XHTML_DOCS[key] || '';
    return html.replace(/<\/(p|h[1-6]|li|div)>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  };
  return {
    waitContent: async () => ({ url: state.doc, text: textOf(state.doc) }),
    readActive: async () => ({ url: state.doc, text: textOf(state.doc) }),
    navigateChapter: async () => false,
    navigateNextDoc: async () => {
      if (state.idx < docOrder.length - 1) { state.idx++; state.doc = docOrder[state.idx]; return { changed: true, doc: { url: state.doc, text: textOf(state.doc) }, beforeUrl: docOrder[state.idx - 1] }; }
      return { changed: false, doc: null, beforeUrl: state.doc };
    },
    fetchPackage: async () => books.fetchEpubPackageFromFetcher(state.doc, async (absUrl) => {
      const hit = fetchMap[absUrl];
      return hit != null ? { ok: true, text: hit } : null;
    }),
    expandToc: async () => false,
  };
}

async function buildReadingEntry() {
  const expected = { chapter: 1, hasChapter: true, book: 'Empreendedorismo', author: 'Dornelas', hasPageRange: false, pageRange: null };
  const r = await books.extractEpubViaAdapter(makeEpubReader(), expected, { maxDocAdvances: 3 });
  return {
    id: 'READING_01', kind: 'book', text: 'Texto-base - Empreendedorismo (Leia o Capítulo 1) | Dornelas',
    url: BASE + '/mod/lti/launch.php?id=102', status: r.status, format: r.format,
    expected,
    bookName: (r.meta && r.meta.title) || expected.book,
    author: (r.meta && r.meta.author) || expected.author,
    publisher: (r.meta && r.meta.publisher) || null,
    edition: (r.meta && r.meta.year) ? 'ano ' + r.meta.year : null,
    metaOrigin: (r.meta && (r.meta.author || r.meta.title)) ? 'OPF do EPUB (metadados reais do pacote)' : null,
    bookText: r.text || '', chars: r.chars || 0,
    endOk: r.validation ? r.validation.endOk : null,
    pageRangeOk: r.validation ? r.validation.pageRangeOk : null,
    pageRangeNote: r.validation ? r.validation.pageRangeNote : null,
    xhtmlDocs: (r.structural && r.structural.capturedDocIds ? r.structural.capturedDocIds.length : null),
    evidenceNotes: 'limite estrutural do capítulo ' + ((r.structural && r.structural.epubBoundaryConfirmed) ? 'confirmado pelo spine' : 'não confirmado'),
    syncNotes: 'documentos capturados: ' + ((r.structural && r.structural.capturedDocIds) || []).join(', '),
    failureType: r.failureType || null, reason: r.error || null,
  };
}

// ==================== 4) VÍDEO (extractVideo com fetch mockado) ====================
const INNERTUBE = 'https://www.youtube.com/youtubei/v1/player';
function videoFetch() {
  return async (url) => {
    if (String(url).startsWith(INNERTUBE)) {
      return { ok: true, status: 200, json: async () => ({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?x=1', languageCode: 'pt' }] } } }), text: async () => '{}' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '<transcript><text start="0" dur="1">Olá, sejam bem-vindos à primeira aula.</text><text start="12" dur="1">Hoje vamos falar de conceitos fundamentais.</text><text start="30" dur="1">Vamos começar.</text></transcript>' };
  };
}

async function buildVideoEntry() {
  const v = await extractVideo({ url: 'https://www.youtube.com/watch?v=' + VIDEO_ID, title: 'Videoaula 1 — Conceitos fundamentais', fetchFn: videoFetch() });
  return {
    id: 'VIDEO_01', kind: 'video', text: 'Videoaula 1 — Conceitos fundamentais',
    url: 'https://www.youtube.com/watch?v=' + VIDEO_ID, status: v.status,
    videoId: v.videoId, isYoutube: v.isYoutube,
    transcriptAvailable: v.transcriptAvailable, transcriptLang: v.transcriptLang,
    transcriptNote: v.transcriptNote || (v.transcriptAvailable ? 'transcrição capturada' : 'transcrição não disponível'),
    segments: v.segments || [], sourcePage: null,
  };
}

// ==================== 5) NÃO SUPORTADO (classificação real) ====================
function buildUnsupportedEntry() {
  const cls = classifyResource({ url: 'https://ava.univesp.br/pluginfile.php/9/mod_data/conteudo.dat', text: 'Arquivo sem formato reconhecido' });
  return {
    id: 'UNKNOWN_01', kind: cls.kind, text: 'Arquivo sem formato reconhecido',
    url: 'https://ava.univesp.br/pluginfile.php/9/mod_data/conteudo.dat', status: 'unsupported',
    note: 'recurso desconhecido registrado (não ignorado silenciosamente)',
    reason: 'sem evidência suficiente de formato',
  };
}

// ==================== Geração ====================
(async () => {
  const [pageEntry, pdfEntry, readingEntry, videoEntry] = await Promise.all([Promise.resolve(buildPageEntry()), buildPdfEntry(), buildReadingEntry(), buildVideoEntry()]);
  const unsupportedEntry = buildUnsupportedEntry();

  fs.mkdirSync(OUT, { recursive: true });
  const samples = [
    ['SAMPLE_PAGE.md', pageEntry],
    ['SAMPLE_PDF.md', pdfEntry],
    ['SAMPLE_READING.md', readingEntry],
    ['SAMPLE_VIDEO.md', videoEntry],
    ['SAMPLE_UNSUPPORTED.md', unsupportedEntry],
  ];
  for (const [file, entry] of samples) {
    fs.writeFileSync(path.join(OUT, file), renderResourceMarkdown({ entry, course, week, meta: META }), 'utf8');
  }

  const courseDir = path.join(OUT, safeName(course.code || course.id));
  const weekDir = path.join(courseDir, safeName(week.name));
  for (const dir of ['videos', 'readings', 'supplementary']) fs.mkdirSync(path.join(weekDir, dir), { recursive: true });
  const writeIn = (dir, entry) => fs.writeFileSync(path.join(weekDir, dir, `${entry.id}.md`), renderResourceMarkdown({ entry, course, week, meta: META }), 'utf8');
  writeIn('', pageEntry);
  writeIn('supplementary', pdfEntry);
  writeIn('readings', readingEntry);
  writeIn('videos', videoEntry);
  writeIn('supplementary', unsupportedEntry);
  fs.writeFileSync(path.join(weekDir, `${safeName(week.name)}.md`), `# Semana 1 — Empreendedorismo e Inovação (ADM270)\n\nDocumentos desta semana gerados pelos EXTRATORES DE PRODUÇÃO sobre fixtures sintéticas.\n`, 'utf8');

  const weeks = [{ id: week.id, name: week.name, resources: [pageEntry, pdfEntry, readingEntry, videoEntry, unsupportedEntry] }];
  buildCourseStructure({ course, weeks, outputDir: OUT });
  buildTopLevelDocs({ courses: [course], outputDir: OUT, resources: [pageEntry, pdfEntry, readingEntry, videoEntry, unsupportedEntry] });

  console.log('Sample docs geradas em', OUT);
  console.log('status: page=' + pageEntry.status, 'pdf=' + pdfEntry.status, 'reading=' + readingEntry.status, 'video=' + videoEntry.status);
  console.log(fs.readdirSync(OUT).join(', '));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
