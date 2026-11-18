# DESCOBERTAS REAIS — Pearson/OCR (sessão 2026-11-18, browser in-app)

Fatos OBSERVADOS em sessão real (login do usuário autorizado). Sem credenciais,
tokens ou URLs assinadas neste arquivo (regra de segurança).

## 1. Confirmações do handoff anterior

- Leitor Beta: `leitor.bvirtual.com.br` (padrão real: `/reader/{PublicacaoId}/pdf/{pagina}`)
- Leitor Clássico: `plataforma.bvirtual.com.br/Leitor/Publicacao/{PublicacaoId}/pdf/{pagina}?code=...`
- Tela de seleção de leitor: `#pdf-novo` (Beta) / `#pdf` (Clássico) — handoff 4.2
- CDN compartilhado: `conteudo.bvirtual.com.br/publicacoes/{id}/page-N.jpg` com
  URL assinada CloudFront (Policy/Signature/Key-Pair-Id) — 403 sem assinatura.
- `alt` do Beta: texto real da página; fórmulas matemáticas corrompidas (handoff 4.8).

## 2. NOVO — Leitor Clássico é VIÁVEL (derruba a conclusão antiga)

O XHR de paginação do Clássico:
```
GET /Leitor/pagination?code=<assinado>&page={paginaPdf}&paginaAnteriorId=0
```
retorna **HTML** (`text/html; charset=utf-8`, 200) contendo:

| Elemento | Conteúdo |
|---|---|
| `#page-canvas[data-src]` | URL assinada da imagem `page-N.jpg` (fallback OCR possível) |
| `#divBookMark[aria-label]` | **TEXTO COMPLETO DA PÁGINA** (vendor OCR, PT-BR) |
| `#divBookMark[data-id]` | id único da página (ex. `9788520727152`) |
| `#ExibicaoAtual` | input de página: `value` = página exibida, `data-original` = página PDF |

- `aria-label` contém texto corrido E tabelas linearizadas com dados completos
  (testado pág. 15 texto; pág. 20 Tabela 1.1 com todos os valores; pág. 40 continuação).
- Conclusão: Clássico NÃO precisa de OCR próprio — o texto vem no XHR.
  Canvas é só a renderização (fabric.js: `lower-canvas`/`upper-canvas` em `.canvas-container`).
- `data-original - value` = offset fixo por livro (empírico: 11 neste livro:
  PDF 12→exibida 1, 15→4, 20→9, 40→29, 126→115).

## 3. TOC (Sumário) — seletores REAIS por leitor

### Beta
- Botão que abre o sumário: **`button#summary-btn`** (`aria-label="Sumário"`)
- Itens: **`button#summary-item-N`** (N = 0..21 neste livro), classes
  `SummaryItem_box__yjAFs summary-item-box`, `aria-label` = nome completo da seção
  (texto visível é truncado com "..." — usar `aria-label`), item ativo tem
  classe `SummaryItem_active__-N3Xf`.
- ⚠️ CSS modules: classes têm sufixo (`__Wmsvq` etc.). Seletores por sufixo
  EXATO quebram. Usar `[class^=...]` / `[class*=...]` / ids.

### Clássico
- Abrir sumário: link **`a.menu-links.btn-sumario`** (também existe
  `button#acess-btn-sumario` no menu lateral).
- Painel: **`section.sumario`** → `ul[role="menu"][aria-label="Sumário"]`
  → itens **`li.box-capt[data-pagina="{paginaPdf}"]`** com `p[id="{nome seção}"]`
  e `p[aria-label="Acesse {nome}"]`.
- `data-pagina` = página PDF (Capa=0, Sumário=6, Unidade 1=12, Unidade 2=40...).
- Clicar no `li` navega o leitor até a página (sem mudar a URL path).

## 4. Conteúdo textual do Beta

- `img[class^="PdfImageView_pageImage"]` com **`alt`** = texto completo da página (PT-BR).
  - ⚠️ Classe real é `PdfImageView_pageImage__Wmsvq` (CSS modules). O seletor
    `img.PdfImageView_pageImage` (classe exata) **NÃO casa**. Usar
    `img[class^="PdfImageView_pageImage"]`.
  - O texto do `alt` inclui estrutura: título da unidade, CONHEÇA/REFLITA/DISCUTA/APLIQUE.
- Página exibida no título da aba: "Empreendedorismo - pág. {n}".
- Progresso: "Progresso da leitura: {x}%, página {n}." e total "/ 183".

## 5. Navegação de página (Beta)

- Campo: **`input#input-navigate-read`** (`input[type=number]`,
  classes `Input_input__rxmnz Input_center__pIlxh form-control`).
- Handoff 4.5 (botões "Avançar uma página"/"Página anterior") — confirmar labels
  exatos ao automatizar; priorizar navegação pelo SUMÁRIO (requisito oficial).

## 6. Diálogo "continuar leitura" (Beta)

- Aparece ao reabrir livro com histórico: "Sua última página lida foi {n}..." com
  botões "Última página lida ({n})" e "Página atual (1)".
- REGRA: clicar sempre **"Página atual"** (handoff 4.6).
- ⚠️ Labels podem aparecer traduzidos (ver seção 8) — identificar por posição/estrutura.

## 7. TRADUÇÃO AUTOMÁTICA (armadilha nova, importante)

- O leitor carrega o widget gtranslate (`googleTraducao.js` +
  `cdn.gtranslate.net/widgets/latest/dropdown.js`) e o Chrome pode traduzir a página.
- **O tradutor REESCREVE `aria-label`/texto do DOM ao vivo para o idioma do browser**
  (observado: aria-label da página 126 virou inglês).
- As respostas XHR **não são afetadas** (texto chega PT-BR do servidor).
- **REGRAS para o código**: extrair texto de respostas XHR (Clássico) e de `alt`
  lido cedo (Beta); NUNCA depender de texto de UI traduzido para decisões;
  fixar cookie `googtrans=/pt/pt` quando possível.

## 8. Comportamento de sessão

- A URL assinada (`?code=`) do Clássico expira — leitor cai na tela de Login.
- O login AVA é feito num iframe SSO (`login.univesp.br/simplesaml/...`);
  após autenticar o top-level navega ao destino (RelayState).
- Política do projeto: se o leitor der erro, fechar aba e relançar (nunca loop).

## 9. Impacto no código (src/extract)

1. `books.js` `tryPearsonAutomation()`:
   - Beta: `#summary-btn` → `#summary-item-N` (usar aria-label); extração via
     `img[class^="PdfImageView_pageImage"]` `alt`; página via `#input-navigate-read`.
   - Clássico: EXTRAIR via XHR `/Leitor/pagination` (texto em `#divBookMark[aria-label]`,
     imagem em `#page-canvas[data-src]`, mapeamento em `#ExibicaoAtual`) — sem OCR próprio.
   - TOC do Clássico: `section.sumario li.box-capt[data-pagina]` + `p[id]`.
2. `pearson.js`: `detectReaderChoices()` → reconhecer `#pdf-novo`/`#pdf`;
   `parseToc()`/`locateInToc()` aceitar entrada `{ summaryItemIndex }` (Beta) e
   `{ dataPagina }` (Clássico).
3. `ocr.js`: manter como camada de decisão/qualidade; primário = vendor OCR
   (Beta `alt` / Clássico `aria-label` do XHR); fallback = tesseract.js na imagem
   assinada (`data-src`), sem soluções pagas.
