# Reconciliação dos recursos (resultado corrigido)

Gerado por `poc/reconcile.js` a partir das execuções existentes — sem novo acesso ao AVA.
Histórico preservado: os QUALITY.md originais não foram alterados.

## Totais reconciliados

- Total: 468
- integral: 329 | partial: 7 | no_text: 0 | failed: 98 | unclassified: 34

- Registros sem URL sanitizada: 425 de 468 — as URLs só foram registradas para as falhas (APRENDIZADO.json); recursos integrais não têm URL preservada no histórico.

## Por disciplina

| Disciplina | Total | integral | partial | no_text | failed | unclassified |
|---|---:|---:|---:|---:|---:|---:|
| ADM210 | 60 | 34 | 1 | 0 | 17 | 8 |
| ADM220 | 47 | 31 | 0 | 0 | 9 | 7 |
| ADM230 | 45 | 29 | 0 | 0 | 8 | 8 |
| ADM270 | 57 | 29 | 1 | 0 | 23 | 4 |
| ADM290 | 35 | 33 | 0 | 0 | 2 | 0 |
| CIN200 | 38 | 27 | 1 | 0 | 8 | 2 |
| D18491 | 51 | 40 | 4 | 0 | 7 | 0 |
| D18539 | 47 | 37 | 0 | 0 | 5 | 5 |
| D18554 | 45 | 41 | 0 | 0 | 4 | 0 |
| SOC200 | 43 | 28 | 0 | 0 | 15 | 0 |

## Por tipo detectado

| Tipo | Total | integral | partial | failed | no_text | unclassified |
|---|---:|---:|---:|---:|---:|---:|
| bvleitor | 4 | 0 | 0 | 4 | 0 | 0 |
| bvpdf | 45 | 0 | 0 | 45 | 0 | 0 |
| pdf | 7 | 5 | 2 | 0 | 0 | 0 |
| reader | 15 | 0 | 0 | 15 | 0 | 0 |
| unknown | 397 | 324 | 5 | 34 | 0 | 34 |

## Problemas detectados

- IDs de recurso duplicados (colisão de identificador): 0
- Duplicatas (mesma disciplina+semana+titulo, sem deduplicação automática): 0
- Arquivos de saída ausentes: 0
- Divergências de contadores antigos x reconciliados: 0

## Separação de resultados

- HISTÓRICO: o que as 10 execuções efetivamente produziram (QUALITY.md originais, intactos; fonte = linha do QUALITY.md, sem registro bruto estruturado preservado).
- CORRIGIDO: como este consolidado classifica os mesmos registros (5 grupos exclusivos).
- TESTES: cobertura automatizada em `poc/test-reconcile-m3.js` (unidade + integração com fixtures).