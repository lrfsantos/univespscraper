# HANDOFF — UNIVESP Study Tool (univespscraper)

**Data:** 2026-11-15
**Branch atual:** `review/pre-release-2026-11-07`
**Próxima IA:** comece DO ZERO. Não confie em nada do que foi feito nesta sessão além do que está neste documento. NÃO continue a conversa anterior.

---

## 1. O QUE O PROJETO É

Ferramenta Electron que extrai e organiza academicamente o conteúdo das disciplinas da UNIVESP (AVA, `https://ava.univesp.br`) em arquivos ZIP. O login é SEMPRE manual (janela visível do navegador); nenhuma credencial é usada/armazenada/repassada pelo app.

**Stack:** Electron 45.2.x + Node 24 + `playwright-core` (para controlar o navegador auxiliar), `pdf-parse`, `youtube-transcript`. Windows.

**Comandos:**
- `npm.cmd run app` — roda o app em desenvolvimento (⚠️ use `npm.cmd`, NÃO `npm`, porque o PowerShell bloqueia `npm.ps1`)
- `npm.cmd test` — 24 suítes determinísticas, 309 casos (todos passam localmente)
- `npm.cmd run build:portable` / `build:dir` — empacota

**Nota importante:** o executável portable (`dist/UnivespStudyTool-1.0.0.exe`) NÃO pode ser validado NESTA máquina por política WDAC/Device Guard. Nesta máquina, só roda via `npm run app` (modo dev).

---

## 2. ESTADO ATUAL DO GIT (tudo commitado e pushado nesta sessão)

HEAD local = `74d5e81`, pushado para `origin/review/pre-release-2026-11-07`. Working tree limpo, exceto 2 arquivos intencionalmente NÃO versionados: `poc/_pkg.js` e `poc/probe-readers.js` (diagnósticos preservados por regra).

Commits desta sessão (após `df4c30f`):
- `f4d6558` fix: launch aux browser window when entry is passed as arg by playwright-core._electron (dev) — guard `require.main === module` agora também dispara quando `browser.js` está em `process.argv`
- `e32a3e0` chore: refresh audit evidence
- `29aaea7` fix: UI inline script blocked by CSP (script-src 'self') left 'Entrar no AVA' dead — lógica do UI extraída para `electron/ui.js` externo; testes de inspeção passam a ler `ui.html` + `ui.js`
- `500b3f1` docs: refresh audit evidence
- `91aedb3` fix: detect closed aux browser (isClosed) + course filter (todas/ativas/período mais recente)
- `74d5e81` chore: refresh audit evidence

`npm test`: 24/24 suítes, 309/309 casos, 0 falhas.

---

## 3. PROBLEMA "O BOTÃO 'Entrar no AVA' NÃO FAZ NADA" — RESOLVIDO (DUAS CAUSAS)

### Causa real n.º 1 (a que o USUÁRIO viu): CSP bloqueando o script inline do UI

A CSP da seção 12 em `electron/ui.html:5` tem `script-src 'self'` (sem `unsafe-inline`). Todo o JS do UI vivia em um `<script>...</script>` INLINE, que a CSP BLOQUEIA. Resultado: nenhum listener de evento é anexado, o botão "não faz nada" e o log do app NUNCA chega a `launch browser aux`. Confirmado por probe (console do renderer: `Executing inline script violates the following Content Security Policy directive 'script-src 'self''`).

**Correção:** extrair todo o script inline para `electron/ui.js` (arquivo externo, carregado via `<script src="ui.js"></script>`), que satisfaz `script-src 'self'`. A CSP permanece estrita (sem `unsafe-inline`).

### Causa n.º 2 (bônus, só aparecia DEPOIS da correção 1): guard `require.main` no browser.js

Mesmo com o UI funcionando, em modo dev o Playwright lança `browser.js` como ARGUMENTO (`args: [browserEntry]`), então `require.main === module` é false e `runStandalone()` nunca rodava → a janela do AVA nunca abria → `firstWindow()` pendurado 30s. **Correção:** guard agora é `require.main === module || process.argv.some(a => a.includes('browser.js'))`. O caminho empacotado (`--univesp-aux`, via main.js) não passa por `browser.js` como entry e permanece intacto.

### Verificação feita
- Comando de reprodução do handoff anterior: `WINDOW OK url=https://ava.univesp.br/custom/univesp_login.php` ✅
- Probe end-to-end do app real: clicar em "Entrar no AVA" → `screen-session` ativo + log `launch browser aux` ✅
- `npm.cmd test` 309/309 ✅

---

## 4. VALIDAÇÃO REAL NO AVA — FEITA (o que o usuário reportou)

O usuário rodou o app real e **o fluxo funcionou**: botão abriu a janela do AVA, login manual OK, e a tela "Suas matérias" mostrou **10 matérias**, incluindo: Liderança/Competências RH Turma 002 (ADM290), Estudos Organizacionais (ADM210), Metodologias ágeis (CIN200), Gestão de Pessoas (ADM250), Indicadores de desempenho (ADM260), Gestão Contábil (ADM230), AIA, e **LEGADO_INT100** (todos listados como "ativa").

Feedback do usuário nesta sessão (IMPORTANTE para a próxima IA):
1. **"ele não tem filtro de materias ativas/mais recentes. ele puxa todas"** → foi adicionado um dropdown de filtro (`#filter-courses`: Todas / Somente ativas / Período mais recente) na tela de matérias (`electron/ui.html` + `electron/ui.js`). ⚠️ O usuário depois disse que **"filtros não funcionam"** e reclamou da UX: filtro fica NO RODAPÉ da lista e **todas as matérias vêm pré-selecionadas**. VERIFICAR e melhorar.
2. **"ele não escaneia apenas os tópicos que eu quero ... ele passa por todas opções de cada materia. eu quero apenas leituras, material complementar e videoaulas"** → a extração NÃO filtra os tipos de recurso; percorre TODAS as opções de cada matéria (não ignora "Live com facilitador", não ignora "Início", não ignora "Em síntese"/resumo etc.). Há `isIgnoredActivity` em `electron/discovery.js` (ignora só "Início" e "Em síntese" exatos). ⚠️ O usuário quer restringir a **leituras + material complementar + videoaulas**.
3. **"estou com umas 10-20 abas abertas no navegador do programa" e "a barra de progresso avança porem o numero de pendencias quase nao diminui" e "pelo menos metade delas nao acessaram conteudo algum"** → PROBLEMA CRÍTICO ABERTO (seção 5).
4. **"existe um leitor diferente da biblioteca pearson? se chama minha biblioteca ... https://app.minhabiblioteca.com.br/reader/books/9788580553338/pageid/22"** → SIM, o leitor "Minha Biblioteca" já é suportado e reconhecido: `app.minhabiblioteca.com.br/reader/books/<id>/pageid/N` é a janela de topo (shell) e o conteúdo vem dos frames `jigsaw.minhabiblioteca.com.br/books/<id>/pageid/N` (padrão pageid, VitalSource). Ver `src/extract/books.js` (`PAGEID_CONTENT_RE`), `electron/discovery.js` (`READER_PLATFORM_RE` inclui `minhabiblioteca`), testes `poc/test-adapters-m3.js`/`poc/test-c-fidelity-m3.js`/`poc/test-regression-m3.js` (caso B9). Não é um leitor "diferente" — é o leitor pageid/VitalSource que já existe no fluxo.
5. **"o fato de precisar deixar ambas janelas abertas tambem é chato"** → o usuário aceitou manter como está se mudar for grande.

---

## 5. PROBLEMA CRÍTICO ABERTO — ABAS/JANELAS QUE NÃO FECHAM + PENDÊNCIAS QUE NÃO DIMINUEM

**Sintoma (usuário, extração real em andamento):** o programa abre páginas e mais páginas e não as fecha; ~10-20 abas/janelas abertas no navegador auxiliar; a barra de progresso avança mas o nº de pendências quase não cai; metade das abas não acessou conteúdo visível.

**Observação de código (NÃO resolvida):** `src/extract/books.js` usa `allWindows(app)`/`collectFrames(app)` e percorre TODAS as janelas, mas **NÃO há nenhum `.close()`** de janelas extras no arquivo (grep de `close()` não retornou nada). Ou seja: se o leitor (Minha Biblioteca / leitor pageid / BVirtual) abre uma janela nova (via `window.open` ou popup do próprio leitor), ela fica aberta para sempre.

**Suspeitas a investigar (próxima IA):**
1. O leitor abre janelas novas por execução e elas nunca são fechadas — acumulam. Verificar onde janelas novas são criadas e fechar as janelas auxiliares que não são a principal após cada extração de livro.
2. `electron/browser.js` cria a janela com `webPreferences` sem tratar `setWindowOpenHandler` — popups/`window.open` do leitor viram janelas novas sem controle. Comparar com `createMainWindow` em `main.js` (que TEM `setWindowOpenHandler`).
3. "Pendências não diminuem" pode ser: cada recurso abre uma aba nova mas a extração fica presa esperando conteúdo numa aba que não é a certa; ou o contador de pendências considera abas que nunca carregaram. Ver fluxo `handleRunExtraction`/`extractResource` e como `done`/`pending` são computados.
4. A extração é SEQUENCIAL sobre uma única `auxWin`; se o leitor muda de janela/frame ativo, `extractResource` pode estar lendo frames de janelas erradas.

**É o item nº 1 de prioridade da próxima sessão**, junto com o filtro de tipos de recurso (feedback 2 da seção 4).

---

## 6. RESOLVIDOS NESTA SESSÃO (além da seção 3) — para registro

- **Janela do AVA fechada pelo usuário → "nenhuma semana":** `electron/main.js` agora tem `auxWindowAlive()` (usa `isClosed()` do Playwright), `resetAuxState()`, e os handlers `checkAuth`, `handleDiscoverCourses`, `handleDiscoverWeeks`, `handleRunExtraction` retornam erro claro `navegador-fechado` com mensagem amigável ("O navegador do AVA foi fechado. Clique em 'Entrar no AVA'...") em vez de semanas vazias. `launchBrowser()` também resetar o estado para permitir reabrir.
- **Filtro de matérias:** dropdown `#filter-courses` (Todas / Somente ativas / Período mais recente) em `electron/ui.html` + lógica `applyCourseFilter()` em `electron/ui.js`; `periodoMaisRecente` vem do summary da descoberta. ⚠️ Usuário disse "não funciona" — verificar.

---

## 7. O QUE AINDA FALTA (não é código / depende do proprietário)

1. Resolver o problema de abas que não fecham + pendências (seção 5).
2. Implementar filtro de tipos de recurso (leituras + material complementar + videoaulas) — feedback do usuário (seção 4, item 2).
3. Melhorar UX do filtro de matérias (posição + pré-seleção) (seção 4, item 1).
4. Validar portable em máquina sem WDAC.
5. Decisão do proprietário sobre purga do histórico (copyright, commit `8742012`).

---

## 8. AVISOS / CONVENÇÕES DO REPO

- **Regra: NUNCA reescrever histórico git** (sem force push/rebase/clean). O texto integral de um livro licenciado permanece no commit `8742012` (removido da árvore em `d6cf122`); a decisão de purgar é do proprietário.
- **Regra: NUNCA versionar credenciais/cookies/sessões/conteúdo protegido.** Usar `sanitizeReason` nos logs.
- **Regra: preservar `poc/_pkg.js` e `poc/probe-readers.js`** (não versionar, não apagar).
- **NÃO modificar `master`** — trabalhar só na branch `review/pre-release-2026-11-07`.
- Logs de diagnóstico do app: `$env:TEMP\univesp-app.log` (sanitizado).
- O navegador auxiliar usa perfil temporário isolado em `%TEMP%\univesp-profile-*`; o UI do app é local (`file:`) com sandbox e CSP (seção 12). O script do UI é `electron/ui.js` (externo, por causa da CSP).
- **Credenciais do usuário para testes ao vivo:** ficam em `UNIVESP_USERNAME` / `UNIVESP_PASSWORD` no ambiente (nunca commitadas). O app NÃO usa essas variáveis — são usadas apenas por probes de diagnóstico (`poc/probe-readers.js`).
- O usuário é leigo (não entende jargão) e impaciente — passos simples e diretos, sem explicações longas.

---

## 9. RESUMO DO QUE A PRÓXIMA IA DEVE FAZER (ordem)

1. **Investigar/resolver abas que não fecham + pendências que não diminuem** (seção 5) — provável falta de `.close()` de janelas extras do leitor + possível leitura de frames de janela errada.
2. **Implementar filtro de tipos de recurso** (leituras + material complementar + videoaulas) no fluxo de extração, respeitando a regra de honestidade (nunca fingir extração do que foi filtrado).
3. **Corrigir/melhorar o filtro de matérias** (seção 4, item 1): usuário disse que não funciona; mover filtro para o topo e não pré-selecionar todas.
4. **Rodar `npm.cmd test`** — deve seguir 309/309.
5. Commitar com mensagem no estilo do repo (`fix(...)`/`feat(...)`), seguir com `chore: refresh audit evidence` se necessário. **Pushar** (o usuário pediu explicitamente para enviar ao GitHub).
6. Acompanhar o usuário em nova validação real, em passos sem jargão.

---

*Documento de handoff gerado em 2026-11-15. Revisei: estado do git (tudo commitado/pushado até `74d5e81`), as DUAS causas reais do botão "Entrar no AVA" (CSP + require.main, ambas corrigidas e verificadas), a validação real no AVA (funcionou, 10 matérias), os feedbacks do usuário (filtro não funciona, tipos de recurso, abas que não fecham, leitor Minha Biblioteca já suportado) e o problema crítico aberto das abas/pendências.*
