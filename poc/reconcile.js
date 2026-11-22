// Reconciliação das execuções existentes — SEM novo acesso ao AVA.
// Lê RECORDS.json (execuções novas) ou QUALITY.md (histórico), junta URLs
// sanitizadas do APRENDIZADO.json, valida arquivos de saída e gera
// INVENTARIO.json + INVENTARIO.csv + RESUMO_RECONCILIACAO.md.
// Uso: node poc/reconcile.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const reconcile = require('./lib/reconcile');

const ROOT = process.env.UNIVESP_OUT || path.join(os.homedir(), 'Desktop', 'univesp');

function safeName(s) { return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90); }

function localizarArquivo(dir, week, title, declarado) {
  const weekDir = path.join(dir, 'SEMANA_' + week);
  const candidatos = declarado ? [declarado] : null;
  if (candidatos && candidatos.some((f) => fs.existsSync(path.join(weekDir, f)))) return path.join('SEMANA_' + week, declarado);
  if (!fs.existsSync(weekDir)) return null;
  const alvo = safeName(title).slice(0, 45);
  const hit = fs.readdirSync(weekDir).find((f) => f.endsWith('.md') && f.includes(alvo));
  return hit ? path.join('SEMANA_' + week, hit) : null;
}

function urlsSanitizadas(root) {
  const map = new Map(); // chave: disciplina|titulo -> url sanitizada
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'APRENDIZADO.json'), 'utf8'));
    for (const k of Object.keys(j.erros || {})) {
      for (const x of (j.erros[k].exemplos || [])) {
        const chave = [x.disciplina, x.titulo].join('|');
        if (!map.has(chave) && x.url) map.set(chave, x.url);
      }
    }
  } catch {}
  return map;
}

const registros = [];
const problemas = { duplicatas: [], arquivosAusentes: [], divergencias: [] };

for (const dir of fs.readdirSync(ROOT).map((d) => path.join(ROOT, d)).filter((d) => fs.statSync(d).isDirectory())) {
  const qualityPath = path.join(dir, 'QUALITY.md');
  if (!fs.existsSync(qualityPath)) continue;
  const qualidade = fs.readFileSync(qualityPath, 'utf8');
  const header = qualidade.match(/- Disciplina: (.+) \(([^)]+)\)/) || [];
  const tituloCurso = (header[1] || path.basename(dir)).trim();
  const code = (header[2] || path.basename(dir)).trim();
  const execucao = 'exec-' + fs.statSync(qualityPath).mtime.toISOString().slice(0, 10);
  const urls = urlsSanitizadas(ROOT);

  let brutos = null;
  const recordsPath = path.join(dir, 'RECORDS.json');
  if (fs.existsSync(recordsPath)) {
    brutos = (JSON.parse(fs.readFileSync(recordsPath, 'utf8')).registros || []).map((r) => ({ id: r.id, title: r.title, week: r.week, kind: r.kind || null, status: r.status, chars: r.chars, detail: r.detail, file: r.file }));
  } else {
    brutos = reconcile.parseQualityDetails(qualidade);
  }

  const vistos = new Map();
  for (const r of brutos) {
    const reconc = reconcile.mapStatus(r);
    const tipo = r.kind || ((String(r.detail || '').match(/formato=(\w+)/) || [])[1] || 'unknown');
    const chaveDedup = [code, r.week, r.title].join('|');
    if (vistos.has(chaveDedup)) problemas.duplicatas.push({ disciplina: code, semana: r.week, titulo: r.title, ocorrencias: 2 });
    vistos.set(chaveDedup, true);
    const arquivo = localizarArquivo(dir, r.week, r.title, r.file);
    if ((r.file || (r.chars > 0)) && !arquivo) problemas.arquivosAusentes.push({ disciplina: code, semana: r.week, titulo: r.title, declarado: r.file || null });
    const recursoId = r.id ? String(r.id) : `${code}-S${r.week}-${safeName(r.title).slice(0, 40)}`;
    registros.push({
      resource_id: recursoId,
      course_id: code,
      course_title: tituloCurso,
      week: r.week,
      detected_type: tipo,
      original_status: r.status,
      reconciled_status: reconc.status,
      reason: reconc.reason,
      chars: r.chars || 0,
      output_file: arquivo,
      sanitized_url: urls.get([code, r.title].join('|')) || null,
      source_execution: execucao,
      evidence_reference: path.relative(ROOT, qualityPath),
    });
  }

  // Divergência: contadores do header histórico x grupos recalculados
  const grupos = reconcile.countGroups(brutos);
  const antigo = {
    recursos: Number((qualidade.match(/- Recursos: (\d+)/) || [])[1]),
    integrais: Number((qualidade.match(/- Integrais: (\d+)/) || [])[1]),
    semTexto: Number((qualidade.match(/- Sem texto: (\d+)/) || [])[1]),
  };
  // No mapeamento novo, chars=0 vira failed/unclassified/no_text (exclusivos).
  const charsZero = grupos.failed + grupos.unclassified + grupos.no_text;
  if (antigo.recursos !== grupos.total || antigo.integrais !== grupos.integral || antigo.semTexto !== charsZero) {
    problemas.divergencias.push({ disciplina: code, contadoresAntigos: antigo, gruposReconciliados: grupos, charsZeroEsperado: charsZero });
  }
}

// Sem deduplicação automática: duplicatas apenas sinalizadas (decisão humana).
// Cada registro já tem exatamente 1 reconciled_status — a soma deve fechar.
const gruposFinais = { total: registros.length, integral: 0, partial: 0, no_text: 0, failed: 0, unclassified: 0 };
for (const r of registros) {
  if (!(r.reconciled_status in gruposFinais) || r.reconciled_status === 'total') throw new Error('status-reconciliado-invalido: ' + r.reconciled_status);
  gruposFinais[r.reconciled_status]++;
}
const soma = gruposFinais.integral + gruposFinais.partial + gruposFinais.no_text + gruposFinais.failed + gruposFinais.unclassified;
if (soma !== gruposFinais.total) throw new Error('contagem-divergente ' + soma + ' != ' + gruposFinais.total);
const inventario = { gerado_em: new Date().toISOString(), fonte: 'execuções existentes — sem acesso ao AVA', total: registros.length, grupos: gruposFinais, problemas, registros };
fs.writeFileSync(path.join(ROOT, 'INVENTARIO.json'), JSON.stringify(inventario, null, 2));

const csvHeader = ['resource_id', 'course_id', 'week', 'detected_type', 'original_status', 'reconciled_status', 'reason', 'chars', 'output_file', 'sanitized_url', 'source_execution', 'evidence_reference'];
fs.writeFileSync(path.join(ROOT, 'INVENTARIO.csv'), reconcile.toCsv(registros, csvHeader));

const porDisciplina = {};
for (const r of registros) {
  const g = (porDisciplina[r.course_id] = porDisciplina[r.course_id] || { total: 0, integral: 0, partial: 0, no_text: 0, failed: 0, unclassified: 0 });
  g.total++; g[r.reconciled_status]++;
}
const porTipo = {};
for (const r of registros) { const t = (porTipo[r.detected_type] = porTipo[r.detected_type] || { total: 0, integral: 0, partial: 0, failed: 0, no_text: 0, unclassified: 0 }); t.total++; t[r.reconciled_status]++; }

const linhas = [
  '# Reconciliação dos recursos (resultado corrigido)', '',
  'Gerado por `poc/reconcile.js` a partir das execuções existentes — sem novo acesso ao AVA.',
  'Histórico preservado: os QUALITY.md originais não foram alterados.', '',
  '## Totais reconciliados', '',
  `- Total: ${gruposFinais.total}`,
  `- integral: ${gruposFinais.integral} | partial: ${gruposFinais.partial} | no_text: ${gruposFinais.no_text} | failed: ${gruposFinais.failed} | unclassified: ${gruposFinais.unclassified}`, '',
  '## Por disciplina', '',
  '| Disciplina | Total | integral | partial | no_text | failed | unclassified |', '|---|---:|---:|---:|---:|---:|---:|',
  ...Object.keys(porDisciplina).sort().map((d) => { const g = porDisciplina[d]; return `| ${d} | ${g.total} | ${g.integral} | ${g.partial} | ${g.no_text} | ${g.failed} | ${g.unclassified} |`; }), '',
  '## Por tipo detectado', '',
  '| Tipo | Total | integral | partial | failed | no_text | unclassified |', '|---|---:|---:|---:|---:|---:|---:|',
  ...Object.keys(porTipo).sort().map((t) => { const g = porTipo[t]; return `| ${t} | ${g.total} | ${g.integral} | ${g.partial} | ${g.failed} | ${g.no_text} | ${g.unclassified} |`; }), '',
  '## Problemas detectados', '',
  `- Duplicatas (mesma disciplina+semana+titulo, sem deduplicação automática): ${problemas.duplicatas.length}`,
  `- Arquivos de saída ausentes: ${problemas.arquivosAusentes.length}`,
  `- Divergências de contadores antigos x reconciliados: ${problemas.divergencias.length}`,
  ...(problemas.duplicatas.length ? ['', '### Duplicatas', ...problemas.duplicatas.map((d) => `- ${d.disciplina} S${d.semana} — ${d.titulo}`)] : []),
  ...(problemas.arquivosAusentes.length ? ['', '### Arquivos ausentes', ...problemas.arquivosAusentes.map((d) => `- ${d.disciplina} S${d.semana} — ${d.titulo} (declarado: ${d.declarado || 'não'})`)] : []),
  ...(problemas.divergencias.length ? ['', '### Divergências de contadores', ...problemas.divergencias.map((d) => `- ${d.disciplina}: antigo ${JSON.stringify(d.contadoresAntigos)} -> reconciliado ${JSON.stringify(d.gruposReconciliados)}`)] : []),
  '',
  '## Separação de resultados', '',
  '- HISTÓRICO: o que as 10 execuções efetivamente produziram (QUALITY.md originais, intactos).',
  '- CORRIGIDO: como este consolidado classifica os mesmos registros (5 grupos exclusivos).',
  '- TESTES: cobertura automatizada do mapeamento e contadores em `poc/test-reconcile-m3.js`.',
];
fs.writeFileSync(path.join(ROOT, 'RESUMO_RECONCILIACAO.md'), linhas.join('\n'));
console.log(`reconciliacao ok: registros=${registros.length} grupos=${JSON.stringify(gruposFinais)}`);
console.log(`problemas: duplicatas=${problemas.duplicatas.length} arquivosAusentes=${problemas.arquivosAusentes.length} divergencias=${problemas.divergencias.length}`);
