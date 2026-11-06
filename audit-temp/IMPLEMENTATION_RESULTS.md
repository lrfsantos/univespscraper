# Resultados de Implementação — Follow-up do commit 053ffc6 (Issues A e B)

> Data: 2026-11-05/06. Esta rodada resolve as duas lacunas apontadas pela revisão
> independente do commit `053ffc618b3c8c295b0ea5220de16eebf92af8bb`:
> 1. o parser estrutural EPUB não estava integrado à extração de produção;
> 2. a sincronização do frame PAGEID ativo com a página exibida não estava comprovada.
>
> Nenhuma das três correções anteriores foi reescrita; o comportamento conservador
> foi preservado (ver `REGRESSION_RESULTS.md`).

## 1. Issue A — Integração do parser estrutural EPUB na produção

### O que foi feito

- **Pacote EPUB servido por URL**: o leitor VitalSource (Minha Biblioteca) expõe o
  conteúdo em frame de origem `jigsaw.minhabiblioteca.com.br/.../epub/OEBPS/Text/<doc>.xhtml`.
  O OPF/nav podem ser obtidos por **fetch same-origin** a partir desse frame
  (`content.opf`/`package.opf` e `toc.ncx`/`nav.xhtml`) — sem contornar DRM.
- **`epub-structure.js`** ganhou parsing por **string XML** (produção por URL, sem
  tocar em disco): `parsePackageFromXml`, `parseOpfFromXml`, `navFromNcxXml`, e a
  validação `validateChapterExtraction` passou a comparar por **basename** (id do
  spine OU href), aceitando os documentos como chegam do leitor.
- **`books.js`**:
  - `fetchEpubPackageFromReader(app)` — busca OPF+nav no frame de conteúdo.
  - `applyEpubStructuralValidation({ pkg, chapter, extractedDocIds })` — decisão
    pura: `used`/`boundaryKnown`/`endOk`/`allChapterItemsExtracted`/`nextChapterIncluded`.
  - `extractEpub` passo 3.5: quando o pacote está acessível, a **estrutura decide**:
    `integral` somente se TODOS os documentos esperados do capítulo foram extraídos
    e NENHUM do capítulo seguinte foi incluído; caso contrário `partial`.
  - A navegação para o capítulo seguinte (mudança de identidade do documento)
    ficou como **mecanismo complementar**, usado somente quando o pacote não
    permitir decisão (`packageUsed=false` ou `boundaryKnown=false`).

### Verificação

- Testes de integração (`poc/test-integration-m3.js`, seção A): pacote por string
  parseado; cap. 1 em 2 docs ambos extraídos → `integral-valid`; falta de doc →
  `endOk=false`; doc do próximo capítulo incluído → `endOk=false`; pacote
  indisponível → `used=false` (navegação complementar); sem próximo capítulo →
  limite não identificável. **6/6 PASS.**
- Regressão sintética (Issue A e D) mantida: **29/29 PASS**.
- **Limitação ambiental**: o conteúdo do leitor real montou de forma intermitente
  nesta sessão (limite de sessão/dispositivos do VitalSource). Quando o pacote real
  não está acessível, `extractEpub` registra `packageUsed=false` e usa a navegação
  complementar — nunca `integral` sem evidência. **Não há validação declarada no
  leitor real nesta rodada** para o caminho de pacote; a integração é comprovada
  pelos testes de integração (contrato extração×validação estrutural).

## 2. Issue B — Sincronização PAGEID: página exibida × frame de conteúdo

### Sinais observados no leitor real

Inspeção do leitor (probe) identificou:

| Sinal | Forma observada |
|---|---|
| Página exibida (pageid, 0-based) | topo: `.../reader/books/<id>/pageid/<N>` |
| Identidade do frame de conteúdo | iframe `jigsaw.../books/<id>/pageid/<N>?brand=vitalsource&create=true` ou URL `.../pages/<N>/content` |
| Conteúdo carregado | `innerText` do frame |
| Estado de atualização | conteúdo novo tem hash diferente do capturado anteriormente |
| Número da página impressa | chrome `"Página N"` — **NÃO é igual** ao pageid |

A janela de TOPO (`app.minhabiblioteca...`) **não** é frame de conteúdo — excluída
por `isPageidContentFrame` (testável; caso B-9 da regressão).

### Mecanismo implementado

`books.js` agora extrai com **sincronização verificável** (`extractPageidViaSync`
sobre um driver — leitor real ou simulado):

1. Captura estado inicial (pageid, página impressa) e frame de conteúdo com
   identidade.
2. Navega (`next`).
3. Espera mudança **verificável** da página (`waitDriverChange` — não `setTimeout`).
4. Espera o frame com **identidade compatível** (pageid do frame == pageid exibido)
   atualizar o conteúdo (hash ≠ hash anterior).
5. Captura somente depois dessa confirmação (`syncCaptureFrame`).
6. Rejeita: conteúdo antigo (`frame-nao-atualizou-conteudo`), sem frame identificável
   (`sem-frame-identificavel`) e múltiplos candidatos (ambíguo) — todos **nunca**
   aprovam `integral` e interrompem/contam como parcial.

A heurística CSS (`scrolling`/largura) deixou de ser o critério único: a
**identidade de página na URL/src do frame** é o sinal principal (verificado no
DOM real); o estilo é mantido como informação auxiliar no audit.

### Testes (integração — leitor simulado realista)

`poc/test-integration-m3.js`, seção B — exercita o **mecanismo completo** via
`extractPageidViaSync` com um driver simulado (timers reais, identidade na URL,
pageid ≠ impressa):

| Cenário | Resultado |
|---|---|
| Página 45 ativa e 46 em prefetch → somente 45 capturada | PASS |
| **Corrida: interface mostra 46, frame ainda com conteúdo 45 → captura aguarda** | PASS |
| **Corrida inversa: frame 46 antes do número exibido → captura aguarda** | PASS |
| Página e frame correspondem → captura aprovada | PASS |
| Frame com conteúdo antigo (nunca atualiza) → captura rejeitada | PASS |
| Dois frames candidatos (mesma identidade) → associação ambígua | PASS |
| Nenhum frame identificável → associação rejeitada | PASS |
| Página seguinte do capítulo seguinte → não incluída | PASS |

**8/8 PASS.** A corrida crítica (conteúdo 45 não é atribuído à página 46) é o caso
B-2/B-3, coberto de forma assíncrona (o mecanismo espera o frame atualizar).

### Limitação ambiental

O leitor real montou conteúdo de forma intermitente nesta sessão (VitalSource).
Quando não monta, a extração é **honesta**: `inaccessible`/`leitor-nao-carregou`
(antes, chegou a capturar 27 chars do topo "Minha Biblioteca" — corrigido por
`isPageidContentFrame`). A validação do mecanismo completo é feita pelos testes de
integração com leitor simulado realista; **não declarada como validada no leitor
real** nesta rodada.

## 3. Issue C — preservada

`poc/lib/m3-criteria.js` e `statusForBook()` não foram enfraquecidos. Nenhum teste
desses critérios foi removido; apenas adicionado o caso B-9 (exclusão do topo) na
regressão. `partial`/`inaccessible` continuam sem satisfazer integridade; ausência
de evidência positiva, páginas ambíguas e conteúdo inesperado continuam impedindo
`integral`.

## 4. Resumo de testes desta rodada

| Suíte | Arquivo | Resultado |
|---|---|---|
| Regressão sintética (A/B/C/D) | `poc/test-regression-m3.js` | **29/29 PASS** |
| Integração (A estrutural + B sincronização) | `poc/test-integration-m3.js` | **14/14 PASS** |
| Real no AVA (smoke) | `poc/test-module3.js` | ambiente VitalSource intermitente — sem validação live nesta rodada (resultados honestos: `inaccessible`/`not_found` quando o conteúdo não monta) |

## 5. Arquivos alterados/criados

- `src/extract/epub-structure.js` (parsing por string, validação por basename)
- `src/extract/books.js` (integração estrutural EPUB; sincronização pageid)
- `poc/test-integration-m3.js` (novo)
- `poc/test-regression-m3.js` (caso B-9)
- `poc/probe-sync.js` (novo, diagnóstico do leitor)
- `audit-temp/IMPLEMENTATION_RESULTS.md`, `REGRESSION_RESULTS.md`, `CHANGES_AND_PENDING_ITEMS.md`
