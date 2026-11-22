// Etapa 2, Fase 2.1 — Integridade AUTOMATIZADA dos 468 registros.
// Verifica existência, tamanho, leitura, hash, rastreabilidade, estrutura,
// duplicação de conteúdo e coerência da classificação — sobre o inventário.
// NÃO acessa o AVA; NÃO converte failed em no_text; NÃO altera o histórico.
// Uso: node poc/integrity-check.js [raiz]
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { toCsv } = require('./lib/reconcile');

const ROOT = process.env.UNIVESP_OUT || path.join(os.homedir(), 'Desktop', 'univesp');

// Coerência classificação x evidência (falha de acesso NÃO vira no_text).
function coerenciaClassificacao(rec, audit) {
  if (rec.reconciled_status === 'integral') return audit.existe && !audit.vazio && rec.chars > 0 ? 'OK' : 'MISCLASSIFIED';
  if (rec.reconciled_status === 'partial' && rec.chars > 0) return audit.existe && !audit.vazio ? 'OK' : 'MISCLASSIFIED';
  if (rec.reconciled_status === 'failed') return 'OK'; // falha explícita: sem exigência de arquivo
  if (rec.reconciled_status === 'unclassified') return 'OK';
  return 'INCONCLUSIVE';
}

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
  const justificativa = {
    integral: { criterio: '>=3 por disciplina, distribuição round-robin por resource_id', alvo: 30, selecionados: amostraIntegral.length },
    partial: { criterio: 'todos os casos', alvo: 7, selecionados: por('partial').length },
    failed: { criterio: 'cobrir causas/leitores distintos, round-robin', alvo: 12, selecionados: amostraFailed.length },
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
  const problemas = { arquivoAusente: 0, vazio: 0, ilegivel: 0, estruturaErrada: 0, conteudoDuplicado: 0, misclassified: 0 };

  // identificação: arquivo deve corresponder a um único registro
  const porArquivo = new Map();
  for (const r of registros) if (r.output_file) porArquivo.set(r.course_id + '|' + r.output_file, (porArquivo.get(r.course_id + '|' + r.output_file) || 0) + 1);

  // course_id é o código curto; a pasta real é "<código> <título>" — resolver.
  const dirs = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory());
  const dirDe = new Map();
  for (const d of dirs) {
    const code = d.split(' ')[0];
    if (!dirDe.has(code)) dirDe.set(code, d);
  }

  const hashes = new Map(); // hash -> [resource_id] (conteúdo idêntico entre registros distintos)
  for (const r of registros) {
    const audit = { resource_id: r.resource_id, existe: false, vazio: false, ilegivel: false, estruturaOk: false, sha256: null, bytes: 0, coerencia: null, resultado: 'INCONCLUSIVE' };
    if (r.output_file) {
      const caminho = path.join(root, dirDe.get(r.course_id) || r.course_id, r.output_file);
      audit.existe = fs.existsSync(caminho);
      if (audit.existe) {
        audit.estruturaOk = r.output_file.replace(/\\/g, '/').startsWith('SEMANA_' + r.week + '/');
        const buf = fs.readFileSync(caminho);
        audit.bytes = buf.length;
        audit.vazio = buf.length === 0;
        let texto = null;
        try { texto = buf.toString('utf8'); audit.ilegivel = /\uFFFD{3,}/.test(texto); } catch { audit.ilegivel = true; }
        audit.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        const hKey = audit.sha256;
        if (!hashes.has(hKey)) hashes.set(hKey, []);
        hashes.get(hKey).push(r.resource_id);
        if (!audit.vazio && !audit.ilegivel) {
          const declarado = r.chars || 0;
          audit.coerenciaTamanho = texto.length >= declarado ? 'OK' : 'MENOR-QUE-DECLARADO';
        }
      } else problemas.arquivoAusente++;
      if (audit.vazio) problemas.vazio++;
      if (audit.ilegivel) problemas.ilegivel++;
      if (!audit.estruturaOk) problemas.estruturaErrada++;
    }
    audit.coerencia = r.output_file ? coerenciaClassificacao(r, audit) : coerenciaClassificacao(r, { existe: false, vazio: true });
    if (audit.coerencia === 'MISCLASSIFIED') problemas.misclassified++;
    audit.resultado = audit.coerencia === 'OK' ? 'PASS' : audit.coerencia;
    resultados.push(audit);
  }
  for (const [h, ids] of hashes) if (ids.length > 1) problemas.conteudoDuplicado++;

  const contagem = { total: resultados.length, PASS: 0, MISCLASSIFIED: 0, INCONCLUSIVE: 0 };
  for (const a of resultados) contagem[a.resultado] = (contagem[a.resultado] || 0) + 1;
  return { inventario, resultados, problemas, contagem };
}

function gerar(root, { inventario, resultados, problemas, contagem }) {
  const amostra = selecionarAmostra(inventario.registros);
  fs.writeFileSync(path.join(root, 'INTEGRITY_AUDIT.json'), JSON.stringify({ gerado_em: new Date().toISOString(), fase: '2.1 — verificação automatizada, sem acesso ao AVA', contagem, problemas, resultados }, null, 2));
  fs.writeFileSync(path.join(root, 'INTEGRITY_AUDIT.csv'), toCsv(resultados, ['resource_id', 'resultado', 'existe', 'vazio', 'ilegivel', 'estruturaOk', 'bytes', 'sha256', 'coerencia']));
  fs.writeFileSync(path.join(root, 'SAMPLE_SELECTION.json'), JSON.stringify({ gerado_em: new Date().toISOString(), criterio: 'estratificada determinística (ordenação por resource_id)', total: amostra.selecionados.length, justificativa: amostra.justificativa, selecionados: amostra.selecionados.map((r) => ({ estrato: r.estrato, resource_id: r.resource_id, course_id: r.course_id, week: r.week, detected_type: r.detected_type, reconciled_status: r.reconciled_status, chars: r.chars, output_file: r.output_file })) }, null, 2));
  const linhas = [
    '# Integridade — Fase 2.1 (automatizada)', '',
    'Verificação automatizada sobre os 468 registros do inventário — sem acesso ao AVA.', '',
    '## Contagem', '',
    `- PASS: ${contagem.PASS} | MISCLASSIFIED: ${contagem.MISCLASSIFIED || 0} | INCONCLUSIVE: ${contagem.INCONCLUSIVE || 0} (de ${contagem.total})`, '',
    '## Problemas', '',
    `- Arquivos ausentes: ${problemas.arquivoAusente}`,
    `- Arquivos vazios: ${problemas.vazio}`,
    `- Arquivos ilegíveis: ${problemas.ilegivel}`,
    `- Estrutura (semana/disciplina) errada: ${problemas.estruturaErrada}`,
    `- Conteúdo idêntico em registros distintos: ${problemas.conteudoDuplicado} (hashes repetidos; pode ser legítimo — material repetido no AVA — sinalizado sem deduzir)`,
    `- Classificação incoerente com evidência: ${problemas.misclassified}`, '',
    '## Amostra da Fase 2.2', '',
    `Seleção estratificada determinística em SAMPLE_SELECTION.json: ${amostra.selecionados.length} registros.`,
    ...Object.keys(amostra.justificativa).map((k) => `- ${k}: alvo ${amostra.justificativa[k].alvo}, selecionados ${amostra.justificativa[k].selecionados} (${amostra.justificativa[k].criterio})`), '',
    'NOTA: falha de acesso NÃO foi convertida em no_text. A comparação de CONTEÚDO com a fonte original (Fase 2.2/2.3) requer novo acesso ao AVA e ainda não foi executada.',
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

module.exports = { auditRoot, gerar, selecionarAmostra, coerenciaClassificacao };
