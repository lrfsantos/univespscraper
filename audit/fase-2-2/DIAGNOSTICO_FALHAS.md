# Diagnóstico consolidado da Fase 2.2 (por tipo de falha)

Consolidação dos achados observados no AVA; nenhum extrator foi corrigido, nenhum registro histórico foi alterado.

## Semântica corrigida

O relatório da Fase 2.2 usou MISCLASSIFIED para 21 recursos sem arquivo cuja fonte abriu no clique. Isso **não** prova erro de classificação histórica: disponibilidade da fonte e resultado da extração são coisas distintas.
Nesta consolidação esses 21 casos passam a `SOURCE_AVAILABLE` (campo `resultado_fase22` preserva o rótulo original para rastreabilidade) e o campo `disponibilidade_fonte` registra o que foi efetivamente observado. Nenhum foi reclassificado no inventário.

## Estados (60)

- INCONCLUSIVE: 2
- PARTIAL: 2
- PASS: 30
- SOURCE_AVAILABLE: 21
- WRONG_SOURCE: 5

## Diagnóstico por tipo de falha (hipóteses de causa, não correções)

As categorias são hipóteses e PODEM SE SOBREPOR: os 5 casos de navegação também aparecem entre os de seleção de leitor. Não some as contagens abaixo como se fossem recursos distintos — há 60 recursos no total. Manual de Oslo está apenas em `fonte-errada`, não em captura de interface.

### captura-interface — Captura de interface (5 casos comprovados)
- Critério: O arquivo contém instruções da UI do AVA em vez do material solicitado.
- Casos: 4
- Evidência: D18491: "Clique em ... para abrir o recurso." (67-78 chars) enquanto o clique abre YouTube e livros no minhabiblioteca.
- Investigação futura: Investigar o seletor de escopo usado em recursos URL (capturou a página do AVA, não o destino).

### fonte-errada — Fonte errada (1 caso comprovado)
- Critério: O arquivo contém conteúdo de outro documento, não o material aberto pelo clique.
- Casos: 1
- Evidência: Arquivo com "404 / Página não encontrada / Ir para Home"; clique abre PDF válido (HTTP 200, application/pdf, 763338 bytes).
- Investigação futura: Investigar a URL baixada pelo extrator: houve divergência entre o link da UI e o recurso obtido.

### cobertura-incompleta — Cobertura incompleta (2 casos)
- Critério: O arquivo corresponde à fonte, mas não cobre integralmente o escopo solicitado.
- Casos: 2
- Evidência: ADM210: só a página de título; CIN200: capítulo 217-250 correto, sem verificação página a página.
- Investigação futura: Investigar paginação/seleção de páginas dos leitores.

### erro-navegacao — Erro de navegação (5 casos, hipótese)
- Critério: O clique abre a tela de escolha de formato do Biblioteca Virtual, sem entrar no leitor.
- Casos: 5
- Evidência: Leitor publicação 3789 mostra "Escolha o formato desejado" com páginas PDF corretas (22, 134, 199, 217, 107).
- Investigação futura: Investigar a etapa pós-clique (seleção PDF/EPUB) no adaptador bvirtual.

### selecao-leitor — Seleção de leitor / autorização (casos de leitor, hipótese)
- Critério: O leitor abre, mas o conteúdo não foi obtido na execução histórica; 2 casos permanecem sem autorização.
- Casos: 14
- Evidência: ADM290: not-authorized / validando autorização. ADM270: leitor beta; CIN200 e ADM220: livros abertos sem texto no DOM.
- Investigação futura: Investigar adaptadores de leitor e credenciais; não corrigir durante a auditoria.

### lacuna_metadados_tipo_historico — Lacuna de metadados de tipo no histórico (30 casos verificados)
- Critério: Não é falha de extração: o tipo estruturado não foi preservado nas execuções históricas (todos os 30 PASS têm detected_type=unknown).
- Casos: 30
- Evidência: INVENTARIO.json: detected_type=unknown para os 30; o novo RECORDS.json passou a gravar kind.
- Investigação futura: Nada a corrigir no passado: informação não preservada. Próximas execuções já registram o tipo.

## Hashes dos 30 PASS (valores presentes no JSON)

Os 30 registros PASS em DIAGNOSTICO_FALHAS.json contêm `hash_fonte` e `hash_extraido` com os valores SHA-256 reais (iguais), além de `hash_comparacao`. O script valida automaticamente que os dois campos existem, não estão vazios, são SHA-256 válidos (64 hex) e são iguais em cada PASS; também confere que captura-interface tem exatamente 4 casos e que Manual de Oslo permanece em fonte-errada.

## Limitações da amostra (devem acompanhar qualquer conclusão)

- Os 30 PASS são todos `detected_type=unknown` e concentrados na semana 1: provam fidelidade dessas páginas, não dos leitores de livro, PDF, EPUB ou vídeo.
- Minha Biblioteca / VitalSource renderizam o conteúdo em iframe: confirmei a abertura e o pageid, não o texto integral.
- CIN200 (PDF, p.217-250): conferido o início/fim e os marcadores 217/250, não todas as páginas individualmente.
- ADM290 S6/S7: leitor sem autorização; INCONCLUSIVE, sem converter falha de acesso em falha de conteúdo.
- 441 testes são resultado local informado, não validação de CI confirmada.

## Conclusão

Achados comprovados: 5 arquivos com conteúdo errado (1 página 404, 4 capturas de interface), 2 parciais, 30 páginas fiéis por hash. Os 21 casos sem arquivo exigem investigação adicional; disponibilidade da fonte não é evidência de sucesso ou erro da extração histórica. A amostra não autoriza generalizar a fidelidade dos leitores.