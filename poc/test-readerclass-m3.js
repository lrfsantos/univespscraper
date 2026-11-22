// Frente 5 — classificação de leitores e motivos honestos (sem AVA).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { classificarLeitor, avaliarEvidenciasLeitor, leitorDeHost, deveGravarConteudo, ehDominioInstitucional, devePersistirBook, persistirMarkdownBook, executarFluxoBook, decidirExtracaoLeitor } = require('./lib/reader-classifier');

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

record({ id: 'RC11', title: 'VitalSource com /pages/{id}/content nao vira pageid', status: ok((function () {
  const r = classificarLeitor({ url: 'https://bookshelf.vitalsource.com/reader/books/x', frames: [{ url: 'https://bookshelf.vitalsource.com/books/x/pages/12/content' }] });
  return r.leitor === 'vitalsource' && r.formato === 'vitalsource' && r.motivo === null;
})()) });
record({ id: 'RC12', title: 'hostname VitalSource sozinho nao e reader-auth', status: ok((function () {
  const r = classificarLeitor({ url: 'https://bookshelf.vitalsource.com/reader/books/x', frames: [{ url: 'https://bookshelf.vitalsource.com/books/x/pages/12/content' }] });
  return r.motivo !== 'sem-autorizacao' && r.motivo !== 'reader-auth';
})()) });
record({ id: 'RC13', title: 'evilunivesp.br nao e dominio institucional', status: ok(
  ehDominioInstitucional('univesp.br') && ehDominioInstitucional('ava.univesp.br') && !ehDominioInstitucional('evilunivesp.br')) });
record({ id: 'RC14', title: 'falha de leitura de evidencias e inconclusiva, nao sem-autorizacao', status: ok((function () {
  const r = classificarLeitor({ url: 'https://leitor.bvirtual.com.br/not-authorized', leituraOk: false });
  return r.motivo === 'inconclusivo' && !deveGravarConteudo(r);
})()) });
record({ id: 'RC15', title: 'autorizacao negada no DOM de dominio conhecido e detectada', status: ok(
  classificarLeitor({ url: 'https://leitor.bvirtual.com.br/reader/1', texto: 'not authorized', frames: [{ url: 'https://leitor.bvirtual.com.br/Leitor/Publicacao/1/pdf/2' }] }).motivo === 'sem-autorizacao') });
record({ id: 'RC16', title: 'integracao: extrator inaccessible nao cria Markdown', status: ok((function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readerclass-'));
  const base = path.join(tmp, '01_material');
  const p1 = persistirMarkdownBook({ resultado: { status: 'inaccessible', text: '' }, classificacao: { motivo: null }, caminhoBase: base, titulo: 'X' });
  const p2 = persistirMarkdownBook({ resultado: { status: 'partial', text: '   ' }, classificacao: { motivo: null }, caminhoBase: base, titulo: 'X' });
  return p1.gravado === false && p2.gravado === false && !fs.existsSync(base + '.md') &&
    devePersistirBook({ status: 'partial', text: 'conteudo' }) === true;
})()) });
record({ id: 'RC17', title: 'integracao: leitor com motivo nao persiste mesmo com texto', status: ok((function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readerclass2-'));
  const base = path.join(tmp, '01_material');
  const p = persistirMarkdownBook({ resultado: { status: 'partial', text: 'texto' }, classificacao: { motivo: 'sem-autorizacao' }, caminhoBase: base, titulo: 'X' });
  return p.gravado === false && !fs.existsSync(base + '.md');
})()) });

(async () => {
  const casos = [
    ['RC18', 'DOM inacessivel: nao chama extractBook', { leituraOk: false }, 'evidencias-inconclusivas'],
    ['RC19', 'frames inacessiveis: nao chama extractBook', { classificacao: { motivo: 'iframe-inacessivel', leitor: 'vitalsource' } }, 'iframe-inacessivel'],
    ['RC20', 'reader-selection-required: nao chama extractBook', { classificacao: { motivo: 'reader-selection-required', leitor: 'bvirtual' } }, 'reader-selection-required'],
    ['RC21', 'sem-autorizacao: nao chama extractBook', { classificacao: { motivo: 'sem-autorizacao', leitor: 'minhabiblioteca' } }, 'sem-autorizacao'],
  ];
  for (const [id, titulo, args, esperado] of casos) {
    let chamou = false;
    const r = await executarFluxoBook(Object.assign({ extrair: async () => { chamou = true; } }, args));
    record({ id, title: titulo, status: ok(r.extraiu === false && chamou === false && r.bloqueio === esperado) });
  }
  let chamouOk = false;
  const okFluxo = await executarFluxoBook({ classificacao: { motivo: null, leitor: 'bvirtual', formato: 'bvpdf' }, extrair: async () => { chamouOk = true; } });
  record({ id: 'RC22', title: 'leitor classificado sem motivo: extrai normalmente', status: ok(okFluxo.extraiu === true && chamouOk === true) });

  const AVA = 'https://ava.univesp.br/mod/lti/view.php?id=263859';
  const casosFrame = [
    ['RC23', 'pagina institucional + iframe VitalSource com not-authorized bloqueia',
      { urlPrincipal: AVA, texto: 'not authorized', frames: [{ url: 'https://bookshelf.vitalsource.com/books/x/pages/12/content' }] }, 'sem-autorizacao'],
    ['RC24', 'pagina institucional + selecao pendente no leitor bloqueia',
      { urlPrincipal: AVA, texto: 'Escolha o formato desejado', frames: [{ url: 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789' }] }, 'reader-selection-required'],
    ['RC25', 'host vazio/ilegivel gera inconclusivo e bloqueia',
      { urlPrincipal: '', texto: '', frames: [] }, 'evidencias-inconclusivas'],
  ];
  for (const [id, titulo, evid, esperado] of casosFrame) {
    const aval = avaliarEvidenciasLeitor(evid);
    let chamou = false;
    const r = await executarFluxoBook({ classificacao: aval.classificacao, leituraOk: true, extrair: async () => { chamou = true; } });
    record({ id, title: titulo, status: ok(r.extraiu === false && chamou === false && r.bloqueio === esperado) });
  }
  const avalOk = avaliarEvidenciasLeitor({ urlPrincipal: AVA, texto: '', frames: [{ url: 'https://bookshelf.vitalsource.com/books/x/pages/12/content' }] });
  let chamouValido = false;
  const fluxoOk = await executarFluxoBook({ classificacao: avalOk.classificacao, extrair: async () => { chamouValido = true; } });
  record({ id: 'RC26', title: 'iframe VitalSource valido em pagina institucional continua extraindo', status: ok(
    avalOk.classificacao.leitor === 'vitalsource' && decidirExtracaoLeitor({ classificacao: avalOk.classificacao }).extrair === true &&
    fluxoOk.extraiu === true && chamouValido === true) });

  const fails = results.filter((r) => r.status !== 'PASS').length;
  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
  console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})();
