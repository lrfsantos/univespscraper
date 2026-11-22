// Frente 3 — teste de integração do fluxo PDF do runner (sem AVA).
const fs = require('fs');
const path = require('path');
const { processarResultadoPdf, persistirMarkdownPdf } = require('./lib/pdf-flow');
const os = require('os');

const OUT = path.join(__dirname, '..', 'audit-temp', 'PDFFLOW_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

const CAPA = 'Reinaldo O. da Silva\n2a edição\nProfessor da Fundação Escola de Comércio\nTeorias da Administração';
const CAPITULO = 'A Revolução Industrial impactou diretamente no mundo empresarial e contribuiu para o surgimento da profissão do administrador no Brasil.';
const pag = (text) => ({ text });

const r1 = processarResultadoPdf({
  status: 'integral', totalPagesArquivo: 3,
  pages: [pag(CAPA), pag(CAPITULO), pag('Continuação do capítulo com conteúdo adicional.')],
  printedPagination: { detected: [null, null, null], reliable: 'none' },
}, { title: 'Texto-base 1 (p. 4-18)', courseId: 'ADM210' });
record({ id: 'PF1', title: 'capa e capitulo: capa descartada, conteudo preservado, partial com avanco', status: ok(
  r1.texto.indexOf(CAPA) < 0 && r1.texto.indexOf(CAPITULO) >= 0 && r1.status === 'partial' && /avanco-pagina-2/.test(r1.detail)) });

const r2 = processarResultadoPdf({
  status: 'integral', totalPagesArquivo: 2,
  pages: [pag(CAPA), pag(CAPA)],
  printedPagination: { detected: [], reliable: 'none' },
}, { title: 'Texto-base 1 (p. 4-18)', courseId: 'ADM210' });
record({ id: 'PF2', title: 'todas as paginas sao capa: partial com avanco-sem-conteudo', status: ok(
  r2.status === 'partial' && /avanco-sem-conteudo/.test(r2.detail) && r2.texto.indexOf(CAPA) >= 0) });

const r3 = processarResultadoPdf({
  status: 'integral', totalPagesArquivo: 3,
  pages: [pag(CAPITULO), pag(CAPITULO + ' mais'), pag(CAPITULO + ' fim')],
  printedPagination: { detected: [217, 248, null], reliable: 'partial' },
}, { title: 'CIN200 capitulo 6 p. 217-250', courseId: 'CIN200' });
record({ id: 'PF3', title: 'ultima pagina fisica sem numero: inconclusivo, nao coberto', status: ok(
  r3.status === 'partial' && /ultima-pagina-impressa-desconhecida/.test(r3.detail)) });

const r4 = processarResultadoPdf({
  status: 'integral', totalPagesArquivo: 3,
  pages: [pag(CAPITULO), pag(CAPITULO + ' meio'), pag(CAPITULO + ' fim 248')],
  printedPagination: { detected: [217, 240, 248], reliable: 'partial' },
}, { title: 'CIN200 Fundamentos de Gestão de Projetos capitulo 6 p. 217-250', courseId: 'CIN200' });
record({ id: 'PF4', title: 'CIN200 calibrado 248 com ultima fisica 248: sem flag de incompleto', status: ok(
  !/intervalo-incompleto/.test(r4.detail) && !/avanco/.test(r4.detail)) });

const r5 = processarResultadoPdf({ status: 'inaccessible', pages: [], error: 'HTTP 404' }, { title: 'Manual de Oslo', courseId: 'ADM270' });
record({ id: 'PF5', title: 'resposta inacessivel nao gera arquivo (gravarArquivo=false)', status: ok(
  r5.status === 'inaccessible' && r5.chars === 0 && r5.texto === '' && r5.gravarArquivo === false) });

const r6 = processarResultadoPdf({
  status: 'integral', totalPagesArquivo: 3,
  pages: [pag(CAPA), pag(CAPITULO), pag(CAPITULO + ' fim 248')],
  printedPagination: { detected: [null, 217, 248], reliable: 'partial' },
}, { title: 'CIN200 Fundamentos de Gestão de Projetos p. 217-250', courseId: 'CIN200' });
record({ id: 'PF6', title: 'capa + intervalo declarado + ultima fisica 248: capa descartada e intervalo avaliado como coberto', status: ok(
  r6.texto.indexOf(CAPA) < 0 && r6.texto.indexOf(CAPITULO) >= 0 &&
  /avanco-pagina-2/.test(r6.detail) && !/so-capa/.test(r6.detail) && !/intervalo-incompleto/.test(r6.detail)) });

const r7 = processarResultadoPdf({
  status: 'integral', totalPagesArquivo: 1, pages: [pag(CAPA)],
  printedPagination: { detected: [], reliable: 'none' },
}, { title: 'Texto-base 1', courseId: 'ADM210' });
record({ id: 'PF7', title: 'PDF de uma pagina so-capa sem intervalo: partial, nunca integral', status: ok(
  r7.status === 'partial' && /somente-folha-de-titulo/.test(r7.detail)) });

const r8 = processarResultadoPdf({
  status: 'integral', totalPagesArquivo: 2, pages: [pag(CAPA), pag(CAPA)],
  printedPagination: { detected: [], reliable: 'none' },
}, { title: 'Texto-base 1', courseId: 'ADM210' });
record({ id: 'PF8', title: 'PDF multiplas capas sem intervalo: partial com avanco-sem-conteudo', status: ok(
  r8.status === 'partial' && /avanco-sem-conteudo/.test(r8.detail)) });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfflow-'));
const base = path.join(tmp, '01_material');
const naoGravou = persistirMarkdownPdf({ resultado: r5, caminhoBase: base, titulo: 'Manual de Oslo' });
record({ id: 'PF9', title: 'persistencia: inacessivel nao cria Markdown e devolve file=null', status: ok(
  naoGravou.gravado === false && naoGravou.arquivo === null && !fs.existsSync(base + '.md')) });
const gravou = persistirMarkdownPdf({ resultado: r1, caminhoBase: base, titulo: 'Texto-base 1' });
record({ id: 'PF10', title: 'persistencia: conteudo valido gera Markdown', status: ok(
  gravou.gravado === true && fs.existsSync(base + '.md') && fs.readFileSync(base + '.md', 'utf8').includes('Status:')) });

const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
