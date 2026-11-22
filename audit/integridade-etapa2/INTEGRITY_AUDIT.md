# Integridade — Fase 2.1 (automatizada)

Verificação automatizada sobre os 468 registros do inventário — sem acesso ao AVA.

## Estados (resultado de integridade separado do resultado de classificação)

- PASS (verificações aplicáveis passaram): 336
- FAIL (problema verificável): 0
- NOT_APPLICABLE (sem arquivo esperado — falha de acesso): 98
- INCONCLUSIVE (evidência insuficiente): 34

## Problemas

- Arquivos esperados ausentes: 0
- Arquivos vazios: 0
- UTF-8 inválido (decodificação estrita): 0
- Estrutura (semana/disciplina) errada: 0
- Tamanho menor que o declarado: 0
- Mesmo arquivo atribuído a dois registros: 0
- Conteúdo idêntico em registros distintos (ALERTA, não reprovação — pode ser material repetido no AVA): 0

## Amostra da Fase 2.2

Seleção estratificada determinística em SAMPLE_SELECTION.json: 60 registros (com título, motivo e evidência de cada selecionado).
- integral: alvo 30, selecionados 30 (>=3 por disciplina, distribuição round-robin por resource_id)
- partial: alvo 7, selecionados 7 (todos os casos)
- failed: alvo 12, selecionados 12 (cobrir causas/leitores distintos, round-robin) — causas cobertas: 6
- unclassified: alvo 11, selecionados 11 (distribuídos entre disciplinas/semanas, round-robin)

NOTA: falha de acesso NÃO foi convertida em no_text nem contabilizada como conteúdo íntegro. A comparação de CONTEÚDO com a fonte original (Fase 2.2/2.3) requer novo acesso ao AVA e ainda não foi executada.