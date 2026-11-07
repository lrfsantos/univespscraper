# Resultados de Regressão — Issues A/B/C (Módulo 3)

> Data: 2026-11-05/06. Testes **sintéticos determinísticos** (sem AVA/leitor real) em
> `poc/test-regression-m3.js` — **29/29 PASS**. Nenhum conteúdo protegido é
> gravado: fixtures sintéticas, contagens e hashes sanitizados apenas.
>
> Fase 3 — consolidação (2026-11-06) e auditoria consolidada (2026-11-07):
> produção EPUB/PAGEID em `poc/test-production-m3.js` (**19/19**), integração
> `poc/test-integration-m3.js` (**14/14**), adaptadores `poc/test-adapters-m3.js`
> (**40/40**), orquestração VitalSource `poc/test-orchestration-m3.js` (**8/8**),
> segurança HTTP `poc/test-http-security-m3.js` (**9/9**) e perfil Electron
> `poc/test-electron-profile-m3.js` (**6/6**) — **125/125 no total**. Detalhes em
> `audit-temp/IMPLEMENTATION_RESULTS.md`.

## Resumo

| Issue | Escopo | Casos | Status |
|---|---|---|---|
| A | Fim de capítulo EPUB exige evidência **estrutural** (nunca pontuação) | 6 | 6/6 PASS |
| B | Associação **frame ativo × página** no leitor pageid (inclui exclusão do topo da janela) | 9 | 9/9 PASS |
| C | Critérios de aprovação independentes (integridade exige evidência) | 8 | 8/8 PASS |
| D | Decisão de limite estrutural EPUB (camada de produção, pura) | 6 | 6/6 PASS |
| **Total (regressão sintética)** | | **29** | **29/29 PASS** |
| Integração (A estrutural + B sincronização) | `poc/test-integration-m3.js` | 14 | 14/14 PASS |
| **Produção (EPUB 2/3 + PAGEID)** | `poc/test-production-m3.js` | 19 | 19/19 PASS |
| **Adaptadores** (parsePackage, fetch EPUB, readers) | `poc/test-adapters-m3.js` | 40 | 40/40 PASS |
| **Orquestração VitalSource** | `poc/test-orchestration-m3.js` | 8 | 8/8 PASS |
| **Segurança HTTP** | `poc/test-http-security-m3.js` | 9 | 9/9 PASS |
| **Perfil Electron** | `poc/test-electron-profile-m3.js` | 6 | 6/6 PASS |
| **Total geral** | | **125** | **125/125 PASS** |

Execução: `node poc/test-regression-m3.js` → `audit-temp/REGRESSION_RESULTS.json`;
`node poc/test-integration-m3.js` → `audit-temp/INTEGRATION_RESULTS.json`;
`node poc/test-production-m3.js` → `audit-temp/PRODUCTION_RESULTS.json`;
`node poc/test-adapters-m3.js` → `audit-temp/ADAPTERS_RESULTS.json`.

---

## Issue A — Fim de capítulo EPUB: evidência estrutural, não pontuação

Problema original: o capítulo truncado que **termina em ponto final** era aprovado
como `integral` apenas por terminar em `.` (heurística de pontuação). Corrigido:
a aprovação do fim exige o **limite estrutural** do capítulo (navegação ao capítulo
seguinte com mudança de documento, ou validação do spine quando disponível).

| Caso | Descrição | Resultado |
|---|---|---|
| A-1 | Capítulo completo, limite estrutural identificado | `endOk=true`, `integral-valid` — PASS |
| A-2 | **Reprodução da falsa aprovação antiga**: capítulo truncado terminando em ponto final | heurística antiga aprovava (`.`) → nova reprova (`endOk=false`) — PASS |
| A-3 | Capítulo distribuído em múltiplos XHTML (completo) | `chapterIds=ch01a,ch01b`, `endOk=true` — PASS |
| A-4 | Documento do capítulo seguinte no spine **não é incluído** | `nextIncluded=true`, `endOk=false` — PASS |
| A-5 | OPF ausente/inválido → `partial` (nunca `integral`) | `parse.ok=false` — PASS |
| A-6 | Capítulo solicitado não identificado estruturalmente → `partial` | `boundaryKnown=false`, `reason=capitulo-nao-identificado` — PASS |

Produção: `src/extract/epub-structure.js` (`validateChapterExtraction`,
`findChapterBoundary`) + `src/extract/books.js` (`extractEpub`, passo 4).
Na execução real de 20:38 o Chiavenato deixou de ser o `integral` histórico
(falsamente aprovado por pontuação) e passou a `partial` honesto com aviso
`fim-capitulo-nao-confirmado-estruturalmente`.

## Issue B — Associação frame ativo × página (leitor pageid)

Problema original: o leitor **pré-carrega** páginas (prefetch/cache); ler todos os
frames duplicava conteúdo e associava texto ao rótulo de página errado
(no histórico: Hisrich com 210.917 chars e ~158 repetições suspeitas). Corrigido:
o conteúdo é associado **somente ao frame ativo** (página exibida), dedup por
**identidade (página + hash)**, e associações ambíguas são rejeitadas e nunca
aprovam `integral`.

| Caso | Descrição | Resultado |
|---|---|---|
| B-1 | Frame ativo (pág. 45) + prefetch (pág. 46) → só o ativo é associado | `frameId=f45` — PASS |
| B-2 | Ordem dos frames invertida → associação correta | `frameId=f45` — PASS |
| B-3 | Frame ativo e inativo presentes → só o ativo é aceito | `frameId=f45` — PASS |
| B-4 | Sem frame ativo identificável → associação rejeitada (ambígua) | `reason=sem-frame-ativo-identificavel` — PASS |
| B-5 | Múltiplos frames ativos → associação rejeitada (ambígua) | `reason=multiplos-frames-ativos` — PASS |
| B-6 | Conteúdo duplicado na **mesma** página → dedup sem perda de identidade | 2ª captura = `duplicate` — PASS |
| B-7 | **Mesmo** conteúdo em páginas **distintas** → origem preservada | página 99 registrada, `seenHashes=2` — PASS |
| B-8 | Prefetch do capítulo seguinte presente → não associado ao capítulo atual | `active.id=f45` — PASS |
| B-9 | **Topo da janela** (`app.../reader/books/<id>/pageid/N`) NÃO é frame de conteúdo; iframe jigsaw e `pages/N/content` são | `topo=false, jigsaw=true, pages=true, shell=false` — PASS |

Produção: `src/extract/books.js` (`classifyContentFrames`,
`associateActivePage`, `extractPageid` + **sincronização pageid** via
`extractPageidViaSync`/`syncCaptureFrame`/`readPageidFrames`/`isPageidContentFrame`).
Na execução real de 20:38 o Hisrich foi `integral` (102.149 chars, 0 avisos) — sem o
conteúdo do capítulo seguinte no último bloco. O mecanismo completo de sincronização
(incluindo as corridas "interface muda antes do frame" e inversa) é exercitado pelos
testes de integração em `poc/test-integration-m3.js` (seção B, leitor simulado
realista) — ver `IMPLEMENTATION_RESULTS.md`.

## Issue C — Critérios de aprovação independentes

Problema original: critérios misturavam "recurso encontrado", "algum conteúdo
extraído" e "integridade comprovada"; `integral` podia ser aprovado sem todas as
validações. Corrigido: critérios separados em `poc/lib/m3-criteria.js`; `integral`
exige **evidência positiva** de começo, meio, fim estrutural, capítulo (quando
esperado), zero páginas ambíguas, zero conteúdo de outro capítulo, zero
repetições e zero avisos.

| Caso | Descrição | Resultado |
|---|---|---|
| C-1 | Todos os recursos esperados integrais → PASS | PASS |
| C-2 | Todos os recursos acessíveis parciais → **FAIL** (`expectedResourcesIntegral=false`) | PASS (reprova corretamente) |
| C-3 | Um parcial + um integral (ambos deveriam ser integrais) → **FAIL** | PASS (reprova corretamente) |
| C-4 | Recurso inacessível corretamente identificado → critério de inacessibilidade PASS | PASS |
| C-5 | `integral` sem validação de fim → **NÃO integral** (`statusForBook=partial`) | PASS |
| C-6 | `integral` com capítulo incorreto → **NÃO integral** | PASS |
| C-7 | `integral` com página de origem ambígua → **NÃO integral** | PASS |
| C-8 | `integral` com conteúdo do capítulo seguinte incluído → **NÃO integral** | PASS |

## Issue D — Decisão de limite estrutural EPUB (produção, função pura)

Refatorado o passo 4 de `extractEpub` para decisão pura e testável
(`confirmEpubBoundaryDecision`), sem depender do leitor vivo.

| Caso | Descrição | Resultado |
|---|---|---|
| D-1 | **Caso real Chiavenato**: doc muda para `chapter02` mas o texto **não** contém "Capítulo 2" | `confirmed=true`, `headingMatches=false` — PASS |
| D-2 | Documento não muda → NÃO confirmado | `reason=documento-nao-mudou` — PASS |
| D-3 | Documento intermediário do capítulo (multi-doc) → NÃO confirmado | `nextDocMatches=false` — PASS |
| D-4 | `idref` muda para o capítulo seguinte → confirmado | PASS |
| D-5 | Sem capítulo esperado → NÃO confirmado | `reason=sem-capitulo-esperado` — PASS |
| D-6 | Doc muda + cabeçalho "Capítulo N+1" → confirmado (confiança extra no audit) | `headingMatches=true` — PASS |

## Teste real (AVA) — status honesto

`poc/test-module3.js` (Electron) executado às 20:38 nesta sessão:

| Recurso | Leitor | Status | Chars | Observação |
|---|---|---|---|---|
| Fabrete (263475) | bvpdf (canvas) | `inaccessible` | 0 | DRM esperado |
| Chiavenato (263476) | epub | `partial` | 45.267 | aviso `fim-capitulo-nao-confirmado-estruturalmente` (honesto) |
| Hisrich (263477) | pageid | `integral` | 102.149 | 0 avisos, `chapterOk=true` |

**Limitação ambiental**: após 21:00 o leitor VitalSource passou a recusar a montagem
dos frames de conteúdo (tela de loading/`login.vitalsource.com/logout` — limite de
sessão/dispositivos no servidor, acumulado pelos lançamentos). Por isso a
revalidação live pós-correção da Issue D e do follow-up não foi possível nesta
máquina; o código passa a classificar esse estado como `reader-auth → inaccessible`
(honesto, nunca `integral` falso) ou `inaccessible`/`not_found` quando o conteúdo
não monta. Na rodada do follow-up (2026-11-06), os leitores montaram conteúdo de
forma intermitente: quando não montam, a extração é honesta (ex.: Chiavenato
`inaccessible/leitor-nao-carregou`; antes chegou a capturar 27 chars do topo
"Minha Biblioteca" — corrigido por `isPageidContentFrame`, caso B-9). O
comportamento de produção das Issues A/B/C foi comprovado na execução de 20:38; os
casos de regressão são cobertos deterministicamente pela tabela acima e o mecanismo
completo de sincronização pelas corridas dos testes de integração. Um experimento
de perfil persistente do leitor (para contornar a invalidação de sessão) foi
**revogado**: o requisito do projeto é perfil temporário e isolado, e `.gitignore`
não substitui esse requisito — o teste volta a usar perfil efêmero por execução.

## Testes de integração (follow-up)

`poc/test-integration-m3.js` — **14/14 PASS** (ver `IMPLEMENTATION_RESULTS.md`):
- **Issue A (EPUB estrutural)**: pacote por string parseado; cap. em 2 docs ambos
  extraídos → `integral-valid`; falta de doc → `endOk=false`; doc do próximo
  capítulo incluído → `endOk=false`; pacote indisponível → `used=false` (navegação
  complementar); sem próximo capítulo → limite não identificável.
- **Issue B (sincronização pageid)**: leitor simulado realista (identidade na
  URL/src, pageid ≠ impressa, timers reais) cobrindo as 8 tabelas do follow-up,
  incluindo as **corridas** "interface mostra 46, frame ainda 45" e inversa —
  o conteúdo antigo NUNCA é atribuído à página nova.

## Arquivos

- Testes: `poc/test-regression-m3.js`, `poc/test-integration-m3.js`, `poc/lib/m3-criteria.js`
- Produção: `src/extract/books.js`, `src/extract/epub-structure.js`
- Resultados JSON: `audit-temp/REGRESSION_RESULTS.json`, `audit-temp/INTEGRATION_RESULTS.json`
- Relatórios: `audit-temp/IMPLEMENTATION_RESULTS.md`, `audit-temp/CHANGES_AND_PENDING_ITEMS.md`
- Evidência real: `poc/evidence/module3/run.log`, `poc/evidence/module3/tmp/*.txt`

