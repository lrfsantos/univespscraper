// Testes da Fase 2.1 (integridade automatizada): estados PASS/FAIL/NOT_APPLICABLE/
// INCONCLUSIVE, amostragem estratificada e auditoria em fixture com arquivos reais.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { selecionarAmostra, auditRoot } = require('./integrity-check');

const OUT = path.join(__dirname, '..', 'audit-temp', 'INTEGRITY_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

// fixture com arquivos reais
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-fixture-'));
const inv = { registros: [
  { resource_id: 'ok-1', course_id: 'C1', week: 1, reconciled_status: 'integral', chars: 5, output_file: 'SEMANA_1/01_a.md' },
  { resource_id: 'fail-1', course_id: 'C1', week: 1, reconciled_status: 'failed', chars: 0, output_file: null, reason: 'reader-auth' },
  { resource_id: 'uncl-1', course_id: 'C1', week: 2, reconciled_status: 'unclassified', chars: 0, output_file: null },
  { resource_id: 'miss-1', course_id: 'C1', week: 1, reconciled_status: 'integral', chars: 5, output_file: 'SEMANA_1/09_inexistente.md' },
  { resource_id: 'week-1', course_id: 'C1', week: 3, reconciled_status: 'integral', chars: 5, output_file: 'SEMANA_9/09_x.md' },
  { resource_id: 'empty-1', course_id: 'C1', week: 1, reconciled_status: 'integral', chars: 0, output_file: 'SEMANA_1/01_vazio.md' },
] };
fs.writeFileSync(path.join(tmp, 'INVENTARIO.json'), JSON.stringify(inv));
fs.mkdirSync(path.join(tmp, 'C1', 'SEMANA_1'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'C1', 'SEMANA_1', '01_a.md'), '# ok\n');
fs.writeFileSync(path.join(tmp, 'C1', 'SEMANA_1', '01_vazio.md'), '');
fs.mkdirSync(path.join(tmp, 'C1', 'SEMANA_9'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'C1', 'SEMANA_9', '09_x.md'), '# semana errada\n');
const audit = auditRoot(tmp);
const porId = Object.fromEntries(audit.resultados.map((r) => [r.resource_id, r]));

record({ id: 'I1', title: 'arquivo valido integral = PASS', status: ok(porId['ok-1'].resultado === 'PASS' && porId['ok-1'].sha256 && porId['ok-1'].tamanhoOk === 'OK'), detail: porId['ok-1'].resultado });
record({ id: 'I2', title: 'failed sem arquivo = NOT_APPLICABLE (nunca PASS/no_text)', status: ok(porId['fail-1'].resultado === 'NOT_APPLICABLE'), detail: porId['fail-1'].resultado });
record({ id: 'I3', title: 'unclassified sem arquivo = INCONCLUSIVE', status: ok(porId['uncl-1'].resultado === 'INCONCLUSIVE'), detail: porId['uncl-1'].resultado });
record({ id: 'I4', title: 'arquivo esperado ausente = FAIL', status: ok(porId['miss-1'].resultado === 'FAIL' && porId['miss-1'].motivo === 'arquivo-ausente'), detail: porId['miss-1'].motivo });
record({ id: 'I5', title: 'arquivo na semana errada = FAIL (estrutura participa)', status: ok(porId['week-1'].resultado === 'FAIL' && porId['week-1'].motivo === 'semana-disciplina-errada' && audit.problemas.estruturaErrada === 1), detail: porId['week-1'].motivo });
record({ id: 'I6', title: 'arquivo vazio = FAIL', status: ok(porId['empty-1'].resultado === 'FAIL' && porId['empty-1'].motivo === 'arquivo-vazio'), detail: porId['empty-1'].motivo });

// dois registros apontando para o mesmo arquivo = FAIL (arquivo compartilhado)
const inv2 = { registros: [
  { resource_id: 'a', course_id: 'C1', week: 1, reconciled_status: 'integral', chars: 5, output_file: 'SEMANA_1/01_a.md' },
  { resource_id: 'b', course_id: 'C1', week: 1, reconciled_status: 'integral', chars: 5, output_file: 'SEMANA_1/01_a.md' },
] };
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-fixture2-'));
fs.writeFileSync(path.join(tmp2, 'INVENTARIO.json'), JSON.stringify(inv2));
fs.mkdirSync(path.join(tmp2, 'C1', 'SEMANA_1'), { recursive: true });
fs.writeFileSync(path.join(tmp2, 'C1', 'SEMANA_1', '01_a.md'), '# ok\n');
const audit2 = auditRoot(tmp2);
record({ id: 'I7', title: 'mesmo arquivo em 2 registros = FAIL compartilhado', status: ok(audit2.problemas.arquivoCompartilhado === 2 && audit2.resultados.every((r) => r.resultado === 'FAIL' && r.motivo === 'arquivo-compartilhado-entre-registros')), detail: JSON.stringify(audit2.contagem) });

// amostragem: 30 integral (>=3 por disciplina), 7 partial, 12 failed, 11 unclassified
const registros = [];
let n = 0;
const mk = (status, disc) => { n++; return { resource_id: disc + '-' + String(n).padStart(4, '0'), course_id: disc, week: 1 + (n % 7), reconciled_status: status, reason: status === 'failed' ? 'motivo-' + (n % 4) : null, chars: status === 'integral' ? 250 : 0, title: 'T' + n, detected_type: 'page', output_file: null }; };
for (let i = 0; i < 32; i++) registros.push(mk('integral', 'D' + (i % 10)));
for (let i = 0; i < 7; i++) registros.push(mk('partial', 'D' + (i % 10)));
for (let i = 0; i < 25; i++) registros.push(mk('failed', 'D' + (i % 10)));
for (let i = 0; i < 18; i++) registros.push(mk('unclassified', 'D' + (i % 10)));
const amostra = selecionarAmostra(registros);
const porEstrato = {};
for (const s of amostra.selecionados) porEstrato[s.estrato] = (porEstrato[s.estrato] || 0) + 1;
record({ id: 'I8', title: 'amostra estratificada: 30/7/12/11 = 60', status: ok(amostra.selecionados.length === 60 && porEstrato.integral === 30 && porEstrato.partial === 7 && porEstrato.failed === 12 && porEstrato.unclassified === 11), detail: JSON.stringify(porEstrato) });
const porDiscInt = {};
for (const s of amostra.selecionados.filter((x) => x.estrato === 'integral')) porDiscInt[s.course_id] = (porDiscInt[s.course_id] || 0) + 1;
record({ id: 'I9', title: 'integrais da amostra: >=3 por disciplina', status: ok(Object.values(porDiscInt).every((v) => v >= 3)), detail: JSON.stringify(porDiscInt) });
record({ id: 'I10', title: 'seleção determinística (mesma entrada -> mesma amostra)', status: ok(JSON.stringify(selecionarAmostra(registros).selecionados.map((s) => s.resource_id)) === JSON.stringify(amostra.selecionados.map((s) => s.resource_id))) });

const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
