# RELATÓRIO DE AUDITORIA — Pearson/OCR (2026-11-18)

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
- Minha Biblioteca / VitalSource contra o leitor real (passo 6.3 do handoff —
  não explorado nesta sessão).
- Fallback tesseract.js com sessão real (baixar página assinada → OCR).
- Múltiplos livros (offsets diferentes; EPUB vs PDF).
