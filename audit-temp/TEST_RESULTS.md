# Resultados de testes — Módulo 3 e revisões

> Data: 2026-11-05. Ambiente: Windows, Electron 45.2.1, playwright-core 1.64.1. Credenciais via env (nunca versionadas).

## 1. `poc/test-module3.js` — ADM270, Semana 1 (3 textos-base LTI)

Executado **após** a refatoração de `statusForBook` (status explícito). Resultado: **PASS**.

| Recurso | id | Leitor | Status | Chars | chapterOk | Avisos | Repetições |
|---|---|---|---|---|---|---|---|
| Fabrete "Empreendedorismo" | 263475 | bvpdf (canvas) | `inaccessible` | 0 | — | [] | 0 |
| Chiavenato "dando asas" Cap. 1 | 263476 | epub | `integral` | 45.267 | true | [] | 0 |
| Hisrich "Empreendedorismo" Cap. 1 | 263477 | pageid | `integral` | 104.066 | true | [] | 0 |

Critérios: `allClassified` ✅, `accessibleExtracted` ✅, `accessibleValidated` ✅, `noIntegralWithoutValidation` ✅, `bvirtualMarkedInaccessible` ✅, `noNonsenseAsContent` ✅.

## 2. Reproducibilidade

- Hisrich (pageid): 104.066 chars em **2 execuções do teste**; 103.493 no diagnóstico (Δ ≈ 0,6% por variação de renderização do leitor). Cobertura estável (págs. 23..45).
- Chiavenato (epub): 45.267 chars (estável, coincide com o registro histórico do Teste B).
- Detalhes da discrepância Hisrich: `audit-temp/HISRICH_COMPARISON.md` + `HISRICH_TRACE.json`.

## 3. `poc/test-module2.js` (regressão)

- Módulo 2 inalterado nesta auditoria; reprodutível anteriormente (62/62 páginas, `integral`).

## 4. Testes não executados

- `poc/test-A.js`, `poc/test-B.js`, `poc/test-D.js` (legados): dependem de `chromium.launch` com binário de navegador. Após a correção `playwright-core`, os módulos **carregam**, mas a execução completa exige um binário de Chromium (o projeto usa o Chromium do Electron via `playwright-core._electron`). Esses harnesses foram **substituídos** pelos testes M1/M2/M3 baseados em Electron — não foram reexecutados (fora de escopo).
- `poc/test-C.js`: usa HttpClient (PDFs públicos) — dependia de rede; não reexecutado nesta auditoria.
- Executável `portable` nesta máquina: bloqueado por política WDAC (ambiente) — validação final pendente em máquina sem a política.

## 5. Cobertura

- Extração epub (Chiavenato), pageid (Hisrich), bvpdf inacessível (Fabrete): validadas com status honesto e evidências sanitizadas.
- Não validado: outras disciplinas/semanas, leitores além dos 3 formatos, integração no app (Etapa 4/5).
