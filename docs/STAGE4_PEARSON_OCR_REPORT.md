# Relatório — Biblioteca Pearson (Beta/Clássico), OCR e validação

**Branch:** `fix/audit-remediation-2026-11-15`
**HEAD inicial:** `94d76dad643b2ea0238e724b4dae355b1fdd0551`
**Data:** 2026-11-15

Este relatório descreve o que foi implementado nesta rodada, o que foi corrigido,
o que está pendente e as evidências. Ele segue o escopo do prompt "PRÓXIMA ETAPA —
IMPLEMENTAÇÃO DA BIBLIOTECA PEARSON, OCR E VALIDAÇÃO COMPLETA DAS EXTRAÇÕES".

> Regra de honestidade seguida: nada é declarado validado em ambiente real sem
> evidência. Testes sintéticos são identificados como tal. Validação real no AVA/
> Pearson/executável permanece pendente (não executada nesta máquina).

---

## Fase A — Diagnóstico do código atual

Estado da branch confirmado: HEAD `94d76dad` (igual ao informado), branch
`fix/audit-remediation-2026-11-15`, working tree com apenas arquivos de
diagnóstico não rastreados. `npm ci`/`npm test` verdes (318 casos antes desta
rodada).

Mapeamento do fluxo de livros:

- `src/extract/books.js` — extração de livros/leitores (Módulo 3): VitalSource
  EPUB (Minha Biblioteca), PAGEID, BVirtual. A entrada principal é
  `extractBook` → `extractBookWithReader` (um único launch; observa o leitor via
  `observeReader`/`classifyReader`; faz relaunch controlado para `unknown`;
  interrompe imediatamente em `reader-auth`).
- **Ponto de integração Pearson:** no branch 5 de `extractBookWithReader`, quando o
  leitor é reconhecido como BVirtual/Pearson (`bvpdf`/`bvleitor`/`unknown`), o
  fluxo devolvia `failureType: 'reader-selection-required'` (sem automatizar a
  escolha Beta/Clássico). Foi exatamente aí que a automação foi ligada.
- `src/extract/pdfs.js` — Módulo 2 (PDF): baixa o original (via sessão do
  navegador), extrai texto por página (`analyzePdf`), `statusFor` devolve
  `partial` quando há páginas sem texto (PDF digitalizado) — ponto de integração
  do OCR.
- `src/extract/epub-structure.js` — EPUB 2/3, hierarquia, limites.
- `electron/flow.js` / `electron/discovery.js` — orquestração do fluxo, parsers
  puros, classificação de recursos, dedup.
- Controle de janelas: `extractBook` já fechava popups em `finally`
  (`closeWindowsOpenedSince`) — requisito da seção 7 em grande parte já atendido.
- OCR: **não existia** camada de OCR (nem decisão nem execução). Nenhuma
  dependência de OCR em `package.json`.
- Classificação de falhas: `drm-not-extractable` só era usada com evidência;
  `reader-selection-required` era mantida para Pearson — conforme o prompt.

## Fase B — Implementação Pearson

### Novo módulo `src/extract/pearson.js` (puro, testável)

Funções exportadas (todas puras, sem dependência de navegador):

| Função | Papel |
|---|---|
| `detectReaderChoices({bodyText, links, buttons})` | Reconhece a tela de seleção de leitor (Beta/Clássico) por evidência de texto/aria — nunca inventa seletor; sem hint → `{recognized:false}` |
| `detectBookFormat({bodyText, links, url})` | Identifica PDF ou EPUB por evidência (extensão, palavras "leitor beta/clássico", "sumário") |
| `chooseReaderPreference(detected)` | Beta primeiro; Clássico como fallback |
| `nextReaderAfterFailure(preferred, attempted)` | Um único fallback Beta→Clássico (sem loop) |
| `parseToc(entries)` | Sumário hierárquico (rótulo, profundidade, href, normalizado) |
| `locateInToc(toc, expected)` | Localiza capítulo/intervalo SEM escolha arbitrária; capítulo inexistente → `not_found` |
| `detectContentLayer({mainText, framesText, hasImages})` | Distingue DOM / frame / imagem (imagem → candidato a OCR), **sem assumir DRM** |
| `validateExtractedText({text, expected})` | Rejeita menu/navegação como conteúdo; valida quantidade mínima |

### Integração no fluxo real (`src/extract/books.js`)

- `tryPearsonAutomation({app, win, expected, opts})`: lê o DOM da janela atual,
  reconhece a tela, detecta formato, escolhe Beta (fallback Clássico), aguarda o
  leitor, lê o sumário, localiza o capítulo indicado, navega e extrai texto.
  - **Não abre Beta e Clássico simultaneamente** (seleciona um, só tenta o outro
    se o primeiro falhar).
  - **Não clica em elementos aleatórios**: usa heurísticas de texto visível/aria/
    classes genéricas, marcadas como heurísticas.
  - **Não extrai o livro inteiro** quando só capítulo/páginas são indicados.
  - Se não reconhecer a tela com segurança → retorna `null` e o fluxo **mantém o
    status original** `reader-selection-required` (não inventa seletor, não
    classifica como DRM).
- Ligado em `extractBookWithReader` (branch 5): antes de devolver o status
  pendente, tenta `tryPearsonAutomation`; se `ok`, retorna a extração; senão,
  mantém `reader-selection-required` e registra os passos em `attempts`.
- Exportado `tryPearsonAutomation` e o próprio módulo `pearson`.

### Sobre a validação real

**NÃO foi possível validar a tela real do leitor Pearson nesta máquina** (exige
sessão autenticada no AVA e o leitor carregar conteúdo). A estrutura do DOM real
é desconhecida e os seletores são heurísticos por design. **A extração Pearson
real continua pendente** — o código não declara suporte completo; apenas
automatiza best-effort e preserva o status honesto quando não reconhece.

## Fase C — OCR

### Novo módulo `src/extract/ocr.js` (puro, testável)

| Função | Papel |
|---|---|
| `classifyPageText(page)` | Página `text` (tem camada) / `scanned` (candidata a OCR) / `unknown` (erro) |
| `planOcr(pages)` | Decide QUAIS páginas precisam de OCR (evita OCR desnecessário); `allScanned`, `withText`, `needsOcr` |
| `validateOcrQuality({text, confidence})` | PASS/PARTIAL/FAIL: vazio, curto, caracteres de substituição, poucas letras (ilegível), repetição anormal de linhas, confiança baixa |
| `composeOcrPages(results)` | Compõe texto preservando ordem e separação de páginas |

### Integração (`src/extract/pdfs.js`)

- Após `analyzePdf`, `extractPdf` agora grava `result.ocr = ocr.planOcr(...)` —
  registra o plano e a necessidade de OCR **sem inventar texto**.
- Comportamento de status existente (`statusFor`) preservado.

### Tecnologia e empacotamento

**Não foi adicionada uma dependência pesada de motor de OCR (ex.: tesseract.js)
nesta rodada.** Motivo (documentado, sem enganar): não é possível validar aqui que
um motor WASM + modelos de idioma (`por`) empacotado no Electron/Windows funciona
neste ambiente (a política WDAC bloqueia o executável portátil nesta máquina;
não há sessão real para gerar páginas digitalizadas). A camada implementada é a
**decisão/qualidade**, com motor pluggável (contrato `ocrPage({pageIndex,
imageBuffer, lang})`). A escolha/validação do motor e o tamanho adicional no
executável ficam como pendência técnica (seção 14 do prompt) — ver pendências.

## Fase D — Regressões e qualidade

- 2 novas suítes sintéticas registradas em `scripts/test-all.js`:
  - `poc/test-pearson-m3.js` (14 casos: reconhecimento da tela, PDF/EPUB,
    preferência/fallback, sumário hierárquico, capítulo localizado/inexistente,
    intervalo, camada de conteúdo, rejeição de menu);
  - `poc/test-ocr-m3.js` (12 casos: PDF textual, totalmente/parcialmente
    digitalizado, página vazia, curta, ilegível, substituição, repetição,
    confiança, ordem e separação de páginas).
- **Resultado local:** `npm test` → **26 suítes, 344/344 casos, 0 falhas**
  (era 318 antes; +26 novos casos Pearson/OCR).
- Extratores existentes preservados (nenhum teste antigo removido/enfraquecido).

## Fase E — Electron e empacotamento

- A integração Pearson/OCR é de **funções puras + hook best-effort**; o fluxo
  existente do Electron não foi alterado em comportamento quando o Pearson não é
  reconhecido.
- **Não foi gerado/validado o executável portátil** nesta rodada (política WDAC
  desta máquina bloqueia a execução; não há evidência de execução do pacote). Isso
  permanece pendente (seção 13 do prompt). Nenhuma dependência nova foi adicionada
  ao pacote (evita risco de quebrar o build sem validação).

## Fase F — Pendências (validação real)

1. **Pearson real**: confirmar o DOM real da tela Beta/Clássico, ajustar os
   seletores heurísticos e validar a extração efetiva do capítulo indicado.
2. **OCR real**: escolher/validar um motor (ex.: tesseract.js) empacotado no
   Electron/Windows, com modelo `por`, e validar a execução offline em PDF
   digitalizado real (tamanho do executável, desempenho).
3. **Executável portátil**: validar em Windows sem WDAC.
4. **Validação real no AVA**: procedimento pronto (seção abaixo), não executado
   nesta máquina.

### Procedimento de validação real no AVA (pronto)

1. `npm.cmd run app`.
2. Clique em "Entrar no AVA"; login manual na janela do navegador.
3. Clique em "Já concluí o login" e verifique a tela "Suas matérias".
4. Selecione uma disciplina e as semanas; clique em "Continuar" e depois em
   "Iniciar extração".
5. Inclua materiais de: site externo, PDF direto do AVA, livro da Minha
   Biblioteca (EPUB/PAGEID) e, se disponível, um livro da Biblioteca Pearson.
6. Verifique no ZIP: estrutura por disciplina/semana, metadados por recurso,
   status honesto no `EXTRACTION_REPORT.md`, e que fóruns/lives/avaliações foram
   ignorados.

## Arquivos alterados nesta rodada

| Arquivo | Mudança |
|---|---|
| `src/extract/pearson.js` | **novo** — módulo puro Pearson (seleção Beta/Clássico, sumário, formato, camada de conteúdo) |
| `src/extract/ocr.js` | **novo** — módulo puro OCR (decisão/qualidade) |
| `src/extract/books.js` | importa `pearson`; `tryPearsonAutomation` ligado ao branch 5; exporta `tryPearsonAutomation` e `pearson` |
| `src/extract/pdfs.js` | importa `ocr`; `extractPdf` grava `result.ocr` (plano) |
| `poc/test-pearson-m3.js` | **novo** — 14 testes sintéticos Pearson |
| `poc/test-ocr-m3.js` | **novo** — 12 testes sintéticos OCR |
| `scripts/test-all.js` | registra as 2 novas suítes |
| `audit-temp/PEARSON_RESULTS.json` | evidência da suíte Pearson |
| `audit-temp/OCR_RESULTS.json` | evidência da suíte OCR |
| `README.md` | atualizado: Pearson best-effort, camada de OCR, limitações honestas |

## Conclusão

Implementado nesta rodada: módulo puro Pearson (seleção de leitor + navegação por
sumário, best-effort e não-rompedor), módulo puro OCR (decisão e qualidade),
integração nos fluxos de `books.js`/`pdfs.js`, 26 novos testes sintéticos,
documentação. **Não** é declarada a Pearson como concluída (falta validação real);
**não** é declarado OCR funcional em produção (falta motor validado e empacotado);
**não** é declarado o executável validado. Os critérios de aceitação que dependem
de ambiente real (seleção real da tela, navegação real do sumário, OCR real,
executável real) estão marcados como **pendentes**, não simulados.
