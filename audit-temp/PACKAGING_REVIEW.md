# Revisão de empacotamento e integração

> Data: 2026-11-05. Verificação do que está empacotado × integrado × pendente.

## 1. Empacotamento (`electron-builder`)

- `package.json` `build.files` inclui `electron/**/*`, `src/lib/**/*`, **`src/extract/**/*`** (correção P2 da auditoria).
- Verificado no `app.asar` do `dist/win-unpacked` (build `--dir` executado em 2026-11-05): presentes `src/extract/books.js`, `pages.js`, `pdfs.js` e os módulos de `src/lib/`.
- **Conclusão: os módulos novos estão no pacote.**

## 2. Integração (quem usa o quê)

| Módulo | Arquivo | Usado por | Integrado ao app? |
|---|---|---|---|
| Módulo 1 — páginas | `src/extract/pages.js` | `poc/test-module1.js` | **Não** (só teste) |
| Módulo 2 — PDFs | `src/extract/pdfs.js` | `poc/test-module2.js` | **Não** (só teste) |
| Módulo 3 — livros | `src/extract/books.js` | `poc/test-module3.js`, `poc/diag-hisrich.js` | **Não** (só teste) |
| Fluxo do app | `electron/main.js` | `./run-poc` (PoC) | — |

- `electron/main.js` **continua** chamando `./run-poc` (`runPoc`) — a PoC de validação da Etapa 2 — e **não** utiliza os módulos de extração da Etapa 3.
- Os módulos 1–3 são **empacotados mas não integrados** ao fluxo real do aplicativo. O `run-poc.js` ainda faz sua própria extração inline (página + livro + PDF), duplicando funcionalidade que os módulos novos já cobrem.

## 3. Pendências de integração (Etapas 4–5, fora do escopo desta auditoria)

- Substituir a extração inline da PoC (`run-poc.js`) pelos módulos `src/extract/*` no fluxo do app (descoberta → extração → organização → ZIP).
- UI (Etapa 5) ainda não consome os módulos.
- Validação do executável portable em máquina sem política WDAC (ambiente) permanece pendente.

## 4. Nota

Não confundir **inclusão no pacote** (confirmada) com **funcionalidade integrada** (pendente). Os módulos da Etapa 3 foram validados isoladamente via harnesses PoC, conforme o plano da Etapa 3.
