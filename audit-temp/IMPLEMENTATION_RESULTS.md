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

---

# Consolidação definitiva da Fase 3 (2026-11-06)

## 6. Correções aplicadas nesta rodada (Fase 3 — consolidação)

### 6.1 EPUB 2/3 — navegação (3.1)
- **EPUB 2/NCX** preservado: `navMap`/`navPoint`, hierarquia (profundidade), links
  `content src`, resolução relativa ao arquivo NCX.
- **EPUB 3/nav.xhtml** implementado (parser próprio): identifica o
  `nav[epub:type="toc"]`, percorre `ol>li>a` com sublistas aninhadas (hierarquia),
  obtém títulos e `href`, resolve caminhos relativos ao arquivo `nav.xhtml`,
  remove fragmentos de URL do caminho do documento e **ignora** outros `nav`
  (landmarks, page-list). Namespace `epub:` tolerado (prefixo alternativo).
- Dedup de entradas por `rawHref` (fragmentos distintos do mesmo doc não colapsam).

### 6.2 Identidade documental e sincronização (3.2)
- `extractEpub` refatorado para **orquestração por adaptador**
  (`extractEpubViaAdapter` + `createEpubReaderAdapter`): cada captura é associada à
  identidade do documento que a produziu; após qualquer navegação, identidade E
  texto são **revalidados** (nunca se reutiliza a captura anterior); navegação só é
  considerada bem-sucedida se o documento ativo **mudou** (`waitEpubDocChange`);
  se o documento não puder ser sincronizado → não `integral`.

### 6.3 Capítulos multi-XHTML (3.3)
- Registro individual de cada documento capturado (dedup por caminho resolvido);
- coleta dos documentos do capítulo via `navigateNextDoc` (limitada), sem incluir
  documentos de outros capítulos nem do capítulo seguinte;
- `extractedDocIds` reflete **todos** os docs capturados (não só o último);
- `integral` somente quando todos os documentos obrigatórios têm evidência;
  documento ausente → `partial`.

### 6.4 Colisões de basename (3.4)
- Comparação por **caminho resolvido normalizado** (`pkgResolve` + `normPath`);
  basename usado **somente se único** no spine; colisão
  `Text/chapter01.xhtml` × `Appendix/chapter01.xhtml` → caminho casa, basename
  ambíguo NÃO casa (teste S-collision).

### 6.5 Confirmação de limites (3.5)
- `confirmEpubBoundaryDecision` consumido corretamente: se o pacote está disponível
  mas o limite não é confirmável, o fallback de navegação **não** produz falsa
  confirmação (`packageUsed=true` → `epubBoundaryConfirmed` não sobrescrito).
- Limite exige evidência estrutural (spine/navegação/mudança de documento);
  pontuação/tamanho/título do livro nunca são prova de fim de capítulo.

### 6.6 PAGEID — valores zero (4.1)
- `readPageidFrames` usa **verificação explícita de ausência** (`== null`) — pageid
  `0` e páginas `0` não são descartados por truthiness;
- `parsePageidFrameIdentity` valida `parseInt` (NaN/negativos → null).

### 6.7 PAGEID — contrato de sincronização (4.2)
- `syncCaptureFrame` passa a usar `expectedState` (página esperada do laço) e
  implementa o contrato: estado atual → página esperada → frames → frame com
  identidade compatível → confirma identidade → captura → **revalida após a captura**;
  estados inconsistentes (mudança entre leituras, Caso C/D) são **descartados**
  (`discardedCount`) e a sincronização é retentada dentro do prazo.

### 6.8 PAGEID — seleção de frame (4.4)
- Seleção por **identidade de página na URL/src** do frame (sinal confiável,
  verificado no DOM real); a heurística CSS (scrolling/largura) é apenas auxiliar
  no audit. Sem prova de relação frame×página exibida → captura não é `integral`.

## 7. Testes de produção desta rodada

`poc/test-production-m3.js` — **19/19 PASS**:
- **Estrutura EPUB 2/3** (S-*): NCX com hierarquia, nav.xhtml só `toc` (landmarks
  ignorados), fragmento removido, subdiretórios, malformado, sem capítulo,
  colisão de basename, multi-doc estrutural.
- **Orquestração `extractEpubViaAdapter`** (E-*): cap. único → integral; multi-doc
  2 docs → integral; doc faltando → partial; doc repetido → dedup; navegação sem
  mudança → não confirmado; pacote ok mas limite não confirmável → partial (sem
  falsa confirmação); pacote indisponível → navegação confirma → integral; texto do
  cap. 1 com identidade do cap. 2 → não integral.
- **Orquestração `extractPageidViaSync`** (P-*): pageid zero aceito (Caso F);
  estado muda entre leituras → descarta (Caso C); estado muda durante captura →
  descarta (Caso D); dois frames ambíguos → conservador (Caso E).

## 8. Resumo de testes — Fase 3 (todas as suítes)

| Suíte | Arquivo | Resultado |
|---|---|---|
| Regressão sintética (A/B/C/D) | `poc/test-regression-m3.js` | **29/29 PASS** |
| Integração (A estrutural + B sincronização) | `poc/test-integration-m3.js` | **14/14 PASS** |
| **Produção (EPUB + PAGEID)** | `poc/test-production-m3.js` | **19/19 PASS** |
| **Total** | | **62/62 PASS** |
| Real no AVA (smoke) | `poc/test-module3.js` | 2026-11-06: leitor VitalSource não montou conteúdo (`inaccessible`/`leitor-nao-carregou`) — **sem validação live declarada**; registrada separadamente |

## 9. Classificação e evidências

- `integral` só com identidade confirmada, todos os documentos obrigatórios,
  limites confirmados e sincronização válida — sem avisos.
- `partial` quando falta documento, limite não confirmado, sincronização falhou ou
  lacuna estrutural.
- `inaccessible` quando a fonte não pôde ser acessada (sessão/plataforma/leitor).
- `not_found` quando o recurso esperado não foi encontrado após busca válida.
- Evidências registram: contagens de docs esperados/capturados, confirmação de
  limites, tentativas, motivos de falha, avisos — sem conteúdo protegido.

## 10. Segurança

- Nenhum conteúdo integral de livro, senha, cookie ou token em commits/fixtures
  (tudo sintético). `.gitignore` mantém evidências e perfis fora do versionamento.
- Sem código novo de contorno de DRM/autenticação.
- Fixtures de teste são originais e sintéticas.
