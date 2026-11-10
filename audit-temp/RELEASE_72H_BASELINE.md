# RELEASE 72H — BASELINE

> Registrado no início da missão de lançamento (72 horas).
> Data: 2026-11-08

## 1. Estado do Git

- Branch de trabalho: `review/pre-release-2026-11-07`
- HEAD inicial esperado: `a44c2562653e4619e723987970263e5a7f286117`
- HEAD inicial verificado: `a44c256` (bate com o esperado)
- `origin/master` intocado: `fdf1dd1` (sem alterações nesta missão)
- `git status`: working tree limpo, exceto `poc/probe-readers.js` (não
  versionado, pré-existente — preservado sem staging).

## 2. Ponto de partida (qualidade herdada)

- `npm test`: 13 suítes determinísticas, 198 casos, 0 falhas (antes desta missão).
- Executável portátil: `dist/UnivespStudyTool-1.0.0.exe` (build anterior, ~119 MB;
  `dist/` é ignorado pelo Git).
- Correções da rodada anterior (A–E) já integradas na branch.

## 3. Problema histórico de copyright

A auditoria anterior identificou que o histórico do repositório contém um
**capítulo integral de livro licenciado**:

- Arquivo: `poc/evidence/module3/result.json`
- Adicionado no commit: `8742012` ("UNIVESP Study Tool: auditoria, correções de
  segurança e Módulo 3") — conteúdo de ~160 KB.
- Removido no commit: `d6cf122` ("Security: remove extracted book text from
  public repository").
- O `.gitignore` atual cobre `poc/evidence/**/result.json`, `*.txt` de extração e
  artefatos de execução.

### Estado na árvore atual

- O arquivo **não** está na árvore de trabalho nem nos commits recentes.
- Varredura dos arquivos rastreados (90 arquivos): nenhum fragmento de conteúdo
  protegido identificado; nenhum PDF/livro/transcrição versionado. Arquivos
  grandes são scripts de teste e relatórios de implementação (sem conteúdo de
  livro).
- Único arquivo rastreado em `poc/evidence/`: `poc/evidence/test-e2e/build-info.json`
  (apenas metadados de build, sanitizado).

### Registro e decisão

- O histórico Git **ainda contém** o material protegido (comit `8742012`).
- Nesta missão **não** se reescreve histórico sem autorização expressa do
  proprietário. Qualquer purga futura exige decisão do proprietário (ex.:
  `git filter-repo` + force push coordenado, com revisão da visibilidade).
- Nenhum relatório novo desta missão reproduzirá o conteúdo do livro.

## 4. P0 conhecidos desta missão (a corrigir)

1. Inicialização do navegador auxiliar no executável empacotado (`process.execPath`).
2. PDF usando a sessão autenticada (contexto de request do Playwright).
3. Interpretação de semana desmarcada (array vazio = nenhuma).
4. Classificação de iframes (vídeo só com evidência de plataforma).
5. Descoberta recursiva de recursos incorporados em páginas.
6. Isolamento de falhas por matéria/semana/recurso.
7. Ciclo de vida dos dados temporários (pasta de trabalho, detecção de processo,
   encerramento do navegador auxiliar).
8. Documentos Markdown individuais por recurso (entrega central).

## 5. Limitações do ambiente

- Sem sessão autenticada no AVA real.
- Sem acesso a leitor VitalSource/Minha Biblioteca real.
- Windows físico permitido para executar o app: disponível nesta máquina para
  smoke tests empacotados; o percurso completo real (login manual → extração →
  ZIP) depende do proprietário.
