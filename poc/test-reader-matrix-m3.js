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
const comIds = (pages, prefixo) => pages.map((p, i) => Object.assign({}, p, { capturaId: prefixo + '-' + i }));

record({ id: 'M6', title: 'repetibilidade: IDs de captura distintos e conteúdo igual', status: ok(
  compararTentativas(comIds(pagesClassic, 'cap-A'), comIds(pagesClassic, 'cap-B')).repetivel === true) });
record({ id: 'M7', title: 'repetibilidade divergente = instável (sinalizado)', status: ok(
  compararTentativas(comIds(pagesClassic, 'cap-A'), comIds([pag(11, 1, trecho(0)), pag(99, 2, trecho(1)), pag(13, 3, trecho(2))], 'cap-B')).repetivel === false) });
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
  compararTentativas(comIds(pagesClassic, 'cap-A'), comIds(pagesClassic.slice(0, 2), 'cap-B')).repetivel === false &&
  compararTentativas(comIds(pagesClassic, 'cap-A'), comIds(pagesClassic.map((p, i) => Object.assign({}, p, { texto: i === 1 ? 'outro' : p.texto })), 'cap-B')).repetivel === false) });
record({ id: 'M12', title: 'origem da evidência é sempre fixture sintética nesta etapa', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(81, 1, trecho(0))] });
  const tentativa = classificarExtracao({ tipo: 'fixture', paginas: [pag(81, 1, trecho(0))], origemEvidencia: 'teste-autenticado' });
  return r.origemEvidencia === 'fixture-sintetica' && tentativa.origemEvidencia === 'fixture-sintetica';
})()) });
record({ id: 'M13', title: '3 páginas consecutivas sem intervalo esperado = parcial (não extraível integral)', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(91, 1, trecho(0)), pag(92, 2, trecho(1)), pag(93, 3, trecho(2))] });
  return r.classe === 'parcialmente extraível' && r.motivos.includes('intervalo-esperado-nao-informado');
})()) });
record({ id: 'M14', title: 'uma única página sem intervalo esperado = parcial', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(94, 8, trecho(0))] });
  return r.classe === 'parcialmente extraível' && r.motivos.includes('intervalo-esperado-nao-informado');
})()) });
record({ id: 'M15', title: 'intervalo completo explicitamente informado = extraível', status: ok((function () {
  const r = classificarExtracao({ tipo: 'pearson-classic', paginas: pagesClassic, esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'extraível' && !r.motivos.length;
})()) });
record({ id: 'M16', title: 'apenas um limite informado = parcial, sem afirmar cobertura completa', status: ok((function () {
  const r = classificarExtracao({ tipo: 'pearson-classic', paginas: pagesClassic, esperado: { fim: 3 } });
  return r.classe === 'parcialmente extraível' && r.motivos.includes('intervalo-esperado-nao-informado');
})()) });
record({ id: 'M17', title: 'fixture não pode se declarar teste autenticado', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(82, 1, trecho(0))], origemEvidencia: 'teste-autenticado' });
  return r.origemEvidencia === 'fixture-sintetica';
})()) });
record({ id: 'M18', title: 'intervalo invertido (inicio > fim) = parcial com motivo explícito', status: ok((function () {
  const r = classificarExtracao({ tipo: 'pearson-classic', paginas: pagesClassic, esperado: { inicio: 3, fim: 1 } });
  return r.classe === 'parcialmente extraível' && r.motivos.includes('intervalo-esperado-invalido');
})()) });
record({ id: 'M19', title: 'intervalo gigantesco nao trava (limite de 5000 paginas)', status: ok((function () {
  const t = Date.now();
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(1, 1, trecho(0))], esperado: { inicio: 1, fim: 1000000000 } });
  return r.classe === 'parcialmente extraível' && r.motivos.includes('intervalo-excessivo') && Date.now() - t < 1000;
})()) });
record({ id: 'M20', title: 'inteiro acima de MAX_SAFE_INTEGER e rejeitado', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(1, 1, trecho(0))], esperado: { inicio: 1, fim: Number.MAX_SAFE_INTEGER + 1 } });
  return r.classe === 'parcialmente extraível' && r.motivos.some((m) => m.includes('intervalo'));
})()) });
record({ id: 'M21', title: 'esperado: null e tratado de forma controlada', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(1, 1, trecho(0))], esperado: null });
  return r.classe === 'parcialmente extraível' && r.motivos.includes('intervalo-esperado-nao-informado');
})()) });
record({ id: 'M22', title: 'paginação zero/negativa nao resulta em classificação integral', status: ok((function () {
  const r = classificarExtracao({ tipo: 'fixture', paginas: [pag(1, 0, trecho(0)), pag(2, -1, trecho(1))], esperado: { inicio: 1, fim: 3 } });
  return r.classe === 'parcialmente extraível' && r.motivos.some((m) => m.startsWith('paginacao-invalida='));
})()) });
record({ id: 'M23', title: 'captura reutilizada, sem ID ou com mesmo ID nunca prova repetibilidade', status: ok(
  compararTentativas(pagesClassic, pagesClassic).repetivel === false &&
  compararTentativas(pagesClassic, pagesClassic.map((p) => Object.assign({}, p))).repetivel === false &&
  compararTentativas(comIds(pagesClassic, 'mesmo'), comIds(pagesClassic, 'mesmo')).repetivel === false &&
  compararTentativas(comIds(pagesClassic, 'cap-A'), comIds(pagesClassic, 'cap-B')).repetivel === true) });
record({ id: 'M24', title: 'motivo explicito quando independência nao e comprovada', status: ok(
  compararTentativas(pagesClassic, pagesClassic).motivo === 'independencia-nao-comprovada' &&
  compararTentativas(comIds(pagesClassic, 'mesmo'), comIds(pagesClassic, 'mesmo')).motivo === 'independencia-nao-comprovada' &&
  compararTentativas(comIds(pagesClassic, 'cap-A'), comIds(pagesClassic, 'cap-B')).motivo === null) });

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
