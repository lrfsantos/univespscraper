# HANDOFF — Sessão Pearson/OCR (2026-11-18)

> **ESTADO ATUAL (2026-11-21)** — branch `integration/pearson-ocr-master`;
> HEAD `c47543b`; `npm test`: **30 suítes / 391 casos / 0 falhas**.
> Validado SINTETICAMENTE: orquestradores Pearson/VitalSource + adaptadores DOM
> (`poc/test-pearson-adapter-m3.js`, seletores simulados — NÃO é sessão real).
> PENDENTE: validação autenticada no Electron (Beta/Clássico/fallback/janelas,
> VitalSource/LTI), OCR Tesseract.js, rotação da credencial histórica exposta.
> As seções abaixo são **HISTÓRICO**; em conflito, prevalece este bloco.

Este documento foi escrito ao fechar a sessão anterior (contexto quase cheio + restart).
Objetivo: a próxima sessão retoma o trabalho SEM depender da memória da conversa.
**Leia este arquivo inteiro antes de qualquer ação.**

---

## 1. Objetivo geral

Integrar e validar a implementação Pearson/OCR no projeto `univespscraper`, usando
navegação REAL no browser para capturar seletores e comportamento do leitor Pearson
(Beta e Clássico), aplicar os achados no código de produção e rodar a suíte completa.

Trabalhar SEMPRE na worktree:
```
C:\Users\luiza\Documents\univespscraper-pearson-ocr   (branch: integration/pearson-ocr-master)
```
**NÃO** commit/push/merge/PR sem autorização explícita do usuário.

Regras de honestidade (ONDE NUNCA QUEBRAR):
- Preservar comportamento fail-closed dos testes do revisor:
  `scripts/test-summary.js`, `poc/lib/qa-status.js`.
- Sem credenciais/tokens nos relatórios/logs.
- Se OCR ou navegação falhar, reportar de forma honesta. NUNCA fabricar sucesso.

---

## 2. Status atual do repositório (verificado antes de fechar)

- Branch atual: `integration/pearson-ocr-master`.
- HEAD = `de7cecd` "docs: README - Pearson best-effort navigation and OCR decision layer".
- Log (top 5 do atual):
  ```
  de7cecd docs: README - Pearson best-effort navigation and OCR decision layer (honest limitations; real validation pending)
  7d18b2b chore: refresh audit evidence after Pearson/OCR suites (26 suites, 344/344 pass)
  114e72a test: evidence artifacts for Pearson (14) and OCR (12) synthetic suites
  fa794f8 feat: Pearson reader selection + TOC navigation (best-effort) and OCR decision/quality layer
  eb1985e fix: tighten test summary validation and security report
  ```
- `node_modules` = junction para o checkout principal (JÁ OK, não reinstalar).
- `git status --short` (modificados, NÃO commitados):
  ```
  M audit-temp/INTEGRATION_RESULTS.json
  M audit-temp/OCR_RESULTS.json
  M audit-temp/PEARSON_RESULTS.json
  M audit-temp/REGRESSION_RESULTS.json
  ```
  Esses 4 arquivos são evidências de auditoria geradas; reexaminar antes de decidir
  se devem ser commitados. Provavelmente foram regenerados por um teste recente.

---

## 3. Histórico de commits integrados (contexto)

O intervalo `origin/master..origin/fix/audit-remediation-2026-11-15` estava VAZIO
(fix branch já totalmente mergeado em master). Integrado via cherry-pick em worktree
separada (JÁ FEITO):

- `e17e3ec` (4º commit confirmado pelo usuário como `55c5e58`, NÃO `5eec58` que não existe)
- Já citados 4 commits: `e17e3ec, 1bca1e5, 2f58524, 55c5e58`.

> ATENÇÃO: o commit citado "55c5e58" foi o que o usuário confirmou; conferir nos
> logs da worktree o que de fato entrou se precisar rastrear.

---

## 4. DESCOBERTAS REAIS do browser (o mais valioso — NÃO perder)

Estas foram capturadas em sessão REAL no leitor Pearson (Edge via browse MCP),
antes do restart. São FATOS OBSERVADOS, não heurísticas.

### 4.1 URLs das plataformas
- Leitor Beta: `leitor.bvirtual.com.br`
- Leitor Clássico: `plataforma.bvirtual.com.br/Leitor/Loader/...`
- Minha Biblioteca (VitalSource): `app.minhabiblioteca.com.br/...` / `jigsaw.minhabiblioteca.com.br`

### 4.2 Tela de seleção de leitor (seletores REAIS)
- Botão Beta = `#pdf-novo`
- Botão Clássico = `#pdf`
- **O código atual (`tryPearsonAutomation`) presume botões/bordas de texto heurísticos
  e NÃO usa esses seletores. PRECISA SER CORRIGIDO** (ver seção 6).

### 4.3 Sumário (TOC) — seletores REAIS
- Itens do sumário = **botões `#summary-item-N`** (ex.: `#summary-item-0`, `#summary-item-1`, ...)
- **O código atual presume `nav a`, `[class*="toc"] a`, `[role="treeitem"]` — seletores
  ERRADOS. PRECISA SER CORRIGIDO** (ver seção 6).

### 4.4 Conteúdo da página (camada textual)
- Beta: conteúdo em `<img class="PdfImageView_pageImage">` com `alt` contendo o texto
  real (resultado do OCR feito pelo próprio leitor/Vendor).
- Clássico: conteúdo em `<canvas>` — **SEM texto acessível no DOM**.

### 4.5 Navegação de páginas (seletores REAIS)
- Campo numérico de página: `input[type='number']`
- Botões: "Avançar uma página" / "Página anterior".

### 4.6 Diálogo "continuar leitura"
- Sempre clicar **"Página atual"** (NUNCA "Última página lida").

### 4.7 Rede / imagens (BETA e CLÁSSICO compartilham o mesmo CDN)
- Ambos servem as mesmas imagens `page-N.jpg` de `conteudo.bvirtual.com.br`
  via CloudFront **URLs assinadas** (expira, exige cookie de sessão; 403 sem assinatura).

### 4.8 Qualidade do `alt` (Beta) — MEDIDA REAL
Analisados: livro 173412 "Empreendedorismo" (págs 2-6) e livro 748 "Cálculo"
(págs 336, 337, 340).
- Texto comum e tabelas: `alt` BOM.
- Fórmulas matemáticas: `alt` CORROMPIDO.
- Conclusão: a limitação NÃO é do nosso motor OCR — é do próprio OCR do leitor para
  matemática complexa. `alt` serve como fonte primária (texto/tabelas), com
  tesseract.js como fallback para páginas onde `alt` é ausente/insuficiente.
  **Usuário: SEM soluções pagas.**

### 4.9 Conclusão sobre extração de texto
- Beta: extração textual via `alt` de `img.PdfImageView_pageImage` = VIÁVEL.
- Clássico: canvas, sem texto acessível = NÃO viável sem OCR de imagem (consome a
  própria imagem `page-N.jpg`, mas exige URL assinada válida).
- `ocr.js` atual é APENAS camada de DECISÃO/qualidade (identifica páginas que
  precisam de OCR e valida qualidade). **Não existe motor de reconhecimento real
  no branch.** O caminho "vendor OCR via `alt`" é o principal.

---

## 5. Estado da exploração no browser (interrompida pelo restart)

Antes do restart: browser MCP conectado ao Edge do usuário, extensão v0.0.17,
3 abas (AVA, Minha Biblioteca, CNA).
- Aba AVA estava em `https://ava.univesp.br/mod/lti/view.php?id=263475` (livro Empreendedorismo).
- Aba Minha Biblioteca estava em `app.minhabiblioteca.com.br/home/dashboard` (NÃO explorado ainda).

Após restart, o browse MCP estava com `pairingState: refused` — o usuário precisa
reautorizar a extensão (clicar "Allow" no popup / `browse install` / `browse pair`).
**NÃO repetir retry loop do captcha/login.**

Plano de exploração combinado com o usuário (explorar livremente, SEM pedir
permissão a cada navegação):
1. Pearson Clássico (em andamento antes do restart)
2. Minha Biblioteca / VitalSource (DEPOIS do Clássico)

---

## 6. PRÓXIMOS PASSOS (em ordem) — retomar daqui

### 6.1 Reconectar o browser
- Verificar `browse` status. Se `refused`/`paired-offline`, pedir ao usuário para
  reautorizar a extensão (Allow no popup) e aguardar. Não ficar em loop.

### 6.2 Terminar exploração do Pearson Clássico
- Pergunta-chave: o endpoint de paginação XHR do Clássico retorna HTML/texto
  acessível? (Beta usa `alt`; Clássico pode precisar só de OCR de imagem ou pode ter
  texto em JSON da regex de paginação.)

### 6.3 Explorar Minha Biblioteca (VitalSource)
- Só depois do passo 6.2. Já existe código EPUB e pageid em `books.js` validado
  sinteticamente; validar contra o leitor real.

### 6.4 Corrigir código de produção (commits LOCAIS apenas, autorizado)
Arquivos a alterar:
1. **`src/extract/books.js`** — `tryPearsonAutomation()`:
   - Substituir seletores de TOC errados (`nav a`, `[class*="toc"]`, `treeitem`) por
     **`#summary-item-N`** (botões).
   - Substituir seleção de leitor heurística por **`#pdf-novo`** (Beta) / **`#pdf`** (Clássico).
   - Implementar extração de conteúdo do Beta lendo o **`alt`** de
     **`img.PdfImageView_pageImage`** como fonte primária de texto.
   - Navegação de página: `input[type='number']` + botões "Avançar/Página anterior".
   - Diálogo continuar: sempre "Página atual".
   - Não clicar repetidamente "próxima página": navegar pelo SUMÁRIO (requisito oficial).
   - Registrar limite estrutural + localização original; NÃO extrair livro inteiro.
2. **`src/extract/pearson.js`**:
   - `detectReaderChoices()`: heurísticas atuais NÃO casam com o DOM real. Ajustar
     para reconhecer a tela via presença de `#pdf-novo`/`#pdf`.
   - `parseToc()` / `locateInToc()`: adaptar para entrada `{ summaryItemIndex }`
     vinda de `#summary-item-N`.
3. **`src/extract/ocr.js`** (decisão/qualidade — SEM motor real): documentar que o
   caminho primário é vendor OCR via `alt`; tesseract.js como fallback. Não inventar
   motor.

### 6.5 Rodar a suíte completa
```
npm.cmd test
```
Reportar números REAIS (antes 26 suites, 344/344 pass nas evidências; confirmar).

### 6.6 Gerar relatório de auditoria honesto
Documentar: o que funciona (Beta via `alt` para texto/tabelas), o que não funciona
(Clássico canvas; `alt` corrompido para matemática), e o que exige validação com
sessão real.

---

## 7. DECISÕES JÁ TOMADAS (não reabrir sem motivo)

- OCR real NÃO está no branch: `ocr.js` é só camada de decisão/qualidade.
- Motor preferido: **`alt` do Beta como fonte primária + tesseract.js fallback**.
  SEM soluções pagas.
- Sempre mostrar "Página atual" no diálogo de continuar leitura.
- Beta primeiro, Clássico como fallback (nunca abrir os dois simultaneamente).
- `integral` exige validação de começo/meio/fim + sem repetições + sem páginas
  ambíguas + sem conteúdo de outro capítulo (fail-closed).
- `not_found` = recurso existe mas capítulo/conteúdo esperado não localizado.
- `inaccessible` = conteúdo não exposto (canvas/DRM) ou leitor não carrega.

---

## 8. Arquivos relevantes

- `src/extract/books.js` — orquestração de produção, `extractBook`,
  `tryPearsonAutomation` (linha ~1598), EPUB/pageid já implementados.
- `src/extract/pearson.js` — módulo puro Pearson (`detectReaderChoices`,
  `detectBookFormat`, `parseToc`, `locateInToc`, `chooseReaderPreference`,
  `detectContentLayer`, `validateExtractedText`).
- `src/extract/ocr.js` — camada de decisão/qualidade (sem motor real).
- `src/extract/pdfs.js` — chama `ocr.planOcr()` (só decide quais páginas precisam).
- `electron/flow.js` — usa `src/extract/books.js` (caminho de produção).
- `poc/test-pearson-m3.js` — testes sintéticos Pearson (14/14 pass, seletores heurísticos).
- `poc/test-ocr-m3.js` — testes OCR sintéticos (12/12, só camada de decisão).
- `scripts/test-summary.js` e `poc/lib/qa-status.js` — fail-closed do revisor (NÃO alterar).

---

## 9. Ambiente / comandos úteis

- Worktree: `cd C:\Users\luiza\Documents\univespscraper-pearson-ocr`
- App / ZIP: `npm run app` produziu `C:\Users\luiza\Documents\UNIVESP_materiais_20261117.zip`.
  Livros marcados `inaccessible` = bug conhecido (leitor não automatizado ainda).
- Shell é PowerShell (Windows).

Regras de segurança da sessão:
- Não commitar nada dos arquivos de modais de auditoria sem revisar.
- Não incluir URLs assinadas/tokens/cookies em outputs ou relatórios.

---

## 10. REGISTRO PÓS-AUDITORIA (2026-11-21) — rodada de correções das 14 seções

Branch `integration/pearson-ocr-master`; nenhum commit reescrito; sem PR/merge.
Commits desta rodada (em ordem):
- `d98162c` fix: respect TOC hierarchy and ambiguity in Pearson summaries (§6: `classifyTocLevel`, `chapterEndBoundary`, `locateInToc` sem pegar o primeiro silenciosamente)
- `4172b08` fix: prevent incomplete Pearson chapters from passing as integral (§2: `integral` só com fronteira ALCANÇADA + sequência completa; §4: XHR /Leitor/pagination com timeout fixo 15s + fallback 30s, HTTP≠200, redirecionamento-login, sessão-expirada, resposta-sem-divbookmark, texto-vazio; §5: Beta só aceita página com confirmação do ESTADO do leitor e conteúdo distinto do anterior)
- `d034995` feat: integrate VitalSource accessibility text navigation (§7: `#pdf-ax-text` em iframe `/books/{isbn}/pages/{pageRef}/content`, TOC `button[aria-label^="Acesse "]`, navegação "Ir para Página" + Enter com página impressa absoluta, offset pageRef = pageRef − página impressa; pipeline pageid HTML preservado)
- `7e56cef` ci: run tests on integration branches (§10: gatilho `integration/**`)
- `8467b26` test: cover production Pearson and VitalSource automation (§9: `extractPearsonViaDriver` extraído do `tryPearsonAutomation` — mesmo código de produção — e `extractVitalsourceViaDriver` puro; 13 casos Pearson + 11 VitalSource registrados em `scripts/test-all.js`)

Classificação de evidência (§11): seletores/limitações VitalSource = observação REAL no Edge (2026-11-18); código = implementado e revisado; testes = sintéticos com drivers falsos sobre o orquestrador REAL; validação Electron com sessão real (Pearson/VitalSource/OCR) = PENDENTE.

Limitações honestas:
- OCR: camada de decisão/qualidade; motor previsto Tesseract.js PENDENTE (não instalado; nenhum texto simulado).
- Minha Biblioteca/VitalSource recusa UA de automação ("Browser Not Supported") — SEM contornar SSO/UA.
- Extração Pearson real em Electron ainda não reexecutada após estas mudanças (próximo passo).
