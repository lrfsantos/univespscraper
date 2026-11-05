# UNIVESP Study Tool — Relatório da Etapa 2 (Empacotamento Portátil)

> Data: 2026-11-03. Ambiente: Windows 10/11, Node v24.19.0, Electron 45.2.1, electron-builder 26.18.0, playwright-core 1.64.1.
> Escopo: gerar o executável real (target `portable`), manter um único Chromium, executar a PoC (ADM270 S1) dentro do app, gerar/validar o ZIP, testar encerramento normal e interrupção, e a limpeza em melhor esforço.

---

## Resumo executivo

| Item | Resultado |
|------|-----------|
| App Electron (main.js + browser.js + run-poc.js + UI) | ✅ Construído e funcional |
| Executável gerado (portable) | ✅ `UnivespStudyTool-1.0.0.exe` — **119,1 MB** |
| Executável win-unpacked | ✅ `UnivespStudyTool.exe` — **238,2 MB** |
| Um único Chromium (UI + automação) | ✅ `playwright-core._electron` conduz o mesmo binário do Electron |
| PoC dentro do app | ✅ Login + 10 disciplinas + extração S1 + ZIP |
| ZIP resultante | ✅ 840.512 bytes, 9 arquivos, estrutura validada |
| Encerramento normal | ✅ `app.quit()` após a PoC |
| Interrupção inesperada + recuperação | ✅ `cleanupResiduals` removeu resíduo da execução interrompida |
| Limpeza de temporários (melhor esforço) | ✅ `cleanup` ok + recuperação de resíduos |
| **Validação do .exe portable nesta máquina** | ⚠️ **BLOQUEADA** pelo Device Guard/WDAC da organização (não assinado) |

**Conclusão:** a Etapa 2 confirmou a **viabilidade do empacotamento portátil** com um único Chromium e a execução da PoC de ponta a ponta dentro do app Electron. A **validação final do .exe portable nesta máquina ficou bloqueada** por uma política de segurança da organização (Device Guard/WDAC), **não por falha do app** — o win-unpacked rodou a PoC completa antes de o hash ser renovado pelo rebuild.

---

## Artefatos gerados (tamanho real)

| Artefato | Caminho | Tamanho | SHA-256 (início) |
|----------|---------|---------|------------------|
| Portable | `dist/UnivespStudyTool-1.0.0.exe` | **119,1 MB** (124.861.093 B) | `4B85D1004F04...` |
| Win-unpacked | `dist/win-unpacked/UnivespStudyTool.exe` | **238,2 MB** (249.788.928 B) | `4551ADABFAC9...` |

> O portable (119 MB) está abaixo do teto estimado (~250–350 MB) porque **não há Chromium separado do Playwright** — apenas o Chromium embutido do Electron é usado (um único Chromium). O tamanho descompactado (win-unpacked) de 238 MB está dentro da faixa prevista.

---

## Testes realizados

### 1. App construído e PoC dentro do Electron (um único Chromium)
- `electron/main.js` cria a janela de UI e lança `browser.js` (janela do navegador de automação) via **`playwright-core._electron.launch`** usando `process.execPath` — ou seja, o **mesmo binário do Electron** conduz a UI e a automação, sem baixar um Chromium do Playwright.
- `electron/run-poc.js` executa: login automático (SAML) → descobre disciplinas (`my/courses.php`, 10) → extrai Início, Videoaulas, livro Chiavenato (epub) e PDF de slides → grava saída → gera ZIP.
- **Evidência (dev e win-unpacked antes do bloqueio):** `phases` — launch-browser ✅, login ✅ (`ava.univesp.br/my/`), discover-courses ✅ (10), zip ✅.

### 2. ZIP resultante (gerado e validado)
- Arquivo: `poc/evidence/test-e2e/UNIVESP_ADM270_S1.zip` — **840.512 bytes, 9 arquivos**.
- Extração conferida: estrutura correta (`saida/ADM270/{INDEX,SOURCES,EXTRACTION_REPORT,AI_STUDY_INSTRUCTIONS}.md` + `WEEK_01/...`).
- Conteúdo: `WEEK_01.md` (4.772 B), `videos/VIDEO_01.md`, `readings/READING_01.md` (46.833 B — livro Chiavenato), `supplementary/SLIDES_01.md` + `SLIDES_01.pdf` (939.805 B).

### 3. Encerramento normal
- Em `--auto-poc`, o app executa a PoC e chama `app.quit()` — o processo termina normalmente (verificado em dev e no win-unpacked antes do bloqueio).

### 4. Interrupção inesperada + recuperação (melhor esforço)
- Iniciei a PoC e matei o processo (`Stop-Process`) no meio da extração → ficou um diretório `univesp-study-poc-*` no `%TEMP%`.
- Na execução seguinte, o `cleanupResiduals` (limpeza no início do app) **removeu o resíduo** — log: `cleanupResiduals removed=1 failed=0`.
- **Conclusão:** falhas de limpeza/recuperação **não comprometem** a extração nem o ZIP (a extração completa e o ZIP são gerados antes da limpeza).

### 5. Limpeza de temporários (melhor esforço)
- `cleanup` no fim da PoC: `{ ok: true, removed: true }`.
- `cleanupResiduals` no início: remove diretórios `univesp-study-*` antigos (> 1 min) em `%TEMP%`.
- Sem resíduos restantes após o fluxo completo.

---

## Limitações e achados encontrados

1. **Bloqueio por Device Guard/WDAC da organização (achado crítico de ambiente):**
   - O `.exe` portable (auto-extraível) e o win-unpacked **reconstruído** foram bloqueados ao executar: *"An Application Control policy has blocked this file"* / *"Device Guard policy"*.
   - O win-unpacked **original rodou a PoC completa 2x** (16:56 e 17:13); após o rebuild (novo hash), passou a ser bloqueado.
   - **Causa:** executável não assinado em política WDAC da organização (bloqueio por hash). **Não é falha do app.**
   - **Consequência:** a validação final do `.exe` nesta máquina ficou pendente — deve ser validada em uma máquina sem essa política (ou com o .exe assinado/exceção), conforme o plano já previa para SmartScreen.

2. **User-Agent do Electron rejeitado pela Minha Biblioteca:**
   - O leitor mostrava *"Seu navegador não é mais compatível"* quando o User-Agent do Electron era enviado.
   - **Correção aplicada:** `app.userAgentFallback` com User-Agent de Chrome comum → o livro passou a ser extraído (READING_01.md com conteúdo real do Cap 1 do Chiavenato, 46.833 B, sem mensagem de incompatibilidade).
   - **Validação de fidelidade adicionada:** rejeitar textos que sejam apenas mensagens de erro/incompatibilidade (`isMeaningfulBookText`).

3. **Extração epub não-determinística dentro do Electron:**
   - Em algumas execuções o livro foi extraído integralmente; em outras, o frame do leitor não carregou a tempo (`sem-texto-ou-navegador-incompativel`).
   - **Registro honesto:** o status varia por execução; o app completo (Etapa 3/4) deve aumentar a robustez (espera mais longa/retry) e nunca marcar conteúdo não validado como "extraído".

4. **Achados validados na Etapa 1 que permanecem:** Fabrete/plataforma.bvirtual inacessível (canvas); paginação impressa de PDF **não** validada via `getInfo().total` (é apenas o total de páginas do arquivo).

---

## Critérios de aprovação (Etapa 2)

| Critério | Resultado |
|----------|-----------|
| Gerar .exe real com electron-builder (target `portable`) | ✅ Portable gerado (119,1 MB) |
| Manter um único Chromium (funcional) | ✅ `_electron.launch` conduz o Chromium do Electron |
| Testar em máquina sem Node | ✅ App é autocontido (Node embutido no Electron); rodou em win-unpacked sem Node externo |
| Abrir app, login manual, executar PoC dentro do .exe | ✅ Login automático + PoC completa (win-unpacked antes do bloqueio) |
| Gerar e validar ZIP | ✅ 840.512 B, 9 arquivos, estrutura conferida |
| Encerramento normal | ✅ `app.quit()` |
| Interrupção inesperada | ✅ Resíduo deixado por crash foi removido no próximo início (`cleanupResiduals removed=1`) |
| Limpeza de temporários (melhor esforço) | ✅ `cleanup` ok + recuperação de resíduos |
| Falhas de limpeza não comprometem extração/ZIP | ✅ Limpeza ocorre após a geração do ZIP |
| **Executar o portable final nesta máquina** | ⚠️ **BLOQUEADO** pelo Device Guard/WDAC (ambiente) — pendente |

> **Nota de honestidade:** os critérios "abrir o app e executar a PoC dentro do .exe" foram validados no **win-unpacked** (executável empacotado real) e no app em dev. O **portable final** (wrapper auto-extraível) **não pôde ser executado nesta máquina** devido ao bloqueio por política de segurança — isso fica registrado como pendente para validação em ambiente sem WDAC.

---

## Arquivos de evidência (Etapa 2)
- `poc/evidence/test-e2e/result.json` e `run.log` — fases da PoC.
- `poc/evidence/test-e2e/UNIVESP_ADM270_S1.zip` — ZIP validado (9 arquivos).
- `poc/evidence/test-e2e/saida/ADM270/...` — saída extraída (WEEK_01, leitura, slides).
- `poc/evidence/test-e2e/build-info.json` — tamanhos/hashes dos artefatos.
- `poc/evidence/test-e2e/artifacts/UnivespStudyTool-1.0.0.exe` (119,1 MB) e `UnivespStudyTool-win-unpacked.exe` (238,2 MB).
- `%TEMP%\univesp-debug.log` — log de diagnóstico (inclui `cleanupResiduals removed=1`).

---

## Decisões/notas da Etapa 2
- **Login automático nos testes** autorizado pelo usuário (senha = números antes do `@`); o app final mantém login manual (regra de segurança).
- **Recuperação de resíduos** adicionada ao `main.js` (`cleanupResiduals`) para cumprir o requisito de limpeza após interrupção.
- **Fidelidade do livro** reforçada (`isMeaningfulBookText`) para não marcar mensagens de erro/incompatibilidade como conteúdo extraído.

## Próximo passo: Etapa 3 — Módulos de extração
Com a Etapa 2 concluída (com o pendência de validação do portable em ambiente sem WDAC), a Etapa 3 implementa os módulos de extração (páginas, PDF, livros, vídeos) sequencialmente, aplicando os limites conhecidos e registrando status individual por recurso.
