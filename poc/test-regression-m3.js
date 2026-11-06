const fs = require('fs');
const os = require('os');
const path = require('path');
const books = require('../src/extract/books');
const ep = require('../src/extract/epub-structure');
const { evaluateCriteria } = require('./lib/m3-criteria');

// Testes de REGRESSÃO do Módulo 3 — sintéticos (sem AVA/leitor real).
// Reproduzem os três problemas originais (Issues A/B/C) e verificam as correções.
// Nenhum conteúdo protegido é gravado: fixtures sintéticas e hashes apenas.

const OUT = path.join(__dirname, '..', 'audit-temp', 'REGRESSION_RESULTS.json');
const results = [];

function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

function sha256(s) {
  return require('crypto').createHash('sha256').update(s || '').digest('hex');
}

// ==================== ISSUE A — EPUB estrutural ====================

function buildEpubFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epubfix-'));
  const text = path.join(dir, 'Text');
  fs.mkdirSync(path.join(dir, 'META-INF'), { recursive: true });
  fs.mkdirSync(text, { recursive: true });
  fs.writeFileSync(path.join(dir, 'META-INF', 'container.xml'),
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  fs.writeFileSync(path.join(dir, 'content.opf'),
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Fixture</dc:title></metadata><manifest>' +
    '<item id="front" href="Text/front.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="ch01a" href="Text/ch01a.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="ch01b" href="Text/ch01b.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="ch02" href="Text/ch02.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
    '</manifest><spine toc="ncx"><itemref idref="front"/><itemref idref="ch01a"/><itemref idref="ch01b"/><itemref idref="ch02"/></spine></package>');
  fs.writeFileSync(path.join(dir, 'toc.ncx'),
    '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>' +
    '<navPoint id="p1"><navLabel><text>Front</text></navLabel><content src="Text/front.xhtml"/></navPoint>' +
    '<navPoint id="c1"><navLabel><text>Capítulo 1</text></navLabel><content src="Text/ch01a.xhtml"/></navPoint>' +
    '<navPoint id="c2"><navLabel><text>Capítulo 2</text></navLabel><content src="Text/ch02.xhtml"/></navPoint>' +
    '</navMap></ncx>');
  for (const f of ['front', 'ch01a', 'ch01b', 'ch02']) {
    fs.writeFileSync(path.join(text, f + '.xhtml'), '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>' + f + ' content.</p></body></html>');
  }
  return dir;
}

function issueA() {
  const dir = buildEpubFixture();
  const parsed = ep.parseEpubPackage(dir);
  const pkg = parsed.pkg;
  const group = 'A';

  const v1 = ep.validateChapterExtraction({ pkg, chapter: 1, extractedDocIds: ['ch01a', 'ch01b'] });
  record({ id: group + '-1', title: 'Capítulo completo, limite estrutural identificado', status: v1.endOk ? 'PASS' : 'FAIL', detail: `endOk=${v1.endOk} status=${v1.status}` });

  const v2 = ep.validateChapterExtraction({ pkg, chapter: 1, extractedDocIds: ['ch01a'] });
  const oldEndOk = /[.!?…»"'\]”]$/.test('Texto truncado do capítulo que termina em ponto final.');
  record({
    id: group + '-2', title: 'Capítulo truncado terminando em ponto final (reprodução da falsa aprovação antiga)',
    status: (oldEndOk && !v2.endOk) ? 'PASS' : 'FAIL',
    detail: `oldEndOk(só pontuação)=${oldEndOk} (falsa aprovação) | newEndOk(estrutural)=${v2.endOk} (reprovado)`,
  });

  const v3 = ep.validateChapterExtraction({ pkg, chapter: 1, extractedDocIds: ['ch01a', 'ch01b'] });
  record({ id: group + '-3', title: 'Capítulo distribuído em múltiplos XHTML (completo)', status: (v3.endOk && v3.chapterIds.length === 2) ? 'PASS' : 'FAIL', detail: `chapterIds=${v3.chapterIds.join(',')} endOk=${v3.endOk}` });

  const v4 = ep.validateChapterExtraction({ pkg, chapter: 1, extractedDocIds: ['ch01a', 'ch01b', 'ch02'] });
  record({ id: group + '-4', title: 'Documento do capítulo seguinte presente no spine não é incluído', status: (v4.nextChapterIncluded === true && v4.endOk === false) ? 'PASS' : 'FAIL', detail: `nextIncluded=${v4.nextChapterIncluded} endOk=${v4.endOk}` });

  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epubbad-'));
  fs.mkdirSync(path.join(badDir, 'META-INF'));
  fs.writeFileSync(path.join(badDir, 'META-INF', 'container.xml'), '<container><rootfiles></rootfiles></container>');
  const bad = ep.parseEpubPackage(badDir);
  record({ id: group + '-5', title: 'OPF ausente/inválido → partial', status: bad.ok === false ? 'PASS' : 'FAIL', detail: `parse=${JSON.stringify(bad)}` });

  const v6 = ep.validateChapterExtraction({ pkg, chapter: 9, extractedDocIds: ['ch01a'] });
  record({ id: group + '-6', title: 'Capítulo solicitado não identificado estruturalmente → partial', status: (v6.boundaryKnown === false && v6.endOk === false && v6.status === 'partial') ? 'PASS' : 'FAIL', detail: `boundaryKnown=${v6.boundaryKnown} reason=${v6.reason}` });

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(badDir, { recursive: true, force: true });
}

// ==================== ISSUE B — associação PAGEID frame/página ====================

function issueB() {
  const group = 'B';
  const active45 = { id: 'f45', active: true, text: 'conteudo da pagina 45 impressa'.repeat(3) };
  const prefetch46 = { id: 'f46', active: false, text: 'conteudo da pagina 46 prefetch'.repeat(3) };
  const inactive22 = { id: 'f22', active: false, text: 'conteudo da pagina 22 cache'.repeat(3) };
  const seen = new Map();

  const r1 = books.associateActivePage({ frames: [active45, prefetch46], printedPage: 45, seenHashes: new Map() });
  record({ id: group + '-1', title: 'Frame ativo (pág 45) + prefetch (pág 46) presentes → só ativo associado', status: (r1.accepted && r1.frameId === 'f45' && !r1.ambiguous) ? 'PASS' : 'FAIL', detail: `frameId=${r1.frameId} accepted=${r1.accepted}` });

  const r2 = books.associateActivePage({ frames: [prefetch46, active45], printedPage: 45, seenHashes: new Map() });
  record({ id: group + '-2', title: 'Ordem dos frames invertida → associação correta', status: (r2.accepted && r2.frameId === 'f45') ? 'PASS' : 'FAIL', detail: `frameId=${r2.frameId}` });

  const r3 = books.associateActivePage({ frames: [active45, inactive22], printedPage: 45, seenHashes: new Map() });
  record({ id: group + '-3', title: 'Frame ativo e inativo presentes → só o ativo é aceito', status: (r3.accepted && r3.frameId === 'f45') ? 'PASS' : 'FAIL', detail: `frameId=${r3.frameId}` });

  const r4 = books.associateActivePage({ frames: [{ id: 'x1', active: false, text: 'a' }, { id: 'x2', active: false, text: 'b' }], printedPage: 45, seenHashes: new Map() });
  record({ id: group + '-4', title: 'Sem frame ativo identificável → associação rejeitada (ambígua)', status: (r4.ambiguous && !r4.accepted) ? 'PASS' : 'FAIL', detail: `ambiguous=${r4.ambiguous} reason=${r4.reason}` });

  const r5 = books.associateActivePage({ frames: [active45, { id: 'f45b', active: true, text: 'outro' }], printedPage: 45, seenHashes: new Map() });
  record({ id: group + '-5', title: 'Múltiplos frames ativos → associação rejeitada (ambígua)', status: (r5.ambiguous && !r5.accepted) ? 'PASS' : 'FAIL', detail: `ambiguous=${r5.ambiguous} reason=${r5.reason}` });

  const seen6 = new Map();
  const d1 = books.associateActivePage({ frames: [active45, prefetch46], printedPage: 45, seenHashes: seen6 });
  const d2 = books.associateActivePage({ frames: [prefetch46, active45], printedPage: 45, seenHashes: seen6 });
  record({ id: group + '-6', title: 'Conteúdo duplicado na mesma página → dedup sem perda de identidade', status: (d1.accepted && d2.audit.status === 'duplicate' && seen6.size === 1) ? 'PASS' : 'FAIL', detail: `d1.accepted=${d1.accepted} d2.audit.status=${d2.audit.status} seenHashes=${seen6.size}` });

  const seen7 = new Map();
  const e1 = books.associateActivePage({ frames: [active45], printedPage: 45, seenHashes: seen7 });
  const e2 = books.associateActivePage({ frames: [{ id: 'f99', active: true, text: active45.text }], printedPage: 99, seenHashes: seen7 });
  const key99 = '99|' + sha256(active45.text.trim());
  record({ id: group + '-7', title: 'Mesmo conteúdo em páginas distintas → origem preservada', status: (e1.accepted && e2.accepted && seen7.get(key99) === 99 && seen7.size === 2) ? 'PASS' : 'FAIL', detail: `origem da página 99=${seen7.get(key99)} seenHashes=${seen7.size}` });

  // B8: "Número exibido muda antes da atualização do frame" — o waitPageChange + associação por frame ativo trata isso;
  // aqui verificamos a função de classificação pura para o cenário de sincronização (associação apenas do ativo).
  const r8 = books.classifyContentFrames([prefetch46, active45]);
  record({ id: group + '-8', title: 'Prefetch do capítulo seguinte presente → não é associado ao capítulo atual', status: (r8.status === 'ok' && r8.active.id === 'f45') ? 'PASS' : 'FAIL', detail: `active.id=${r8.active && r8.active.id}` });
}

// ==================== ISSUE C — critérios e status ====================

function mkBook(over) {
  return Object.assign({
    status: 'integral', expectInaccessible: false, expected: { chapter: 1 },
    validation: { hasText: true, noNonsense: true, startOk: true, midOk: true, endOk: true, chapterOk: true, ambiguousPages: 0, unexpectedContent: [], repetitions: [], warnings: [] },
  }, over);
}

function issueC() {
  const group = 'C';
  const { statusForBook } = books;

  // C1: todos integrais → PASS
  const booksC1 = [mkBook({}), mkBook({})];
  record({ id: group + '-1', title: 'Todos os recursos esperados integrais → PASS', status: evaluateCriteria(booksC1).passed ? 'PASS' : 'FAIL' });

  // C2: todos acessíveis parciais → FAIL
  const booksC2 = [mkBook({ status: 'partial' }), mkBook({ status: 'partial' })];
  record({ id: group + '-2', title: 'Todos os recursos acessíveis parciais → FAIL', status: !evaluateCriteria(booksC2).passed ? 'PASS' : 'FAIL', detail: `expectedResourcesIntegral=${evaluateCriteria(booksC2).crit.expectedResourcesIntegral}` });

  // C3: um parcial + um integral (ambos deveriam ser integrais) → FAIL
  const booksC3 = [mkBook({}), mkBook({ status: 'partial' })];
  record({ id: group + '-3', title: 'Um acessível parcial e outro integral → FAIL (se ambos deveriam ser integrais)', status: !evaluateCriteria(booksC3).passed ? 'PASS' : 'FAIL' });

  // C4: inacessível corretamente identificado → critério de inacessibilidade PASS
  const booksC4 = [mkBook({ status: 'integral' }), mkBook({ status: 'inaccessible', expectInaccessible: true })];
  record({ id: group + '-4', title: 'Recurso inacessível corretamente identificado → critério PASS', status: evaluateCriteria(booksC4).crit.bvirtualMarkedInaccessible ? 'PASS' : 'FAIL' });

  // C5: integral sem validação de fim → status não integral + critério FAIL
  const v5 = mkBook({ status: 'integral', validation: { hasText: true, noNonsense: true, startOk: true, midOk: true, endOk: false, chapterOk: true, ambiguousPages: 0, unexpectedContent: [], repetitions: [], warnings: ['fim-de-capitulo-nao-confirmado'] } });
  const s5 = statusForBook({ format: 'pageid', validation: v5.validation, readerLoaded: true, chapterNotFound: false, expected: v5.expected });
  record({ id: group + '-5', title: 'Recurso integral sem validação de fim → NÃO integral', status: (s5 !== 'integral' && !evaluateCriteria([v5]).passed) ? 'PASS' : 'FAIL', detail: `statusForBook=${s5}` });

  // C6: integral com capítulo incorreto → NÃO integral
  const v6 = mkBook({ status: 'integral', validation: { hasText: true, noNonsense: true, startOk: true, midOk: true, endOk: true, chapterOk: false, ambiguousPages: 0, unexpectedContent: [], repetitions: [], warnings: ['capitulo-1-nao-confirmado'] } });
  const s6 = statusForBook({ format: 'pageid', validation: v6.validation, readerLoaded: true, chapterNotFound: false, expected: v6.expected });
  record({ id: group + '-6', title: 'Recurso integral com capítulo incorreto → NÃO integral', status: (s6 !== 'integral') ? 'PASS' : 'FAIL', detail: `statusForBook=${s6}` });

  // C7: integral com página de origem ambígua → NÃO integral
  const v7 = mkBook({ status: 'integral', validation: { hasText: true, noNonsense: true, startOk: true, midOk: true, endOk: true, chapterOk: true, ambiguousPages: 2, unexpectedContent: [], repetitions: [], warnings: ['paginas-com-associacao-ambigua (2)'] } });
  const s7 = statusForBook({ format: 'pageid', validation: v7.validation, readerLoaded: true, chapterNotFound: false, expected: v7.expected });
  record({ id: group + '-7', title: 'Recurso integral com página de origem ambígua → NÃO integral', status: (s7 !== 'integral') ? 'PASS' : 'FAIL', detail: `statusForBook=${s7}` });

  // C8: conteúdo do capítulo seguinte incluído → NÃO integral (unexpectedContent)
  const v8 = mkBook({ status: 'integral', validation: { hasText: true, noNonsense: true, startOk: true, midOk: true, endOk: true, chapterOk: true, ambiguousPages: 0, unexpectedContent: ['cabecalho-do-proximo-capitulo'], repetitions: [], warnings: ['conteudo-de-outro-capitulo/pagina-incluido (1)'] } });
  const s8 = statusForBook({ format: 'pageid', validation: v8.validation, readerLoaded: true, chapterNotFound: false, expected: v8.expected });
  record({ id: group + '-8', title: 'Recurso integral com conteúdo do capítulo seguinte incluído → NÃO integral', status: (s8 !== 'integral') ? 'PASS' : 'FAIL', detail: `statusForBook=${s8}` });
}

// ==================== ISSUE D — decisão de limite EPUB (produção, pura) ====================

function issueD() {
  const group = 'D';
  const { confirmEpubBoundaryDecision } = books;
  const beforeDoc = { doc: 'chapter01', idref: 'chapter01' };
  const beforeUrl = 'https://jigsaw.minhabiblioteca.com.br/books/1/epub/OEBPS/Text/chapter01.xhtml?favre=brett#cfi=/6/26%5B;vnd.vst.idref=chapter01%5D';

  // D-1: caso real Chiavenato — doc muda para chapter02 mas o texto NÃO contém "Capítulo 2".
  const d1 = confirmEpubBoundaryDecision({ beforeDoc, beforeUrl, nextDocIdent: { doc: 'chapter02', idref: 'chapter02' }, nextHead: 'O QUE VEREMOS ADIANTE\n\nO que é um negócio?', chapter: 2 });
  record({ id: group + '-1', title: 'Doc muda p/ capítulo seguinte SEM "Capítulo N+1" no texto (caso Chiavenato) → confirmado', status: (d1.confirmed && d1.docChanged && d1.nextDocMatches && d1.headingMatches === false) ? 'PASS' : 'FAIL', detail: JSON.stringify(d1) });

  // D-2: mesmo documento → não confirmado.
  const d2 = confirmEpubBoundaryDecision({ beforeDoc, beforeUrl, nextDocIdent: { doc: 'chapter01', idref: 'chapter01' }, nextHead: 'Capítulo 2', chapter: 2 });
  record({ id: group + '-2', title: 'Documento não muda → NÃO confirmado', status: (d2.confirmed === false && d2.reason === 'documento-nao-mudou') ? 'PASS' : 'FAIL', detail: JSON.stringify(d2) });

  // D-3: documento intermediário (não é o capítulo N+1) → não confirmado (guarda multi-doc).
  const d3 = confirmEpubBoundaryDecision({ beforeDoc, beforeUrl, nextDocIdent: { doc: 'chapter01b', idref: 'chapter01b' }, nextHead: 'Capítulo 2', chapter: 2 });
  record({ id: group + '-3', title: 'Documento intermediário do capítulo (multi-doc) → NÃO confirmado', status: (d3.confirmed === false && d3.nextDocMatches === false) ? 'PASS' : 'FAIL', detail: JSON.stringify(d3) });

  // D-4: idref muda ainda que doc igual → confirmado.
  const d4 = confirmEpubBoundaryDecision({ beforeDoc, beforeUrl, nextDocIdent: { doc: 'chapter01', idref: 'chapter02' }, nextHead: 'Capítulo 2', chapter: 2 });
  record({ id: group + '-4', title: 'idref muda para o capítulo seguinte → confirmado', status: (d4.confirmed === true) ? 'PASS' : 'FAIL', detail: JSON.stringify(d4) });

  // D-5: sem capítulo esperado → não confirmado.
  const d5 = confirmEpubBoundaryDecision({ beforeDoc, beforeUrl, nextDocIdent: { doc: 'chapter02', idref: 'chapter02' }, nextHead: '', chapter: null });
  record({ id: group + '-5', title: 'Sem capítulo esperado → NÃO confirmado', status: (d5.confirmed === false && d5.reason === 'sem-capitulo-esperado') ? 'PASS' : 'FAIL', detail: JSON.stringify(d5) });

  // D-6: doc muda E texto contém "Capítulo 2" → confirmado com headingMatches=true (confiança extra).
  const d6 = confirmEpubBoundaryDecision({ beforeDoc, beforeUrl, nextDocIdent: { doc: 'chapter02', idref: 'chapter02' }, nextHead: 'Capítulo 2 — Administração', chapter: 2 });
  record({ id: group + '-6', title: 'Doc muda + cabeçalho "Capítulo N+1" → confirmado (confiança extra)', status: (d6.confirmed && d6.headingMatches === true) ? 'PASS' : 'FAIL', detail: JSON.stringify(d6) });
}

// ==================== executor ====================

(async () => {
  issueA();
  issueB();
  issueC();
  issueD();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO REGRESSÃO ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) {
    console.log('FALHAS:');
    for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail);
    process.exitCode = 1;
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
