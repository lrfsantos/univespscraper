# UNIVESP Study Tool — Etapa 3, Módulo 1: Páginas HTML e conteúdo textual do AVA

> Data: 2026-11-03. Material de validação: **ADM270 — Empreendedorismo e Inovação, Semana 1**.
> Objetivo: extrair e validar o conteúdo textual das páginas `mod/page` do AVA, com status de fidelidade honesto por recurso.

---

## 1. Arquivos criados/modificados

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `docs/STAGE3_PLAN.md` | criado | Decisões obrigatórias e plano modular da Etapa 3 |
| `src/extract/pages.js` | criado | **Módulo 1**: extração de páginas HTML/AVA com status de fidelidade |
| `poc/test-module1.js` | criado | Teste do Módulo 1 (lança Electron, login, extrai páginas da S1) |
| `poc/evidence/module1/result.json` | gerado | Resultado estruturado do teste |
| `poc/evidence/module1/{inicio,videoaulas,aprofundando,sintese}.txt` | gerado | Texto extraído por página (evidência) |
| `poc/evidence/module1/run.log` | gerado | Log de execução |

---

## 2. Comportamento implementado

O módulo `src/extract/pages.js` opera sobre a janela do Playwright (`Page`) já autenticada no AVA e:

1. Navega até a URL (`domcontentloaded` + espera curta).
2. Localiza o escopo principal do conteúdo: `.ava-scope` → `[role="main"]` → fallback `body`.
3. Extrai: **título**, **texto** (`innerText` do escopo), **links**, **iframes**.
4. Classifica recursos: **PDFs** (`.pdf`) e **vídeos** (YouTube/embeds) dentro do escopo.
5. Calcula o **status de fidelidade** por recurso:
   - `integral` — texto presente no escopo principal, sem mensagens de erro, ≥ 20 chars;
   - `partial` — texto presente, mas escopo principal não confirmado;
   - `inaccessible` — HTTP ≥ 400, texto vazio, ou texto = mensagem de erro;
   - `not_found` — HTTP 404 ou sem título e sem texto.
6. **Rejeita mensagens de erro/incompatibilidade** (não confunde com conteúdo acadêmico) via regex `ERROR_RE`.

---

## 3. Testes realizados

- **Harness:** `poc/test-module1.js` — lança `electron/browser.js` via `playwright-core._electron` (um único Chromium), faz login automático (autorizado) e extrai 4 páginas `mod/page` da Semana 1 do ADM270.
- **Páginas testadas:**
  - `263473` — S1-Início
  - `263474` — S1-Videoaulas
  - `263481` — S1-Aprofundando o tema
  - `263482` — S1-Em síntese
- **Execução:** login OK (`ava.univesp.br/my/`), 4 páginas extraídas, sem interação manual.

---

## 4. Evidências concretas (resultado do teste)

| Recurso | pageStatus (texto HTML) | Texto (chars) | HTTP | Links | PDFs (pendentes) | Vídeos (pendentes) |
|---------|--------------------------|---------------|------|-------|-------------------|--------------------|
| S1-Início | **integral** | 4.219 | 200 | 0 | 0 | 3 |
| S1-Videoaulas | **integral** | 386 | 200 | 6 | 3 | 3 |
| S1-Aprofundando | **integral** | 508 | 200 | 0 | 0 | 4 |
| S1-Em síntese | **integral** | 1.152 | 200 | 0 | 0 | 0 |

> **Nota:** `pageStatus` refere-se **somente ao texto HTML** da página. Os PDFs e vídeos listados
> são **referências detectadas** (URLs), com status **pendente** — serão avaliados nos Módulos 2-4.
> Um `pageStatus: integral` **não** significa que os materiais associados foram extraídos.

- `httpStatus` 200 em todas; `hasScope: true` em todas (escopo principal detectado).
- Verificação de encoding: os arquivos `.txt` estão em **UTF-8 válido** (ex.: bytes `C3 A7` = ç, `C3 A3` = ã). A aparente corrupção no console era apenas exibição do terminal.

---

## 5. Exemplos de conteúdo extraído (fidelidade)

**S1-Início (início do texto):**
> TEMA DA SEMANA 1
> Introdução ao desenvolvimento de novos empreendimentos (histórico e conceituação)
> Olá, estudante!
> Boas-vindas à disciplina Empreendedorismo e Inovação.
> Nesta primeira semana, serão apresentados conceitos básicos a respeito da temática empreendedorismo e empreendedor.
> ... Objetivos de aprendizagem / Desafio / Revisitando Conhecimentos / Orientação de estudos ...

**S1-Videoaulas (links/recursos detectados):**
- 3 PDFs: `assets.univesp.br/disciplinas/ADM270/pdf/s1_slides_videoaula{1,2,3}.pdf`
- 3 vídeos YouTube (embeds) + 3 links "Download do Vídeo" (`download.php?disciplina=adm270&video=...`)

**S1-Em síntese (fim do texto):**
> Parabéns! Você chegou ao fim do conteúdo desta semana.
> Na próxima semana, abordaremos o processo de criação de uma empresa...

---

## 6. Status de fidelidade

> **Esclarecimento (correção obrigatória):** os 4 resultados `integral` abaixo referem-se **exclusivamente ao texto HTML extraído da página** (`pageStatus`). **Não** representam o status dos materiais associados (vídeos, PDFs, livros). Os recursos vinculados/incorporados têm status **próprio e pendente** (`resources.status: 'pending'`), a ser calculado nos Módulos 2-4. Uma página pode ser `integral` enquanto seus PDFs/vídeos ainda não foram avaliados.

- Todas as 4 páginas obtiveram `pageStatus: integral` — texto HTML presente no escopo principal (`.ava-scope`), HTTP 200, sem mensagens de erro.
- **Ressalva de completude:** HTTP 200 + escopo detectado + texto ≥ 20 caracteres são **verificações básicas** (registradas em `checks`), mas **não provam, isoladamente, que todo o conteúdo foi carregado**. A completude ainda depende de validações adicionais (conteúdo dinâmico, renderização JS tardia, elementos que carregam após a leitura).
- **Classificação honesta:** se houver sinais de carregamento incompleto (ex.: texto com "carregando/loading/skeleton"), o status cai para `partial` — nunca `integral` sem ressalvas. Nenhuma página foi marcada `integral` sem essas condições.

---

## 7. Limitações conhecidas

1. **Título duplicado/incompleto no escopo:** o `innerText` do escopo pode conter o título da página repetido (ex.: "S1-Início" apareceu no texto) — não interfere na fidelidade, mas é normalizado apenas parcialmente.
2. **`smart_display` (ícones) incluídos no texto:** ícones de mídia aparecem como texto `smart_display` em algumas páginas (ex.: Videoaulas) — ruído de acessibilidade, não conteúdo falso.
3. **Páginas dinâmicas (JS tardio):** usa `domcontentloaded` + espera fixa de 2,5s. Páginas que carregam conteúdo via JS após esse tempo podem vir `partial`/`inaccessible` — mitigação futura (detecção de elemento-alvo) no app completo.
4. **Vídeos de apoio em "Início"** aparecem como iframes sem texto — referência preservada, conteúdo (transcrição) fica para o Módulo 4.

---

## 8. Problemas ainda não resolvidos

- Detecção mais robusta de "conteúdo carregado" (em vez de espera fixa) — recomendada para páginas com renderização JS tardia.
- Normalização do ruído (`smart_display`, títulos duplicados) — planejado para a Etapa 4 (organização/report).
- Não implementado no Módulo 1: extração de PDFs (Módulo 2), livros (Módulo 3), transcrições de vídeo (Módulo 4).

---

## 9. Conclusão

O **Módulo 1** atende aos critérios: extração do **texto HTML** das páginas do AVA com **status de fidelidade honesto** (`pageStatus`), validação contra mensagens de erro, e evidências reais da Semana 1 do ADM270 (4 páginas, todas com `pageStatus: integral` — **apenas o texto HTML**; os recursos associados continuam pendentes). O módulo **aguarda sua avaliação** antes de avançar para o **Módulo 2 (PDFs)**.
