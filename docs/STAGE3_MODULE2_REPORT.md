# UNIVESP Study Tool — Etapa 3, Módulo 2: PDFs (download e extração textual)

> Data: 2026-11-04. Material de validação: **ADM270 — Empreendedorismo e Inovação, Semana 1** (slides de apoio das videoaulas 1-3).
> Objetivo: baixar os PDFs detectados no Módulo 1 (preservando os bytes originais), extrair o texto **por página**, distinguir total de páginas do arquivo × numeração impressa, e atribuir status de fidelidade honesto.

---

## 1. Arquivos criados/modificados

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `src/extract/pdfs.js` | criado | **Módulo 2**: download do PDF (net do Electron ou HttpClient), análise por página, paginação impressa (heurística), status de fidelidade |
| `poc/test-module2.js` | criado | Teste do Módulo 2 (baixa e analisa os 3 slides de apoio da S1) |
| `poc/evidence/module2/result.json` | gerado | Resultado estruturado do teste |
| `poc/evidence/module2/tmp/*.pdf` | gerado | PDFs originais preservados (evidência dos bytes) |
| `poc/evidence/module2/tmp/*.txt` | gerado | Texto extraído por página (evidência) |

---

## 2. Comportamento implementado

O módulo `src/extract/pdfs.js` expõe `extractPdf({ url, filePath, client, useElectronNet })`:

1. **Download** do PDF preservando os **bytes originais**:
   - via `net` do Electron (processo principal, contorna CORS/UA) — `useElectronNet: true`;
   - ou via `HttpClient` (Node puro, cookie jar em memória) — usado no teste (recursos são públicos em `assets.univesp.br`).
2. **Preservação do original:** grava o arquivo binário recebido em `filePath` sem nenhuma modificação.
3. **Análise por página** (`analyzePdf`): com `pdf-parse` v2.4.5, carrega o documento, obtém metadados e extrai o texto **de cada página individualmente** (`doc.getPage(n)` + `getPageText(page, opts, total)`), com chars por página.
4. **Distinção explícita de paginação** (correção obrigatória da PoC):
   - `totalPagesArquivo` = `getInfo().total` (**páginas do arquivo**, não numeração impressa);
   - `printedPagination` = **numeração impressa** via heurística (procura linha isolada com um único número no texto da página) — explícita como **não garantida**;
   - `pagesExtracted` = quantidade de páginas com texto efetivamente obtido.
5. **Status de fidelidade** (`statusFor`):
   - `inaccessible` — download falhou, sem bytes, ou nenhuma página com texto;
   - `partial` — baixado, mas análise falhou, ou texto extraído < total de páginas do arquivo;
   - `integral` — **todas** as páginas do arquivo tiveram texto extraído.

> **Correção aplicada durante o teste:** nesta versão do pdf-parse, `getPageText` recebe o **objeto de página** (não o índice). A primeira execução retornava `0/18` páginas por esse erro de API; corrigido em `analyzePdf` e reexecutado.

---

## 3. Testes realizados

- **Harness:** `poc/test-module2.js` — usa `createHttpClient([])` (recursos públicos, sem login), baixa e analisa os 3 slides de apoio detectados no Módulo 1.
- **Recursos testados (URLs públicas `assets.univesp.br`):**
  - `s1_slides_videoaula1.pdf` — slides da Videoaula 1 (S1)
  - `s1_slides_videoaula2.pdf` — slides da Videoaula 2 (S1)
  - `s1_slides_videoaula3.pdf` — slides da Videoaula 3 (S1)
- **Execução:** 3/3 downloads OK, análise concluída sem interação.

---

## 4. Evidências concretas (resultado do teste)

| Recurso | Status | Bytes | totalPagesArquivo | pagesExtracted | Numeração impressa detectada |
|---------|--------|-------|--------------------|----------------|------------------------------|
| s1_slides_videoaula1 | **integral** | 939.805 | 18 | 18/18 | nenhuma (none) |
| s1_slides_videoaula2 | **integral** | 1.379.827 | 18 | 18/18 | nenhuma (none) |
| s1_slides_videoaula3 | **integral** | 1.698.417 | 26 | 26/26 | nenhuma (none) |

- **Total: 62/62 páginas extraídas com texto**, status `integral` nos 3 PDFs.
- `printedPagination.detected` = todos `null` → `reliable: 'none'`: os slides **não possuem numeração impressa isolada** extraível (relato honesto: ausência de detecção ≠ perda de conteúdo; os slides não imprimem número de página isolado no texto).

---

## 5. Exemplos de conteúdo extraído (fidelidade)

**s1_slides_videoaula1 — página 1:**
> Empreendedor e Empreendedorismo
> Introdução
> EMPREENDEDORISMO E INOVAÇÃO

**s1_slides_videoaula2 — página 2:**
> É possível aprender a ser Empreendedor?
> Até tempos atrás, muitos autores acreditavam que essa fosse uma característica...

**s1_slides_videoaula3 — página 2:**
> INOVAÇÃO E DESENVOLVIMENTO ECONÔMICO
> INOVAÇÃO – A reação de Obama
> Barack Obama lança esforço para estimular investimentos...

Os arquivos `.txt` por página estão disponíveis em `poc/evidence/module2/tmp/` (UTF-8 válido).

---

## 6. Status de fidelidade

- Os 3 PDFs obtiveram **`integral`**: arquivo baixado (bytes preservados), `totalPagesArquivo` definido e **todas** as páginas do arquivo tiveram texto extraído (`18/18`, `18/18`, `26/26`).
- **Ressalva honesta:** `integral` aqui significa **texto extraível de todas as páginas do arquivo**. Não valida: fidelidade visual (layout/slides como imagem), numeração impressa (ausente nos slides) nem comparação byte a byte com o que o AVA exibe (o download foi do mesmo URL público indicado pela página).
- **Paginação impressa:** a heurística não encontrou numeração isolada nos slides → `reliable: 'none'`, registrado como tal (não inventar numeração).

---

## 7. Limitações conhecidas

1. **Numeração impressa é heurística:** depende de o texto da página conter um número isolado em linha própria. Slides da S1 não têm; livros/pdf-acadêmicos podem ter — sempre tratado como **não garantido** e validado caso a caso.
2. **PDFs escaneados/imagem:** sem camada de texto (ou com texto como imagem), `pagesExtracted` será 0 → status `inaccessible`/`partial` e precisarão de OCR (não implementado, não prometido).
3. **`integral` não prova fidelidade visual:** layout, cores, imagens não são validados nesta etapa; apenas o texto por página.
4. **Download via HttpClient** depende da URL ser publicamente acessível (caso dos slides). Recursos atrás de autenticação/DRM usam `net` do Electron com a sessão do login (caminho `useElectronNet: true`), ainda não exercitado com autenticação neste teste.

---

## 8. Problemas ainda não resolvidos

- Extração de PDFs de **textos-base (Minha Biblioteca, DRM)** — escopo do Módulo 3; aqui só URLs públicas `assets.univesp.br`.
- Validação da **numeração impressa** em PDFs que realmente a possuam (ex.: e-books/artigos) — pendente de amostra.
- Caminho `useElectronNet: true` dentro do app Electron com sessão autenticada — a validar quando integrarmos os módulos no app completo.

---

## 9. Conclusão

O **Módulo 2** atende aos critérios: **download preservando os bytes originais**, **extração textual por página**, **distinção explícita entre total de páginas do arquivo e numeração impressa** (sem garantir o que não é verificável), e **status de fidelidade honesto** por PDF. Evidências reais da S1 do ADM270: 3 PDFs de slides, **62/62 páginas** extraídas com texto, status `integral` nos 3. O módulo **aguarda sua avaliação** antes de avançar para o **Módulo 3 (livros/Minha Biblioteca)**.
