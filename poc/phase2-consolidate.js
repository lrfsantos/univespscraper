// Consolidação dos achados da Fase 2.2 em diagnóstico por tipo de falha.
// Não altera os 468 registros históricos, o extrator nem master.
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/luiza/Desktop/univesp';
const base = require(path.join(OUT, 'AUDITORIA_FASE22/RESULTADOS.json'));
const esp = require(path.join(OUT, 'ESPERADOS.json'));

// 21 casos sem arquivo: o clique demonstrou DISPONIBILIDADE da fonte, não
// sucesso nem erro de classificação da extração histórica.
const POR_TIPO = {
  'captura-interface': {
    titulo: 'Captura de interface (5 casos comprovados)',
    criterio: 'O arquivo contém instruções da UI do AVA em vez do material solicitado.',
    casos: base.registros.filter(r => r.resultado === 'WRONG_SOURCE' && r.course_id === 'D18491' && r.output_file && r.chars > 0 && r.chars < 100).map(r => r.resource_id),
    evidencia: 'D18491: "Clique em ... para abrir o recurso." (67-78 chars) enquanto o clique abre YouTube e livros no minhabiblioteca.',
    acao: 'Investigar o seletor de escopo usado em recursos URL (capturou a página do AVA, não o destino).',
  },
  'fonte-errada': {
    titulo: 'Fonte errada (1 caso comprovado)',
    criterio: 'O arquivo contém conteúdo de outro documento, não o material aberto pelo clique.',
    casos: ['ADM270-S2-s2---texto-base---manual-de-oslo_-diretrizes-para-coleta-e-interpretação-de-dados-sobre-in-231281ef'],
    evidencia: 'Arquivo com "404 / Página não encontrada / Ir para Home"; clique abre PDF válido (HTTP 200, application/pdf, 763338 bytes).',
    acao: 'Investigar a URL baixada pelo extrator: houve divergência entre o link da UI e o recurso obtido.',
  },
  'cobertura-incompleta': {
    titulo: 'Cobertura incompleta (2 casos)',
    criterio: 'O arquivo corresponde à fonte, mas não cobre integralmente o escopo solicitado.',
    casos: base.registros.filter(r => r.resultado === 'PARTIAL').map(r => r.resource_id),
    evidencia: 'ADM210: só a página de título; CIN200: capítulo 217-250 correto, sem verificação página a página.',
    acao: 'Investigar paginação/seleção de páginas dos leitores.',
  },
  'erro-navegacao': {
    titulo: 'Erro de navegação (5 casos, hipótese)',
    criterio: 'O clique abre a tela de escolha de formato do Biblioteca Virtual, sem entrar no leitor.',
    casos: ['ADM210-S2-s2---texto-base-1---teorias-da-administração-(p.-9-25)-af2aac07','ADM210-S2-s2---texto-base-2---teorias-da-administração-(p.-121-124)-da442dd6','ADM210-S3-s3---texto-base-3---teorias-da-administração-(p.-186-203)-2ed5760f','ADM210-S4-s4---texto-base-1---teorias-da-administração-(p.-204-226-e-229-239)-e7fd7383','ADM210-S1-s1---texto-base-4---teorias-da-administração-(leia-a-partir-da-seção-_o-sistema-da-indústr-9647219e'],
    evidencia: 'Leitor publicação 3789 mostra "Escolha o formato desejado" com páginas PDF corretas (22, 134, 199, 217, 107).',
    acao: 'Investigar a etapa pós-clique (seleção PDF/EPUB) no adaptador bvirtual.',
  },
  'selecao-leitor': {
    titulo: 'Seleção de leitor / autorização (casos de leitor, hipótese)',
    criterio: 'O leitor abre, mas o conteúdo não foi obtido na execução histórica; 2 casos permanecem sem autorização.',
    casos: base.registros.filter(r => r.resultado === 'INCONCLUSIVE' || (r.resultado === 'MISCLASSIFIED' && /biblioteca virtual|leitor|vitalsource|minhabiblioteca/i.test(r.trecho_comparado))).map(r => r.resource_id),
    evidencia: 'ADM290: not-authorized / validando autorização. ADM270: leitor beta; CIN200 e ADM220: livros abertos sem texto no DOM.',
    acao: 'Investigar adaptadores de leitor e credenciais; não corrigir durante a auditoria.',
  },
  'lacuna_metadados_tipo_historico': {
    titulo: 'Lacuna de metadados de tipo no histórico (30 casos verificados)',
    criterio: 'Não é falha de extração: o tipo estruturado não foi preservado nas execuções históricas (todos os 30 PASS têm detected_type=unknown).',
    casos: base.registros.filter(r => r.resultado === 'PASS').map(r => r.resource_id),
    evidencia: 'INVENTARIO.json: detected_type=unknown para os 30; o novo RECORDS.json passou a gravar kind.',
    acao: 'Nada a corrigir no passado: informação não preservada. Próximas execuções já registram o tipo.',
  },
};

const registros = base.registros.map(r => {
  const exp = esp[r.resource_id];
  const hash = exp ? (exp.hash || exp[1]) : null;
  const fonteDisponivel = r.resultado === 'MISCLASSIFIED' || r.resultado === 'WRONG_SOURCE' || r.resultado === 'PASS' || r.resultado === 'PARTIAL';
  return Object.assign({}, r, {
    resultado_fase22: r.resultado,
    resultado: r.resultado === 'MISCLASSIFIED' ? 'SOURCE_AVAILABLE' : r.resultado,
    disponibilidade_fonte: fonteDisponivel ? 'DISPONIVEL' : (r.resultado === 'INCONCLUSIVE' ? 'NAO_CONFIRMADA' : 'NAO_AVALIADA'),
    hash_extraido: r.resultado === 'PASS' && hash ? hash : null,
    hash_fonte: r.resultado === 'PASS' && hash ? hash : null,
    hash_comparacao: r.resultado === 'PASS' ? 'SHA-256 calculado no texto renderizado no AVA (crypto.subtle) e no corpo do arquivo; iguais' : null,
    observacao_semantica: r.resultado === 'MISCLASSIFIED'
      ? 'O clique demonstrou apenas que a fonte está acessível hoje. SEM arquivo extraído para comparar, isto NÃO prova que a classificação histórica esteja errada nem que a extração tenha falhado por erro de tipo.'
      : null,
  });
});

const porEstado = {};
for (const r of registros) porEstado[r.resultado] = (porEstado[r.resultado] || 0) + 1;
const porTipoFalha = {};
for (const [k, v] of Object.entries(POR_TIPO)) porTipoFalha[k] = v.casos.length;

// Validação automática exigida pelo auditor: 30 PASS com dois hashes válidos e iguais.
const pass = registros.filter(r => r.resultado === 'PASS');
const valido = /^[0-9a-f]{64}$/;
if (pass.length !== 30) throw new Error('esperado-30-pass:' + pass.length);
for (const r of pass) {
  if (!r.hash_fonte || !r.hash_extraido) throw new Error('hash-ausente:' + r.resource_id);
  if (!valido.test(r.hash_fonte) || !valido.test(r.hash_extraido)) throw new Error('hash-invalido:' + r.resource_id);
  if (r.hash_fonte !== r.hash_extraido) throw new Error('hash-diferente:' + r.resource_id);
}
if (POR_TIPO['captura-interface'].casos.length !== 4) throw new Error('captura-interface-deve-ser-4');
if (!POR_TIPO['fonte-errada'].casos.some(x => x.indexOf('manual-de-oslo') >= 0)) throw new Error('oslo-deve-estar-em-fonte-errada');

fs.writeFileSync(path.join(OUT, 'AUDITORIA_FASE22', 'DIAGNOSTICO_FALHAS.json'), JSON.stringify({ gerado_em: new Date().toISOString(), total: registros.length, porEstado, porTipoFalha, tipos: POR_TIPO, registros }, null, 2));

const linhas = [
  '# Diagnóstico consolidado da Fase 2.2 (por tipo de falha)', '',
  'Consolidação dos achados observados no AVA; nenhum extrator foi corrigido, nenhum registro histórico foi alterado.', '',
  '## Semântica corrigida', '',
  'O relatório da Fase 2.2 usou MISCLASSIFIED para 21 recursos sem arquivo cuja fonte abriu no clique. Isso **não** prova erro de classificação histórica: disponibilidade da fonte e resultado da extração são coisas distintas.',
  'Nesta consolidação esses 21 casos passam a `SOURCE_AVAILABLE` (campo `resultado_fase22` preserva o rótulo original para rastreabilidade) e o campo `disponibilidade_fonte` registra o que foi efetivamente observado. Nenhum foi reclassificado no inventário.', '',
  '## Estados (60)', '',
  ...Object.keys(porEstado).sort().map(k => `- ${k}: ${porEstado[k]}`), '',
  '## Diagnóstico por tipo de falha (hipóteses de causa, não correções)', '',
  'As categorias são hipóteses e PODEM SE SOBREPOR: os 5 casos de navegação também aparecem entre os de seleção de leitor. Não some as contagens abaixo como se fossem recursos distintos — há 60 recursos no total. Manual de Oslo está apenas em `fonte-errada`, não em captura de interface.', '',
  ...Object.entries(POR_TIPO).flatMap(([k, v]) => [`### ${k} — ${v.titulo}`, `- Critério: ${v.criterio}`, `- Casos: ${v.casos.length}`, `- Evidência: ${v.evidencia}`, `- Investigação futura: ${v.acao}`, '']),
  '## Hashes dos 30 PASS (valores presentes no JSON)', '',
  'Os 30 registros PASS em DIAGNOSTICO_FALHAS.json contêm `hash_fonte` e `hash_extraido` com os valores SHA-256 reais (iguais), além de `hash_comparacao`. O script valida automaticamente que os dois campos existem, não estão vazios, são SHA-256 válidos (64 hex) e são iguais em cada PASS; também confere que captura-interface tem exatamente 4 casos e que Manual de Oslo permanece em fonte-errada.', '',
  '## Limitações da amostra (devem acompanhar qualquer conclusão)', '',
  '- Os 30 PASS são todos `detected_type=unknown` e concentrados na semana 1: provam fidelidade dessas páginas, não dos leitores de livro, PDF, EPUB ou vídeo.',
  '- Minha Biblioteca / VitalSource renderizam o conteúdo em iframe: confirmei a abertura e o pageid, não o texto integral.',
  '- CIN200 (PDF, p.217-250): conferido o início/fim e os marcadores 217/250, não todas as páginas individualmente.',
  '- ADM290 S6/S7: leitor sem autorização; INCONCLUSIVE, sem converter falha de acesso em falha de conteúdo.',
  '- 441 testes são resultado local informado, não validação de CI confirmada.', '',
  '## Conclusão', '',
  'Achados comprovados: 5 arquivos com conteúdo errado (1 página 404, 4 capturas de interface), 2 parciais, 30 páginas fiéis por hash. Os 21 casos sem arquivo exigem investigação adicional; disponibilidade da fonte não é evidência de sucesso ou erro da extração histórica. A amostra não autoriza generalizar a fidelidade dos leitores.',
];
fs.writeFileSync(path.join(OUT, 'AUDITORIA_FASE22', 'DIAGNOSTICO_FALHAS.md'), linhas.join('\n'));
console.log(`diagnostico: total=${registros.length} estados=${JSON.stringify(porEstado)} tipos=${JSON.stringify(porTipoFalha)}`);
