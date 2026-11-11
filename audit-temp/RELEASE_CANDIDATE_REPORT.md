# RELATÓRIO DO CANDIDATO A LANÇAMENTO — UNIVESP STUDY TOOL

> Missão de lançamento em 72 horas. Branch: `review/pre-release-2026-11-07`.
> Gerado ao fim do trabalho nesta branch (candidato a lançamento).

## 1. SHA inicial e SHA final

- SHA inicial: `a44c2562653e4619e723987970263e5a7f286117` (verificado no baseline).
- SHA final (HEAD da branch): `f5aa45abf70fab6ed59b1738173fcded64a55075`.

## 2. Commits criados (nesta missão)

| Commit | Descrição |
|---|---|
| `30387c4` | fix: stabilize packaged browser launch and authenticated pdf downloads |
| `6a962e2` | fix: honor exact week selection, classify iframes by evidence, isolate failures, and manage temp-work lifecycle |
| `123b0e0` | chore: refresh audit evidence timestamps |
| `dc2eb11` | feat: write resource-level markdown extraction documents |
| `a59e587` | test: add extraction quality fixtures, generated sample documents and QA report |
| `db9f193` | chore: refresh audit evidence timestamps |
| `5a7bb40` | fix(books): make expected.pageRange participate in pageid navigation and validation |
| `f5aa45a` | chore: bump electron to 45.2.3, migrate CI to Node 24 LTS, update README |

## 3. P0 corrigidos

- **P0 2.1 — Navegador auxiliar no executável empacotado**: usa `process.execPath`
  com `--univesp-aux` (mesmo exe, sem segunda interface principal, sem disputar o
  lock); UA derivado do Chromium real do runtime (`browser.js`).
- **P0 2.2 — PDF com sessão autenticada**: download via `page.request` do Playwright
  (contexto do login manual); valida magic bytes, redireciona para login/403/404,
  HTML no lugar de PDF; SHA-256 do original preservado.
- **P0 2.3 — Semana desmarcada**: array vazio = NENHUMA semana; null = todas;
  bloqueio de extração sem nenhuma semana selecionada.
- **P0 2.4 — Classificação de iframes por evidência**: vídeo só com plataforma
  reconhecida (YouTube/Vimeo); leitor→book; PDF viewer→pdf; HTML comum→page;
  sem URL→unknown (unsupported), nunca vídeo por padrão.
- **P0 2.5 — Descoberta recursiva**: página extraída revela vídeos/PDFs/livros/
  páginas; dedup por URL normalizada E identidade do vídeo; profundidade máxima;
  página de origem registrada; sem download indiscriminado de links externos.
- **P0 2.6 — Isolamento de falhas**: por matéria (buildSelectionPlan), por semana e
  por recurso (try/catch individuais); sessão expirada → inacessível (autenticação),
  nunca integral; pendências nunca viram sucesso.

## 4. P0 não corrigidos

- Nenhum P0 conhecido permanece sem correção. A validação prática (Windows/AVA
  reais) depende do proprietário.

## 5. P1 corrigidos

- Limpeza e ciclo de vida da pasta de trabalho (`univesp-work-*`): OWNER.json,
  remoção após ZIP validado, encerramento normal, resíduos na inicialização.
- `isProcessAlive` corrigido (confirma o PID na saída do `tasklist`).
- OWNER.json inválido → política conservadora (não apaga por engano).
- Encerramento controlado do processo auxiliar no quit (before-quit assíncrono).
- Descarte explícito da extração (`discard-extraction`) + salvar parcial pós-cancelamento.
- Documentos Markdown individuais por recurso (seção 4).
- `expected.pageRange` participa da navegação/validação pageid (4.3).
- Transcrição de vídeo com segmentos e timestamps preservados (4.4).

## 6. P1 pendentes

- Confirmação do leitor VitalSource/Minha Biblioteca real (ambiente).
- Validação do executável portable em máquina autorizada (política WDAC nesta máquina).
- Decisão do proprietário sobre purga do histórico (copyright) — não reescrito.

## 7. Testes realmente executados

- `npm test`: **16 suítes determinísticas, 0 falhas** (sem AVA/credenciais/rede).
- Suítes novas: `test-workdir-m3` (pasta de trabalho + isProcessAlive),
  `test-extraction-qa-m3` (qualidade de saída), `test-pagerange-m3` (4.3).

## 8. Número de suítes/casos

- Suítes: 16. Falhas: 0. (Resumo emitido pelo próprio `npm test`.)

## 9. Build e smoke tests executados

- `npm run build:dir` (win-unpacked): **sucesso**.
- `npm run build:portable`: **sucesso** (gerou o exe portátil).
- Smoke test do app empacotado (win-unpacked): **passou** (janela abre e o processo
  permanece ativo ≥10s).
- Asar verificado: `electron/workdir.js`, `src/extract/markdown.js`,
  `src/extract/pdfs.js`, `electron/flow.js`, `electron/browser.js` presentes.

## 10. Tamanho e SHA-256 do executável

- Arquivo: `dist/UnivespStudyTool-1.0.0.exe`.
- Tamanho: 124.889.576 bytes (~119 MB).
- SHA-256: `D16D5A80E121ACFE982114231E6A723A31EA2C483976ED341AD22EC74983CB45`.
- Versões embutidas (lidas do exe empacotado): Electron 45.2.1; Node 24.22.1;
  Chromium 156.0.8078.75.
- Não assinado (SmartScreen/Defender podem alertar).

## 11. Abertura do navegador auxiliar no pacote

- A implementação usa `process.execPath` com `--univesp-aux` (P0 2.1) e o modo
  auxiliar foi incluído no pacote (asar verificado). A janela do navegador AVA no
  **executável** depende de validação manual do proprietário (nesta máquina, a
  execução do portable é bloqueada por política de segurança — ver seção 17).

## 12. PDF que usa a sessão autenticada

- Implementado via `page.request` (sessão do login manual) com validações (magic
  bytes, 403/404, HTML no lugar de PDF, SHA-256). Testes determinísticos de
  `downloadViaPageRequest` cobertos; validação com PDF autenticado real depende do
  AVA.

## 13. Resultado de cada tipo de documento Markdown

- Página HTML: `SAMPLE_PAGE.md` (conteúdo integral + recursos incorporados).
- PDF: `SAMPLE_PDF.md` (separação por página; distinção página do arquivo × impressa
  × não identificada; SHA-256; status honesto `partial` com página sem texto).
- Livro: `SAMPLE_READING.md` (capítulo + intervalo de páginas; evidência estrutural).
- Vídeo: `SAMPLE_VIDEO.md` (transcrição segmentada com timestamps).
- Não suportado: `SAMPLE_UNSUPPORTED.md` (motivo + orientação de acesso manual).

## 14. Caminhos dos documentos de exemplo

- `poc/fixtures/generated-output/` (SAMPLE_*.md + INDEX.md + SOURCES.md +
  EXTRACTION_REPORT.md + EXTRACTION_QA.md + estrutura `ADM270/Semana_1/...`).
- Gerados pelos escritores reais (`poc/generate-samples.js`).

## 15. Auditoria automatizada de qualidade

- `audit-temp/EXTRACTION_QA_REPORT.md` e `audit-temp/EXTRACTION_QA_RESULTS.json`.
- 9 verificações: fidelidade (conteúdo/ordem/headings/listas/página/timestamps),
  integridade, rastreabilidade e honestidade do status — **9/9 aprovadas** (suíte
  `test-extraction-qa-m3`).

## 16. Estado da limpeza temporária

- Pasta de trabalho com OWNER.json; removida após ZIP validado, no encerramento sem
  ZIP e em resíduos na inicialização; descarte explícito e salvamento parcial pós-
  cancelamento. Testes em `test-workdir-m3` (8/8). Perfil temporário do navegador
  isolado e limpo (suíte de perfil).

## 17. Limitações reais de AVA/VitalSource

- Sem sessão autenticada real do AVA nesta máquina: descoberta/extração reais não
  executadas aqui; parsers/classificação validados com fixtures determinísticas.
- Leitor VitalSource/Minha Biblioteca não validado em runtime real (configuração do
  dispositivo/limite de sessão são fatores externos).

## 18. Limitações de Windows/assinatura

- Executável **não assinado**; Windows pode exibir alertas SmartScreen/Defender.
- Nesta máquina, a política de segurança (Device Guard/WDAC) **bloqueia a execução
  do portable**; o win-unpacked abriu e permaneceu ativo (smoke test básico). A
  validação final deve ocorrer em ambiente Windows autorizado.

## 19. Material protegido no histórico Git

- `poc/evidence/module3/result.json` (capítulo integral) permanece em `8742012`
  (removido da árvore em `d6cf122`). NÃO reescrito. Decisão de purga (ex.:
  `git filter-repo`) pertence ao proprietário. Nada desta missão reproduz o conteúdo.

## 20. O que o proprietário ainda precisa validar manualmente

1. Executar o portable/win-unpacked em Windows autorizado (sem WDAC).
2. Abrir o navegador auxiliar no pacote e confirmar a janela do AVA.
3. Login manual real → descoberta de matérias (ativas, antigas/encerradas).
4. Seleção de semanas (incluindo desmarcar uma matéria inteira).
5. Extração real: página, PDF (com sessão), livro (Minha Biblioteca), videoaulas.
6. Conferência dos documentos Markdown gerados (fidelidade e status).
7. Gerar e validar o ZIP; conferir a limpeza da pasta temporária.
8. Revisar os alertas de segurança do executável não assinado.

## Conclusão

Todos os P0 da missão foram corrigidos; `npm test` (16 suítes) passa; build
win-unpacked e portable gerados; smoke test básico do app empacotado passou;
documentos Markdown e relatório de QA gerados pelos escritores reais.

**Status: PRONTO PARA TESTE PRÁTICO DO USUÁRIO** (validação real em Windows/AVA
pendente — somente o proprietário pode confirmar `PRONTO PARA LANÇAMENTO`).
