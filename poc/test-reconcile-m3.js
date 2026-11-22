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
record({ id: 'R10', title: 'sem duplicação: cada registro em exatamente 1 grupo', status: ok((function () { const mapped = fixture.map((r) => mapStatus(r).status); const validos = ['integral', 'partial', 'no_text', 'failed', 'unclassified']; return mapped.length === fixture.length && mapped.every((s) => validos.includes(s)); })()) });

// parseQualityDetails
const md = ['# Qualidade da extração', '', '- Disciplina: X (ADM210)', '- Recursos: 3', '', '## Detalhes', '- S1 S1 - Texto-base (p. 4-18): partial (121 chars) — formato=pdf status=partial falha=-', '- S2 S2 - Videoaula: integral (250 chars)', '- S3 S3 - Livro: inaccessible (0 chars) — clique-nao-abriu-recurso'];
const parsed = parseQualityDetails(md.join('\n'));
record({ id: 'R11', title: 'parser do QUALITY.md extrai 3 registros', status: ok(parsed.length === 3 && parsed[0].chars === 121 && parsed[1].status === 'integral' && parsed[2].detail === 'clique-nao-abriu-recurso') });
const gHist = countGroups(parsed);
record({ id: 'R12', title: 'grupos do histórico: 1 integral, 1 partial, 1 failed', status: ok(gHist.integral === 1 && gHist.partial === 1 && gHist.failed === 1) });

// toCsv
const csv = toCsv([{ a: 'x;y', b: 'a"b' }], ['a', 'b']);
record({ id: 'R13', title: 'csv escapa separador e aspas', status: ok(csv === 'a;b\n"x;y";"a""b"') });

// ===== Integração do consolidador (poc/reconcile.js) com fixtures =====
const os = require('os');
const { execFileSync } = require('child_process');
const { reconcileRoot, gerarRelatorios } = require('./reconcile');

// Fixture reproduzindo as 10 disciplinas (contagens reais) nos dois formatos.
const DISTRIBUICAO = [ // [code, total, integral, partialComConteudo, falhaExplicita, semMotivo, formato]
  ['ADM210', 60, 34, 1, 17, 8, 'historico'], ['ADM220', 47, 31, 0, 9, 7, 'historico'],
  ['ADM230', 45, 29, 0, 8, 8, 'historico'], ['ADM270', 57, 29, 1, 23, 4, 'historico'],
  ['ADM290', 35, 33, 0, 2, 0, 'historico'], ['CIN200', 38, 27, 1, 8, 2, 'historico'],
  ['D18491', 51, 40, 4, 7, 0, 'historico'], ['D18539', 47, 37, 0, 5, 5, 'historico'],
  ['D18554', 45, 41, 0, 4, 0, 'historico'],
  ['SOC200', 43, 28, 0, 15, 0, 'novo'], // formato NOVO: RECORDS.json com runId e kind
];
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-fixture-'));
for (const [code, total, integral, partialC, failed, unclass, formato] of DISTRIBUICAO) {
  const dir = path.join(tmpRoot, code);
  fs.mkdirSync(dir, { recursive: true });
  const detalhes = [];
  let n = 0;
  const mk = (week, status, chars, detail) => { n++; const t = `S${week} - Recurso ${n} ${code}`; detalhes.push(`- S${week} ${t}: ${status} (${chars} chars)${detail ? ' — ' + detail : ''}`); return t; };
  const registros = [];
  let week = 1;
  const kinds = ['page', 'pdf', 'video', 'book'];
  const add = (count, fn) => { for (let i = 0; i < count; i++) { if (n % 7 === 0) week++; fn(week); } };
  add(integral, (w) => { const t = mk(w, 'integral', 250, null); registros.push({ id: 1000 + n, title: t, week: w, kind: kinds[n % 4], status: 'integral', chars: 250, file: `0${(n % 9) + 1}_arquivo-${code}-${n}.md` }); });
  add(partialC, (w) => { const t = mk(w, 'partial', 121, 'formato=pdf status=partial falha=-'); registros.push({ id: 1000 + n, title: t, week: w, kind: 'book', status: 'partial', chars: 121, detail: 'formato=pdf status=partial falha=-' }); });
  add(failed, (w) => { const t = mk(w, 'inaccessible', 0, 'reader-selection-required'); registros.push({ id: 1000 + n, title: t, week: w, kind: 'book', status: 'inaccessible', chars: 0, detail: 'reader-selection-required' }); });
  add(unclass, (w) => { const t = mk(w, 'partial', 0, null); registros.push({ id: 1000 + n, title: t, week: w, kind: 'page', status: 'partial', chars: 0, detail: null }); });
  const header = formato === 'novo'
    ? ['- Recursos: ' + total, `- Integral: ${integral}`, '- Partial: ' + partialC, '- Sem texto: 0', '- Falhas: ' + failed, '- Sem classificação: ' + unclass]
    : ['- Recursos: ' + total, `- Integrais: ${integral}`, `- Sem texto: ${failed + unclass}`];
  fs.writeFileSync(path.join(dir, 'QUALITY.md'), ['# Qualidade da extração', '', `- Disciplina: Titulo ${code} (${code})`, ...header, '- Resultado: REVIEW', '', '## Detalhes', ...detalhes].join('\n'));
  if (formato === 'novo') {
    fs.writeFileSync(path.join(dir, 'RECORDS.json'), JSON.stringify({ runId: 'run-fixture-' + code, disciplina: code, registros }, null, 2));
    // cria os arquivos de saída declarados (alguns em semanas posteriores)
    for (const rec of registros) {
      if (!rec.file) continue;
      const semDir = path.join(dir, 'SEMANA_' + rec.week);
      fs.mkdirSync(semDir, { recursive: true });
      fs.writeFileSync(path.join(semDir, rec.file), '# conteudo\n');
    }
  } else {
    // histórico: arquivo da primeira semana (integral tem arquivo; unclassified não)
    const sem1 = path.join(dir, 'SEMANA_1');
    fs.mkdirSync(sem1, { recursive: true });
    detalhes.slice(0, 3).forEach((_, i) => fs.writeFileSync(path.join(sem1, `0${i + 1}_arquivo-${code}-${i}.md`), '# x\n'));
  }
}

const antes = fs.readFileSync(path.join(tmpRoot, 'ADM210', 'QUALITY.md'), 'utf8');
const r = reconcileRoot(tmpRoot);
gerarRelatorios(tmpRoot, r);
const depois = fs.readFileSync(path.join(tmpRoot, 'ADM210', 'QUALITY.md'), 'utf8');

record({ id: 'R14', title: 'integracao: 468 registros a partir das 10 disciplinas', status: ok(r.registros.length === 468), detail: String(r.registros.length) });
record({ id: 'R15', title: 'integracao: soma dos grupos fecha 468', status: ok(r.gruposFinais.total === 468 && r.gruposFinais.integral + r.gruposFinais.partial + r.gruposFinais.no_text + r.gruposFinais.failed + r.gruposFinais.unclassified === 468), detail: JSON.stringify(r.gruposFinais) });
record({ id: 'R16', title: 'integracao: historico preservado byte a byte', status: ok(antes === depois) });
record({ id: 'R17', title: 'integracao: evidencia aponta linha do QUALITY (formato historico)', status: ok(/QUALITY\.md#L\d+/.test(r.registros[0].evidence_reference) && /histórico/.test(r.registros[0].source_kind)), detail: r.registros[0].evidence_reference });
record({ id: 'R18', title: 'integracao: 3 relatorios gerados', status: ok(fs.existsSync(path.join(tmpRoot, 'INVENTARIO.json')) && fs.existsSync(path.join(tmpRoot, 'INVENTARIO.csv')) && fs.existsSync(path.join(tmpRoot, 'RESUMO_RECONCILIACAO.md'))) });
record({ id: 'R19', title: 'integracao: divergencias/duplicatas=0 no fixture fiel', status: ok(r.problemas.duplicatas.length === 0 && r.problemas.divergencias.length === 0), detail: JSON.stringify(r.problemas).slice(0, 120) });
record({ id: 'R19b', title: 'integracao: sem colisao de resource_id', status: ok(r.problemas.idsDuplicados.length === 0), detail: JSON.stringify(r.problemas.idsDuplicados).slice(0, 150) });
record({ id: 'R19c', title: 'integracao: formato novo coberto (RECORDS.json, runId, kind)', status: ok((function () { const novos = r.registros.filter((x) => x.course_id === 'SOC200'); return novos.length === 43 && novos.every((x) => x.source_execution === 'run-fixture-SOC200') && novos.some((x) => x.detected_type === 'video') && novos.every((x) => x.output_file || x.chars === 0 || x.original_status !== 'integral'); })()) });

// caso negativo: divergência artificial de header
const dirDiv = path.join(tmpRoot, 'DIV');
fs.mkdirSync(dirDiv, { recursive: true });
fs.writeFileSync(path.join(dirDiv, 'QUALITY.md'), ['# Qualidade da extração', '', '- Disciplina: X (DIV)', '- Recursos: 99', '- Integrais: 1', '- Sem texto: 0', '- Resultado: REVIEW', '', '## Detalhes', '- S1 A: integral (50 chars)'].join('\n'));
const rDiv = reconcileRoot(tmpRoot);
record({ id: 'R20', title: 'integracao: header divergente é sinalizado', status: ok(rDiv.problemas.divergencias.some((d) => d.disciplina === 'DIV')), detail: JSON.stringify(rDiv.problemas.divergencias.map((d) => d.disciplina)) });

// caso negativo: duplicata dentro da mesma disciplina+semana
const dirDup = path.join(tmpRoot, 'DUP');
fs.mkdirSync(dirDup, { recursive: true });
fs.writeFileSync(path.join(dirDup, 'QUALITY.md'), ['# Qualidade da extração', '', '- Disciplina: Y (DUP)', '- Recursos: 2', '- Integrais: 2', '- Sem texto: 0', '- Resultado: PASS', '', '## Detalhes', '- S1 Mesmo titulo: integral (50 chars)', '- S1 Mesmo titulo: integral (50 chars)'].join('\n'));
const rDup = reconcileRoot(tmpRoot);
record({ id: 'R21', title: 'integracao: duplicata sinalizada sem deduplicar', status: ok(rDup.problemas.duplicatas.some((d) => d.disciplina === 'DUP') && rDup.gruposFinais.total === r.registros.length + 3), detail: JSON.stringify(rDup.problemas.duplicatas) });

const fails = results.filter((r) => r.status !== 'PASS').length;
fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
