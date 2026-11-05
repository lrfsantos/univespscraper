# Alterações e itens pendentes — continuação da auditoria do Módulo 3

> Data: 2026-11-05. Resumo dos commits desta rodada, problemas corrigidos e pendências para revisão independente.

## 1. Correções de código aplicadas nesta rodada

1. **`src/extract/books.js`**
   - `statusForBook` agora exige **evidência positiva** de `startOk`, `midOk`, `endOk`, `chapterOk` (quando esperado), zero repetições e zero avisos para `integral` (antes dependia indiretamente de `warnings`). `expected` passado às chamadas.
   - Instrumentação `opts.trace` em `extractPageid` (sha256 por página, contagens, fragmentos ≤40 chars) — sanitizada, para diagnóstico/reprodução.
2. **`poc/diag-hisrich.js`** (novo): diagnóstico da discrepância Hisrich com trace sanitizado → `audit-temp/HISRICH_TRACE.json`.
3. **Remoção da sumarização legada** (regra "não resumir"): `src/scraper.js` não chama mais `summarizeVideo` (mantém transcrições); **`src/lib/summarize.js` excluído** (órfão + incompatível); texto de ajuda do `src/cli.js` ajustado.
4. **Dependência corrigida**: `require('playwright')` → `require('playwright-core')` em `src/lib/auth.js`, `src/lib/discover.js`, `src/lib/books.js` (legado) e `poc/lib/session.js` (carregam sem `MODULE_NOT_FOUND`).
5. **Segurança/versionamento**: `git rm --cached` dos `poc/evidence/**/result.json` rastreados (política `.gitignore`); redação do valor da senha de teste no `docs/AUDIT_2026-11-05.md`.

## 2. Relatórios em `audit-temp/`

- `audit-temp/HISRICH_TRACE.json` — trace sanitizado (sha256 por página, contagens).
- `audit-temp/HISRICH_COMPARISON.md` — explicação da discrepância 365.625 × 104.066.
- `audit-temp/MODULE3_AUDIT.md` — revisão de `books.js` + `test-module3.js`.
- `audit-temp/SECURITY_REVIEW.md` — segurança e histórico do Git.
- `audit-temp/PACKAGING_REVIEW.md` — empacotado × integrado × pendente.
- `audit-temp/TEST_RESULTS.md` — testes executados e resultados.

## 3. Itens pendentes (para revisão independente / decisão do usuário)

1. **Histórico contém texto integral de livro licenciado**: commit `8742012` incluiu `poc/evidence/module3/result.json` (removido da árvore em `d6cf122`, mas **permanece no histórico**). Decisão pendente: purgar histórico (ex.: `git filter-repo`) se o repositório for público. **Não reescrevi o histórico** (regra).
2. **Integração dos módulos 1–3 no fluxo real do app** (Etapa 4/5): hoje empacotados, porém usados apenas pelos harnesses; `electron/main.js` ainda usa a PoC `run-poc.js`. Não é escopo desta rodada (exigiria mudança arquitetural — documentado em `PACKAGING_REVIEW.md`).
3. **Validação do executável portable** em máquina sem política WDAC (ambiente) — pendente.
4. **Legado `src/lib/books.js`, `src/lib/auth.js`, `src/lib/discover.js`, `src/cli.js`/`scraper.js`**: agora carregam com `playwright-core`, mas exigem binário de Chromium para executar (harness legado, substituído pelos testes Electron). Não removidos (fora de escopo; documentados).
5. **`pageid`: rótulo de página impressa aproximado** (sobre-inclusão do início do capítulo seguinte no último bloco) — limitação documentada, não bloqueia `integral` com evidência de faixa.

## 4. Limitações que impedem aprovação do Módulo 3

- O Módulo 3 foi validado em **um curso/uma semana (ADM270 S1)** — não prova funcionamento universal (regra da auditoria). Recomenda-se validação adicional em ao menos outra disciplina/semana.
- Rótulo de página impressa aproximado (pageid) e variabilidade de chars entre execuções (Δ ≤0,6%) — documentados.
- Integração no fluxo real do app e UI ainda pendentes (Etapas 4/5).

## 5. Decisão solicitada

- Autorização (ou não) para **purgar o histórico** do texto licenciado de `8742012`.
- Aprovação (ou não) do Módulo 3 para avançar ao Módulo 4.
