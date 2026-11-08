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

---

# Rodada Fase 3 — consolidação definitiva (2026-11-06)

## 10. Correções desta rodada

- **EPUB 3/nav.xhtml**: parser próprio (`navFromNavHtml`, `collectNavList`),
  `nav[epub:type="toc"]`, hierarquia, caminhos relativos ao arquivo nav, fragmentos
  removidos, landmarks ignorados; EPUB 2/NCX preservado.
- **EPUB identidade/sincronização**: `extractEpubViaAdapter` (orquestração por
  adaptador) revalida identidade+texto após cada navegação; navegação só vale se o
  documento mudou; `epubDocPathFromUrl`, `navigateEpubNextDoc`, `waitEpubDocChange`.
- **EPUB multi-XHTML**: captura de todos os docs do capítulo (dedup por caminho
  resolvido); `extractedDocIds` completo; doc ausente → `partial`.
- **EPUB colisões de basename**: comparação por caminho resolvido; basename só se
  único no spine.
- **EPUB limites**: fallback de navegação não confirma quando o pacote está
  disponível mas o limite não é confirmável.
- **PAGEID zero**: verificações `== null` (pageid 0/páginas 0 válidos);
  `parsePageidFrameIdentity` trata NaN/negativos.
- **PAGEID contrato de sincronização**: `syncCaptureFrame` usa `expectedState`,
  descarta tentativas inconsistentes (Caso C/D, `discardedCount`) e revalida após a
  captura; seleção de frame por identidade de URL (sinal confiável), CSS auxiliar.

## 11. Testes — resultados reais

| Suíte | Arquivo | Resultado |
|---|---|---|
| Regressão sintética (A/B/C/D) | `poc/test-regression-m3.js` | **29/29 PASS** |
| Integração (A estrutural + B sincronização) | `poc/test-integration-m3.js` | **14/14 PASS** |
| **Produção (EPUB 2/3 + PAGEID)** | `poc/test-production-m3.js` | **19/19 PASS** |
| **Total** | | **62/62 PASS** |
| Real no AVA (smoke) | `poc/test-module3.js` | 2026-11-06: VitalSource não montou conteúdo (`inaccessible`/`leitor-nao-carregou`) — **sem validação live declarada** |

## 12. Pendências / limitações (Fase 3)

- **Validação real no AVA/VitalSource**: pendente — o leitor não montou conteúdo
  nesta sessão (limite de sessão/dispositivos). Não é falha de implementação
  corrigível localmente; será registrada separadamente quando o acesso estiver
  estável (recomenda-se outra disciplina/semana).
- **`fetchEpubPackageFromReader`** depende do modo EPUB do leitor; em modo pageid o
  caminho de pacote não é usado e o limite vem da navegação complementar
  (comportamento correto e documentado).
- Demais pendências permanecem (Etapas 4/5, purga do histórico `8742012`, validação
  do executável portable).

## 13. Entrega Git (Fase 3)

- Commit 1 — `fix: support EPUB 3 navigation` (`epub-structure.js`).
- Commit 2 — `fix: synchronize EPUB document identity and extraction` (`books.js` EPUB).
- Commit 3 — `fix: validate multi-document EPUB chapters` (`books.js` EPUB multi-doc/limites).
- Commit 4 — `fix: synchronize PAGEID frame capture` (`books.js` PAGEID zero/contrato/corridas).
- Commit 5 — `test: cover production EPUB and PAGEID extraction` (`test-production-m3.js` + artefatos JSON).
- Commit 6 — `docs: consolidate phase 3 validation evidence` (IMPLEMENTATION_RESULTS, REGRESSION_RESULTS, CHANGES_AND_PENDING_ITEMS).
- Histórico **não** reescrito. Hashes completos na resposta final.

---

# Rodada follow-up da revisão (2026-11-06)

## 14. Correções do follow-up

- **`fetchEpubPackageFromReader`**: separa `ncxXml`/`navHtml` (sem sobrescrita) e
  entrega ao parser os campos corretos; núcleo `fetchEpubPackageFromFetcher` (DI).
- **Descoberta de navegação pelo manifest**: `parseOpfFromXml` preserva
  `properties` + `<spine toc>`; `discoverNavTargets` localiza NCX/nav.xhtml por
  metadados (não por nomes fixos); resolução relativa ao diretório do OPF e do
  arquivo de navegação; OPF pode estar fora da raiz de OEBPS (`candidateOpfDirs`).
- **`parsePackageFromXml`/`navFromNavHtml`/`collectNavList`**: percorre apenas
  filhos diretos (sem duplicar listas aninhadas); `ncxBase`/`navBase` para
  subdiretórios.
- **PAGEID `syncCaptureFrame`**: exige estado EXPLÍCITO/estável quando
  `expectedState.pageid` está disponível — estado ausente NÃO confirma captura.
- **Sanitização na geração**: `PRODUCTION_RESULTS.json` e `ADAPTERS_RESULTS.json`
  substituem caminhos locais por `<TEMP>` na própria geração.

## 15. Testes — follow-up (4 suítes, 97/97)

| Suíte | Arquivo | Resultado |
|---|---|---|
| Regressão sintética (A/B/C/D) | `poc/test-regression-m3.js` | **29/29 PASS** |
| Integração (A estrutural + B sincronização) | `poc/test-integration-m3.js` | **14/14 PASS** |
| Produção (EPUB 2/3 + PAGEID) | `poc/test-production-m3.js` | **19/19 PASS** |
| **Adaptadores** | `poc/test-adapters-m3.js` | **35/35 PASS** |
| **Total** | | **97/97 PASS** |
| Real no AVA (smoke) | `poc/test-module3.js` | leitor não montou conteúdo — **sem validação live declarada** |

Níveis de teste (relatório): (1) unitários — `test-adapters-m3.js` A-*; (2)
orquestração com mocks — `test-production-m3.js` E-*/P-*; (3) adaptadores com
fixtures — `test-adapters-m3.js` B-*/C-*/D-* (fetchEpubPackageFromFetcher,
readPageidFrames, createEpubReaderAdapter); (4) DOM/Electron — não usado
(fixtures de DOM/frames simulados; NÃO equivalem a validação real); (5) validação
real AVA/VitalSource — não declarada (registrada separadamente).

## 16. Pendências / limitações (follow-up)

- **Validação real no AVA/VitalSource**: continua pendente (leitor não montou
  conteúdo; limite de sessão/dispositivos). Não é corrigível localmente; registrada
  separadamente quando o acesso estiver estável.
- **DOM/Electron real**: os testes de adaptadores usam fixtures de DOM/frames
  simulados — não equivalem a validação no Electron/VitalSource.
- **`fetchEpubPackageFromReader`** depende do modo EPUB do leitor; em modo pageid o
  pacote não é usado (limite via navegação complementar) — correto e documentado.
- Demais pendências permanecem (Etapas 4/5, purga do histórico `8742012`, validação
  do executável portable).

## 17. Entrega Git (follow-up)

- Commit 1 — `fix: connect EPUB3 navigation to package fetching`
  (`epub-structure.js` + `books.js` fetch do pacote + `parsePackageFromXml`).
- Commit 2 — `test: cover real EPUB package reader adapter`
  (`poc/test-adapters-m3.js` A/B/C + `ADAPTERS_RESULTS.json`).
- Commit 3 — `fix: reject unverified PAGEID reader state` (`books.js` syncCaptureFrame).
- Commit 4 — `test: cover PAGEID frame collection adapter`
  (`poc/test-adapters-m3.js` D + artefatos).
- Commit 5 — `chore: sanitize phase 3 evidence` (`test-production-m3.js` +
  `PRODUCTION_RESULTS.json` + docs).
- Histórico **não** reescrito. Hashes completos na resposta final.

---

# Rodada auditoria consolidada (2026-11-07)

## 18. Plano de remediação do HISTÓRICO (S2) — NÃO EXECUTADO (depende do proprietário)

Blobs com conteúdo protegido (texto integral de livros) ainda acessíveis pelo
histórico (introduzidos em `8742012`, removidos do HEAD em `d6cf122`):

| Arquivo | Blob | Bytes |
|---|---|---|
| poc/evidence/module3/result.json | 6200a6c7733393b37980193630ee54300283b450 | 160.458 |
| poc/evidence/test-A/result.json | 6e9d4f581f38e9e8e01d49e2843a5bd62331a6cc | 4.104 |
| poc/evidence/test-B/result.json | 0c516326826f01c6f923a2207f5e5a13719ebc1d | 2.285 |
| poc/evidence/test-C/result.json | 3d736b9da6caf69bfc655a045ca22e325cfe7594 | 3.947 |
| poc/evidence/test-D/result.json | 0ad05d6d466a48af6ce4202afca197c6ffc6cd14 | 869 |
| poc/evidence/test-e2e/result.json | 57a4d2732d336d49ec4cc2adfab86fb1eb0fb0cb | 715 |

Procedimento recomendado (não executado): reescrita de histórico (ex.
`git filter-repo --path poc/evidence/... --invert-paths`) em cópia nova,
re-verificação de credenciais/blob, atualização do remote e forçar push a partir
da cópia corrigida — com impacto em forks/clones (história anterior permanece
onde já foi clonada). Recomenda-se também tornar o repositório privado
temporariamente até a limpeza. Requer autorização expressa do proprietário
(regras da rodada: não reescrever histórico, não force-push).

## 19. Pendências separadas

- TÉCNICAS: nenhuma pendência de código desta rodada; validação real do
  VitalSource (EPUB/pageid) continua dependente de sessão estável.
- DECISÕES DO PROPRIETÁRIO: (1) autorizar limpeza do histórico (seção 18);
  (2) avaliar troca de senha caso a regra descrita no antigo comentário seja
  reconhecida; (3) decidir privacidade do repositório.
- VALIDAÇÃO LIVE: não executada nesta rodada (regra da rodada). Deve ser tentada
  em tarefa separada, com login manual legítimo e sessão estável, registrando
  estado real (integral/partial/inaccessible/not_found). Não contornar restrições.
- FASE 4: integração dos módulos ao fluxo final do Electron fora do escopo desta
  rodada (planejada para outra etapa).

## 20. Conclusão da rodada

Todos os critérios de aceitação (seção 9) atendidos: segurança (sem credencial
literal/comentário de regra; cookies por domínio/host-only/path/Secure/expiração;
redirect cross-origin sem credenciais; sem conteúdo protegido novo), VitalSource
(1 launch, sem goto redundante, zero retries após reader-auth, máx 1 relaunch,
failureType diferenciado), perfil (temporário isolado + limpeza normal/residual
testada), extração (hierarquia EPUB3 sem duplicação; identidade PAGEID validada
antes/depois com descarte de corrida), build/testes (legado fora do pacote; npm
test funcional; 125/125; critérios de integral preservados). Histórico NÃO
reescrito; nenhuma força de push. Hashes completos na resposta final.

---

# Rodada INTEGRAÇÃO — app integrado (missão de implementação, 2026-11-07/08)

## 21. Resumo da rodada

Saiu da PoC fixa para um aplicativo integrado: login MANUAL, descoberta dinâmica
de disciplinas/semanas/recursos, extração com os Módulos 1-3 existentes e ZIP
validado no destino escolhido via `dialog.showSaveDialog`. Nenhuma credencial é
usada no app final; env explícito para o processo auxiliar; perfil temporário com
lock de propriedade (OWNER.json + PID); logs sanitizados.

## 22. O que foi implementado

- **`electron/flow.js` (novo)**: orquestração do fluxo — login manual aguardado,
  descoberta de disciplinas/semanas/recursos (parsers puros de
  `electron/discovery.js`), extração delegada aos Módulos 1-3, status honesto
  (`concluído` / `concluído com pendências` / `falhou`), estrutura acadêmica do
  ZIP (INDEX/AI_STUDY_INSTRUCTIONS/EXTRACTION_REPORT/SOURCES + semanas) e ZIP com
  validação (existe, >0, abre como ZIP, nº de entradas == nº de arquivos).
- **`electron/main.js` (reescrito)**: instância única (B1, apenas principal;
  `browser.js` auxiliar não é bloqueado), login manual (A1), IPC do fluxo,
  `dialog.showSaveDialog` para o destino do ZIP (A6), log sanitizado (B4),
  `will-quit` com limpeza do perfil.
- **`electron/env.js` (novo)**: `buildAuxEnv()` — env EXPLÍCITO para o processo
  auxiliar (nunca `process.env` inteiro).
- **`electron/browser.js`**: janela VISÍVEL do AVA; login manual; sem credenciais.
- **`electron/discovery.js` (novo)**: parsers puros de disciplinas/semanas/recursos
  + classificação (A2/A3/A4/A5), com id curto/estável por recurso.
- **`electron/log.js` (novo)**: log sanitizado (query strings removidas,
  retenção/rotação, sem credenciais/cookies/conteúdo).
- **`electron/profile.js`**: já possuía lock de propriedade (OWNER.json + PID),
  validação de caminho e abort se `setPath` falhar (B2/B3) — coberto por testes.
- **`src/extract/books.js`**: C1 (navigateEpubNextDoc captura identidade ANTES do
  clique), C2 (readEpubActiveDocument vincula ao documento ativo/ambíguo), C3
  (syncCaptureFrame aceita `pages/N/content` com pageid null), C4 (limite
  maxDocAdvances registrado e nunca tratado como fim natural).
- **`package.json`**: script `test:live` (harnesses autorizados fora do `npm test`).
- **`poc/`**: novas suítes determinísticas (discovery, módulos 1/2, fidelidade C,
  fluxo Electron) + testes ampliados do perfil.
- **`README.md`, `LICENSE`, `.github/workflows/ci.yml`** (D4).

## 23. Tabela de validação

| Item | Teste automatizado | Electron real | AVA real | Evidência |
|---|---|---|---|---|
| A1 login manual (sem credenciais no app) | ✔ (isLoggedIn/waitForManualLogin) | ✔ (fluxo implementado) | — (não executado live) | test-electron-flow-m3.js |
| A2 descoberta de disciplinas | ✔ (D-1) | ✔ (parsers puros usados no fluxo) | — | test-discovery-m3.js |
| A3 descoberta de semanas | ✔ (D-2) | ✔ | — | test-discovery-m3.js |
| A4 integração dos módulos | ✔ (fluxo delega a pages/pdfs/books) | ✔ (implementado) | — | flow.js + testes |
| A5 vídeos (link/metadados/transcrição) | ✔ (D-3 classificação video) | ✔ | — | test-discovery-m3.js |
| A6 ZIP destino escolhido + validação + estados | ✔ (D-4/D-5) | ✔ (dialog no main) | — | test-discovery-m3.js |
| A7 estrutura do ZIP | ✔ (D-5) | ✔ | — | test-discovery-m3.js |
| B1 instância única (principal vs auxiliar) | ✔ (main.js; aux não bloqueado) | ✔ | — | main.js |
| B2 propriedade/lock do perfil | ✔ (E-7/8/9) | ✔ | — | test-electron-profile-m3.js |
| B3 validação de caminho + abort setPath | ✔ (E-10/11) | ✔ | — | test-electron-profile-m3.js |
| B4 logs sanitizados | ✔ (log.js; rotação/retenção) | ✔ | — | electron/log.js |
| C1 corrida EPUB | ✔ (C-1/C-1b) | — | — | test-c-fidelity-m3.js |
| C2 documento ativo EPUB | ✔ (C-2/C-2b) | — | — | test-c-fidelity-m3.js |
| C3 PAGEID pages/N/content | ✔ (C-3) | — | — | test-c-fidelity-m3.js |
| C4 limites configuráveis | ✔ (C-4/C-4b) | — | — | test-c-fidelity-m3.js |
| C5 presença x integridade (pages/pdfs) | ✔ (M1-*/M2-*) | — | — | test-modules12-m3.js |
| D1 testes determinísticos M1/M2 | ✔ | — | — | test-modules12-m3.js |
| D2 fluxo Electron/IPC | ✔ (mocks; Electron real não executado) | — | — | test-electron-flow-m3.js |
| D3 npm test | ✔ (11 suítes; falha se qualquer falhar) | — | — | scripts/test-all.js |
| D4 README/LICENSE/CI | ✔ | — | — | README/LICENSE/ci.yml |

Nota: itens marcados "Electron real: —" foram validados por fixture/mocks
determinísticos; a validação com Electron real e AVA real NÃO foi executada nesta
rodada (não bloquear os testes determinísticos).

## 24. Testes

- Comando: `npm test` (equivalente: `node scripts/test-all.js`).
- Suítes executadas: **11**.
- Resultado: **157/157 PASS** (0 falhas), saída com contagens por suíte.
- Suítes: regression 29, integration 14, production 19, adapters 40,
  orchestration 8, http-security 15, electron-profile 11, discovery 5,
  modules12 4, c-fidelity 7, electron-flow 5.
- Não executados: testes live (`npm run test:live`) — exigem AVA/VitalSource reais.
- Limitação do ambiente: validação com Electron real e AVA real não executada.

## 25. Segurança

- Aplicativo final sem credenciais (nenhum `UNIVESP_USERNAME/PASSWORD` em
  `electron/*` do fluxo final; existem apenas nos harnesses `poc/test-module*.js`).
- Env explícito para o processo auxiliar (nunca `process.env` inteiro).
- Sem conteúdo acadêmico protegido em arquivos novos versionados (fixtures
  sintéticas; resultados sanitizados com `<TEMP>`).
- Sem cópias persistentes automáticas fora do destino escolhido pelo estudante.
- Perfis temporários com lock de propriedade (OWNER.json + PID), validação de
  caminho real com `os.tmpdir()` e abort se `app.setPath` falhar.
- Logs sanitizados (query strings removidas, retenção/rotação).
- Histórico Git NÃO reescrito; nenhuma força de push; visibilidade inalterada.

## 26. Pendências (fora de escopo desta rodada)

- Módulo 4 (transcrição/extração de vídeo): registra links/metadados; não extrai.
- Melhorias adicionais do cliente HTTP legado `src/lib/http.js` (fora do pacote).
- Purga/reescrita do histórico Git (depende do proprietário).
- Validação live do VitalSource e do AVA real (executar com `npm run test:live`).
- Validação do executável portátil em Windows 10/11 (não declarada nesta rodada).

## 27. Conclusão

Aplicativo integrado implementado (A1-A7, B1-B4, C1-C5, D1-D4). O app não exige
credenciais por variável de ambiente, espera o login manual, descobre
disciplinas/semanas dinamicamente, permite seleção, chama os módulos existentes e
gera ZIP validado no destino escolhido com status honesto. Testes determinísticos:
**157/157**. Projeto **parcialmente concluído** quanto à validação real (AVA e
VitalSource e executável portátil não validados nesta rodada) — conforme
documentado; nenhum item foi declarado validado em ambiente real sem ter sido.
