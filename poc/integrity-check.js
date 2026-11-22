// Etapa 2, Fase 2.1 — Integridade AUTOMATIZADA dos 468 registros.
// Estados explícitos (parecer auditor): PASS (verificações aplicáveis passaram),
// FAIL (problema verificável), NOT_APPLICABLE (sem arquivo esperado — falha de
// acesso), INCONCLUSIVE (evidência insuficiente). Falha de acesso NUNCA vira
// no_text nem "conteúdo íntegro". NÃO acessa o AVA; NÃO altera o histórico.
// Uso: node poc/integrity-check.js [raiz]
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { toCsv } = require('./lib/reconcile');

const ROOT = process.env.UNIVESP_OUT || path.join(os.homedir(), 'Desktop', 'univesp');

// Amostragem estratificada determinística (Etapa 2.2): 30 integral (>=3 por
// disciplina), 7 partial (todos), 12 failed (causas distintas), 11 unclassified.
function selecionarAmostra(registros) {
  const por = (s) => registros.filter((r) => r.reconciled_status === s).sort((a, b) => String(a.resource_id).localeCompare(String(b.resource_id)));
  const integrais = por('integral');
  const porDisc = new Map();
  for (const r of integrais) {
    const l = porDisc.get(r.course_id) || [];
    l.push(r); porDisc.set(r.course_id, l);
  }
  const amostraIntegral = [];
  for (let i = 0; amostraIntegral.length < 30; i++) {
    for (const disc of [...porDisc.keys()].sort()) {
      const l = porDisc.get(disc);
      if (l[i] && amostraIntegral.length < 30) amostraIntegral.push(l[i]);
    }
  }
  const porCausa = new Map();
  for (const r of por('failed')) {
    const causa = String(r.reason || '-').slice(0, 40) + '|' + r.detected_type;
    const l = porCausa.get(causa) || []; l.push(r); porCausa.set(causa, l);
  }
  const amostraFailed = [];
  for (let i = 0; amostraFailed.length < 12; i++) {
    for (const causa of [...porCausa.keys()].sort()) {
      const l = porCausa.get(causa);
      if (l[i] && amostraFailed.length < 12) amostraFailed.push(l[i]);
    }
  }
  const porCursoU = new Map();
  for (const r of por('unclassified')) {
    const l = porCursoU.get(r.course_id) || []; l.push(r); porCursoU.set(r.course_id, l);
  }
  const amostraUnclass = [];
  for (let i = 0; amostraUnclass.length < 11; i++) {
    for (const disc of [...porCursoU.keys()].sort()) {
      const l = porCursoU.get(disc);
      if (l[i] && amostraUnclass.length < 11) amostraUnclass.push(l[i]);
    }
  }
  const causasFailed = [...new Set(amostraFailed.map((r) => String(r.reason || '-').slice(0, 40) + '|' + r.detected_type))];
  const justificativa = {
    integral: { criterio: '>=3 por disciplina, distribuição round-robin por resource_id', alvo: 30, selecionados: amostraIntegral.length },
    partial: { criterio: 'todos os casos', alvo: 7, selecionados: por('partial').length },
    failed: { criterio: 'cobrir causas/leitores distintos, round-robin', alvo: 12, selecionados: amostraFailed.length, causasCobertas: causasFailed },
    unclassified: { criterio: 'distribuídos entre disciplinas/semanas, round-robin', alvo: 11, selecionados: amostraUnclass.length },
  };
  return {
    selecionados: [
      ...amostraIntegral.map((r) => Object.assign({ estrato: 'integral' }, r)),
      ...por('partial').map((r) => Object.assign({ estrato: 'partial' }, r)),
      ...amostraFailed.map((r) => Object.assign({ estrato: 'failed' }, r)),
      ...amostraUnclass.map((r) => Object.assign({ estrato: 'unclassified' }, r)),
    ],
    justificativa,
  };
}

function auditRoot(root) {
  const inventario = JSON.parse(fs.readFileSync(path.join(root, 'INVENTARIO.json'), 'utf8'));
  const registros = inventario.registros;
  const resultados = [];
  const problemas = { arquivoAusente: 0, vazio: 0, ilegivel: 0, estruturaErrada: 0, arquivoCompartilhado: 0, conteudoDuplicado: 0, tamanhoMenorQueDeclarado: 0 };

  // course_id é o código curto; a pasta real é "<código> <título>" — resolver.
  const dirs = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory());
  const dirDe = new Map();
  for (const d of dirs) {
    const code = d.split(' ')[0];
    if (!dirDe.has(code)) dirDe.set(code, d);
  }

  // unicidade de atribuição: dois registros não podem apontar para o mesmo arquivo
  const porArquivo = new Map();
  for (const r of registros) if (r.output_file) porArquivo.set(r.course_id + '|' + r.output_file, (porArquivo.get(r.course_id + '|' + r.output_file) || 0) + 1);

  const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
  const hashes = new Map(); // hash -> [resource_id] (conteúdo idêntico: alerta, não reprovação)
  for (const r of registros) {
    const audit = { resource_id: r.resource_id, existe: false, vazio: false, ilegivel: false, estruturaOk: null, sha256: null, bytes: 0, tamanhoOk: null, resultado: 'INCONCLUSIVE', motivo: null };
    if (!r.output_file) {
      // Sem arquivo esperado: falha de acesso = NOT_APPLICABLE (não é conteúdo
      // íntegro); unclassified = evidência insuficiente = INCONCLUSIVE.
      audit.resultado = r.reconciled_status === 'failed' ? 'NOT_APPLICABLE' : r.reconciled_status === 'unclassified' ? 'INCONCLUSIVE' : 'FAIL';
      audit.motivo = audit.resultado === 'FAIL' ? 'arquivo-esperado-ausente' : 'sem-arquivo-esperado';
      if (audit.resultado === 'FAIL') problemas.arquivoAusente++;
      resultados.push(audit);
      continue;
    }
    if ((porArquivo.get(r.course_id + '|' + r.output_file) || 0) > 1) {
      problemas.arquivoCompartilhado++;
      audit.resultado = 'FAIL'; audit.motivo = 'arquivo-compartilhado-entre-registros';
      resultados.push(audit);
      continue;
    }
    const caminho = path.join(root, dirDe.get(r.course_id) || r.course_id, r.output_file);
    audit.existe = fs.existsSync(caminho);
    if (!audit.existe) {
      problemas.arquivoAusente++;
      audit.resultado = 'FAIL'; audit.motivo = 'arquivo-ausente';
      resultados.push(audit);
      continue;
    }
    const buf = fs.readFileSync(caminho);
    audit.bytes = buf.length;
    audit.vazio = buf.length === 0;
    audit.estruturaOk = r.output_file.replace(/\\/g, '/').startsWith('SEMANA_' + r.week + '/');
    let texto = null;
    try { texto = strictUtf8.decode(buf); } catch { audit.ilegivel = true; }
    audit.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    if (!hashes.has(audit.sha256)) hashes.set(audit.sha256, []);
    hashes.get(audit.sha256).push(r.resource_id);
    if (!audit.vazio && !audit.ilegivel && texto != null) {
      // Conteúdo útil deve ser >= chars declarado (o .md inclui cabeçalho).
      audit.tamanhoOk = texto.length >= (r.chars || 0) ? 'OK' : 'MENOR-QUE-DECLARADO';
    }
    if (audit.vazio) { problemas.vazio++; audit.resultado = 'FAIL'; audit.motivo = 'arquivo-vazio'; }
    else if (audit.ilegivel) { problemas.ilegivel++; audit.resultado = 'FAIL'; audit.motivo = 'utf8-invalido'; }
    else if (!audit.estruturaOk) { problemas.estruturaErrada++; audit.resultado = 'FAIL'; audit.motivo = 'semana-disciplina-errada'; }
    else if (audit.tamanhoOk === 'MENOR-QUE-DECLARADO') { problemas.tamanhoMenorQueDeclarado++; audit.resultado = 'FAIL'; audit.motivo = 'tamanho-menor-que-declarado'; }
    else audit.resultado = 'PASS';
    resultados.push(audit);
  }
  // Conteúdo idêntico em arquivos diferentes: APENAS alerta (pode ser material
  // repetido no AVA) — não reprova automaticamente.
  for (const [h, ids] of hashes) if (ids.length > 1) problemas.conteudoDuplicado++;

  const contagem = { total: resultados.length, PASS: 0, FAIL: 0, NOT_APPLICABLE: 0, INCONCLUSIVE: 0 };
  for (const a of resultados) contagem[a.resultado] = (contagem[a.resultado] || 0) + 1;
  return { inventario, resultados, problemas, contagem };
}

function gerar(root, { inventario, resultados, problemas, contagem }) {
  const amostra = selecionarAmostra(inventario.registros);
  fs.writeFileSync(path.join(root, 'INTEGRITY_AUDIT.json'), JSON.stringify({ gerado_em: new Date().toISOString(), fase: '2.1 — verificação automatizada, sem acesso ao AVA', estados: 'PASS/FAIL/NOT_APPLICABLE/INCONCLUSIVE', contagem, problemas, resultados }, null, 2));
  fs.writeFileSync(path.join(root, 'INTEGRITY_AUDIT.csv'), toCsv(resultados, ['resource_id', 'resultado', 'motivo', 'existe', 'vazio', 'ilegivel', 'estruturaOk', 'tamanhoOk', 'bytes', 'sha256']));
  fs.writeFileSync(path.join(root, 'SAMPLE_SELECTION.json'), JSON.stringify({ gerado_em: new Date().toISOString(), criterio: 'estratificada determinística (ordenação por resource_id)', total: amostra.selecionados.length, justificativa: amostra.justificativa, selecionados: amostra.selecionados.map((r) => ({ estrato: r.estrato, resource_id: r.resource_id, course_id: r.course_id, week: r.week, title: r.title, detected_type: r.detected_type, reconciled_status: r.reconciled_status, reason: r.reason, chars: r.chars, output_file: r.output_file, evidence_reference: r.evidence_reference })) }, null, 2));
  const linhas = [
    '# Integridade — Fase 2.1 (automatizada)', '',
    'Verificação automatizada sobre os 468 registros do inventário — sem acesso ao AVA.', '',
    '## Estados (resultado de integridade separado do resultado de classificação)', '',
    `- PASS (verificações aplicáveis passaram): ${contagem.PASS}`,
    `- FAIL (problema verificável): ${contagem.FAIL}`,
    `- NOT_APPLICABLE (sem arquivo esperado — falha de acesso): ${contagem.NOT_APPLICABLE}`,
    `- INCONCLUSIVE (evidência insuficiente): ${contagem.INCONCLUSIVE}`, '',
    '## Problemas', '',
    `- Arquivos esperados ausentes: ${problemas.arquivoAusente}`,
    `- Arquivos vazios: ${problemas.vazio}`,
    `- UTF-8 inválido (decodificação estrita): ${problemas.ilegivel}`,
    `- Estrutura (semana/disciplina) errada: ${problemas.estruturaErrada}`,
    `- Tamanho menor que o declarado: ${problemas.tamanhoMenorQueDeclarado}`,
    `- Mesmo arquivo atribuído a dois registros: ${problemas.arquivoCompartilhado}`,
    `- Conteúdo idêntico em registros distintos (ALERTA, não reprovação — pode ser material repetido no AVA): ${problemas.conteudoDuplicado}`, '',
    '## Amostra da Fase 2.2', '',
    `Seleção estratificada determinística em SAMPLE_SELECTION.json: ${amostra.selecionados.length} registros (com título, motivo e evidência de cada selecionado).`,
    ...Object.keys(amostra.justificativa).map((k) => { const j = amostra.justificativa[k]; return `- ${k}: alvo ${j.alvo}, selecionados ${j.selecionados} (${j.criterio})${j.causasCobertas ? ' — causas cobertas: ' + j.causasCobertas.length : ''}`; }), '',
    'NOTA: falha de acesso NÃO foi convertida em no_text nem contabilizada como conteúdo íntegro. A comparação de CONTEÚDO com a fonte original (Fase 2.2/2.3) requer novo acesso ao AVA e ainda não foi executada.',
  ];
  fs.writeFileSync(path.join(root, 'INTEGRITY_AUDIT.md'), linhas.join('\n'));
  return contagem;
}

if (require.main === module) {
  const raiz = process.argv[2] || ROOT;
  const r = auditRoot(raiz);
  const c = gerar(raiz, r);
  console.log('integridade: ' + JSON.stringify(c));
  console.log('problemas: ' + JSON.stringify(r.problemas));
}

module.exports = { auditRoot, gerar, selecionarAmostra };
