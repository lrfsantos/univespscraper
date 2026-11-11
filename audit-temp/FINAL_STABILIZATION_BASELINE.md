# FINAL STABILIZATION — BASELINE

> Registrado no início da missão final de estabilização.
> Data: 2026-11-11

## 1. Estado do Git

- Branch de trabalho: `review/pre-release-2026-11-07` (checkout atual).
- HEAD local: `3c22ad21e67dfa18c113e49c6cfdf537cc91dcdd` ("chore: refresh audit evidence timestamps after final test run").
- HEAD remoto (`origin/review/pre-release-2026-11-07`): `3c22ad21e67dfa18c113e49c6cfdf537cc91dcdd` — **bate com o SHA da auditoria**; sem commits posteriores a reconciliar.
- `master` (`origin/master`): `fdf1dd1211d40cc50e2b864c6488eedad9a72eed` — **intocada**.
- `git status --short`: working tree limpo, exceto `poc/_pkg.js` e `poc/probe-readers.js`
  (diagnósticos NÃO versionados — preservados, fora do Git).

## 2. Ponto de partida (qualidade herdada)

- `npm test`: 16 suítes determinísticas, 0 falhas (rodada anterior).
- Build anterior `dist/UnivespStudyTool-1.0.0.exe` (~124.9 MB) — verificado que NÃO corresponde
  ao HEAD atual (Electron embutido 45.2.1 × manifest ^45.2.3); será reconstruído.
- Documentos de exemplo em `poc/fixtures/generated-output/` gerados por escritores reais, mas a
  QA anterior aprovou exemplos construídos manualmente (a corrigir na seção 9).

## 3. Objetivos da missão (resumo)

- P0: validar ZIP de verdade (nunca falso sucesso).
- P1: descoberta AVA (Geral/Início/Em síntese), vídeos (status/transcrição/timeout),
  HTML estrutural real, livros/pageRange/metadados, PDF (memória/status/link relativo),
  descoberta incorporada, documentos Markdown, QA com fixtures reais, testes fracos,
  CI, segurança Electron, copyright/higiene, rebuild portable.

## 4. Regras

- Trabalhar somente na branch de revisão; não tocar `master`; sem force push/rebase/clean.
- Preservar `poc/_pkg.js` e `poc/probe-readers.js`.
- Não versionar material protegido, cookies, tokens, sessões.
- Commits pequenos e push autorizado.
