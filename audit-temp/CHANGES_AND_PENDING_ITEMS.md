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

---

# Rodada follow-up — commit 053ffc6 (2026-11-05/06)

## 6. Lacunas resolvidas (Issue A/B) e entrega

A revisão independente apontou duas lacunas, resolvidas nesta rodada (sem reescrever
as correções anteriores; comportamento conservador preservado):

1. **Issue A — integração estrutural EPUB na produção**:
   - `epub-structure.js`: parsing por **string XML** (`parsePackageFromXml`,
     `parseOpfFromXml`, `navFromNcxXml`) para o pacote servido por URL, e
     `validateChapterExtraction` tolerante a basename (id do spine OU href).
   - `books.js`: `fetchEpubPackageFromReader` (fetch same-origin do OPF/nav no frame
     de conteúdo jigsaw), `applyEpubStructuralValidation` (decisão pura) e passo 3.5
     do `extractEpub`: quando o pacote está acessível, a **estrutura decide** o
     limite; a navegação ao capítulo seguinte fica como mecanismo complementar.
   - Teste de integração (contrato extração×validação estrutural): **6/6 PASS**.
2. **Issue B — sincronização pageid (página exibida × frame)**:
   - Identidade de página do frame na **URL/src** (`jigsaw.../books/<id>/pageid/N` ou
     `pages/N/content`); topo da janela excluído (`isPageidContentFrame`, B-9).
   - `extractPageidViaSync` + `syncCaptureFrame`: captura estado, navega, espera
     mudança verificável da página, espera o frame correspondente atualizar o
     conteúdo (hash ≠ anterior) e captura só após a confirmação de identidade;
     conteúdo antigo / sem frame / múltiplos candidatos → rejeição conservadora.
   - Testes de integração com leitor simulado realista, cobrindo as 8 tabelas do
     follow-up, incl. as **corridas** (interface 46 × frame ainda 45, e inversa):
     **8/8 PASS**.
3. **Issue C**: `m3-criteria.js` e `statusForBook()` preservados; só o caso B-9
   adicionado à regressão.

## 7. Testes executados nesta rodada

| Suíte | Resultado |
|---|---|
| `poc/test-regression-m3.js` (sintética A/B/C/D) | **29/29 PASS** |
| `poc/test-integration-m3.js` (A estrutural + B sincronização) | **14/14 PASS** |
| `poc/test-module3.js` (real no AVA) | sem validação live nesta rodada (leitor VitalSource intermitente; resultados honestos `inaccessible`/`not_found` quando o conteúdo não monta) |

## 8. Pendências / limitações (follow-up)

- **Validação live do caminho de pacote EPUB e do mecanismo de sincronização**:
  não declarada nesta rodada — o leitor real montou conteúdo de forma intermitente
  (limite de sessão/dispositivos do VitalSource). Coberta deterministicamente por
  testes de integração com leitor simulado realista; recomenda-se revalidação em
  momento com sessão estável e em outra disciplina/semana.
- **`fetchEpubPackageFromReader`** depende de o leitor abrir o frame `epub/OEBPS/Text/`
  (modo EPUB). Quando o VitalSource abre o livro em modo pageid, o caminho de pacote
  não é usado e o limite vem da navegação complementar — comportamento correto e
  documentado.
- Demais pendências da rodada anterior permanecem (Etapas 4/5, purga do histórico,
  validação do executável portable).

## 9. Entrega Git

- Commit 1 (Issue A — EPUB estrutural): `src/extract/epub-structure.js` + fiação em
  `src/extract/books.js`.
- Commit 2 (Issue B — sincronização pageid): `src/extract/books.js`.
- Commit 3 (testes e documentação): `poc/test-integration-m3.js`,
  `poc/test-regression-m3.js`, `poc/probe-sync.js`, `audit-temp/IMPLEMENTATION_RESULTS.md`,
  `REGRESSION_RESULTS.md`, `CHANGES_AND_PENDING_ITEMS.md`, `INTEGRATION_RESULTS.json`.
- Histórico **não** reescrito. Hashes completos informados na resposta final.
