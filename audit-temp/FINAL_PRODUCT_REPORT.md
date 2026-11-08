# Relatório Final do Produto — UNIVESP Scraper

> Data: 2026-11-08
> Branch de revisão: `review/pre-release-2026-11-07`
> HEAD inicial da missão de produto: `9b2b6aaa521cdeddccb4a898dbfb1846f8db9b13`
> HEAD inicial da missão de correção final: `9fe21e4`

---

## Correções da revisão final

Esta seção documenta a última rodada de correções (5 áreas) feita após a revisão
independente da branch. Cada área descreve o problema, o que foi alterado, como
foi testado, o resultado e se a validação foi apenas simulada ou também real.

### A. Descoberta de semanas e recursos

- **Problema**: o parser usava uma expressão regular que encerrava a captura de
  uma semana no primeiro `</li>`. Em HTML com `<li>` aninhados dentro de uma
  semana, isso podia perder recursos ou misturar o conteúdo de semanas
  diferentes.
- **Alterado**: `electron/discovery.js` foi reescrito com **parsing estrutural
  local** (sem dependência externa): `scanTags`, `attrsOf` e `balancedElement`
  localizam `<li class="section" id="section-N">` e extraem o **bloco balanceado**
  (li aninhados preservados). Limites entre semanas corretos, seção "Geral" não é
  tratada como semana, ordem original preservada, sem duplicação e quantidade de
  semanas dinâmica (sem número fixo).
- **Como foi testado**: nova suíte `poc/test-correcoes-m3.js` (grupo A) com
  fixtures reais: semana com vários `li` internos, listas aninhadas, duas semanas
  consecutivas, PDF/vídeo/leitura na mesma semana, seção Geral antes das semanas,
  HTML com espaços/quebras de linha e atributos em ordens diferentes, semana sem
  recursos e IDs/URLs diferentes. Também os casos D-2/D-3 de
  `poc/test-discovery-m3.js`.
- **Resultado**: todas as semanas são encontradas; todos os recursos de cada
  semana são preservados; nenhum recurso é atribuído à semana errada; nenhuma
  semana é duplicada.
- **Validação**: apenas **testes simulados** (fixtures). Descoberta real no AVA
  não foi executada (sem sessão autenticada neste ambiente).

### B. Matérias antigas acessíveis

- **Problema**: termos como `concluída` eram considerados evidência de
  indisponibilidade, o que podia excluir matérias antigas/concluídas/inativas que
  continuam acessíveis ao estudante.
- **Alterado**: separou-se **situação acadêmica** (`situacao`: ativa, concluida,
  encerrada, inativa, indisponivel) de **disponibilidade real** (`available`).
  `available=false` só ocorre com evidência concreta de inacessibilidade
  (indisponível, não disponível, sem oferta, fora do ar, acesso negado, não
  autorizado, matrícula não disponível, vagas encerradas). Estado indeterminado
  não desabilita. A interface exibe o rótulo de situação e só desabilita o
  checkbox quando `available=false`; falha de acesso a uma matéria é registrada
  sem impedir o processamento das demais.
- **Como foi testado**: grupo B da nova suíte (matéria ativa, concluída, antiga,
  inativa, sem acesso real e estado indeterminado) e caso D-1 de
  `poc/test-discovery-m3.js` ("Estatística encerrada" acessível; "Curso
  indisponível" desabilitado).
- **Resultado**: as quatro primeiras matérias permanecem selecionáveis; somente
  evidência concreta desabilita.
- **Validação**: apenas **testes simulados**. Fluxo real no AVA não executado.

### C. Progresso da extração

- **Problema**: o backend enviava eventos com `step: 'progresso'`, mas a
  interface só processava `step: 'extracao'` — a barra e os contadores nunca
  atualizavam.
- **Alterado**: contrato único de eventos: envelope `step: 'extracao'` com
  sub-tipo em `event` (`recurso`, `progresso`, `cancelado`, `concluida`,
  `sem-recursos`). A interface aceita `extracao` (e `progresso` por
  retrocompatibilidade). A barra é `round((done+pending)/total*100)` calculada a
  partir das contagens reais — nenhuma porcentagem inventada e nenhuma dupla
  contagem; o cancelamento é refletido na interface.
- **Como foi testado**: grupo C da nova suíte: extração simulada com 3 recursos
  integrais + 1 parcial + 1 inacessível (done=3, pending=2, barra=100%), progresso
  parcial (3/5 → 60%) e cancelamento durante a execução, com réplica pura do
  handler da interface e inspeção do código real de `main.js`/`ui.html`.
- **Resultado**: os valores apresentados correspondem aos eventos recebidos, sem
  saltos artificiais nem conclusão prematura.
- **Validação**: **simulada** (réplica pura + inspeção). Execução com Electron
  real e AVA real não executada.

### D. Tela de resultado e salvamento do ZIP

- **Problema**: o backend retornava o resultado dentro de um objeto aninhado,
  enquanto a interface procurava título/mensagem/status no nível externo — tela
  de resultado incompleta.
- **Alterado**: resposta padronizada no **nível externo**
  (`status`, `statusLabel`, `title`, `message`, `counts`) e `showResult` lê no
  topo, com fallback compatível para o objeto aninhado. O botão Salvar ZIP fica
  disponível quando há conteúdo; cancelamento da janela de destino **não** é
  apresentado como falha da extração (botão reabilitado e mensagem clara); o ZIP
  é **criado e validado antes da confirmação** (validação real abre o arquivo e
  confere o número de entradas); o botão de revelar usa o caminho efetivamente
  salvo.
- **Como foi testado**: grupo D da nova suíte: extração integral, com pendências,
  sem recursos válidos, falha de extração (não vira tela de sucesso), cancelamento,
  cancelamento da janela de destino e **salvamento bem-sucedido com ZIP real**
  (`createZip` + `validateZip` em diretório temporário), além de D-4/D-5 de
  `poc/test-discovery-m3.js`.
- **Resultado**: status/título/mensagem/contagens corretos; nenhuma mensagem de
  sucesso antes de o arquivo existir e passar pela validação.
- **Validação**: criação/validação do ZIP foi **real** (Windows local). O fluxo
  completo com o diálogo nativo e uma extração real não foi executado (depende de
  sessão/extração reais).

### E. Navegação e extração EPUB

- **Problema**: a revisão identificou `expected = {}` na chamada de `extractBook` —
  o capítulo/intervalo de páginas recomendado pelo AVA podia se perder na
  descoberta, enfraquecendo a validação estrutural.
- **Alterado**: a descoberta agora preserva o que o AVA declara no material
  (`parseExpectedFromResource`: "Leia o Capítulo 1", "páginas 10 a 25") e
  `flow.js` repassa esse `expected` a `extractBook`. Quando o AVA não fornece
  capítulo/páginas, isso é representado **explicitamente** (`hasChapter:false`),
  nunca inventado. As funções estruturais de navegação/sincronização
  (`navigateEpubNextDoc`, `waitEpubDocChange`, `readPageidFrames`,
  `syncCaptureFrame`, `applyEpubStructuralValidation`,
  `fetchEpubPackageFromReader`) foram mantidas, e `validateContent` é
  conservador: sem prova de limite estrutural, `endOk=false` → o resultado nunca é
  `integral`.
- **Como foi testado**: grupo E da nova suíte (propagação de `expected`, capítulo
  e páginas declarados, ausência explícita, funções presentes, conservadorismo do
  `validateContent`) e **cross-reference** comprovando que os 14 cenários
  obrigatórios (frame ainda carregando, conteúdo antigo, URL sem conteúdo novo,
  conteúdo sem identidade, dois frames com mesma identidade, página anterior
  repetida, mudança de capítulo, multi-XHTML, EPUB sem NCX, EPUB3 com nav HTML,
  OPF em diretório diferente, limite não confirmável, documentos faltantes e
  capítulo diferente do aberto) já são cobertos pelas suítes existentes
  (`test-integration-m3.js`, `test-regression-m3.js`, `test-production-m3.js`).
- **Resultado**: `expected` real chega à validação; comportamento conservador
  preservado; nenhum capítulo/página inventado.
- **Validação**: apenas **testes simulados/sintéticos**. Leitor EPUB real
  (VitalSource/Minha Biblioteca) não executado (depende de sessão real). Nenhum
  conteúdo protegido foi incluído nos testes, fixtures ou commits.

### Tabela final

| Área | Corrigido | Teste executado | Validação real |
|---|---|---|---|
| Descoberta de semanas e recursos | Sim | test-correcoes-m3 (A), test-discovery-m3 (D-2/D-3) | Não (sem sessão AVA) |
| Matérias antigas acessíveis | Sim | test-correcoes-m3 (B), test-discovery-m3 (D-1) | Não (sem sessão AVA) |
| Progresso | Sim | test-correcoes-m3 (C) + inspeção main.js/ui.html | Não (sem Electron/extração real) |
| Resultado e ZIP | Sim | test-correcoes-m3 (D), test-discovery-m3 (D-4/D-5) | ZIP real no Windows local; diálogo/extração reais não |
| EPUB | Sim | test-correcoes-m3 (E) + suítes EPUB existentes (14 cenários) | Não (sem leitor real) |

### Conclusão da revisão final

**PRONTO COM LIMITAÇÕES DOCUMENTADAS**

As cinco correções foram implementadas e comprovadas por testes determinísticos
(13 suítes, 198 casos, 0 falhas, incluindo ZIP real validado no Windows local),
mas a validação com AVA real, leitores EPUB reais e o percurso completo numa
máquina física não foi executada neste ambiente. Portanto o produto **não** é
declarado pronto para lançamento sem essa validação prática pelo usuário.

---



## A. O que mudou para o estudante

Antes, o aplicativo era uma PoC de validação: abria, exigia login **automático**
(com credenciais de ambiente) e extraía uma única disciplina/semana fixa
(ADM270, Semana 1) por dentro de um fluxo de teste. O estudante via mensagens
técnicas e "logs" de desenvolvedor.

Agora, o aplicativo é um produto utilizável:

- Abre em uma tela de **boas-vindas** clara, com nome "UNIVESP Scraper" e uma
  explicação simples do que ele faz.
- Abre um **navegador visível** para o estudante fazer o **login manual** no AVA
  (nenhuma senha é solicitada ou armazenada pelo aplicativo).
- Depois do login, o estudante clica em "Já concluí o login" e o aplicativo
  **verifica a sessão** (sem fingir sucesso se não estiver autenticado).
- O aplicativo **localiza dinamicamente todas as matérias** disponíveis na conta,
  sem limites fixos, sem duplicações, ignorando links auxiliares.
- O estudante **seleciona as matérias** que deseja (uma, várias ou todas).
- O aplicativo **localiza as semanas** de cada matéria (todas marcadas por padrão;
  o estudante pode desmarcar as que não quer).
- A extração roda com **progresso real** (matéria, semana, recurso atual, total
  de materiais, quantos prontos e quantos com pendência) e permite **cancelar**.
- No final, o estudante vê um **resultado honesto** (integral / parcial /
  inacessível / não encontrado) e escolhe onde salvar o **ZIP** em uma janela
  nativa do Windows.
- O ZIP é **validado de verdade** (abre, tem arquivos, número de entradas confere)
  antes de mostrar sucesso. O caminho final é mostrado, com botão para abrir a
  pasta.

## B. Flexibilidade

### Matérias

A descoberta consulta `https://ava.univesp.br/my/courses.php` na sessão
autenticada e usa um parser puro (`electron/discovery.js`) que reconhece links
reais de curso (`course/view.php?id=N`). Não há lista fixa, não há ID fixo e não
há limite de quantidade — a contagem depende exclusivamente do que o AVA
disponibilizar. O parser:

- deduplica matérias pelo ID (um mesmo curso com dois links diferentes aparece
  uma vez);
- ignora links auxiliares (módulos, categorias, URLs avulsas);
- preserva nome, código (ex.: ADM270) e URL;
- marca como indisponível matérias com texto de "encerrada"/"indisponível".

Comprovado por teste (cenário A): fixture com 12 matérias retorna 12, sem
duplicação, sem links auxiliares.

### Semanas

A descoberta navega na página de cada matéria e lê as seções reais do Moodle
(`<li class="section ..." id="section-N">`). Não há limite de quantidade (testado
com 3 e com 15 semanas), não pressupõe estrutura idêntica, preserva título e
ordem e **não** trata a seção "Geral" como semana. Todas as semanas encontradas
vêm selecionadas por padrão; o estudante pode desmarcar.

### Recursos

Dentro de cada semana, os recursos são descobertos pelos links/iframes reais do
bloco e classificados por tipo (página HTML, PDF, livro/leitor, vídeo,
desconhecido). Nada é ignorado silenciosamente: recursos desconhecidos entram no
relatório como "não suportado".

## C. Interface

Foram implementadas **seis telas**, em português brasileiro e sem jargão técnico:

1. **Boas-vindas e acesso** — nome do app, explicação, aviso de login manual,
   botão "Entrar no AVA".
2. **Identificação da sessão** — mensagens claras de "ainda não autenticado",
   "sessão expirada" ou "nenhuma matéria encontrada", com botão para verificar e
   tentar novamente.
3. **Seleção de matérias** — lista com nome, código e situação; "Selecionar
   todas", "Desmarcar todas", seleção individual e contador.
4. **Seleção de semanas** — organizada por matéria, todas marcadas por padrão,
   com selecionar/desmarcar todas e contador; matéria sem semanas é explicada sem
   bloquear as demais.
5. **Extração em andamento** — matéria/semana/recurso atuais, barra de progresso
   real (calculada a partir da contagem real de recursos), contadores de prontos
   e pendentes, botão "Cancelar extração".
6. **Resultado** — status claro (concluído / concluído com pendências), contagem
   por tipo, botão "Salvar ZIP", janela nativa de destino, confirmação verdadeira
   e caminho final.

A interface tem hierarquia visual consistente, estados de carregamento/sucesso/
aviso/erro e não exibe IDs internos nem informações de desenvolvedor.

## D. Extração

O fluxo principal do aplicativo **chama os módulos reais** (`src/extract/*`):

- **HTML/páginas** (`pages.js`): extrai o texto do escopo principal, preserva
  título/links/iframes, detecta carregamento incompleto e mensagens de erro.
- **PDF** (`pdfs.js`): baixa o original, extrai texto por página, distingue
  total de páginas do arquivo × numeração impressa × páginas extraídas; **limita
  tamanho (200 MB) e tempo (120 s)** de download.
- **Livros/leitores** (`books.js`): extração EPUB/PAGEID com validação estrutural
  e de identidade; corrida de navegação corrigida; identidade `pages/N/content`
  aceita; limites configuráveis nunca tratados como fim natural.
- **Vídeos** (`videos.js`, novo): identifica videoaulas e, quando o YouTube
  disponibiliza transcrição, captura a **transcrição real** (sem chave de API);
  se não houver, registra a pendência. Nunca inventa transcrição nem usa IA para
  resumir.
- Recurso desconhecido: registrado como "não suportado".

Status honestos por recurso: `integral`, `partial`, `inaccessible`, `not_found`
(+ `unsupported`/`video`). Nenhum recurso é declarado integral sem evidência.

## E. Arquivos entregues

- Executável portátil: `dist/UnivespStudyTool-1.0.0.exe` (~119 MB).
- ZIP de exemplo validado (sintético, representativo da estrutura): criado e
  aberto com sucesso durante a validação (estrutura `INDEX.md`,
  `AI_STUDY_INSTRUCTIONS.md`, `EXTRACTION_REPORT.md`, `SOURCES.md` + pastas por
  matéria/semana + `videos/readings/supplementary`).

## F. Testes

| Categoria | Resultado |
|---|---|
| Unitários (parsers e decisões de fidelidade) | 198/198 PASS |
| Integração (fluxo com fixtures/mocks) | 198/198 PASS (mesmas suítes, separadas por caso) |
| Correções da revisão final (A–E) | 33/33 PASS (suíte `test-correcoes-m3.js`) |
| AVA real | **NÃO executado** (sem acesso autenticado nesta rodada) |
| Leitores reais (VitalSource/Minha Biblioteca) | **NÃO executado** (depende de sessão real) |
| Executável Windows | Inicialização e tela inicial **validados no app empacotado** (`win-unpacked` e portátil); fluxo completo real **NÃO** validado em máquina física |

Detalhe: `npm test` executa 13 suítes determinísticas (198 casos), sem AVA, sem
internet, sem credenciais. Os cenários A–H da missão foram cobertos por testes
com fixtures (`poc/test-product-m3.js`), as correções A–E pela nova suíte
(`poc/test-correcoes-m3.js`) e o app empacotado foi iniciado e fechado com
sucesso.

## G. Pendências

- **Validação com AVA real** e **leitores reais** não foi executada nesta rodada
  (sem sessão/ambiente disponíveis). O fluxo está implementado e coberto por
  testes determinísticos, mas a confirmação com dados reais fica pendente.
- **Executável em Windows 10/11 físico**: a inicialização foi validada, mas o
  percurso completo (login manual → extração → ZIP) numa máquina real não foi
  executado.
- Transcrição de vídeo depende da disponibilidade no YouTube; quando ausente, é
  registrada como pendência.
- Módulo 4 completo (download de vídeo/áudio) continua fora de escopo.
- O histórico Git ainda contém conteúdo antigo não purgado (decisão do
  proprietário; sem reescrita de histórico nesta missão).

## H. Como usar

1. Abra o aplicativo `UnivespStudyTool.exe`.
2. Na tela de boas-vindas, clique em **Entrar no AVA**.
3. Na janela do navegador que abrir, faça o login na sua conta UNIVESP.
4. Volte ao aplicativo e clique em **Já concluí o login**.
5. Selecione as matérias que deseja e clique em **Continuar**.
6. Confirme as semanas (todas já vêm marcadas) e clique em **Iniciar extração**.
7. Acompanhe o progresso; pode cancelar quando quiser.
8. Ao final, clique em **Salvar ZIP**, escolha o destino e confira o resultado.
9. Abra a pasta do arquivo se quiser localizar o ZIP.

## I. Decisão final

**PRONTO COM LIMITAÇÕES DOCUMENTADAS**

O fluxo principal está implementado e o aplicativo é utilizável por um estudante
sem conhecimento técnico: login manual, descoberta dinâmica de matérias e
semanas, seleção, extração pelos módulos reais, progresso, cancelamento, ZIP
validado no destino escolhido e resultado honesto. As cinco correções da
revisão final (descoberta estrutural, matérias antigas acessíveis, progresso,
resultado/ZIP e EPUB) foram implementadas e comprovadas por testes
determinísticos (13 suítes, 198 casos, 0 falhas). A classificação reflete que a
validação final com AVA real, leitores reais e o percurso completo numa máquina
física ainda não foi executada (pendências da seção G) — não é uma limitação de
implementação identificada no código, mas o lançamento **não** deve ser
declarado sem essa validação prática.

## J. Histórico de implementação (esta missão)

- **feat(ui)**: interface com 6 telas em português, sem jargão técnico.
- **feat(extraction)**: módulo de vídeos com captura real de transcrição quando
  disponível; limites de tamanho/tempo no download de PDFs.
- **feat(flow)**: progresso real, cancelamento, status honestos, docs de topo no
  ZIP e nome `UNIVESP_<MATERIA>_<DATA>`; validação do ZIP conta apenas arquivos
  (entradas), corrigindo falso negativo.
- **test**: suíte do produto (cenários A–H) com fixtures; total de 165 testes em
  12 suítes, todos passando.
- **build**: executável portátil regenerado com o código final.
- **fix(discovery)**: parsing estrutural das semanas (li aninhados) e separação
  situação acadêmica × disponibilidade real (correções A/B).
- **fix(progress)**: contrato de eventos `step='extracao'` + `event` (correção C).
- **fix(result)**: resposta achatada da extração + gating/validação do ZIP
  (correção D).
- **fix(books)**: propagação do `expected` (capítulo/páginas do AVA) a
  `extractBook`, sem inventar dados (correção E).
- **test(correcoes)**: suíte `test-correcoes-m3.js` (33 casos) + integração no
  `npm test` (13 suítes, 198 casos, 0 falhas).
- **build**: executável portátil `UnivespStudyTool-1.0.0.exe` regenerado e
  smoke test (inicialização/encerramento) no app empacotado.
