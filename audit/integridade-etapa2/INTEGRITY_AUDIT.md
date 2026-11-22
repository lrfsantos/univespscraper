# Integridade — Fase 2.1 (automatizada)

Verificação automatizada sobre os 468 registros do inventário — sem acesso ao AVA.

## Contagem

- PASS: 468 | MISCLASSIFIED: 0 | INCONCLUSIVE: 0 (de 468)

## Problemas

- Arquivos ausentes: 0
- Arquivos vazios: 0
- Arquivos ilegíveis: 0
- Estrutura (semana/disciplina) errada: 0
- Conteúdo idêntico em registros distintos: 0 (hashes repetidos; pode ser legítimo — material repetido no AVA — sinalizado sem deduzir)
- Classificação incoerente com evidência: 0

## Amostra da Fase 2.2

Seleção estratificada determinística em SAMPLE_SELECTION.json: 60 registros.
- integral: alvo 30, selecionados 30 (>=3 por disciplina, distribuição round-robin por resource_id)
- partial: alvo 7, selecionados 7 (todos os casos)
- failed: alvo 12, selecionados 12 (cobrir causas/leitores distintos, round-robin)
- unclassified: alvo 11, selecionados 11 (distribuídos entre disciplinas/semanas, round-robin)

NOTA: falha de acesso NÃO foi convertida em no_text. A comparação de CONTEÚDO com a fonte original (Fase 2.2/2.3) requer novo acesso ao AVA e ainda não foi executada.