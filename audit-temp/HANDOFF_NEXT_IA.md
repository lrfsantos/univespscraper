# HANDOFF — UNIVESP Study Tool (univespscraper)

**Data:** 2026-11-14
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

## 2. ESTADO ATUAL DO GIT (já feito e commitado)

HEAD local = `df4c30f`, já pushado para `origin/review/pre-release-2026-11-07`. Working tree limpo, exceto 2 arquivos intencionalmente NÃO versionados: `poc/_pkg.js` e `poc/probe-readers.js` (diagnósticos preservados por regra, ver `audit-temp/FINAL_STABILIZATION_BASELINE.md`).

Commits desta sessão (após `b0214da`):
- `22419df` feat: close Meus cursos discovery gaps (removido da visualização, período mais recente, verificação de acesso abrindo o curso, driver de DOM testável, Favoritos como visão adicional)
- `df4c30f` chore: refresh audit evidence

Trabalho anterior já commitado/pushado (seções do prompt): 4, 5, 6, 9, 10/11.5, 12, 14, BVirtual 4.5, e a nova seção "Meus cursos" (testes M-1..M-7). `npm test`: 24/24 suítes, 309/309 casos, 0 falhas.

**Arquivos-chave alterados nesta sessão (para fechar os 5 gaps da nova seção "Meus cursos"):**
- `electron/discovery.js` — adicionou `parsePeriodRank`, `mostRecentPeriod`; `classifySelectorOption` agora distingue `favoritos` e `removido` (antes retornava `categoria` para tudo)
- `electron/my-courses.js` — adicionou: coleta de `removidosDaVisualizacao` (registra sem restaurar), verificação REAL de acesso via `checkCourseAccess` (abre o curso), `periodoMaisRecente` no summary, `Favoritos` como visão adicional (não bloqueia `completo`); refatorou o driver real em funções PURAS exportadas (`collectSelectorOptions`, `applySelectOption`, `readStability`, `readCards`, `applyShowAll`, `applyNextPage`, `readActiveLabel`) testáveis com `document` fake
- `poc/test-my-courses-m3.js` — adicionou testes M-8..M-12 (removido, período mais recente, acesso por abertura, Favoritos adicional, driver puro com document fake). Total M-1..M-12.

**O que AINDA falta no projeto (não é código, depende de ambiente/proprietário):**
1. Validação real contra o AVA (ver seção 4 abaixo — ESTE é o trabalho em andamento)
2. Validar portable em máquina sem WDAC
3. Decisão do proprietário sobre purga do histórico (copyright, commit `8742012`)

---

## 3. PROBLEMA EM ANDAMENTO — "O BOTÃO 'Entrar no AVA' NÃO FAZ NADA"

Este é o motivo desta sessão. Reproduzido 100% localmente. **NÃO foi corrigido ainda.**

### Sintoma
Ao clicar em "Entrar no AVA" (botão `#btn-enter` em `electron/ui.html`), nada acontece — a tela não muda para "screen-session". O app fica travado. No log (`$env:TEMP\univesp-app.log`) NUNCA aparece a linha `launch browser aux ...`, ou seja, `launchBrowser()` inicia mas nunca completa.

### Causa raiz (confirmada)
`launchBrowser()` em `electron/main.js:130` lança o navegador auxiliar assim:
```js
const browserEntry = path.join(__dirname, 'browser.js');
const args = app.isPackaged ? ['--univesp-aux'] : [browserEntry];
auxApp = await _electron.launch({ executablePath: process.execPath, args, env: auxEnv() });
auxWin = await auxApp.firstWindow();   // <-- TRAVA AQUI: nenhuma janela aparece
```

Em desenvolvimento (`npm run app`, `app.isPackaged === false`), ele lança com `args: [browserEntry]` e espera a janela via `firstWindow()`.

**O bug:** em `electron/browser.js`, o código que cria a janela está protegido por:
```js
if (require.main === module) runStandalone();
```

Quando o Electron é lançado via `playwright-core._electron.launch({ executablePath, args: [browserEntry] })`, **`require.main === module` é `false`** para o `browser.js`. **Confirmado experimentalmente** (probe3-log.txt, arquivo em `$env:TEMP\probe3-log.txt`):

```
module-loaded requireMain=false
argv=["...electron.exe","--inspect=0","--remote-debugging-port=0","C:\\...\\probe3-log.js"]
before-guard requireMain=false
```

Ou seja: quando o Playwright injeta `--inspect=0` e `--remote-debugging-port=0` e passa o entry como ARGUMENTO (não como `require.main`), o guard `if (require.main === module)` nunca dispara, `runStandalone()` nunca roda, a `BrowserWindow` nunca é criada, e `firstWindow()` fica pendurado 30s → o `await` em `launchBrowser()` nunca resolve → o botão "não faz nada".

### Evidências experimentais (já coletadas — NÃO refaça tudo)
1. **Probe mínimo (janela simples, sem guard) FUNCIONA:** `new BrowserWindow` + `about:blank` via `_electron.launch` → `firstWindow()` retorna a janela. ✅
2. **Probe com `installTempProfile` + `applyBrowserDefaults` + `about:blank` FUNCIONA** (o perfil temporário NÃO é o problema). ✅
3. **Probe com URL real `https://ava.univesp.br/` FUNCIONA** — a janela abre e redireciona para `ava.univesp.br/custom/univesp_login.php`. ✅ (ou seja, rede/URL não é o problema)
4. **Probe IDÊNTICO ao `browser.js` mas SEM o guard `if (require.main === module)`** → criar a janela diretamente em `app.whenReady()` **FUNCIONA**. ✅
5. **Probe que replica o guard do `browser.js`** (`if (require.main === module) runStandalone()`) → **FALHA**, `windows=0`, `requireMain=false`. ❌ ← ESTA é a reprodução exata.

Conclusão inequívoca: **o guard `if (require.main === module)` é a causa raiz.** Quando lançado por `_electron.launch` com o entry como argumento, `require.main` nunca é o `browser.js`.

### Correção recomendada (a próxima IA deve implementar e testar)
O `browser.js` precisa criar a janela também quando é lançado como argumento do Playwright, não só quando `require.main === module`. Opções:

**Opção A (recomendada):** Detectar se foi lançado pelo Playwright. O Playwright adiciona `--remote-debugging-port=0` (e `--inspect=0`) aos args. Ou simplesmente chamar `runStandalone()` sempre que NÃO houver sinal de "modo auxiliar empacotado". Concretamente, em `browser.js`, trocar:
```js
if (require.main === module) runStandalone();
```
por algo que rode `runStandalone()` em ambos os casos (dev via playwright E standalone). Ex.:
```js
if (require.main === module || process.argv.some(a => a.includes('browser.js') || a.includes('remote-debugging-port'))) runStandalone();
```
Ou, mais simples e robusto: **remover o guard** e chamar `runStandalone()` incondicionalmente, já que `browser.js` é um processo AUXILIAR dedicado (nunca é `require`'d como biblioteca pelo fluxo normal — `main.js` só importa funções dele, mas o processo auxiliar é lançado como entry). ⚠️ VERIFICAR: `main.js` faz `require('./browser')` e chama `createAuxWindow`/`applyBrowserDefaults`. Se remover o guard e o arquivo for `require`'d pelo `main.js` principal, `runStandalone()` rodaria no processo principal e abriria uma janela indevida. Portanto: a remoção do guard NÃO é segura se `browser.js` for `require`'d no processo principal. **Preferir manter um guard, mas que também cubra o lançamento via Playwright.**

**Verificação obrigatória após a correção:** rodar o teste de reprodução (abaixo) e confirmar que `firstWindow()` retorna a janela com URL do AVA. Depois rodar `npm.cmd test` (309 casos).

### Como reproduzir o bug (comandos prontos)
```powershell
cd C:\Users\luiza\Documents\univespscraper
node -e "const {_electron}=require('playwright-core'); const path=require('path'); const exe=path.join(process.cwd(),'node_modules','electron','dist','electron.exe'); const entry=path.join(process.cwd(),'electron','browser.js'); (async()=>{ const app=await _electron.launch({executablePath:exe,args:[entry]}); const t=setTimeout(()=>{console.log('TIMEOUT windows='+app.windows().length);process.exit(0)},15000); try{ const win=await app.firstWindow(); clearTimeout(t); console.log('WINDOW OK url='+win.url()); await app.close(); }catch(e){clearTimeout(t);console.log('FAILED '+e.message)} })().catch(e=>{console.error('ERR',e&&e.message);process.exit(1)})"
```
**Resultado atual (bug):** `TIMEOUT windows=0`
**Resultado esperado após a correção:** `WINDOW OK url=https://ava.univesp.br/custom/univesp_login.php`

**OBSERVAÇÃO IMPORTANTE sobre `main.js`:** em modo EMPACOTADO (`app.isPackaged === true`), `launchBrowser` usa `args: ['--univesp-aux']`, e o `main.js:504-512` trata `isAuxBrowser` criando a janela via `createAuxWindow()`. Esse caminho NÃO passa por `browser.js` como entry — é o próprio `main.js` em modo auxiliar. Portanto, o bug do `require.main` afeta APENAS o modo desenvolvimento (`npm run app`). A correção não deve quebrar o caminho empacotado.

---

## 4. PRÓXIMOS PASSOS (validação real no AVA — o que o usuário queria)

O objetivo do usuário (da sessão anterior) era fazer a **validação real do AVA** (Opção A): rodar `npm run app`, clicar "Entrar no AVA", logar manualmente e ver se a descoberta de disciplinas funciona contra o DOM real. **Isso estava bloqueado pelo bug da seção 3** — o botão não abria o navegador.

Após corrigir o bug, o fluxo a validar com o usuário (ele NÃO entende jargão de programação — dar passos simples):
1. `npm.cmd run app`
2. Clicar **"Entrar no AVA"**
3. Logar manualmente na janela do UNIVESP que abre
4. Clicar **"Já concluí o login"**
5. Ver a tela **"Suas matérias"** e reportar o número e os nomes/períodos
6. Reportar qualquer erro literal na tela

O usuário reportou literalmente: **"o botão entrar no AVA não faz nada"** — sintoma 100% compatível com o bug da seção 3.

---

## 5. AVISOS / CONVENÇÕES DO REPO

- **Regra: NUNCA reescrever histórico git** (sem force push/rebase/clean). O texto integral de um livro licenciado permanece no commit `8742012` (removido da árvore em `d6cf122`); a decisão de purgar é do proprietário.
- **Regra: NUNCA versionar credenciais/cookies/sessões/conteúdo protegido.** Usar `sanitizeReason` nos logs.
- **Regra: preservar `poc/_pkg.js` e `poc/probe-readers.js`** (não versionar, não apagar).
- **NÃO modificar `master`** — trabalhar só na branch `review/pre-release-2026-11-07`.
- Logs de diagnóstico do app: `$env:TEMP\univesp-app.log` (sanitizado).
- O navegador auxiliar usa perfil temporário isolado em `%TEMP%\univesp-profile-*`; o UI do app é local (`file:`) com sandbox e CSP (seção 12).
- **Credenciais do usuário para testes ao vivo:** ficam em `UNIVESP_USERNAME` / `UNIVESP_PASSWORD` no ambiente (nunca commitadas). O app NÃO usa essas variáveis — são usadas apenas por probes de diagnóstico (`poc/probe-readers.js`).

---

## 6. RESUMO DO QUE A PRÓXIMA IA DEVE FAZER (ordem)

1. **Corrigir o bug do `require.main` em `electron/browser.js`** (seção 3) — causa do "botão não faz nada".
2. **Rodar o comando de reprodução** e confirmar que `firstWindow()` retorna a janela do AVA.
3. **Rodar `npm.cmd test`** — deve seguir 309/309.
4. Se a correção alterar código de produção, commitar com mensagem no estilo do repo (prefixo `fix(...)`), seguir com `chore: refresh audit evidence` se necessário.
5. **Acompanhar o usuário na validação real do AVA** (seção 4), em passos sem jargão.
6. Itens de ambiente pendentes (portable em máquina sem WDAC; decisão de purga do histórico) — não são código.

---

*Documento de handoff gerado em 2026-11-14. Revisei: estado do git, causa raiz (guard require.main), evidências experimentais, e próximos passos. A causa raiz está confirmada experimentalmente; a CORREÇÃO ainda não foi implementada.*
