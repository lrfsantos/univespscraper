// Frente 5 — classificação de leitores e motivos honestos (sem AVA).
const fs = require('fs');
const path = require('path');
const { classificarLeitor, leitorDeHost, deveGravarConteudo } = require('./lib/reader-classifier');

const OUT = path.join(__dirname, '..', 'audit-temp', 'READERCLASS_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

record({ id: 'RC1', title: 'subdominios conhecidos reconhecidos (http e https)', status: ok(
  leitorDeHost('app.minhabiblioteca.com.br') === 'minhabiblioteca' &&
  leitorDeHost('jigsaw.minhabiblioteca.com.br') === 'minhabiblioteca' &&
  leitorDeHost('bookshelf.vitalsource.com') === 'vitalsource' &&
  leitorDeHost('plataforma.bvirtual.com.br') === 'bvirtual' &&
  leitorDeHost('leitor.bvirtual.com.br') === 'bvirtual') });
record({ id: 'RC2', title: 'dominio desconhecido nao e confundido com falta de autorizacao', status: ok((function () {
  const r = classificarLeitor({ url: 'https://exemplo.gov.br/leitor', texto: 'not authorized' });
  return r.motivo === 'dominio-desconhecido' && r.dominio === 'desconhecido';
})()) });
record({ id: 'RC3', title: 'leitor conhecido com not-authorized = sem-autorizacao', status: ok((function () {
  const r = classificarLeitor({ url: 'https://leitor.bvirtual.com.br/not-authorized', texto: '' });
  return r.motivo === 'sem-autorizacao' && r.leitor === 'bvirtual';
})()) });
record({ id: 'RC4', title: 'leitor conhecido com sessao expirada = sem-autorizacao', status: ok(
  classificarLeitor({ url: 'https://app.minhabiblioteca.com.br/reader', texto: 'Sessão expirou' }).motivo === 'sem-autorizacao') });
record({ id: 'RC5', title: 'selecao exigida = reader-selection-required', status: ok(
  classificarLeitor({ url: 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789', texto: 'Escolha o formato desejado' }).motivo === 'reader-selection-required') });
record({ id: 'RC6', title: 'sem frames = iframe-inacessivel', status: ok(
  classificarLeitor({ url: 'https://app.minhabiblioteca.com.br/reader/books/x/pageid/42' }).motivo === 'iframe-inacessivel') });
record({ id: 'RC7', title: 'frames sem conteudo consultavel = motivo especifico', status: ok(
  classificarLeitor({ url: 'https://app.minhabiblioteca.com.br/reader/books/x/pageid/42', frames: [{ url: 'https://app.minhabiblioteca.com.br/top.html' }] }).motivo === 'iframe-sem-conteudo-consultavel') });
record({ id: 'RC8', title: 'frame pageid reconhecido = formato pageid e autorizacao de gravar', status: ok((function () {
  const r = classificarLeitor({ url: 'https://app.minhabiblioteca.com.br/reader/books/x/pageid/42', frames: [{ url: 'https://jigsaw.minhabiblioteca.com.br/books/x/pages/42/content' }] });
  return r.formato === 'pageid' && r.motivo === null && deveGravarConteudo(r) === true;
})()) });
record({ id: 'RC9', title: 'frame bvirtual PDF reconhecido = bvpdf', status: ok(
  classificarLeitor({ url: 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789', frames: [{ url: 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789/pdf/17' }] }).formato === 'bvpdf') });
record({ id: 'RC10', title: 'nenhum motivo = nenhum arquivo gravado', status: ok(
  [RC2(), RC3(), RC6()].every((r) => deveGravarConteudo(r) === false) ) });

function RC2() { return classificarLeitor({ url: 'https://exemplo.gov.br/x' }); }
function RC3() { return classificarLeitor({ url: 'https://leitor.bvirtual.com.br/not-authorized' }); }
function RC6() { return classificarLeitor({ url: 'https://app.minhabiblioteca.com.br/reader/books/x/pageid/42' }); }

const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
