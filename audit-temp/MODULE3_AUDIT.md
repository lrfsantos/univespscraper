# Auditoria do Módulo 3 — `src/extract/books.js` e `poc/test-module3.js`

> Data: 2026-11-05. Revisão independente da lógica de extração/validação e dos critérios de teste, após os commits do repositório (8742012..1a46321).

## A. `src/extract/books.js`

### A.1 Critérios de `integral` (verificados)

`statusForBook` (após correção nesta auditoria) exige **evidência positiva de todas** as validações:

- `readerLoaded` (leitor carregou);
- `hasText` (texto ≥ 500 chars) e `noNonsense` (não é mensagem de erro/incompatibilidade);
- `startOk` (início com conteúdo acadêmico, sem front matter);
- `midOk` (corpo ≥ 3000 chars e ≥ 8 parágrafos);
- `endOk` (fim confirmado: pageid = alcançou o início do capítulo seguinte; epub = termina em limite de sentença);
- `chapterOk === true` quando um capítulo é esperado (texto OU faixa de páginas impressas do sumário);
- zero repetições suspeitas e zero avisos.

**Resultado:** ausência de validação ou qualquer falha comprovada **impede** `integral` (rebaixa para `partial`). Antes desta auditoria, o status dependia indiretamente de `warnings`; agora o contrato é explícito e coincide com o critério do teste.

### A.2 Falsa confirmação por título do livro (verificado)

O commit `b161da3` removeu a lógica que usava `expected.book` para aprovar `chapterOk`. **Mantida.** A simples presença do título (que aparece no sumário/cabeçalho do leitor) não confirma que o capítulo pedido foi extraído. Confirmação de capítulo exige:
- pageid: faixa de páginas impressas do sumário (ex.: Cap. 1 = 23..45) — navegou do início do capítulo até o início do próximo; OU
- epub: ocorrência de "Capítulo N" no conteúdo extraído.

### A.3 Navegação pageid — início/fim

- **Início:** a extração começa na página impressa corrente (23 = início do Cap. 1, confirmado pelo sumário). A página inicial não é "pulada".
- **Fim:** o loop para quando `curPage >= nextChapterPage` (46, lido do sumário) → `reachedChapterEnd`, ou por cabeçalho "Capítulo N+1" (fallback sem sumário), ou por `maxPages`/`sem-conteudo-novo`/`sem-botao-seguinte` (→ `partial`). Fim de capítulo não confirmado nunca gera `integral`.

### A.4 Deduplicação preserva parágrafos legítimos (verificado)

- A dedup é **por texto completo de página** (hash do texto), não por parágrafo: uma página única é mantida integralmente; apenas leituras repetidas (prefetch) são descartadas. Parágrafos legítimos que ocorrem em páginas diferentes são preservados (ver `HISRICH_COMPARISON.md`: 24 blocos únicos, 22 frame-reads duplicados descartados; razão de parágrafos bruto/único 1,945).
- `detectRepetitions` sinaliza **parágrafos idênticos** (≥120 chars) repetidos no resultado final — se aparecerem, vira aviso → `partial` (comportamento conservador e honesto).

### A.5 Falhas intermediárias detectadas e registradas

- `steps` registra: `pagina-limite-capitulo`, `cabecalho-capitulo-seguinte`, `sem-conteudo-novo`, `sem-botao-seguinte`, `limite-de-paginas`, `leitor-nao-carregou`.
- Falhas que impedem o fim do capítulo → `endOk=false` → aviso → `partial`. Falha de carregamento do leitor → `inaccessible`. Capítulo não localizado (epub) → `not_found`.

### A.6 Avisos × comportamento real

- Avisos emitidos correspondem 1:1 a falhas estruturais: `inicio-nao-validado`, `meio-nao-validado`, `possivel-truncamento-no-final` / `fim-*`, `repeticao-suspeita`, `capitulo-N-nao-confirmado-*`, `conteudo-e-mensagem-de-erro`.
- A confirmação por faixa de páginas registra uma **nota** (`pageRangeNote`), não um aviso — não rebaixa o status.

## B. `poc/test-module3.js`

### B.1 Campo de repetições (verificado)

- `validation.repetitions` é um **array** de `{ length, count, snippet }` (de `detectRepetitions`). O critério `(!v.repetitions || v.repetitions.length === 0)` está **correto** quanto ao tipo e significado (ausência de parágrafos idênticos repetidos).

### B.2 Critério `noIntegralWithoutValidation` (verificado)

- Exige, para `integral`: `hasText && noNonsense && startOk && midOk && endOk && (sem capítulo esperado ou chapterOk===true) && repetições vazias && warnings vazios`. Coincide exatamente com o `statusForBook` corrigido — sem falso positivo (um resultado com início/meio/fim não validados **nunca** é aceito como `integral`).

### B.3 Validação de capítulo obrigatória

- Quando `expected.chapter` existe (os 3 recursos da S1 têm capítulo 1), `chapterOk === true` é exigido para `integral`. Sem ele → `partial`/`not_found`. (Fabrete, inacessível, é excluído do critério.)

### B.4 Detecção de falsos positivos

- `noIntegralWithoutValidation` revalida os campos do objeto retornado pelo extrator, independentemente do `status` calculado — se o extrator errar e marcar `integral` sem evidência, o teste falha.

## C. Correções aplicadas nesta auditoria

1. `statusForBook` agora exige explicitamente `startOk && midOk && endOk && chapterOk` (+ sem repetições/avisos) — antes dependia indiretamente de `warnings`.
2. Instrumentação de diagnóstico (`opts.trace`) adicionada a `extractPageid` (sha256 por página, contagens, fragmentos ≤40 chars) — usada em `poc/diag-hisrich.js`; não altera o fluxo normal.

## D. Conclusão

A lógica de `integral` está tecnicamente correta e conservadora; a confirmação de capítulo exige evidência real; a dedup preserva conteúdo único; falhas intermediárias são refletidas no status. Testes espelham o comportamento real e não aprovam falsos positivos.
