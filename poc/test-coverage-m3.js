// Frente 3 — cobertura incompleta (sem AVA, sem credenciais).
const fs = require('fs');
const path = require('path');
const { ehSomenteCapa, intervaloDeclarado, avaliarCobertura } = require('./lib/coverage-check');

const OUT = path.join(__dirname, '..', 'audit-temp', 'COVERAGE_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

const CAPA = 'Reinaldo O. da Silva\n2a edição\nProfessor da Fundação Escola de Comércio\nTeorias da Administração';
const CORPO = 'A Revolução Industrial impactou diretamente no mundo empresarial e contribuiu para o surgimento da profissão do administrador de empresas no Brasil durante o século vinte.';

record({ id: 'C1', title: 'folha de titulo com sinais e sem corpo = capa', status: ok(ehSomenteCapa(CAPA) === true) });
record({ id: 'C2', title: 'texto curto legítimo com paragrafo de corpo NAO e capa', status: ok(ehSomenteCapa(CORPO) === false) });
record({ id: 'C3', title: 'so titulo curto sem sinais NAO e capa', status: ok(ehSomenteCapa('S1 - Aprofundando o tema') === false) });
record({ id: 'C4', title: 'capa com paragrafo longo depois NAO e capa', status: ok(ehSomenteCapa(CAPA + '\n\n' + CORPO) === false) });
record({ id: 'C5', title: 'intervalo impresso extraido do titulo', status: ok(JSON.stringify(intervaloDeclarado('Leia o capítulo 6, p. 217-250')) === JSON.stringify({ inicio: 217, fim: 250 })) });
record({ id: 'C6', title: 'titulo sem intervalo retorna null', status: ok(intervaloDeclarado('Texto-base - Ética profissional') === null) });
record({ id: 'C7', title: 'somente capa pede avanco e permanece partial', status: ok((function () {
  const r = avaliarCobertura({ texto: CAPA, titulo: 'Texto-base 1 (p. 4-18)' });
  return r.acao === 'so-capa' && r.status === 'partial' && r.requerAvanco === true;
})()) });
record({ id: 'C8', title: 'CIN200 com calibracao 248 e ultima 248 = coberto', status: ok((function () {
  const r = avaliarCobertura({ texto: CORPO, titulo: 'CIN200 capítulo 6 p. 217-250', ultimaPaginaImpressa: 248, fimCalibrado: 248 });
  return r.acao === 'coberto' && r.status === null;
})()) });
record({ id: 'C9', title: 'sem calibracao, intervalo declarado 250 e ultima 248 = incompleto', status: ok((function () {
  const r = avaliarCobertura({ texto: CORPO, titulo: 'CIN200 p. 217-250', ultimaPaginaImpressa: 248 });
  return r.acao === 'incompleto' && /248\/esperado=250/.test(r.detail);
})()) });
record({ id: 'C10', title: 'sem intervalo declarado nao presume erro', status: ok(avaliarCobertura({ texto: CORPO, titulo: 'Texto-base 1', ultimaPaginaImpressa: 100 }).acao === 'sem-intervalo') });
record({ id: 'C11', title: 'ultima pagina desconhecida = inconclusivo, nunca integral', status: ok((function () {
  const r = avaliarCobertura({ texto: CORPO, titulo: 'p. 10-20' });
  return r.acao === 'inconclusivo' && r.status === 'partial';
})()) });
record({ id: 'C12', title: 'calibracao local CIN200 = 248 (nao exigir 249-250)', status: ok((function () {
  const fim = require('./lib/coverage-check').fimCalibradoParaTitulo('CIN200 - Fundamentos de Gestão de Projetos p. 217-250');
  const r = avaliarCobertura({ texto: CORPO, titulo: 'CIN200 Fundamentos de Gestão de Projetos p. 217-250', ultimaPaginaImpressa: 248, fimCalibrado: fim });
  return fim === 248 && r.acao === 'coberto';
})()) });

const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
