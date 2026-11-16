const fs = require('fs');
const path = require('path');
const { parseSuiteSummary } = require('../scripts/test-summary');

const OUT = path.join(__dirname, '..', 'audit-temp', 'TEST_SUMMARY_RESULTS.json');
const results = [];
function record(id, title, ok, detail) {
  results.push({ id, title, status: ok ? 'PASS' : 'FAIL', detail });
}

{
  const r = parseSuiteSummary({ summary: { total: 5, passed: 5, failed: 0 } });
  record('TS-1', 'Aceita resumo aninhado válido', r.valid && r.total === 5 && r.passed === 5 && r.failed === 0, JSON.stringify(r));
}
{
  const r = parseSuiteSummary({ total: 8, failed: 2 });
  record('TS-2', 'Aceita formato legado e deriva passed corretamente', r.valid && r.total === 8 && r.passed === 6 && r.failed === 2, JSON.stringify(r));
}
{
  const r = parseSuiteSummary({ summary: { total: 4, passed: 4, failed: 1 } });
  record('TS-3', 'Rejeita contagens que não fecham com o total', !r.valid && r.error === 'contagens-inconsistentes', JSON.stringify(r));
}
{
  const r = parseSuiteSummary({ summary: { total: true, passed: 1, failed: 0 } });
  record('TS-4', 'Rejeita booleano usado como quantidade', !r.valid && r.error === 'total-ausente-ou-invalido', JSON.stringify(r));
}
{
  const r = parseSuiteSummary({ results: [] });
  record('TS-5', 'Rejeita arquivo sem resumo quantitativo', !r.valid, JSON.stringify(r));
}

const failed = results.filter((r) => r.status !== 'PASS').length;
const summary = { total: results.length, passed: results.length - failed, failed };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary }, null, 2));
console.log('=== RESUMO TEST-SUMMARY ===');
for (const r of results) console.log(`[${r.status}] ${r.id}: ${r.title} — ${r.detail}`);
console.log(summary);
if (failed) process.exitCode = 1;
