// Frente 6 — matriz diagnóstica com fixtures locais (sem AVA, sem credenciais).
const fs = require('fs');
const path = require('path');
const { classificarExtracao, compararTentativas } = require('./lib/reader-extraction-matrix');

const OUT = path.join(__dirname, '..', 'audit-temp', 'READERMATRIX_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

// Texto curto retirado da fixture já versionada (sem conteúdo protegido integral).
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'generated-output', 'SAMPLE_READING.md'), 'utf8');
const corpo = fixture.split('## Conteúdo acadêmico extraído')[1] || fixture;
const partes = corpo.split(/\n\n+/).map((x) => x.trim()).filter((x) => x.length > 30);
const trecho = (i) => (partes[i % Math.max(1, partes.length)] || 'conteudo').slice(0, 180);
const pag = (id, impressa, texto) => ({ id, impressa, texto });

const pagesClassic = [pag(11, 1, trecho(0)), pag(12, 2, trecho(1)), pag(13, 3, trecho(2))];
const pagesBeta = [pag(21, 1, trecho(0)), pag(22, 2, ''), pag(23, 3, '')];
const pagesMb = [pag(31, 1, ''), pag(32, 2, ''), pag(33, 3, '')];

record({ id: 'M1', title: 'Pearson clássico com 3 páginas legíveis = extraível', status: ok((function () {
  const r = classificarExtracao({ tipo: 'pearson-classic', paginas: pagesClassic, esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'extraível' && r.comTexto === 3 && r.chars > 0 && !!r.evidencia;
})()) });
record({ id: 'M2', title: 'Pearson Beta com páginas vazias = parcialmente extraível', status: ok((function () {
  const r = classificarExtracao({ tipo: 'pearson-beta', paginas: pagesBeta, esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'parcialmente extraível' && r.motivos.some((m) => m.startsWith('paginas-sem-texto='));
})()) });
record({ id: 'M3', title: 'Minha Biblioteca sem texto consultável = não extraível nas condições testadas', status: ok((function () {
  const r = classificarExtracao({ tipo: 'minhabiblioteca', paginas: pagesMb, esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'não extraível' && r.motivos.includes('nenhuma-pagina-com-texto');
})()) });
record({ id: 'M4', title: 'cobertura aquém do intervalo esperado = parcial', status: ok((function () {
  const r = classificarExtracao({ tipo: 'pearson-classic', paginas: [pag(41, 1, trecho(0)), pag(42, 2, trecho(1))], esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'parcialmente extraível' && (r.motivos.some((m) => m.includes('cobertura')) || r.lacunas === 'lacunas=3');
})()) });
record({ id: 'M5', title: 'ids duplicados = parcial, nunca integral', status: ok((function () {
  const r = classificarExtracao({ tipo: 'vitalsource', paginas: [pag(51, 1, trecho(0)), pag(51, 2, trecho(1)), pag(50, 3, trecho(2))], esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'parcialmente extraível' && r.motivos.includes('ids-duplicados=1');
})()) });
record({ id: 'M5b', title: 'ordem de captura quebrada (campo ordem) = parcial', status: ok((function () {
  const r = classificarExtracao({ tipo: 'vitalsource', paginas: [
    { id: 'a', ordem: 1, impressa: 1, texto: trecho(0) },
    { id: 'b', ordem: 3, impressa: 2, texto: trecho(1) },
    { id: 'c', ordem: 2, impressa: 3, texto: trecho(2) }], esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'parcialmente extraível' && r.motivos.includes('ordem-de-captura-ou-paginacao-invalida');
})()) });
record({ id: 'M6', title: 'repetibilidade: mesma sequência duas vezes = estável', status: ok(
  compararTentativas(pagesClassic, pagesClassic.map((p) => Object.assign({}, p))).repetivel === true) });
record({ id: 'M7', title: 'repetibilidade divergente = instável (sinalizado)', status: ok(
  compararTentativas(pagesClassic, [pag(11, 1, trecho(0)), pag(99, 2, trecho(1)), pag(13, 3, trecho(2))]).repetivel === false) });
record({ id: 'M8', title: 'evidência é trecho curto, não conteúdo integral', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(61, 1, trecho(0))] });
  return r.evidencia && r.evidencia.length <= 120;
})()) });
record({ id: 'M9', title: 'lacuna interna (páginas 1 e 3, falta 2) = parcial, nunca extraível', status: ok((function () {
  const r = classificarExtracao({ tipo: 'pearson-classic', paginas: [pag(71, 1, trecho(0)), pag(73, 3, trecho(2))], esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'parcialmente extraível' && r.lacunas === 'lacunas=2';
})()) });
record({ id: 'M10', title: 'ordem avaliada pela paginação impressa, não por ID interno', status: ok((function () {
  const r = classificarExtracao({ tipo: 'vitalsource', paginas: [pag('doc-b', 1, trecho(0)), pag('doc-a', 2, trecho(1)), pag('doc-c', 3, trecho(2))], esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'extraível' && !r.motivos.some((m) => m.includes('ordem'));
})()) });
record({ id: 'M11', title: 'repetibilidade exige mesma quantidade, paginação e texto', status: ok(
  compararTentativas(pagesClassic, pagesClassic.slice(0, 2)).repetivel === false &&
  compararTentativas(pagesClassic, pagesClassic.map((p, i) => Object.assign({}, p, { texto: i === 1 ? 'outro' : p.texto }))).repetivel === false) });
record({ id: 'M12', title: 'origem da evidência é explícita: fixture sintética', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(81, 1, trecho(0))], origemEvidencia: 'fixture-sintetica' });
  const real = classificarExtracao({ tipo: 'pearson-classic', paginas: pagesClassic, origemEvidencia: 'teste-autenticado' });
  return r.origemEvidencia === 'fixture-sintetica' && real.origemEvidencia === 'teste-autenticado';
})()) });

const matriz = [
  classificarExtracao({ tipo: 'pearson-classic', paginas: pagesClassic, esperado: { inicio: 1, fim: 3 } }),
  classificarExtracao({ tipo: 'pearson-beta', paginas: pagesBeta, esperado: { inicio: 1, fim: 3 } }),
  classificarExtracao({ tipo: 'minhabiblioteca', paginas: pagesMb, esperado: { inicio: 1, fim: 3 } }),
];
const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({
  date: new Date().toISOString(),
  summary: { total: results.length, passed: results.length - fails, failed: fails },
  matrix: matriz,
  results,
}, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
