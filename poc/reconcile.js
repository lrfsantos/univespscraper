// Reconciliação das execuções existentes — SEM novo acesso ao AVA.
// Lê RECORDS.json (execuções novas, com runId) ou QUALITY.md (histórico,
// referenciando a linha exata que sustenta cada classificação), junta URLs
// sanitizadas do APRENDIZADO.json, valida arquivos de saída e gera
// INVENTARIO.json + INVENTARIO.csv + RESUMO_RECONCILIACAO.md.
// Uso: node poc/reconcile.js [raiz]
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const reconcile = require('./lib/reconcile');

const ROOT = process.env.UNIVESP_OUT || path.join(os.homedir(), 'Desktop', 'univesp');

function safeName(s) { return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90); }

// ID determinístico a partir do título COMPLETO + hash curto (sem truncar o
// título, evita colisões); ocorrência entra quando tudo for idêntico.
function idHistorico(code, week, title, ocorrencia) {
  const slug = safeName(String(title || '')).replace(/\s+/g, '-').toLowerCase();
  const h = crypto.createHash('sha1').update([code, week, title].join('|')).digest('hex').slice(0, 8);
  return `${code}-S${week}-${slug}-${h}` + (ocorrencia > 1 ? `-oc${ocorrencia}` : '');
}

function localizarArquivo(dir, week, title, declarado) {
  const weekDir = path.join(dir, 'SEMANA_' + week);
  if (declarado && fs.existsSync(path.join(weekDir, declarado))) return path.join('SEMANA_' + week, declarado);
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

// Contadores do QUALITY.md — reconhece formato HISTÓRICO e NOVO.
function contadoresAntigos(qualidade) {
  const pega = (re) => { const m = qualidade.match(re); return m ? Number(m[1]) : null; };
  const novo = { recursos: pega(/- Recursos: (\d+)/), integrais: pega(/- Integral: (\d+)/), partial: pega(/- Partial: (\d+)/), semTexto: pega(/- Sem texto: (\d+)/), falhas: pega(/- Falhas: (\d+)/), semClassificacao: pega(/- Sem classificação: (\d+)/) };
  if (novo.integrais != null) return { formato: 'novo', ...novo };
  return { formato: 'historico', recursos: pega(/- Recursos: (\d+)/), integrais: pega(/- Integrais: (\d+)/), semTexto: pega(/- Sem texto: (\d+)/) };
}

function reconcileRoot(root) {
  const registros = [];
  const problemas = { duplicatas: [], idsDuplicados: [], arquivosAusentes: [], divergencias: [] };
  const dirs = fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.statSync(d).isDirectory());
  const urls = urlsSanitizadas(root);

  for (const dir of dirs) {
    const qualityPath = path.join(dir, 'QUALITY.md');
    if (!fs.existsSync(qualityPath)) continue;
    const qualidade = fs.readFileSync(qualityPath, 'utf8');
    const header = qualidade.match(/- Disciplina: (.+) \(([^)]+)\)/) || [];
    const tituloCurso = (header[1] || path.basename(dir)).trim();
    const code = (header[2] || path.basename(dir)).trim();
    const evidencePath = path.relative(root, qualityPath);
    const relName = path.basename(qualityPath);

    let brutos = null;
    let execucao = null;
    let fonte = null;
    const recordsPath = path.join(dir, 'RECORDS.json');
    if (fs.existsSync(recordsPath)) {
      const j = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
      execucao = j.runId || 'exec-sem-identificador';
      fonte = 'RECORDS.json (registro bruto estruturado)';
      brutos = (j.registros || []).map((r) => ({ id: r.id, title: r.title, week: r.week, kind: r.kind || null, status: r.status, chars: r.chars, detail: r.detail, file: r.file }));
    } else {
      // Histórico: fonte é a linha do QUALITY.md — apontar a linha exata.
      execucao = 'historico-sem-identificador';
      fonte = `${relName} (histórico, sem RECORDS.json — evidência é a linha do QUALITY.md)`;
      brutos = reconcile.parseQualityDetails(qualidade);
    }

    const vistos = new Map();
    const ocorrencias = new Map();
    for (const r of brutos) {
      const reconc = reconcile.mapStatus(r);
      const tipo = r.kind || ((String(r.detail || '').match(/formato=(\w+)/) || [])[1] || 'unknown');
      const chaveDedup = [code, r.week, r.title].join('|');
      if (vistos.has(chaveDedup)) problemas.duplicatas.push({ disciplina: code, semana: r.week, titulo: r.title });
      vistos.set(chaveDedup, true);
      const ocorrencia = (ocorrencias.get(chaveDedup) || 0) + 1;
      ocorrencias.set(chaveDedup, ocorrencia);
      // Só quem produziu arquivo (declarado ou com conteúdo) recebe output_file:
      // fuzzy-match para registro sem conteúdo atribuía arquivo alheio.
      const arquivo = (r.file || r.chars > 0) ? localizarArquivo(dir, r.week, r.title, r.file) : null;
      if ((r.file || (r.chars > 0)) && !arquivo) problemas.arquivosAusentes.push({ disciplina: code, semana: r.week, titulo: r.title, declarado: r.file || null });
      const recursoId = r.id ? String(r.id) : idHistorico(code, r.week, r.title, ocorrencia);
      const linha = r.__line ? `#L${r.__line}` : '';
      registros.push({
        resource_id: recursoId,
        course_id: code,
        course_title: tituloCurso,
        title: r.title,
        week: r.week,
        detected_type: tipo,
        original_status: r.status,
        reconciled_status: reconc.status,
        reason: reconc.reason,
        chars: r.chars || 0,
        output_file: arquivo,
        sanitized_url: urls.get([code, r.title].join('|')) || null,
        source_execution: execucao,
        source_kind: fonte,
        evidence_reference: evidencePath + (fs.existsSync(recordsPath) ? '' : linha),
      });
    }

    // Divergência: contadores do QUALITY (ambos os formatos) x grupos recalculados
    const grupos = reconcile.countGroups(brutos);
    const antigo = contadoresAntigos(qualidade);
    const charsZero = grupos.failed + grupos.unclassified + grupos.no_text;
    const diverge = antigo.formato === 'novo'
      ? antigo.recursos !== grupos.total || antigo.integrais !== grupos.integral || antigo.partial !== grupos.partial || antigo.semTexto !== grupos.no_text || antigo.falhas !== grupos.failed || antigo.semClassificacao !== grupos.unclassified
      : antigo.recursos !== grupos.total || antigo.integrais !== grupos.integral || antigo.semTexto !== charsZero;
    if (diverge) problemas.divergencias.push({ disciplina: code, formato: antigo.formato, contadoresAntigos: antigo, gruposReconciliados: grupos });
  }

  // Sem deduplicação automática: duplicatas apenas sinalizadas (decisão humana).
  const gruposFinais = { total: registros.length, integral: 0, partial: 0, no_text: 0, failed: 0, unclassified: 0 };
  for (const r of registros) {
    if (!(r.reconciled_status in gruposFinais) || r.reconciled_status === 'total') throw new Error('status-reconciliado-invalido: ' + r.reconciled_status);
    gruposFinais[r.reconciled_status]++;
  }
  const soma = gruposFinais.integral + gruposFinais.partial + gruposFinais.no_text + gruposFinais.failed + gruposFinais.unclassified;
  if (soma !== gruposFinais.total) throw new Error('contagem-divergente ' + soma + ' != ' + gruposFinais.total);
  // Colisões de resource_id (identificador precisa ser único).
  const porId = new Map();
  for (const r of registros) porId.set(r.resource_id, (porId.get(r.resource_id) || 0) + 1);
  for (const [id, n] of porId) if (n > 1) problemas.idsDuplicados.push({ resource_id: id, ocorrencias: n });
  const semUrl = registros.filter((r) => !r.sanitized_url).length;
  return { registros, problemas, gruposFinais, semUrl };
}

function gerarRelatorios(root, resultado) {
  const { registros, problemas, gruposFinais, semUrl } = resultado;
  const inventario = { gerado_em: new Date().toISOString(), fonte: 'execuções existentes — sem acesso ao AVA', total: registros.length, grupos: gruposFinais, semUrl, problemas, registros };
  fs.writeFileSync(path.join(root, 'INVENTARIO.json'), JSON.stringify(inventario, null, 2));

  const csvHeader = ['resource_id', 'course_id', 'course_title', 'title', 'week', 'detected_type', 'original_status', 'reconciled_status', 'reason', 'chars', 'output_file', 'sanitized_url', 'source_execution', 'source_kind', 'evidence_reference'];
  fs.writeFileSync(path.join(root, 'INVENTARIO.csv'), reconcile.toCsv(registros, csvHeader));

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
    `- Registros sem URL sanitizada: ${semUrl} de ${registros.length} — as URLs só foram registradas para as falhas (APRENDIZADO.json); recursos integrais não têm URL preservada no histórico.`, '',
    '## Por disciplina', '',
    '| Disciplina | Total | integral | partial | no_text | failed | unclassified |', '|---|---:|---:|---:|---:|---:|---:|',
    ...Object.keys(porDisciplina).sort().map((d) => { const g = porDisciplina[d]; return `| ${d} | ${g.total} | ${g.integral} | ${g.partial} | ${g.no_text} | ${g.failed} | ${g.unclassified} |`; }), '',
    '## Por tipo detectado', '',
    '| Tipo | Total | integral | partial | failed | no_text | unclassified |', '|---|---:|---:|---:|---:|---:|---:|',
    ...Object.keys(porTipo).sort().map((t) => { const g = porTipo[t]; return `| ${t} | ${g.total} | ${g.integral} | ${g.partial} | ${g.failed} | ${g.no_text} | ${g.unclassified} |`; }), '',
    '## Problemas detectados', '',
    `- IDs de recurso duplicados (colisão de identificador): ${problemas.idsDuplicados.length}`,
    `- Duplicatas (mesma disciplina+semana+titulo, sem deduplicação automática): ${problemas.duplicatas.length}`,
    `- Arquivos de saída ausentes: ${problemas.arquivosAusentes.length}`,
    `- Divergências de contadores antigos x reconciliados: ${problemas.divergencias.length}`,
    ...(problemas.idsDuplicados.length ? ['', '### IDs duplicados', ...problemas.idsDuplicados.map((d) => `- ${d.resource_id} (${d.ocorrencias}x)`)] : []),
    ...(problemas.duplicatas.length ? ['', '### Duplicatas', ...problemas.duplicatas.map((d) => `- ${d.disciplina} S${d.semana} — ${d.titulo}`)] : []),
    ...(problemas.arquivosAusentes.length ? ['', '### Arquivos ausentes', ...problemas.arquivosAusentes.map((d) => `- ${d.disciplina} S${d.semana} — ${d.titulo} (declarado: ${d.declarado || 'não'})`)] : []),
    ...(problemas.divergencias.length ? ['', '### Divergências de contadores', ...problemas.divergencias.map((d) => `- ${d.disciplina} (${d.formato}): antigo ${JSON.stringify(d.contadoresAntigos)} -> reconciliado ${JSON.stringify(d.gruposReconciliados)}`)] : []),
    '',
    '## Separação de resultados', '',
    '- HISTÓRICO: o que as 10 execuções efetivamente produziram (QUALITY.md originais, intactos; fonte = linha do QUALITY.md, sem registro bruto estruturado preservado).',
    '- CORRIGIDO: como este consolidado classifica os mesmos registros (5 grupos exclusivos).',
    '- TESTES: cobertura automatizada em `poc/test-reconcile-m3.js` (unidade + integração com fixtures).',
  ];
  fs.writeFileSync(path.join(root, 'RESUMO_RECONCILIACAO.md'), linhas.join('\n'));
}

if (require.main === module) {
  const raiz = process.argv[2] || ROOT;
  const r = reconcileRoot(raiz);
  gerarRelatorios(raiz, r);
  console.log(`reconciliacao ok: registros=${r.registros.length} grupos=${JSON.stringify(r.gruposFinais)} semUrl=${r.semUrl}`);
  console.log(`problemas: duplicatas=${r.problemas.duplicatas.length} arquivosAusentes=${r.problemas.arquivosAusentes.length} divergencias=${r.problemas.divergencias.length}`);
}

module.exports = { reconcileRoot, gerarRelatorios, contadoresAntigos, localizarArquivo };
