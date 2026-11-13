const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  renderPageDocument,
  renderPdfDocument,
  renderReadingDocument,
  renderVideoDocument,
  renderUnsupportedDocument,
  formatTs,
} = require('../src/extract/markdown');

// Suíte de QUALIDADE DE SAÍDA (seção 6.3): avalia FIDELIDADE, INTEGRIDADE,
// RASTREABILIDADE e HONESTIDADE do status dos documentos Markdown. Verifica os
// escritores REAIS (unit) e os DOCUMENTOS DE EXEMPLO commitados (fixtures) — nunca
// redige o relatório manualmente. Gera EXTRACTION_QA_REPORT.md e
// EXTRACTION_QA_RESULTS.json em audit-temp/.

const FIXTURES = path.join(__dirname, 'fixtures', 'generated-output');
const QA_MD = path.join(__dirname, '..', 'audit-temp', 'EXTRACTION_QA_REPORT.md');
const QA_JSON = path.join(__dirname, '..', 'audit-temp', 'EXTRACTION_QA_RESULTS.json');

const META = { version: '1.0.0', commit: 'sintetico-para-exemplo', extractedAt: '2026-11-08T12:00:00.000Z' };
const course = { id: '101', code: 'ADM270', title: 'Empreendedorismo e Inovação', url: 'https://ava.univesp.br/course/view.php?id=101' };
const week = { id: '1', name: 'Semana 1' };

const results = [];
const reportLines = [];
function record(entry) {
  results.push(entry);
  console.log('[' + entry.status + '] ' + entry.id + ': ' + entry.title);
  if (entry.detail) console.log('    ', entry.detail);
}

// Fixture entry reutilizada nos unit tests dos escritores.
function fixtureEntries() {
  return {
    page: {
      id: 'PAGE_01', kind: 'page', text: 'S1 Início', url: 'https://ava.univesp.br/mod/page/view.php?id=101',
      status: 'integral', title: 'S1 Início', pageContent: '# Introdução\n\nBem-vindo.\n\n- Item A\n- Item B\n', loadWarnings: [],
      embedded: [{ id: 'V_1', text: 'Videoaula', url: 'https://www.youtube.com/watch?v=aaa', kind: 'video', status: 'video-com-transcricao' }],
    },
    pdf: {
      id: 'PDF_01', kind: 'pdf', text: 'Slides S1', url: 'https://assets.univesp.br/ADM270/s1.pdf', status: 'partial', bytes: 100,
      sha256: 'aa', pdfFile: 'PDF_01.pdf', totalPagesArquivo: 2, pagesExtracted: 1, printedPagination: { detected: [1, null], reliable: 'partial' },
      info: { Title: 'T', Author: 'A' }, pages: [{ pageIndex: 1, text: 'pagina um', chars: 9 }, { pageIndex: 2, text: '', chars: 0 }], error: null,
    },
    reading: {
      id: 'READING_01', kind: 'book', text: 'Texto-base (Leia o Capítulo 1)', url: 'https://ava.univesp.br/mod/lti/launch.php?id=102',
      status: 'integral', format: 'pageid', expected: { chapter: 1, hasChapter: true, book: 'Livro', pageRange: { start: 10, end: 25 }, hasPageRange: true },
      bookText: '# Capitulo 1\n\nConteudo sintetico.\n', chars: 40, endOk: true, identifiedPages: 3, xhtmlDocs: 2, evidenceNotes: 'comeco/meio/fim', failureType: null, reason: null,
    },
    video: {
      id: 'VIDEO_01', kind: 'video', text: 'Videoaula 1', url: 'https://www.youtube.com/watch?v=bbb', status: 'video-com-transcricao',
      videoId: 'bbb', isYoutube: true, transcriptAvailable: true, transcriptLang: 'pt', transcriptNote: 'capturada',
      segments: [{ offset: 0, text: 'Olá.' }, { offset: 1500, text: 'Segundo segmento.' }],
    },
    unsupported: {
      id: 'UNKNOWN_01', kind: 'unknown', text: 'Arquivo X', url: 'https://ava.univesp.br/pluginfile.php/9/x.dat', status: 'unsupported', note: 'recurso desconhecido', reason: 'sem evidencia',
    },
  };
}

// ==================== QA unit — FIDELIDADE ====================
function qaFidelity() {
  const G = 'QA-FID';
  const f = fixtureEntries();

  const pageMd = renderPageDocument({ entry: f.page, course, week, meta: META });
  const fidPage = pageMd.includes('Bem-vindo.') && pageMd.includes('- Item A') && pageMd.includes('# Introdução') && pageMd.includes('## Conteúdo textual integral obtido') && pageMd.includes('www.youtube.com/watch?v=aaa');
  record({ id: G + '-1', title: 'Página: conteúdo, headings, listas e recursos incorporados preservados (não resumido)', status: fidPage ? 'PASS' : 'FAIL', detail: `fidPage=${fidPage}` });

  const pdfMd = renderPdfDocument({ entry: f.pdf, course, week, meta: META });
  const fidPdf = pdfMd.includes('## Página do arquivo 1 (página impressa 1)') && pdfMd.includes('## Página do arquivo 2 (página impressa não identificada)') && pdfMd.includes('pagina um') && !/Status de fidelidade:\s*integral/.test(pdfMd);
  record({ id: G + '-2', title: 'PDF: separação por página + distinção página do arquivo × impressa × não identificada', status: fidPdf ? 'PASS' : 'FAIL', detail: `fidPdf=${fidPdf}` });

  const vidMd = renderVideoDocument({ entry: f.video, course, week, meta: META });
  const fidVid = vidMd.includes('[00:00]') && vidMd.includes('[00:01]') && vidMd.includes('Olá.') && vidMd.includes('Segundo segmento.');
  record({ id: G + '-3', title: 'Vídeo: transcrição integral com timestamps e ordem dos segmentos preservados', status: fidVid ? 'PASS' : 'FAIL', detail: `fidVid=${fidVid} ts=${formatTs(1500)}` });

  const readMd = renderReadingDocument({ entry: f.reading, course, week, meta: META });
  const fidRead = readMd.includes('## Conteúdo acadêmico extraído') && readMd.includes('Conteudo sintetico.') && readMd.includes('Capítulo 1') && readMd.includes('10 a 25');
  record({ id: G + '-4', title: 'Livro: conteúdo acadêmico + capítulo e intervalo de páginas declarados preservados', status: fidRead ? 'PASS' : 'FAIL', detail: `fidRead=${fidRead}` });

  const unkMd = renderUnsupportedDocument({ entry: f.unsupported, course, week, meta: META });
  const fidUnk = unkMd.includes('unsupported') && unkMd.includes('Acesse o recurso diretamente no AVA');
  record({ id: G + '-5', title: 'Não suportado: registrado com motivo e orientação de acesso manual (sem fingir extração)', status: fidUnk ? 'PASS' : 'FAIL', detail: `fidUnk=${fidUnk}` });
}

// ==================== QA unit — HONESTIDADE do status ====================
function qaHonesty() {
  const G = 'QA-HON';
  const f = fixtureEntries();

  // PDF sem texto extraível NÃO pode reivindicar integral.
  const pdfPartial = renderPdfDocument({ entry: f.pdf, course, week, meta: META });
  const noIntegralClaim = !/Status de fidelidade:\s*integral/.test(pdfPartial) && pdfPartial.includes('Status de fidelidade: partial');
  record({ id: G + '-1', title: 'PDF parcial (página sem texto) declara partial, nunca integral', status: noIntegralClaim ? 'PASS' : 'FAIL', detail: `partialDeclarado=${noIntegralClaim}` });

  // Vídeo sem transcrição não inventa transcrição.
  const vidNoTr = { ...f.video, transcriptAvailable: false, transcriptLang: null, segments: [], status: 'video-registrado', transcriptNote: 'transcrição não disponível para este vídeo' };
  const noFakeTr = renderVideoDocument({ entry: vidNoTr, course, week, meta: META });
  const honestVideo = noFakeTr.includes('video-registrado') && noFakeTr.includes('Nenhuma transcrição é inventada') && !noFakeTr.includes('## Transcrição (segmentos');
  record({ id: G + '-2', title: 'Vídeo sem transcrição: registrado como tal, sem inventar transcrição', status: honestVideo ? 'PASS' : 'FAIL', detail: `honesto=${honestVideo}` });
}

// ==================== QA — documentos de exemplo commitados ====================
function qaFixtures() {
  const G = 'QA-SAMPLE';
  const files = ['SAMPLE_PAGE.md', 'SAMPLE_PDF.md', 'SAMPLE_READING.md', 'SAMPLE_VIDEO.md', 'SAMPLE_UNSUPPORTED.md', 'INDEX.md', 'SOURCES.md', 'EXTRACTION_REPORT.md'];
  const exists = files.every((f) => fs.existsSync(path.join(FIXTURES, f)));
  record({ id: G + '-1', title: 'Documentos de exemplo existem e foram commitados (produzidos pelos escritores reais)', status: exists ? 'PASS' : 'FAIL', detail: files.join(', ') });

  const read = (f) => fs.readFileSync(path.join(FIXTURES, f), 'utf8');
  const page = read('SAMPLE_PAGE.md');
  const pdf = read('SAMPLE_PDF.md');
  const video = read('SAMPLE_VIDEO.md');
  const reading = read('SAMPLE_READING.md');
  const unk = read('SAMPLE_UNSUPPORTED.md');
  const index = read('INDEX.md');
  const report = read('EXTRACTION_REPORT.md');

  const nonEmpty = [page, pdf, video, reading, unk, index, report].every((s) => s.trim().length >= 40);
  const pageOk = page.includes('Conteúdo textual integral obtido') && page.includes('Recursos incorporados descobertos') && page.includes('https://ava.univesp.br/mod/page/view.php?id=101') && page.includes('VIDEO01abcd');
  const pdfOk = pdf.includes('## Página do arquivo 1') && pdf.includes('## Página do arquivo 2') && pdf.includes('## Página do arquivo 3') && pdf.includes('Status de fidelidade: partial') && pdf.includes('SHA-256 do PDF baixado') && pdf.includes('PDF original (relativo)');
  const videoOk = video.includes('[00:00]') && video.includes('[00:12]') && video.includes('[00:30]') && video.includes('segmentos com timestamps') && video.includes('VIDEO01abcd');
  const readingOk = reading.includes('## Conteúdo acadêmico extraído') && reading.includes('Capítulo solicitado pelo AVA: 1') && reading.includes('limite estrutural do capítulo confirmado') && reading.includes('Autor: Dornelas') && reading.includes('Editora: Atlas') && reading.includes('OPF do EPUB (metadados reais do pacote)');
  const unkOk = unk.includes('unsupported') && unk.includes('Acesse o recurso diretamente no AVA');
  const indexOk = index.includes('Empreendedorismo e Inovação') && index.includes('ADM270');
  const reportOk = report.includes('Resumo') && report.includes('integral');
  const ok = nonEmpty && pageOk && pdfOk && videoOk && readingOk && unkOk && indexOk && reportOk;
  record({ id: G + '-2', title: 'Conteúdo dos exemplos (produzidos pelos EXTRATORES reais): fidelidade, separação por página, timestamps, metadados e status honesto', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ pageOk, pdfOk, videoOk, readingOk, unkOk, indexOk, reportOk }) });

  // Consistência de IDENTIDADE (corrige a inconsistência aaa111/bbb222 da auditoria):
  // a página e o vídeo da mesma fixture devem referenciar o MESMO id de vídeo.
  const pageVidId = (page.match(/watch\?v=([A-Za-z0-9_-]{11})/) || [])[1] || null;
  const videoVidId = (video.match(/^-\s*ID do vídeo: ([A-Za-z0-9_-]{11})/m) || [])[1] || (video.match(/watch\?v=([A-Za-z0-9_-]{11})/) || [])[1] || null;
  record({ id: G + '-3', title: 'Consistência de identidade: página e vídeo da mesma fixture usam o MESMO id (aaa111/bbb222 corrigido)', status: pageVidId && pageVidId === videoVidId ? 'PASS' : 'FAIL', detail: `pageId=${pageVidId} videoId=${videoVidId}` });
}

// ==================== QA — TESTES NEGATIVOS (seção 11.3) ====================
async function qaNegative() {
  const G = 'QA-NEG';
  const f = fixtureEntries();

  // N1: parágrafo REMOVIDO do HTML não aparece na conversão estrutural (detecção).
  const { htmlToMarkdown } = require('../src/extract/html');
  const fullHtml = '<div role="main"><h1>T</h1><p>Parágrafo presente.</p><p>Parágrafo crítico X.</p><ul><li>A</li><li>B</li></ul></div>';
  const missingHtml = '<div role="main"><h1>T</h1><p>Parágrafo presente.</p><ul><li>A</li><li>B</li></ul></div>';
  const fullMd = htmlToMarkdown(fullHtml);
  const missingMd = htmlToMarkdown(missingHtml);
  const n1 = fullMd.includes('Parágrafo crítico X.') && !missingMd.includes('Parágrafo crítico X.');
  record({ id: G + '-1', title: 'Negativo: parágrafo omitido do HTML é DETECTADO na conversão estrutural', status: n1 ? 'PASS' : 'FAIL', detail: `presente=${fullMd.includes('Parágrafo crítico X.')} ausente=${!missingMd.includes('Parágrafo crítico X.')}` });

  // N2: página SEM texto no PDF -> status NUNCA integral (produção).
  const { analyzePdf, statusFor: pdfStatusFor } = require('../src/extract/pdfs');
  const { makePdf } = require('./fixtures/synthetic/make-pdf');
  const full = await analyzePdf(makePdf([{ text: 'A' }, { text: 'B' }, { text: 'C' }]));
  const withEmpty = await analyzePdf(makePdf([{ text: 'A' }, { text: 'B' }, { text: '' }]));
  const sFull = pdfStatusFor({ ok: true, bytes: 1, analyze: full, pages: full.pages });
  const sEmpty = pdfStatusFor({ ok: true, bytes: 1, analyze: withEmpty, pages: withEmpty.pages });
  const n2 = sFull === 'integral' && sEmpty === 'partial';
  record({ id: G + '-2', title: 'Negativo: página sem texto no PDF rebaixa para partial (nunca integral)', status: n2 ? 'PASS' : 'FAIL', detail: `completo=${sFull} comPaginaVazia=${sEmpty}` });

  // N3: SEGMENTO de transcrição REMOVIDO é detectado (contagem/ordem).
  const { extractVideo } = require('../src/extract/videos');
  const INNERTUBE = 'https://www.youtube.com/youtubei/v1/player';
  const mkFetch = (xml) => async (url) => String(url).startsWith(INNERTUBE)
    ? { ok: true, status: 200, json: async () => ({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?x=1', languageCode: 'pt' }] } } }), text: async () => '{}' }
    : { ok: true, status: 200, json: async () => ({}), text: async () => xml };
  const xmlFull = '<transcript><text start="0" dur="1">Primeiro.</text><text start="5" dur="1">Segundo.</text><text start="10" dur="1">Terceiro.</text></transcript>';
  const xmlShort = '<transcript><text start="0" dur="1">Primeiro.</text><text start="10" dur="1">Terceiro.</text></transcript>';
  const vFull = await extractVideo({ url: 'https://www.youtube.com/watch?v=abc12345678', fetchFn: mkFetch(xmlFull), timeoutMs: 5000 });
  const vShort = await extractVideo({ url: 'https://www.youtube.com/watch?v=abc12345678', fetchFn: mkFetch(xmlShort), timeoutMs: 5000 });
  const n3 = vFull.segments.length === 3 && vShort.segments.length === 2 && vShort.segments.map((s) => s.text).join('|') === 'Primeiro.|Terceiro.';
  record({ id: G + '-3', title: 'Negativo: segmento de transcrição removido é detectado (contagem e ordem)', status: n3 ? 'PASS' : 'FAIL', detail: `completo=${vFull.segments.length} comOmissao=${vShort.segments.length} ordem=${vShort.segments.map((s) => s.text).join('|')}` });

  // N4: capítulo/limite NÃO confirmado -> livro nunca integral (produção).
  const books = require('../src/extract/books');
  const statusN4 = books.statusForBook({ format: 'epub', readerLoaded: true, chapterNotFound: false, expected: { chapter: 1 }, validation: { hasText: true, noNonsense: true, startOk: true, midOk: true, endOk: false, chapterOk: true, pageRangeOk: null, warnings: ['fim-capitulo-nao-confirmado-estruturalmente'], ambiguousPages: 0, unexpectedContent: [], repetitions: [] } });
  record({ id: G + '-4', title: 'Negativo: limite do capítulo não confirmado rebaixa o livro para partial', status: statusN4 !== 'integral' ? 'PASS' : 'FAIL', detail: `status=${statusN4}` });

  // N5: recurso DESCONHECIDO nunca é apresentado como extraído.
  const { renderUnsupportedDocument } = require('../src/extract/markdown');
  const unkMd = renderUnsupportedDocument({ entry: { ...f.unsupported, kind: 'unknown' }, course, week, meta: META });
  const n5 = unkMd.includes('unsupported') && !unkMd.includes('Conteúdo textual integral obtido') && !unkMd.includes('## Transcrição');
  record({ id: G + '-5', title: 'Negativo: recurso desconhecido não é apresentado como conteúdo extraído', status: n5 ? 'PASS' : 'FAIL', detail: `naoFingeExtracao=${n5}` });

  // N6: ZIP inválido (arquivo não-zip) NUNCA valida (produção).
  const { validateZip } = require('../electron/flow');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-neg-'));
  const dest = path.join(tmp, 'out.zip');
  fs.writeFileSync(dest, 'isso nao e um zip');
  const v = validateZip({ ok: true, path: dest, bytes: 13, entries: [] });
  const n6 = v.valid === false;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  record({ id: G + '-6', title: 'Negativo: ZIP inválido não valida (nunca sucesso)', status: n6 ? 'PASS' : 'FAIL', detail: `valid=${v.valid} reason=${v.reason}` });
}

// ==================== QA — CONSISTÊNCIA (regenerar == commitado) ====================
function qaConsistency() {
  const { spawnSync } = require('child_process');
  const { execSync } = require('child_process');
  const G = 'QA-CONS';
  // Regenera as amostras pelo pipeline real e compara com os arquivos commitados.
  const r = spawnSync(process.execPath, [path.join(__dirname, 'generate-samples.js')], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const regenOk = r.status === 0;
  if (!regenOk) { record({ id: G + '-1', title: 'Consistência: geração de amostras termina sem erro', status: false, detail: (r.stderr || '').slice(0, 200) }); return; }
  record({ id: G + '-1', title: 'Consistência: geração de amostras termina sem erro', status: true, detail: 'exit=0' });

  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|json)$/.test(e.name)) files.push(p);
    }
  };
  walk(FIXTURES);
  const divergences = [];
  for (const p of files) {
    const rel = path.relative(FIXTURES, p);
    // Os arquivos commitados já estão em generated-output; a regeneração escreveu
    // nos MESMOS caminhos. Para comparar "commitado x regenerado" precisamos do
    // conteúdo versionado (git show HEAD:<path>).
    const gitPath = 'poc/fixtures/generated-output/' + rel.split(path.sep).join('/');
    try {
      const committed = execSync('git show HEAD:' + gitPath, { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1024 * 1024 });
      const regenerated = fs.readFileSync(p, 'utf8');
      if (committed !== regenerated) divergences.push(rel);
    } catch (e) {
      divergences.push(rel + ' (não versionado)');
    }
  }
  record({ id: G + '-2', title: 'Consistência: regeneração não diverge dos arquivos commitados', status: divergences.length === 0 ? 'PASS' : 'FAIL', detail: `arquivos=${files.length} divergentes=${divergences.join(', ') || 'nenhum'}` });
}

(async () => {
  qaFidelity();
  qaHonesty();
  qaFixtures();
  qaNegative();
  qaConsistency();

  const failed = results.filter((r) => r.status === 'FAIL');
  // Relatório de qualidade (nunca redigido manualmente — métricas observadas acima).
  reportLines.push('# Relatório de Qualidade de Extração (EXTRACTION_QA)');
  reportLines.push('');
  reportLines.push('> Gerado automaticamente pelos escritores e validações reais. Fixtures sintéticas;');
  reportLines.push('> nenhum material protegido é reproduzido.');
  reportLines.push('');
  reportLines.push(`Data: ${new Date().toISOString()}`);
  reportLines.push(`Total de verificações: ${results.length} | Aprovadas: ${results.length - failed.length} | Reprovadas: ${failed.length}`);
  reportLines.push('');
  for (const r of results) {
    reportLines.push(`## ${r.id} — ${r.title}`);
    reportLines.push(`- Status: **${r.status}**`);
    reportLines.push(`- Métricas observadas: \`${r.detail}\``);
    reportLines.push(`- Verificações aprovadas: ${r.status === 'PASS' ? 'todas' : '—'}`);
    reportLines.push(`- Verificações reprovadas: ${r.status === 'FAIL' ? 'ver detalhe acima' : 'nenhuma'}`);
    reportLines.push('- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.');
    reportLines.push(`- Decisão: ${r.status === 'PASS' ? 'aprovado' : 'reprovado'}`);
    reportLines.push('');
  }
  fs.mkdirSync(path.dirname(QA_MD), { recursive: true });
  fs.writeFileSync(QA_MD, reportLines.join('\n'), 'utf8');
  fs.writeFileSync(QA_JSON, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO QUALIDADE DE EXTRAÇÃO ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
