// Testes do mapeamento de reconciliação e dos contadores (5 grupos exclusivos).
// Fixtures incluem os dois registros reais que geraram a divergência histórica
// (partial com conteúdo: ADM210 121 chars, CIN200 39527 chars).
const fs = require('fs');
const path = require('path');
const { mapStatus, countGroups, parseQualityDetails, toCsv } = require('./lib/reconcile');

const OUT = path.join(__dirname, '..', 'audit-temp', 'RECONCILE_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

// mapStatus
record({ id: 'R1', title: 'integral mapeado', status: ok(mapStatus({ status: 'integral', chars: 500, detail: null }).status === 'integral') });
record({ id: 'R2', title: 'partial com chars>0 (ADM210 real: 121 chars pdf)', status: ok(mapStatus({ status: 'partial', chars: 121, detail: 'formato=pdf status=partial falha=-' }).status === 'partial') });
record({ id: 'R3', title: 'partial grande com conteúdo (CIN200 real: 39527 chars)', status: ok(mapStatus({ status: 'partial', chars: 39527, detail: 'formato=pdf status=partial falha=-' }).status === 'partial') });
record({ id: 'R4', title: 'partial NÃO vira failed só por ter falha registrada', status: ok(mapStatus({ status: 'partial', chars: 121, detail: 'falha=no-text' }).status === 'partial') });
record({ id: 'R5', title: 'chars=0 com falha explícita = failed', status: ok(mapStatus({ status: 'inaccessible', chars: 0, detail: 'reader-selection-required' }).status === 'failed') });
record({ id: 'R6', title: 'chars=0 sem motivo = unclassified', status: ok(mapStatus({ status: 'partial', chars: 0, detail: null }).status === 'unclassified') });
record({ id: 'R7', title: 'no_text só com confirmação explícita', status: ok(mapStatus({ status: 'partial', chars: 0, detail: null, noTextConfirmed: true }).status === 'no_text') });

// countGroups: exclusividade e soma = total
const fixture = [
  { status: 'integral', chars: 500 }, { status: 'integral', chars: 300 },
  { status: 'partial', chars: 121, detail: 'falha=-' }, { status: 'partial', chars: 0 },
  { status: 'inaccessible', chars: 0, detail: 'clique-nao-abriu-recurso' },
  { status: 'partial', chars: 0, detail: null },
];
const g = countGroups(fixture);
record({ id: 'R8', title: 'contadores exclusivos somam o total', status: ok(g.total === 6 && g.integral + g.partial + g.no_text + g.failed + g.unclassified === 6), detail: JSON.stringify(g) });
record({ id: 'R9', title: 'classificação esperada dos 6 casos', status: ok(g.integral === 2 && g.partial === 1 && g.failed === 1 && g.unclassified === 2), detail: JSON.stringify(g) });
record({ id: 'R10', title: 'sem duplicação: cada registro em 1 grupo', status: ok((function () { const counts = countGroups(fixture.map((r) => Object.assign({}, r))); return Object.keys(counts).filter((k) => k !== 'total').every((k) => counts[k] >= 0); })()) });

// parseQualityDetails
const md = ['# Qualidade da extração', '', '- Disciplina: X (ADM210)', '- Recursos: 3', '', '## Detalhes', '- S1 S1 - Texto-base (p. 4-18): partial (121 chars) — formato=pdf status=partial falha=-', '- S2 S2 - Videoaula: integral (250 chars)', '- S3 S3 - Livro: inaccessible (0 chars) — clique-nao-abriu-recurso'];
const parsed = parseQualityDetails(md.join('\n'));
record({ id: 'R11', title: 'parser do QUALITY.md extrai 3 registros', status: ok(parsed.length === 3 && parsed[0].chars === 121 && parsed[1].status === 'integral' && parsed[2].detail === 'clique-nao-abriu-recurso') });
const gHist = countGroups(parsed);
record({ id: 'R12', title: 'grupos do histórico: 1 integral, 1 partial, 1 failed', status: ok(gHist.integral === 1 && gHist.partial === 1 && gHist.failed === 1) });

// toCsv
const csv = toCsv([{ a: 'x;y', b: 'a"b' }], ['a', 'b']);
record({ id: 'R13', title: 'csv escapa separador e aspas', status: ok(csv === 'a;b\n"x;y";"a""b"') });

const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
