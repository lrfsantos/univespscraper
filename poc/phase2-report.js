// Relatório consolidado da Fase 2.2 — comparação dos 60 recursos com o AVA.
// Dados observados em navegação real (cliques no AVA autenticado), 2026-11-22.
// NÃO altera inventário, extrator nem histórico. URLs sem códigos/assinaturas.
const fs = require('fs');
const path = require('path');

const SAMPLE = require('C:/Users/luiza/Desktop/univesp/SAMPLE_SELECTION.json').selecionados;

// Integrais: hash SHA-256 do corpo extraído == texto renderizado no AVA.
// [pageId do AVA, chars]
const INTEGRAIS = {
  'ADM210-S1-s1---aprofundando-o-tema-página-230b5e94': [62449, 950],
  'ADM220-S1-s1---aprofundando-o-tema-página-839a5525': [128812, 427],
  'ADM230-S1-s1---aprofundando-o-tema-página-5a06a2da': [128877, 539],
  'ADM270-S1-s1---aprofundando-o-tema-página-82af0da2': [263481, 508],
  'ADM290-S1-s1---aprofundando-o-tema-página-4a0a8e01': [263821, 1063],
  'CIN200-S1-s1---aprofundando-o-tema-página-c9349428': [160559, 492],
  'D18491-S1-s1---aprofundando-o-tema-página-c81416e1': [86031, 513],
  'D18539-S1-s1---aprofundando-o-tema-página-70a3d229': [141161, 396],
  'D18554-S1-s1---aprofundando-o-tema-página-19627bfe': [141029, 606],
  'SOC200-S1-s1---aprofundando-o-tema-página-50f38581': [273379, 705],
  'ADM210-S1-s1---em-síntese-página-c4876ab5': [62452, 1266],
  'ADM220-S1-s1---em-síntese-página-d6f2c0aa': [128814, 1812],
  'ADM230-S1-s1---em-síntese-página-be88abd7': [128879, 1854],
  'ADM270-S1-s1---em-síntese-página-1c968436': [263482, 1152],
  'ADM290-S1-s1---em-síntese-página-a00145a7': [263824, 1355],
  'CIN200-S1-s1---em-síntese-página-24435220': [160563, 1224],
  'D18491-S1-s1---em-síntese-página-60c75211': [86034, 1794],
  'D18539-S1-s1---em-síntese-página-6158820e': [141164, 1113],
  'D18554-S1-s1---em-síntese-página-9994b707': [141031, 1649],
  'SOC200-S1-s1---em-síntese-página-296faf50': [273382, 1516],
  'ADM210-S1-s1---videoaula-1---revolução-industrial-e-o-surgimento-do-administrador-página-06e16ebd': [62442, 255],
  'ADM220-S1-s1---início-página-3d1756d9': [128806, 6081],
  'ADM230-S1-s1---início-página-f601d4b9': [128872, 2205],
  'ADM270-S1-s1---início-página-231d2203': [263473, 4219],
  'ADM290-S1-s1---início-página-fc0b881d': [263817, 5041],
  'CIN200-S1-s1---início-página-a43fe540': [160555, 4645],
  'D18491-S1-s1---introdução-à-ética_-conceitos-fundamentais-página-c74c6060': [86025, 4936],
  'D18539-S1-s1---exercício-de-apoio-página-eeafda3b': [141162, 682],
  'D18554-S1-s1---início-página-26bf251e': [141020, 3848],
  'SOC200-S1-s1---início-página-e116c610': [273373, 5479],
};

// [resultado, trecho/página comparado, justificativa] para os 30 não-integrais.
const OUTROS = [
  ['ADM210-S1-s1---texto-base-1---teorias-da-administração-(p.-4-18-e-42-46-)-12bd976b', 'PARTIAL',
    'Biblioteca Virtual, publicação 3789, PDF p.17 (clique no recurso), obra "Teorias da Administração", Reinaldo O. da Silva',
    'O arquivo contém a página de título (121 chars), compatível com a fonte, mas não cobre as páginas 4-18 e 42-46 pedidas.'],
  ['ADM270-S2-s2---texto-base---manual-de-oslo_-diretrizes-para-coleta-e-interpretação-de-dados-sobre-in-231281ef', 'WRONG_SOURCE',
    'legacy.finep.gov.br/images/apoio-e-financiamento/manualoslo.pdf#page=23; HTTP 200, application/pdf, 763338 bytes, assinatura %PDF-1.2',
    'O arquivo extraído contém "404 / Página não encontrada / Ir para Home", que não pertence ao PDF válido aberto pelo clique.'],
  ['CIN200-S4-s4---texto-base_-fundamentos-de-gestão-de-projetos-(leia-o-capítulo-6,-p.-217-250)-257f9217', 'PARTIAL',
    'Biblioteca Virtual, publicação 177750, leitor PDF p.217 de 266; obra "Fundamentals of project management", Adriana Bastos da Costa',
    'Texto de 39527 chars começa em p.217, inclui marcador 250 e o fechamento do capítulo; fonte correta, mas não foi feita verificação página a página.'],
  ['D18491-S1-s1---vídeo-base---qual-o-significado-de-ética_-url-90aac5de', 'WRONG_SOURCE',
    'YouTube "Qual o significado de Ética?" (2:25), aberto pelo clique no recurso URL',
    'O arquivo contém apenas "Clique em ... para abrir o recurso.", texto de interface do AVA, e não o vídeo.'],
  ['D18491-S5-s5---texto-base---ética-profissional-url-be901345', 'WRONG_SOURCE',
    'minhabiblioteca, livro 9788597021653, pageid/42, aberto pelo clique no recurso URL',
    'O arquivo contém texto de interface ("Clique em ... para abrir o recurso."), não o conteúdo do livro.'],
  ['D18491-S6-s6---texto-base---dignidade-da-pessoa-humana-url-1c093940', 'WRONG_SOURCE',
    'minhabiblioteca, livro 9788595025370, pageid/148, aberto pelo clique no recurso URL',
    'O arquivo contém texto de interface ("Clique em ... para abrir o recurso."), não o conteúdo do livro.'],
  ['D18491-S7-s7---texto-base---ética-na-pesquisa-url-d7ba5b28', 'WRONG_SOURCE',
    'minhabiblioteca, livro 9788595029576, pageid/212, aberto pelo clique no recurso URL',
    'O arquivo contém texto de interface ("Clique em ... para abrir o recurso."), não o conteúdo do livro.'],

  ['ADM210-S1-s1---introdução-a-abordagem-científica-e-a-teoria-clássica-da-administração-página-f3dd9550', 'MISCLASSIFIED',
    'AVA mod/page/view.php?id=62441, página renderizada com 4197 chars',
    'Recurso classificado como unclassified, mas a página abre e apresenta conteúdo integral.'],
  ['ADM210-S1-s1---texto-base-2---teoria-geral-da-administração-(p.-23-35)-_-fernando-c.-prestes-motta,--2bbb50d0', 'MISCLASSIFIED',
    'minhabiblioteca, livro 9786555583885, pageid/47, aberto pelo clique no recurso URL',
    'Registrado como failed, mas o leitor do livro abre na página solicitada.'],
  ['ADM210-S2-s2---aprofundando-o-tema-página-48d07d60', 'MISCLASSIFIED',
    'AVA mod/page/view.php?id=65669, página renderizada com 1310 chars',
    'Registrado como unclassified, mas a página abre com conteúdo.'],
  ['ADM210-S1-s1---texto-base-3---teoria-geral-da-administração_-da-revolução-urbana-à-era-da-agilidade--11ada4e8', 'MISCLASSIFIED',
    'minhabiblioteca, livro 9786559775897, pageid/32, aberto pelo clique no recurso URL',
    'Registrado como failed, mas o leitor do livro abre na página solicitada.'],
  ['ADM210-S2-s2---texto-base-1---teorias-da-administração-(p.-9-25)-af2aac07', 'MISCLASSIFIED',
    'Biblioteca Virtual, publicação 3789, leitor PDF p.22 — leitor de formato',
    'Registrado como failed (bvpdf), mas o clique abre o leitor exatamente na página pedida.'],
  ['ADM210-S2-s2---texto-base-2---teorias-da-administração-(p.-121-124)-da442dd6', 'MISCLASSIFIED',
    'Biblioteca Virtual, publicação 3789, leitor PDF p.134 — leitor de formato',
    'Registrado como failed (bvpdf), mas o clique abre o leitor na página pedida.'],
  ['ADM210-S3-s3---texto-base-3---teorias-da-administração-(p.-186-203)-2ed5760f', 'MISCLASSIFIED',
    'Biblioteca Virtual, publicação 3789, leitor PDF p.199 — leitor de formato',
    'Registrado como failed, mas o clique abre o leitor na página pedida.'],
  ['ADM210-S4-s4---texto-base-1---teorias-da-administração-(p.-204-226-e-229-239)-e7fd7383', 'MISCLASSIFIED',
    'Biblioteca Virtual, publicação 3789, leitor PDF p.217 — leitor de formato',
    'Registrado como failed, mas o clique abre o leitor na página pedida.'],
  ['ADM210-S1-s1---texto-base-4---teorias-da-administração-(leia-a-partir-da-seção-_o-sistema-da-indústr-9647219e', 'MISCLASSIFIED',
    'Biblioteca Virtual, publicação 3789, leitor PDF p.107 — leitor de formato',
    'Registrado como failed, mas o clique abre o leitor na página pedida.'],
  ['ADM220-S1-s1---texto-base---comportamento-humano-nas-organizações-(leia-o-capítulo-4---atitudes-e-co-a13f63ed', 'MISCLASSIFIED',
    'Vitalsource, livro 9788597012873, epubcfi capítulo html14, aberto pelo clique no recurso URL',
    'Registrado como unclassified, mas o leitor do capítulo abre.'],
  ['ADM220-S2-s2---texto-base---comportamento-organizacional-(leia-o-capítulo-5---motivação-e-desempenho-ae262b08', 'MISCLASSIFIED',
    'minhabiblioteca, livro 9788571440760, pageid/96, aberto pelo clique no recurso URL',
    'Registrado como unclassified, mas o leitor do livro abre.'],
  ['ADM230-S2-s2---exercício-de-apoio-página-035e99ad', 'MISCLASSIFIED',
    'AVA mod/page/view.php?id=128883, página renderizada com 544 chars',
    'Registrado como unclassified, mas a página abre com conteúdo.'],
  ['ADM230-S3-s3---exercício-de-apoio-página-08724e74', 'MISCLASSIFIED',
    'AVA mod/page/view.php?id=133616, página renderizada com 526 chars',
    'Registrado como unclassified, mas a página abre com conteúdo.'],
  ['ADM270-S1-s1---texto-base---empreendedorismo-(leia-o-capítulo-1-_o-empreendedorismo-e-a-mentalidade--862b643c', 'MISCLASSIFIED',
    'Biblioteca Virtual, publicação 173412, leitor PDF p.12 — leitor beta',
    'Registrado como failed (reader-auth), mas o clique abre o leitor da obra na página pedida.'],
  ['ADM270-S2-s2--texto-base---manual-de-oslo_-diretrizes-para-coleta-e-interpretação-de-dados-sobre-ino-7c7ee091', 'MISCLASSIFIED',
    'legacy.finep.gov.br/images/apoio-e-financiamento/manualoslo.pdf#page=57',
    'Registrado como failed, mas o PDF é válido (mesmo arquivo verificado: HTTP 200, application/pdf).'],
  ['ADM270-S1-s1---vídeo-base---palestra-empreendedorismo-e-seus-reflexos-para-o-brasil-(veja-até-25min)-50a116b7', 'MISCLASSIFIED',
    'YouTube "Palestra Empreendedorismo e seus reflexos para o Brasil" (2:01:15), aberto pelo clique',
    'Registrado como unclassified, mas o vídeo abre e reproduz.'],
  ['ADM270-S4-s4---vídeo-base---como-fazer-um-plano-de-negócios-2d85c57e', 'MISCLASSIFIED',
    'YouTube "Como Fazer Um Plano de Negócios | Modelo SEBRAE" (21:35), aberto pelo clique',
    'Registrado como unclassified, mas o vídeo abre e reproduz.'],
  ['ADM290-S6-s6---texto-base---comunicação-organizacional,-transformações-e-mudanças,-comunicação-digit-e88045df', 'INCONCLUSIVE',
    'Biblioteca Virtual: leitor redirecionou para leitor.bvirtual.com.br/not-authorized',
    'Acesso não autorizado no leitor; não foi possível comparar o conteúdo com a fonte. Falha de acesso permanece falha de acesso.'],
  ['ADM290-S7-s7---texto-base---métricas-e-avaliação-em-comunicação-organizacional-(leia-o-capítulo-16)-8d9de090', 'INCONCLUSIVE',
    'Biblioteca Virtual: "Validando autorização" sem conclusão; publicação 195178, epub p.28',
    'Não foi possível confirmar o conteúdo por falta de autorização no leitor.'],
  ['CIN200-S1-s1---texto-base-1_-gestão-eficaz-de-projetos_-como-gerenciar-com-excelência-projetos-tradi-1ec1acc3', 'MISCLASSIFIED',
    'Vitalsource, livro 9788571441002, pageid/50, aberto pelo clique no recurso LTI',
    'Registrado como failed (reader-auth), mas o leitor do livro abre na página pedida.'],
  ['CIN200-S3-s3---videoaula-página-4a8e654a', 'MISCLASSIFIED',
    'AVA mod/page/view.php?id=160573, página renderizada com 854 chars',
    'Registrado como unclassified, mas a página abre com conteúdo.'],
  ['CIN200-S6-s6---texto-base_-cases-de-scrum-6ec09c54', 'MISCLASSIFIED',
    'AVA disciplinas/CIN200/pdf/s6_texto-base_cases-de-scrum.pdf, aberto pelo clique no recurso URL',
    'Registrado como unclassified, mas o PDF abre.'],
  ['D18539-S3-s3---texto-base---introdução-à-metodologia-da-pesquisa_-um-guia-para-iniciantes-(leia-o-ca-9e36d04a', 'MISCLASSIFIED',
    'minhabiblioteca, livro 9788565848138, pageid/206, aberto pelo clique no recurso URL',
    'Registrado como unclassified, mas o leitor do livro abre.'],
];

const registros = [];
for (const r of SAMPLE) {
  let item;
  if (r.reconciled_status === 'integral') {
    const [page, chars] = INTEGRAIS[r.resource_id] || [null, null];
    item = { resultado: page ? 'PASS' : 'INCONCLUSIVE', trecho: page ? `AVA mod/page/view.php?id=${page}; corpo extraído (${chars} chars)` : 'sem observação',
      justificativa: page ? 'Hash SHA-256 do corpo extraído idêntico ao texto renderizado no AVA; início, fim e tamanho conferem.' : 'Sem observação registrada.' };
  } else {
    const o = OUTROS.find(x => x[0] === r.resource_id);
    item = o ? { resultado: o[1], trecho: o[2], justificativa: o[3] } : { resultado: 'INCONCLUSIVE', trecho: '-', justificativa: 'Sem observação registrada.' };
  }
  registros.push({
    resource_id: r.resource_id, estrato: r.estrato, course_id: r.course_id, disciplina: r.course_title,
    week: r.week, title: r.title, detected_type: r.detected_type, status_historico: r.reconciled_status,
    chars: r.chars, output_file: r.output_file, evidencia_historica: r.evidence_reference,
    resultado: item.resultado, trecho_comparado: item.trecho, justificativa: item.justificativa,
  });
}

const porEstado = {};
for (const r of registros) porEstado[r.resultado] = (porEstado[r.resultado] || 0) + 1;
const porDisciplina = {};
for (const r of registros) { const g = porDisciplina[r.course_id] = porDisciplina[r.course_id] || {}; g[r.resultado] = (g[r.resultado] || 0) + 1; }
const porTipo = {};
for (const r of registros) { const g = porTipo[r.detected_type] = porTipo[r.detected_type] || {}; g[r.resultado] = (g[r.resultado] || 0) + 1; }

const OUT = 'C:/Users/luiza/Desktop/univesp';
fs.mkdirSync(path.join(OUT, 'AUDITORIA_FASE22'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'AUDITORIA_FASE22', 'RESULTADOS.json'), JSON.stringify({ gerado_em: new Date().toISOString(), total: registros.length, porEstado, porDisciplina, porTipo, registros }, null, 2));
const md = [
  '# Auditoria de integridade — Fase 2.2 (60 recursos no AVA)', '',
  'Comparação realizada em 2026-11-22 por navegação e cliques reais no AVA autenticado. Nenhum extrator foi corrigido, nenhum registro histórico foi alterado, nenhum merge/PR foi feito. URLs sem códigos de assinatura.', '',
  '## Contagem por estado', '',
  ...Object.keys(porEstado).sort().map(k => `- ${k}: ${porEstado[k]}`),
  '- Total: ' + registros.length, '',
  '## Por disciplina', '',
  '| Disciplina | PASS | PARTIAL | WRONG_SOURCE | MISCLASSIFIED | INCONCLUSIVE |', '|---|---:|---:|---:|---:|---:|',
  ...Object.keys(porDisciplina).sort().map(d => { const g = porDisciplina[d]; return `| ${d} | ${g.PASS||0} | ${g.PARTIAL||0} | ${g.WRONG_SOURCE||0} | ${g.MISCLASSIFIED||0} | ${g.INCONCLUSIVE||0} |`; }), '',
  '## Por tipo detectado', '',
  '| Tipo | PASS | PARTIAL | WRONG_SOURCE | MISCLASSIFIED | INCONCLUSIVE |', '|---|---:|---:|---:|---:|---:|',
  ...Object.keys(porTipo).sort().map(t => { const g = porTipo[t]; return `| ${t} | ${g.PASS||0} | ${g.PARTIAL||0} | ${g.WRONG_SOURCE||0} | ${g.MISCLASSIFIED||0} | ${g.INCONCLUSIVE||0} |`; }), '',
  '## Resultados individuais (60)', '',
  '| # | resource_id | Disciplina | Sem. | Título | Histórico | Resultado | Evidência (trecho comparado) | Justificativa |', '|---:|---|---|---:|---|---|---|---|---|',
  ...registros.map((r, i) => `| ${i+1} | ${r.resource_id} | ${r.course_id} | ${r.week} | ${String(r.title).replace(/\|/g,'\\|').slice(0,70)} | ${r.status_historico} | ${r.resultado} | ${r.trecho_comparado.replace(/\|/g,'\\|')} | ${r.justificativa.replace(/\|/g,'\\|')} |`), '',
  '## Limitações', '',
  '- leitores minhabiblioteca/VitalSource com corpo renderizado em iframe (len=0 no DOM): foi possível confirmar a abertura do livro e o pageid, não o texto página a página.',
  '- leitores bvirtual com autorização não concedida (ADM290 S6/S7): INCONCLUSIVE por falha de acesso, sem converter em falha de conteúdo.',
  '- o PDF do CIN200 foi conferido no leitor na p.217 de 266; a verificação do texto completo foi feita por trecho inicial/final e marcadores 217/250, não página a página.',
  '',
  '## Conclusão', '',
  'Os 30 recursos integrais amostrados são fiéis à fonte (hash idêntico). Entre os 7 parciais, 1 é correto porém incompleto, 1 contém o capítulo correto e 5 contêm conteúdo de outra origem (página 404 ou texto de interface do AVA). Entre os 23 sem arquivo, 21 têm fonte acessível no AVA (classificação histórica incompatível) e 2 permanecem inconclusivos por falta de autorização no leitor.',
].join('\n');
fs.writeFileSync(path.join(OUT, 'AUDITORIA_FASE22', 'RELATORIO_FASE22.md'), md);
console.log(`fase22: total=${registros.length} estados=${JSON.stringify(porEstado)}`);
