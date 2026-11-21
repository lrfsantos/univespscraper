# RELATÓRIO DE AUDITORIA — Pearson/OCR (2026-11-18)

> **ESTADO ATUAL (2026-11-21)** — branch `integration/pearson-ocr-master`;
> HEAD `ca0b9f2`; `npm test`: **30 suítes / 398 casos / 0 falhas**. Correções
> P1/P2 da auditoria anterior em `d2494b9`/`f58c85a`; rodada de fidelidade
> (TOC N.M.K, fronteira §6-B, pageRange §2 com fim declarado pelo AVA, testes de
> adaptador DOM) em `ca0b9f2`. Seções abaixo: **HISTÓRICO** (inclui pendências
> já fechadas — ver registros de fechamento no fim); em conflito, prevalece este
> bloco. Validação real no Electron e OCR Tesseract.js: PENDENTES.

Relatório honesto da sessão de integração/validação. Nenhuma credencial, token,
cookie ou URL assinada é incluída (regra da sessão).

## 1. Método

- Navegação REAL no leitor Pearson com sessão autenticada do usuário
  (autorização explícita do titular da conta), em browser dedicado da
  ferramenta de automação — livro 173412 "Empreendedorismo" (ADM270).
- Nenhuma suposição foi aceita sem observação direta do DOM/rede; os fatos
  estão registrados em `DESCOBERTAS-PEARSON-2026-11-18.md`.

## 2. O que foi VALIDADO em sessão real (fatos observados)

1. **Tela de seleção de leitor**: botões reais `#pdf-novo` (Beta) e `#pdf`
   (Clássico). Confirmada a abertura dos dois leitores a partir do LTI do AVA.
2. **Leitor Beta** (`leitor.bvirtual.com.br/reader/{pub}/pdf/{pag}`):
   - Sumário: `button#summary-btn` abre; itens são `button#summary-item-N`
     (22 no livro testado), nome completo em `aria-label`, item atual marcado
     com classe `SummaryItem_active`.
   - Conteúdo: `img[class^="PdfImageView_pageImage"]` com `alt` = texto real da
     página em PT-BR (inclui CONHEÇA/REFLITA/DISCUTA/APLIQUE).
   - Navegação: `input#input-navigate-read` (`input[type=number]`).
   - Diálogo "continuar leitura": botões "Última página lida ({n})" e
     "Página atual (1)" — regra: sempre "Página atual".
3. **Leitor Clássico** (`plataforma.bvirtual.com.br/Leitor/Publicacao/{pub}/pdf/{pag}?code=...`):
   - **O texto da página É acessível** — resultado que corrige a hipótese
     anterior ("canvas sem texto = inviável"): o XHR
     `GET /Leitor/pagination?code=...&page={paginaPdf}&paginaAnteriorId=0`
     retorna HTML com `#divBookMark[aria-label]` contendo o TEXTO COMPLETO da
     página (texto corrido e tabelas linearizadas com valores — verificado em
     páginas de texto e de tabela).
   - `#page-canvas[data-src]` traz a URL assinada da imagem `page-N.jpg`
     (fallback OCR possível; URL NUNCA registrada em logs/relatórios).
   - `#ExibicaoAtual` mapeia página exibida (`value`) × página PDF
     (`data-original`) — offset consistente de 11 no livro testado.
   - Sumário: `a.menu-links.btn-sumario` → `section.sumario` →
     `li.box-capt[data-pagina]` com `p[id]` = nome da seção; clicar navega.
   - Renderização em canvas (fabric.js) — sem camada textual no DOM vivo.
4. **Armadilha do tradutor**: o leitor carrega gtranslate e o navegador pode
   traduzir o DOM ao vivo (inclusive `aria-label`) — o texto ao vivo chegou a
   ser lido em inglês. Mitigado: cookie `googtrans=/pt/pt` fixa PT-BR e o
   extrator lê fontes não traduzidas (`alt`/XHR) e decide por ids/estrutura.
5. **CDN compartilhado**: Beta e Clássico servem as mesmas imagens
   `conteudo.bvirtual.com.br/publicacoes/{id}/page-N.jpg` com URL assinada
   CloudFront (403 sem assinatura) — confirma descoberta anterior.
6. **Sessão**: a URL assinada (`?code=`) expira — o leitor cai na tela de
   Login. Política aplicada: fechar e relançar, nunca loop.

## 3. Mudanças de código (commits LOCAIS)

- `src/extract/pearson.js`:
  - `detectReaderChoices()` reconhece a tela REAL pelos ids `pdf-novo`/`pdf`
    (texto como fallback).
  - Novos `parseTocFromSummaryItems()` (Beta) e `parseTocClassic()` (Clássico).
  - `locateInToc()` reconhece "Unidade N" (padrão real dos livros UNIVESP)
    além de "Capítulo N", e usa `dataPagina` real para intervalos (fail-closed:
    sem fronteira exata, não escolhe).
  - Novo `chapterEndBoundary()` — fronteira de fim de capítulo (próximo
    rótulo distinto; ignora entradas duplicadas da mesma unidade).
- `src/extract/books.js` — `tryPearsonAutomation()` reescrito com os seletores
  reais: seleção por id, diálogo "Página atual", sumário por leitor, navegação
  pelo SUMÁRIO (nunca "próxima página" repetida), extração limitada
  (`pearsonMaxPages` padrão 120, `pearsonMaxChars` padrão 500.000), status
  honesto (`integral` só com fronteira conhecida + sem páginas sem texto +
  sem repetições).
- `src/extract/ocr.js` — documentado no cabeçalho: caminho primário = vendor
  OCR dos leitores (`alt` do Beta / `aria-label` do XHR do Clássico);
  tesseract.js sobre a imagem assinada é FALLBACK; sem soluções pagas; o
  módulo continua sendo APENAS decisão/qualidade (sem motor inventado).
- `electron/discovery.js` — `parseExpectedFromResource()` captura
  "Unidade N" do âncora do AVA com a mesma honestidade de "Capítulo N"
  (só quando declarado) e limpa "(Leia a Unidade N ...)" do título do livro.
- `README.md` — seção Pearson atualizada com a validação real e a armadilha
  do tradutor; pendências reais mantidas explícitas.

## 4. Suíte de testes (números REAIS desta sessão)

```
npm test → suites=27 falhas=0 casosAgregados=350 pass=350 fail=0
```

- Pearson sintético: 14/14 (suíte intacta e verde após a reescrita).
- OCR sintético: 12/12 (camada de decisão — sem motor).
- Comportamento fail-closed do revisor preservado: `scripts/test-summary.js`
  e `poc/lib/qa-status.js` NÃO foram alterados.

## 5. O que FUNCIONA (com evidência real)

- Reconhecimento da tela de seleção pelos ids reais.
- Sumário e localização de capítulo/unidade nos dois leitores.
- Extração de texto/tabelas do Beta via `alt` (vendor OCR).
- Extração de texto/tabelas do Clássico via XHR de paginação (vendor OCR) —
  sem necessidade de motor OCR próprio.

## 6. O que NÃO funciona / limitações honestas

- Fórmulas matemáticas: `alt`/`aria-label` do vendor saem corrompidos
  (limitação do próprio leitor, medida em 2026-11-17) — páginas ricas em
  matemática exigiriam OCR de imagem como fallback (tesseract.js; não
  exercitado com sessão real nesta sessão).
- Página exibida × página PDF: offset por livro (11 no livro testado);
  `pageRange` do AVA só casa com fronteira EXATA de `dataPagina` — caso
  contrário falha fechada (`capitulo-nao-localizado`). Pode exigir ajuste
  com mais livros reais.
- Sem fronteira conhecida (último capítulo), o status nunca é `integral`
  (conservador).

## 7. Pendências (declaração honesta)

- Execução end-to-end com o aplicativo empacotado (Electron) usando a sessão
  real do usuário (os fluxos desta sessão foram validados no browser de
  automação; o caminho Electron usa os mesmos seletores via driver).
- **Minha Biblioteca / VitalSource — EXPLORADO nesta sessão (2026-11-18)** no
  leitor real (via Edge/AVA, LTI 160557, livro 9788571441002):
  - TEXTO COMPLETO em camada de acessibilidade `#pdf-ax-text` (iframe
    `jigsaw.../pages/{pageRef}/content` dentro de `<mosaic-book>` shadow DOM);
    `pageRef` +1 por página impressa (unicidade); TOC
    `button[aria-label^="Acesse "]` "Acesse {título}, página {P}"; navegação por
    "Ir para Página" (página impressa absoluta) + Enter; fronteira = próxima
    entrada do TOC (validado: pág. 68 → cap. 3). Acesso só via LTI do AVA
    (sem login direto). **Risco**: leitor recusa UA de automação
    ("Browser Not Supported") — precisou do Edge real; testar no Electron.
  - Código de integração (pipeline `mb`) AINDA NÃO implementado — descobertas
    em `DESCOBERTAS-PEARSON-2026-11-18.md` §10; extração da Minha Biblioteca só
    com o próximo passo de código.
- Fallback tesseract.js com sessão real (baixar página assinada → OCR).
- Múltiplos livros (offsets diferentes; EPUB vs PDF).

## Registro de fechamento (2026-11-21)

A auditoria independente posterior gerou 14 seções de correções, executadas no
branch `integration/pearson-ocr-master` (commits `d98162c` §6, `4172b08`
§2/§4/§5, `d034995` §7, `7e56cef` §10, `8467b26` §9 — detalhes em HANDOFF §10 e
RELATORIO-FINAL §8). Itens acima que deixaram de valer como pendência:
- Código de integração da Minha Biblioteca (VitalSource): IMPLEMENTADO (§7) —
  camada `#pdf-ax-text`, "Ir para Página" + Enter com página impressa absoluta,
  offset pageRef por livro. Validação em sessão real no Electron continua
  PENDENTE (UA de automação pode ser recusada — sem contornar SSO/UA).
- Fallback tesseract.js: segue PENDENTE e inequívoco (motor não instalado;
  `ocr.js` continua camada de decisão/qualidade, sem simulação).

## Segunda rodada pós-auditoria (2026-11-21, commit d2494b9)

FULL AUDIT da IA auditora (achados P1/P2) endereçados:
- §2: `expected.pageRange` do AVA agora DELIMITA a janela de extração (Pearson
  Beta/Clássico e VitalSource) — nunca o capítulo inteiro; só estreita
  (endPage exclusivo = reqEnd + 1). Casos P14/V12.
- §3: janelas/popups abertos por uma tentativa fecham ANTES do relaunch
  (`closeWindowsOpenedSince`) e antes do fallback (`driver.closeNewWindows`) —
  nunca dois leitores abertos. Sem caso automatizado (fluxo real Electron);
  pendência de sessão real mantida.
- §4: fallback 30s do XHR `/Leitor/pagination` limpa o timer e aborta a
  requisição no `done` (nunca pendente).
- §5: confirmação de página (Beta) exige evidência INDEPENDENTE
  (`#ExibicaoAtual`) ou mudança real de conteúdo — o input programático
  (preenchido por nós) nunca é prova. Caso P15.
- §6-A: `parseExpectedFromResource` preserva `chapterKind` ('capitulo' vs
  'unidade') e `locateInToc` respeita o tipo declarado — Capítulo 2 ≠
  Unidade 2. Casos P17/P18.
- §6-B: fronteira com item SEM numeração ("Referências") é AMBÍGUA —
  integral bloqueado (fail-closed), texto preservado. Casos P16/V13.
- §7: `readAxText` captura identidade (location.href) e texto no MESMO
  snapshot e revalida contra a URL do driver (corrida eliminada).
Bateria: 29 suítes, 381 casos, 0 falhas. OCR tesseract.js segue PENDENTE.

## Terceira rodada — adaptadores (2026-11-21, HEAD ca0b9f2)

Achados P1/P2 da auditoria do GPT sobre `25361d5` corrigidos:
- Baseline de janelas Pearson capturado ANTES da seleção (não no fallback), com
  popup da tentativa anterior fechado antes do único fallback; operações do
  leitor passam a usar `activeWin` (janela real do popup). Caso A5.
- Primeira página Beta exige evidência independente: assinatura de conteúdo
  capturada ANTES da navegação; conteúdo antigo não vazio → partial. Casos P15/P25/P26.
- VitalSource: ISBN/frame vinculados à navegação; `gotoPage` exige mudança real
  de pageRef antes de calibrar o offset; leitura atômica e frame único. Corrigido
  também o uso de URL obsoleta do frame na revalidação. Casos V14–V17.
Bateria final: 30 suítes, 398 casos, 0 falhas. **Validação real no Electron
autenticado: BLOQUEADA** — depende de sessão humana (login manual no AVA); OCR
Tesseract.js e rotação da credencial histórica seguem PENDENTES.

