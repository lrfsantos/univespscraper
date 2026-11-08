# Relatório Final do Produto — UNIVESP Scraper

> Data: 2026-11-08
> Branch de revisão: `review/pre-release-2026-11-07`
> HEAD inicial da missão: `9b2b6aaa521cdeddccb4a898dbfb1846f8db9b13`

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
| Unitários (parsers e decisões de fidelidade) | 165/165 PASS |
| Integração (fluxo com fixtures/mocks) | 165/165 PASS (mesma suíte, separada por caso) |
| AVA real | **NÃO executado** (sem acesso autenticado nesta rodada) |
| Leitores reais (VitalSource/Minha Biblioteca) | **NÃO executado** (depende de sessão real) |
| Executável Windows | Inicialização e tela inicial **validados no app empacotado** (`win-unpacked`); fluxo completo real **NÃO** validado em máquina física |

Detalhe: `npm test` executa 12 suítes determinísticas (165 testes), sem AVA, sem
internet, sem credenciais. Os cenários A–H da missão foram cobertos por testes
com fixtures (`poc/test-product-m3.js`) e o app empacotado foi iniciado e
fechado com sucesso.

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

**CANDIDATO A LANÇAMENTO COM LIMITAÇÕES**

O fluxo principal está implementado e o aplicativo é utilizável por um estudante
sem conhecimento técnico: login manual, descoberta dinâmica de matérias e
semanas, seleção, extração pelos módulos reais, progresso, cancelamento, ZIP
validado no destino escolhido e resultado honesto. A classificação reflete que a
validação final com AVA real, leitores reais e Windows físico ainda não foi
executada (pendências da seção G) — não é uma limitação de implementação
identificada no código.

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
