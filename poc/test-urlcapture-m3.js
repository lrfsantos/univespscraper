// Frente 1 — testes da captura de recursos URL (sem AVA, sem credenciais).
const fs = require('fs');
const path = require('path');
const { avaliarCapturaUrl, sanitizar } = require('./lib/url-capture');

const OUT = path.join(__dirname, '..', 'audit-temp', 'URLCAPTURE_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

const AVA = 'https://ava.univesp.br/mod/url/view.php?id=86028';
const CURSO = 'https://ava.univesp.br/course/view.php?id=18491';
const YT = 'https://www.youtube.com/watch?v=xaoHPwa9sqk&themeRefresh=1';
const LIVRO = 'https://app.minhabiblioteca.com.br/reader/books/9788597021653/pageid/42?dummy=placeholder';
const UI = 'Clique em S1 - Vídeo-base - Qual o significado de ética? para abrir o recurso.';

record({ id: 'U1', title: 'wrapper mod/url com texto de interface = sem-destino, zero chars', status: ok((function () {
  const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: AVA, texto: UI });
  return r.acao === 'sem-destino' && r.status === 'inaccessible' && r.chars === 0 && r.detail === 'destino-nao-detectado';
})()) });
record({ id: 'U2', title: 'destino YouTube mas texto da interface = nao salvar', status: ok((function () {
  const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: YT, texto: UI });
  return r.acao === 'interface' && r.status === 'inaccessible' && r.chars === 0;
})()) });
record({ id: 'U3', title: 'destino correto com conteudo = ok e evidencia sanitizada', status: ok((function () {
  const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: YT, texto: 'Conteúdo real do vídeo' });
  return r.acao === 'destino' && r.status === 'ok' && r.chars === 'Conteúdo real do vídeo'.length && r.detail.includes('www.youtube.com/watch') && !r.detail.includes('v=') && !r.detail.includes('themeRefresh');
})()) });
record({ id: 'U4', title: 'destino igual a origem (curso) = sem-destino', status: ok(avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: CURSO, texto: 'qualquer' }).acao === 'sem-destino') });
record({ id: 'U5', title: 'sem destino capturado = sem-destino', status: ok(avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: '', texto: 'qualquer' }).acao === 'sem-destino') });
record({ id: 'U6', title: 'URL assinada nao vaza no detail', status: ok((function () {
  const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: LIVRO, texto: 'texto do livro' });
  return r.status === 'ok' && !/dummy=|SEGREDO|code=/.test(r.detail) && r.detail.includes('/reader/books/9788597021653/pageid/42');
})()) });
record({ id: 'U7', title: 'sanitizar remove query e fragmento', status: ok(sanitizar('https://x.br/a/b?token=abc#z') === 'https://x.br/a/b') });
record({ id: 'U8', title: 'recurso page nao e afetado pela regra URL', status: ok(avaliarCapturaUrl({ subKind: 'page', origemUrl: CURSO, destinoUrl: AVA, texto: UI }).acao === 'nao-aplicavel') });

const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
