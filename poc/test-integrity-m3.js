// Testes da Fase 2.1 (integridade automatizada): coerência de classificação,
// amostragem estratificada e auditoria em fixture real de arquivos.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { coerenciaClassificacao, selecionarAmostra, auditRoot } = require('./integrity-check');

const OUT = path.join(__dirname, '..', 'audit-temp', 'INTEGRITY_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

// coerência: integral exige arquivo com conteúdo; failed não exige arquivo
record({ id: 'I1', title: 'integral com arquivo valido = OK', status: ok(coerenciaClassificacao({ reconciled_status: 'integral', chars: 200 }, { existe: true, vazio: false }) === 'OK') });
record({ id: 'I2', title: 'integral sem arquivo = MISCLASSIFIED', status: ok(coerenciaClassificacao({ reconciled_status: 'integral', chars: 200 }, { existe: false, vazio: true }) === 'MISCLASSIFIED') });
record({ id: 'I3', title: 'failed sem arquivo NÃO vira no_text/misclassified', status: ok(coerenciaClassificacao({ reconciled_status: 'failed', chars: 0 }, { existe: false, vazio: true }) === 'OK') });
record({ id: 'I4', title: 'partial com conteudo exige arquivo', status: ok(coerenciaClassificacao({ reconciled_status: 'partial', chars: 121 }, { existe: true, vazio: false }) === 'OK' && coerenciaClassificacao({ reconciled_status: 'partial', chars: 121 }, { existe: false, vazio: true }) === 'MISCLASSIFIED') });

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
record({ id: 'I5', title: 'amostra estratificada: 30/7/12/11 = 60', status: ok(amostra.selecionados.length === 60 && porEstrato.integral === 30 && porEstrato.partial === 7 && porEstrato.failed === 12 && porEstrato.unclassified === 11), detail: JSON.stringify(porEstrato) });
const porDiscInt = {};
for (const s of amostra.selecionados.filter((x) => x.estrato === 'integral')) porDiscInt[s.course_id] = (porDiscInt[s.course_id] || 0) + 1;
record({ id: 'I6', title: 'integrais da amostra: >=3 por disciplina', status: ok(Object.values(porDiscInt).every((v) => v >= 3)), detail: JSON.stringify(porDiscInt) });
record({ id: 'I7', title: 'seleção determinística (mesma entrada -> mesma amostra)', status: ok(JSON.stringify(selecionarAmostra(registros).selecionados.map((s) => s.resource_id)) === JSON.stringify(amostra.selecionados.map((s) => s.resource_id))) });

// auditRoot em fixture pequena com arquivos reais
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-fixture-'));
fs.mkdirSync(path.join(tmp, 'C1 SEMANA'), { recursive: true });
const inv = { registros: [
  { resource_id: 'c1-1', course_id: 'C1', week: 1, reconciled_status: 'integral', chars: 5, output_file: 'SEMANA_1/01_a.md' },
  { resource_id: 'c1-2', course_id: 'C1', week: 1, reconciled_status: 'failed', chars: 0, output_file: null, reason: 'reader-auth' },
  { resource_id: 'c1-3', course_id: 'C1', week: 2, reconciled_status: 'integral', chars: 5, output_file: 'SEMANA_9/09_x.md' }, // estrutura errada
] };
fs.writeFileSync(path.join(tmp, 'INVENTARIO.json'), JSON.stringify(inv));
fs.mkdirSync(path.join(tmp, 'C1', 'SEMANA_1'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'C1', 'SEMANA_1', '01_a.md'), '# ok\n');
fs.writeFileSync(path.join(tmp, 'INTEGRITY_AUDIT.json'), '{}'); // auditRoot só lê INVENTARIO
const audit = auditRoot(tmp);
record({ id: 'I8', title: 'auditoria: arquivo valido PASS, falha OK, inexistente MISCLASSIFIED', status: ok(audit.contagem.PASS === 2 && audit.contagem.MISCLASSIFIED === 1 && audit.resultados[0].resultado === 'PASS' && audit.resultados[1].resultado === 'PASS' && audit.resultados[2].existe === false && audit.resultados[2].resultado === 'MISCLASSIFIED'), detail: JSON.stringify(audit.contagem) });

const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
