# Investigação dos leitores BVirtual — UNIVESP Scraper

**Status geral: INVESTIGAÇÃO DOCUMENTADA — confirmação técnica depende de sessão real do usuário.**

Este relatório descreve separadamente os dois leitores observados na gravação do usuário (08:12, 848×478, com narração) e o que o aplicativo implementa hoje para investigá-los e extraí-los.

> Regra de honestidade (seção 4.6 da missão): a gravação confirma o comportamento da interface, não o transporte interno do conteúdo. Nenhuma conclusão sobre PDF/EPUB/endpoints é apresentada aqui como fato sem inspeção de DOM/rede com sessão real.

---

## 1. Contexto

A gravação mostra navegação em materiais de leitura acessados a partir do AVA UNIVESP. Foram identificados dois padrões de leitor distintos, em domínios diferentes, que exigem investigação técnica própria.

Não foi fornecida transcrição textual da fala; nenhuma instrução ou observação atribuída ao usuário é inventada aqui.

---

## 2. Caso A — leitor BVirtual com comportamento de leitura estruturada (tipo EPUB)

### 2.1. Evidência visual (o que a gravação mostra)

- Livro: **Comunicação organizacional: práticas, desafios e perspectivas digitais**.
- Atividade relacionada: **Capítulo 1 — Comunicação Organizacional e transformação digital: novos cenários, novos olhares**.
- Autora (descrição da atividade): **Elizabeth Saad**.
- Domínio do leitor: `leitor.bvirtual.com.br`.
- Comportamentos: abertura a partir do AVA, texto em interface de leitura digital, indicador de página, navegação entre páginas, sumário/ferramentas, leitura em tela cheia, conteúdo organizado em títulos e parágrafos.

### 2.2. O que a gravação NÃO prova

- Que o conteúdo é um EPUB ou um conjunto de XHTML;
- que existe um arquivo EPUB baixável;
- que existe um endpoint de conteúdo específico;
- que todos os capítulos estão acessíveis pela rede.

### 2.3. Suporte técnico atual no aplicativo

O aplicativo já classifica leitores por evidência técnica de URL/frame (não por aparência):

- `classifyReader()` reconhece o padrão **EPUB** quando um frame de conteúdo tem caminho `/epub/OEBPS/Text/...` (`EPUB_CONTENT_RE`);
- reconhece o padrão **pageid** (`/pages/N/content` ou `jigsaw.minhabiblioteca.../books/<id>/pageid/N`);
- reconhece a plataforma BVirtual (`plataforma.bvirtual`, `leitor.bvirtual`, `/Leitor/`) — distinguindo `bvpdf` de `bvleitor`;
- para conteúdo em canvas/DRM, retorna status `inaccessible` com `failureType` `drm-not-extractable` (nunca inventa extração textual).

### 2.4. Estratégia de extração pretendida

Quando houver conteúdo estruturado autorizado na sessão (EPUB ou documentos XHTML):

1. Identificar o documento ativo por identidade estrutural (doc/idref/caminho EPUB).
2. Obter o pacote EPUB (manifest/spine/nav) pela mesma origem do frame (sem contornar DRM).
3. Confirmar capítulo pelo sumário/navegação e o limite pelo documento seguinte ou spine.
4. Extrair a estrutura original (títulos, parágrafos, listas, tabelas, links) — nunca converter o capítulo em massa de texto.

Essa infraestrutura já existe em `src/extract/books.js` (`extractEpubViaAdapter`, `applyEpubStructuralValidation`, `confirmEpubBoundaryDecision`, `fetchEpubPackageFromReader`).

### 2.5. O que ainda depende de sessão real do usuário

- Confirmar se o domínio `leitor.bvirtual.com.br` expõe documentos `/epub/OEBPS/Text/` ou equivalente;
- confirmar se o pacote EPUB (manifest/spine/nav) é acessível pela sessão;
- confirmar o mecanismo de navegação entre capítulos;
- executar o `diagnoseReader` (ver seção 4) e validar o relatório sanitizado.

---

## 3. Caso B — leitor BVirtual com navegação por páginas (livro de Cálculo)

### 3.1. Evidência visual (o que a gravação mostra)

- Livro: **Cálculo A — Funções, limite, derivação e integração**.
- Autoras: **Diva Marília Flemming; Mirian Buss Gonçalves**.
- Plataforma: `plataforma.bvirtual.com.br`.
- Comportamentos: interface paginada, opção entre versão nova em beta e leitor clássico, sumário lateral com capítulos, navegação por número de página, indicador de página atual/total, navegação observada até a página 203, documento com indicador de ~452 páginas.

### 3.2. O que a gravação NÃO prova

- Que o leitor disponibiliza o PDF original;
- que o conteúdo é imagem de página, HTML, dados estruturados ou outro formato;
- que a página interna 203 corresponde à página impressa 203;
- que o total de páginas do leitor equivale ao de um PDF.

### 3.3. Suporte técnico atual no aplicativo

- `classifyReader()` reconhece `plataforma.bvirtual` como `bvpdf` (leitor paginado) e `leitor.bvirtual` como `bvleitor`;
- para leitores paginados sem conteúdo extraível, o status é `inaccessible` com `failureType` `drm-not-extractable` — sem OCR, sem alegação de integral;
- o padrão **pageid** (Minha Biblioteca/VitalSource) tem extração estrutural com sincronização página×frame, mas isso NÃO é presumido para a plataforma BVirtual.

### 3.4. Tratamento de fórmulas matemáticas

O livro de Cálculo exige atenção especial com fórmulas. O aplicativo:

- preserva o que estiver no DOM textual (não remove operadores/símbolos por heurística);
- não inventa expressões matemáticas a partir de imagens/canvas;
- se o conteúdo for exclusivamente imagem/canvas e não houver OCR real, o status refletirá a limitação — nunca será declarado integral.

### 3.5. O que ainda depende de sessão real do usuário

- Confirmar o formato real (PDF / imagens / HTML / dados estruturados);
- se houver PDF autorizado, usar a extração PDF já corrigida (seção 7);
- se houver texto no DOM, avaliar extração estrutural por página;
- se for exclusivamente imagem, registrar a limitação sem OCR.

---

## 4. Modo de diagnóstico sanitizado

Implementado em `src/extract/books.js`:

- `sanitizeUrlForReport(url)` — redige query string e fragmento por padrão (cobre o parâmetro `code` observado na gravação);
- `diagnoseReader(app, win, launchUrl, expected, opts)` — navega uma vez, classifica o leitor e gera relatório SEM credenciais/tokens/query strings/conteúdo de livros.

O relatório contém: origem AVA sanitizada, domínio, classificação, `failureType`, nº de janelas/frames, domínios observados, tipos de conteúdo, evidência de PDF, evidência de conteúdo HTML/EPUB, método de navegação, estratégia de extração, tempo de carregamento, tentativas e limitações.

Proibido no relatório: cookies, senhas, tokens, `code=`, cabeçalhos de autenticação, IDs de sessão, conteúdo integral de livros.

Testes: `poc/test-bvirtual-m3.js` (6 casos) — inclui prova de que o relatório não vaza `code`/`token`/credenciais.

---

## 5. Conclusão e pendências

| Item | Estado |
|---|---|
| Classificação técnica por evidência (EPUB/pageid/bvpdf/bvleitor) | CONCLUÍDO (código + testes) |
| Diagnóstico sanitizado (`diagnoseReader`) | CONCLUÍDO (código + testes 6/6) |
| Extração estrutural EPUB (multi-XHTML, spine, limite) | CONCLUÍDO (código + testes) |
| Extração pageid com sincronização página×frame | CONCLUÍDO (código + testes) |
| Confirmação do formato real do leitor A (`leitor.bvirtual.com.br`) | NÃO TESTADO (depende de sessão real) |
| Confirmação do formato real do leitor B (`plataforma.bvirtual.com.br`) | NÃO TESTADO (depende de sessão real) |
| Extração real de um capítulo de cada leitor | NÃO TESTADO (depende de sessão real) |

**Não é declarado suporte a um leitor BVirtual apenas porque a interface abriu.** O suporte real só será confirmado quando o `diagnoseReader` rodar em sessão autenticada do usuário e os formatos forem inspecionados (DOM + rede), sem registrar dados sensíveis.
