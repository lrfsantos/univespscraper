# RELATÓRIO FINAL — Pearson / OCR / Minha Biblioteca (2026-11-18)

> **ESTADO ATUAL (2026-11-21)** — branch `integration/pearson-ocr-master`;
> HEAD `0f4358e`; `npm test`: **30 suítes / 398 casos / 0 falhas**. CI: conferir
> Actions no SHA `0f4358e`. Validado REAL: login AVA, módulos 1/2, Pearson
> Clássico e fallback (integrais, uma janela); Beta falha fechada (leitor real
> mudou), VitalSource reader-auth. SINTÉTICO: orquestradores + adaptadores DOM.
> OCR Tesseract.js segue PENDENTE (sem motor instalado, sem simulação).
> Seções abaixo: **HISTÓRICO** — em conflito, prevalece este bloco.

Relatório consolidado do fechamento da sessão de integração e validação.
Nenhuma credencial, token, cookie ou URL assinada aparece neste arquivo (regra de segurança).

Sessão executada na worktree:
`C:\Users\luiza\Documents\univespscraper-pearson-ocr` (branch `integration/pearson-ocr-master`)
— **apenas commits LOCAIS** (nenhum push/merge/PR sem autorização explícita).

---

## 1. Objetivo e método

Integrar e validar a extração de livros das plataformas Pearson (Beta/Clássico),
Minha Biblioteca (VitalSource) e a camada de OCR. Tudo validado em **sessão real**
no leitor, com login autorizado do titular da conta, em browser de navegação real
(Edge) porque o reader rejeita UAs de automação. Fatos observados registrados em
`DESCOBERTAS-PEARSON-2026-11-18.md`; este relatório consolida avanços e pendências.

## 2. Avanços VALIDADOS em sessão real (fatos, não suposições)

### Pearson — tela de seleção e seletores
- Seleção REAL: `#pdf-novo` (Beta) / `#pdf` (Clássico).
- Beta: sumário `button#summary-btn` → `button#summary-item-N` (22 no livro 173412);
  item atual com classe `SummaryItem_active`; conteúdo em
  `img[class^="PdfImageView_pageImage"]` com `alt` = texto real da página (PT-BR);
  navegação por `input#input-navigate-read`; diálogo "continuar leitura" com regra
  **sempre "Página atual"**.
- Clássico: sumário `a.menu-links.btn-sumario` → `section.sumario` →
  `li.box-capt[data-pagina]` com `p[id]` = seção.
- **Descoberta importante**: o leitor Clássico (antes "não viável") É viável — o
  XHR `GET /Leitor/pagination?code=...&page={p}&paginaAnteriorId=0` retorna HTML com
  **texto completo da página** em `#divBookMark[aria-label]` (inclui tabelas
  linearizadas com dados), imagem em `#page-canvas[data-src]` (URL assinada — nunca
  registrada), mapeamento em `#ExibicaoAtual` (offset 11 no livro testado).
- Armadilha do tradutor automático (gtranslate/Chrome) mapeada: reescreve
  `aria-label`/DOM ao vivo; mitigado por cookie `googtrans=/pt/pt` e extração de
  fontes não traduzidas (`alt`/XHR); decisões por ids/estrutura.

### Minha Biblioteca / VitalSource (passo 6.3 — nesta sessão)
- Acesso só via LTI do AVA → "Abrir em uma nova janela"
  (`mod/lti/view.php?id=160557` → `app.minhabiblioteca.com.br/reader/books/9788571441002/pageid/50`),
  auto-login via SSO. Sem login direto (a plataforma rejeita).
- Distinção no AVA: os 6 LTIs da Minha Biblioteca usam ícone padrão do Moodle;
  os 98 do Pearson usam `staticbv.bvirtual.com.br/icon-50x50.png`.
- Estrutura: iframe `jigsaw.minhabiblioteca.com.br/mosaic/wrapper.html` → custom
  element `<mosaic-book>` (shadow DOM) → iframes `/pageid/{N}` (shell) e
  `/pages/{pageRef}/content` (conteúdo). **Texto completo na camada de
  acessibilidade `#pdf-ax-text`** (`div.comment{pageRef}` → `<p class="comment...">`).
- **`pageRef` incrementa exatamente +1 por página impressa** (884→885→886) —
  sinal de unicidade/ordem contra repetição.
- Navegação real confiável: caixa "Ir para Página" com **página impressa absoluta**
  + Enter. (Botão "Seguinte" não avançou nesta instância — não confiar.)
- TOC: `button[aria-label^="Acesse "]` "Acesse {título}, página {P}"; item atual por
  `aria-current="true"`; fronteira de capítulo = próxima entrada (validado:
  página 68 → capítulo 3).
- ⚠️ **Restrição de navegador**: o reader VitalSource recusa UA de automação
  ("Browser Not Supported") — exigiu Edge real. Risco para o app Electron (testar).

## 3. Código alterado (commits LOCAIS)

- `src/extract/pearson.js` — `detectReaderChoices()` reconhece `ids` (`pdf-novo`/`pdf`);
  novos `parseTocFromSummaryItems()` (Beta) e `parseTocClassic()` (Clássico);
  `locateInToc()` reconhece "Unidade N"; novo `chapterEndBoundary()` (próximo rótulo
  distinto, ignora duplicadas).
- `src/extract/books.js` — `tryPearsonAutomation()` reescrita com seletores REAIS:
  seleção por id, diálogo "Página atual", navegação pelo SUMÁRIO (nunca "próxima
  página" repetida), extração Beta via `alt` e Clássico via XHR `/Leitor/pagination`,
  limites estruturais (`pearsonMaxPages` 120 / `pearsonMaxChars` 500.000), status
  honesto (`integral` só com fronteira conhecida + sem páginas sem texto + sem
  repetições).
- `src/extract/ocr.js` — cabeçalho documentado: primário = vendor OCR dos leitores
  (Beta `alt` / Clássico `aria-label` do XHR); tesseract.js = fallback; SEM soluções
  pagas; módulo continua sendo APENAS decisão/qualidade (sem motor inventado).
- `electron/discovery.js` — `parseExpectedFromResource()` captura "Unidade N" explícito
  e limpa "(Leia a Unidade N ...)" do título do livro.
- `README.md` — seção Pearson atualizada (seletores reais + armadilha do tradutor +
  pendentes reais).
- O pipeline `pageid` existente (capaz de cobrir a Minha Biblioteca) não foi alterado;
  os achados da Minha Biblioteca ficam documentados para um próximo passo de código.

## 4. Suíte de testes — números REAIS desta sessão

```
npm test → suites = 27 | falhas = 0 | casosAgregados = 350 | pass = 350 | fail = 0
```
- Pearson sintético: 14/14 (verde após a reescrita com seletores reais).
- OCR sintético: 12/12 (camada de decisão, sem motor).
- Comportamento fail-closed do revisor preservado:
  `scripts/test-summary.js` e `poc/lib/qa-status.js` NÃO foram alterados.

## 5. O que funciona / não funciona / pendente (honestidade)

**Funciona (com prova real):** reconhecimento da tela por ids reais; sumário e
localização de capítulo/unidade nos dois leitores Pearson; extração de texto/tabelas
do Beta (`alt`) e do Clássico (XHR) sem OCR próprio; texto completo da Minha
Biblioteca via `#pdf-ax-text` com unicidade por `pageRef`.

**Não funciona / limitações:** fórmulas matemáticas vêm corrompidas no vendor OCR
(limitação do próprio leitor, não nossa); página exibida × página PDF varia por livro
(offset 11 no testado) — o `pageRange` do AVA só casa com fronteira exata de
`dataPagina`; sem fronteira conhecida o status nunca é `integral` (conservador);
reader VitalSource recusa UA de automação.

**Pendendo de validação real:** executar o fluxo no app empacotado (Electron) com a
sessão do usuário (e confirmar a UA do VitalSource no Electron); pipeline de código
da Minha Biblioteca (implementação do extrator dedicado, se desejado); fallback
tesseract.js sobre imagens assinadas; múltiplos livros (offsets diferentes; EPUB vs PDF).

## 6. Commits locais desta rodada

- `bbbdc52` — feat: Pearson automation with REAL selectors validated in real session.
- `ec9281f` — chore: refresh audit evidence after Pearson real-selector integration (27 suites, 350/350).
- `2bc3e93` — docs: Minha Biblioteca/VitalSource explored in real reader (6.3).
- `(final)` — relatório consolidado + HANDOFF (este arquivo).

## 7. Documentos de evidência
- `DESCOBERTAS-PEARSON-2026-11-18.md` — fatos observados (seletores reais por leitor).
- `AUDIT-PEARSON-OCR-2026-11-18.md` — auditoria (funciona/não funciona/pendentes).
- `RELATORIO-FINAL-PEARSON-OCR-2026-11-18.md` — este consolidado.

## 8. Registro pós-auditoria (2026-11-21)

Auditoria independente gerou 14 seções de correções, executadas no branch
`integration/pearson-ocr-master` (commits `d98162c`, `4172b08`, `d034995`,
`7e56cef`, `8467b26` — detalhes no HANDOFF §10). Resumo:
- §2 `integral` Pearson agora exige fronteira do próximo item ALCANÇADA e
  sequência completa; limites → `partial` com texto preservado.
- §4 XHR de paginação Clássico protegido (timeout fixo, HTTP≠200,
  redirecionamento-login, sessão expirada, resposta sem `#divBookMark`,
  texto vazio) — nunca pendente.
- §5 navegação Beta só aceita página com confirmação do estado do leitor e
  conteúdo distinto do anterior.
- §6 sumário: hierarquia (subcapítulo não encerra capítulo/unidade) e
  ambiguidade nunca resolvidas pela primeira ocorrência silenciosa.
- §3 fallback único Beta→Clássico só após falha comprovada (seleção ≠ fallback).
- §7 VitalSource: camada `#pdf-ax-text` com "Ir para Página" + Enter, offset
  pageRef, dedup por repetição — integrado com pipeline pageid preservado.
- §9 novos testes do código de PRODUÇÃO (13 Pearson + 11 VitalSource).
- §10 CI agora dispara em `integration/**`.
- Pendências mantidas: OCR real (Tesseract.js pendente), validação em sessão
  real no Electron após estas mudanças, UA do VitalSource ("Browser Not
  Supported").
