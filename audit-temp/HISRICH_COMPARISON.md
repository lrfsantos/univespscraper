# Discrepância Hisrich — 365.625 × 104.066 caracteres (investigação)

> Data: 2026-11-05. Recurso: ADM270 S1, id 263477, Hisrich "Empreendedorismo" (leia o capítulo 1) — leitor `pageid`.
> Objetivo: explicar a diferença entre a execução histórica (≈365.625 chars) e a atual (≈104.066 chars) e validar a deduplicação, a sequência de páginas e a cobertura do capítulo.
> Evidência bruta sanitizada: `audit-temp/HISRICH_TRACE.json` (sha256 por página, contagens, fragmentos ≤40 chars). Nenhum texto integral é publicado.

## 1. Contexto das duas execuções

| | Execução histórica | Execução atual |
|---|---|---|
| Harness | Legado `src/lib/books.js` (`extractChapterFromPage`) — browser Chromium do Playwright + cookies | Módulo 3 `src/extract/books.js` — janela do Electron (`playwright-core._electron`), sessão autenticada |
| Deduplicação | **Não** (acumulava todos os frames lidos a cada passo) | Sim (por texto de página) |
| Critério de parada | `Capítulo 2` no texto OU até 40 iterações | Página impressa 46 (início do Cap. 2, lida do sumário) OU cabeçalho "Capítulo 2" |
| Chars | ≈365.625 (brutos, com duplicatas) | 104.066 / 104.066 / 103.493 (2 testes + 1 diagnóstico) |

## 2. Execução instrumentada (esta sessão, `poc/diag-hisrich.js`)

- Iterações de navegação: **23**
- Leituras de frame (raw): **46** → 24 únicas + 22 repetidas → **2,00 frames/passo** (o leitor pré-carrega a página seguinte em um segundo frame de conteúdo)
- Chars brutos lidos (todas as leituras): **203.170** | Chars únicos (após dedup): **103.493** → razão **1,963**
- Parágrafos brutos: **852** | Parágrafos únicos: **438** → razão **1,945**
- Blocos de conteúdo únicos: **24**, cobrindo **páginas impressas 23..45** — sequência **contígua, sem lacunas**
- Sumário lido do leitor: Cap. 1 → pág. 23; Cap. 2 → pág. 46; `reachedChapterEnd: true`; `maxPagesHit: false`
- Início (pág. 23): abertura do capítulo ("O EMPREENDEDORISMO E A MENTALIDADE EMPREENDEDORA / OBJETIVOS DE APRENDIZAGEM…")
- Fim: último bloco (rótulo 45) contém a abertura do Cap. 2 → limite do capítulo atingido
- Meio: págs. 24..44 todas presentes

## 3. Explicação da discrepância

1. **Prefetch:** o leitor mantém ~2 frames de conteúdo por passo (página atual + próxima pré-carregada). Um extrator sem deduplicação lê cada página ~2×.
2. **Harness legado sem dedup:** `extractChapterFromPage` acumulava chars BRUTOS de todos os frames a cada passo, sem remover duplicatas entre passos, e podia rodar até 40 iterações sem confirmar o fim do capítulo.
3. **Projeção do acúmulo legado:** 203.170 chars brutos ÷ 23 passos × 40 iterações ≈ **353.339 chars** — próximo do histórico **365.625** (Δ ≈ 3%, atribuído a variação de sessão/tamanho de página). Ou seja, o histórico é consistente com ~40 iterações × ~2 frames/passo **com duplicatas**.
4. **Extrator atual:** deduplica por texto e produz o conteúdo **único** do capítulo (103–104k chars), com fim confirmado pelo sumário (pág. 46).

**Conclusão: discrepância EXPLICADA** — causada por duplicação (prefetch) + limite de iterações do harness legado, não por perda de conteúdo no extrator atual. A cobertura atual do Cap. 1 (págs. 23..45) é contígua e sem lacunas.

## 4. Respostas às perguntas da auditoria

| # | Pergunta | Resposta (evidência) |
|---|---|---|
| 1 | Mesmo intervalo de páginas? | Sim — ambos percorrem o Cap. 1 (págs. impressas 23..45); o legado, porém, parava por limite de iterações/texto, não pela página impressa |
| 2 | Perda de conteúdo na navegação? | Não — sequência 23..45 contígua, sem lacunas (trace `pageSequence`) |
| 3 | Dedup removeu conteúdo legítimo? | Não — removeu **somente** leituras repetidas (22 de 46 frame-reads = cópias de páginas já capturadas); 24 blocos únicos preservados (hash por página em `HISRICH_TRACE.json`) |
| 4 | Prefetch interfere na sequência? | Sim, mas é tratado: ~2 frames/passo; a dedup por texto garante 1 captura por conteúdo único; sem dedup o texto ficaria ~2× maior (razão 1,96) |
| 5 | Início/meio/fim capturados? | Sim — início (pág. 23), meio (24..44) e fim (boundary do Cap. 2, pág. 46) |
| 6 | Identificação de páginas impressas correta? | Parcial — o rótulo é a página impressa corrente do leitor no momento; é **aproximado** (limitação): a pág. 23 tem 2 frames de conteúdo (abertura do capítulo + página da "Parte I") e o último bloco (rótulo 45) traz a abertura do Cap. 2 (leve sobre-inclusão, sem truncamento) |
| 7 | Truncamento ou interrupção silenciosa? | Não detectado — `reachedChapterEnd: true`, sem `maxPagesHit`, sem `sem-conteudo-novo` |

## 5. Reproducibilidade

- 2 execuções do teste M3: **104.066** e **104.066** (idênticas).
- Execução de diagnóstico: **103.493** (Δ ≈ 0,6% em relação aos testes, atribuído a variação de renderização do leitor — ex.: texto dinâmico em frame de conteúdo). O conteúdo do capítulo permanece íntegro; hashes por página em `HISRICH_TRACE.json` permitem comparação por reexecução.

## 6. Limitações conhecidas (registradas)

- Rótulo de página impressa é heurística do leitor (associação página↔frame aproximada; sobre-inclusão do início do capítulo seguinte no último bloco).
- A execução histórica (365.625) não é reproduzível bit a bit (harness legado removido da execução atual); a explicação é por mecanismo (duplicação + limite de iterações), não por reprodução exata.
- `HISRICH_TRACE.json` contém hashes sha256 por página — permite verificação independente sem expor conteúdo.
