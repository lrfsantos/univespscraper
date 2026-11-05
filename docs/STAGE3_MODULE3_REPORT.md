# UNIVESP Study Tool — Etapa 3, Módulo 3: Livros digitais / Minha Biblioteca

> Data: 2026-11-05. Material de validação: **ADM270 — Empreendedorismo e Inovação, Semana 1** (3 textos-base LTI).
> Objetivo: extrair capítulos de livros digitais da Minha Biblioteca com **detecção confiável de carregamento**, **retries controlados**, **validação de começo/meio/fim**, **confirmação do capítulo certo**, **detecção de repetições/truncamentos** e **status de fidelidade honesto** por recurso.
> Execução: via `playwright-core._electron` (UM ÚNICO Chromium), janela do navegador autenticada no AVA — caminho validado na Etapa 2.

---

## 1. Arquivos criados/modificados

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `src/extract/books.js` | criado | **Módulo 3**: detecção de formato do leitor, extração epub e pageid, validação de fidelidade, status honesto |
| `poc/test-module3.js` | criado | Harness: login automático + extração dos 3 textos-base da S1 com validação |
| `poc/evidence/module3/result.json` | gerado | Resultado estruturado |
| `poc/evidence/module3/run.log` | gerado | Log de execução |
| `poc/evidence/module3/tmp/{chiavenato,hisrich}.txt` | gerado | Texto extraído (evidência; gitignored por conter material protegido) |

## 2. Comportamento implementado

`src/extract/books.js` expõe `extractBook({ app, win, launchUrl, expected, opts })`:

1. **Detecção do leitor** (`detectFormat`): classifica `epub` (frame `/epub/OEBPS/Text/`), `pageid` (frame `/pages/N/content`), `bvpdf`/`bvleitor` (canvas/DRM), `unknown` — por sondagem, sem espera fixa.
2. **Detecção de carregamento** (`poll`): aguarda frame de conteúdo com texto significativo (≥500 chars, sem front matter), sondando a cada 2s até o prazo.
3. **Retries controlados (epub)**: tentativa inicial + 1 retry (expande o sumário e navega para o capítulo) se o conteúdo não carregou.
4. **Navegação (pageid)**: página a página via botão "Seguinte", até alcançar a **página impressa** onde começa o próximo capítulo (lida do sumário do leitor) ou cabeçalho "Capítulo N+1"; deduplicação por texto (o leitor pré-carrega a página seguinte — sem dedupe haveria conteúdo duplicado).
5. **Validação de fidelidade** (`validateContent`): `hasText`, `noNonsense`, `startOk`, `midOk`, `endOk`, `chapterOk`, `detectRepetitions`, truncamento no final.
6. **Status honesto** (`statusForBook`): `integral` / `partial` / `inaccessible` / `not_found`, sem marcar conteúdo não validado como integral.

## 3. Testes realizados (ADM270 S1)

| Recurso | id | Leitor | Status | Chars | Validação | Tempo |
|---------|----|--------|--------|-------|-----------|-------|
| Fabrete — "Empreendedorismo" (Unidade 1) | 263475 | bvpdf (canvas) | **inaccessible** | 0 | — (não contornar canvas/DRM) | 32s |
| Chiavenato — "dando asas ao espírito empreendedor" (Cap. 1) | 263476 | epub | **integral** | 45.267 | chapterOk ✅, 0 repetições, fim completo | ~15s |
| Hisrich — "Empreendedorismo" (Cap. 1) | 263477 | pageid | **integral** | 104.066 | chapterOk ✅ (págs. impressas 23..45), 0 repetições, fim no início do Cap. 2 | ~78s |

**Critérios do teste (todos PASSOU):** `allClassified`, `accessibleExtracted`, `accessibleValidated`, `noIntegralWithoutValidation`, `bvirtualMarkedInaccessible`, `noNonsenseAsContent`.

## 4. Evidências (exemplos)

**Chiavenato (epub) — início:** "O QUE VEREMOS ADIANTE … O empreendedor está no epicentro deste livro. Ele não é somente o criador ou fundador de novas empresas…" — mesmo texto e volume (45.267 chars) do registro histórico, agora com validação explícita.

**Hisrich (pageid) — início (pág. impressa 23):** "O EMPREENDEDORI1SMO E A MENTALIDADE EMPREENDEDORA / OBJETIVOS DE APRENDIZAGEM…" — fim (pág. impressa 45): abertura do Cap. 2 ("INTRAEMPREE2NDEDORISMO OU EMPREENDEDORISMO CORPORATIVO…"), confirmando a cobertura do Cap. 1 (23..45).

> Nota: "EMPREENDEDORI1SMO"/"INTRAEMPREE2NDEDORISMO" são erros do **próprio texto digital do livro** (OCR), preservados fielmente — não são erros de extração.

## 5. O que foi validado

- **Carregamento real detectado por sondagem**, não por espera fixa (epub e pageid).
- **Começo, meio e fim** do conteúdo validados.
- **Capítulo confirmado**: por texto (epub) e/ou por **faixa de páginas impressas do sumário** (pageid: 23..45 ⇒ Cap. 1) — fonte mais confiável que procurar a string "Capítulo 1" no corpo.
- **Zero repetições suspeitas** após deduplicação do prefetch do leitor pageid.
- **Sem truncamento** (fim em limite de sentença / no início do capítulo seguinte).
- **Recurso inacessível não é mascarado**: Fabrete (canvas) registrado `inaccessible`, sem conteúdo inventado.

## 6. O que ainda NÃO foi validado

- Fidelidade visual (layout, imagens, tabelas) — não é escopo do Módulo 3 (texto apenas).
- Livros DRM com restrição de leitura online (não testar/contornar).
- Outras disciplinas/semanas (apenas ADM270 S1; cada recurso será avaliado individualmente).
- Integração no fluxo completo do app (Etapa 4/5) e no executável empacotado.
- Numeração de página por frame no pageid é a **página impressa corrente do leitor** no momento da captura (o prefetch pode incluir a próxima página); fidelidade da associação página↔texto é aproximada.

## 7. Limitações conhecidas

1. **Prefetch no leitor pageid**: o leitor pré-carrega a página seguinte; resolvido com deduplicação por texto, mas a etiqueta de página impressa pode associar a página pré-carregada à página corrente (cobertura correta, numeração aproximada).
2. **`bvpdf`/`bvleitor` (canvas)**: conteúdo não exposto ao DOM; registrado `inaccessible` (não contornar).
3. **`unknown`**: leitor não reconhecido → `inaccessible`.
4. **Capítulo por faixa de páginas** depende do sumário estar legível no DOM; sem ele, usa cabeçalho "Capítulo N+1" como fallback.
5. **OCR do livro**: o texto digital de Hisrich contém artefatos ("EMPREENDEDORI1SMO") preservados como no original.

## 8. Problemas encontrados e corrigidos durante o teste

1. **Falso positivo de "fim de capítulo"** (pageid): a 1ª versão lia o chrome do leitor (sumário) junto do conteúdo, e o sumário contém "Capítulo 2 …" → parava após ~3k chars com status `integral` errado. **Correção**: ler só frames `/pages/N/content` + confirmar fim pela **página impressa** do próximo capítulo.
2. **Conteúdo duplicado (prefetch)**: 181 parágrafos repetidos em Hisrich. **Correção**: deduplicação por texto por página.
3. **Harness**: `expectInaccessible` não era copiado para o objeto do livro → critério de teste incorreto. **Correção** no harness.

## 9. Conclusão

O **Módulo 3** extrai capítulos de livros digitais da Minha Biblioteca com validação rigorosa e status honesto, sobre a janela do Electron (um único Chromium). Evidências reais da S1: **Chiavenato (epub) `integral`** e **Hisrich (pageid) `integral`** (Cap. 1 confirmado por páginas impressas 23..45), **Fabrete (bvpdf) `inaccessible`**. O módulo **aguarda sua avaliação** antes de avançar ao **Módulo 4 (videoaulas)**.
