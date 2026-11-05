# UNIVESP Study Tool — Etapa 3: Módulos de Extração (Plano e Decisões)

> Data: 2026-11-03. Etapa 2 aprovada com ressalvas. Início da Etapa 3.
> Foco: validar cada módulo com materiais reais de **ADM270 — Empreendedorismo e Inovação**, preservando a PoC como referência. Não desenvolver a versão completa com todas as disciplinas/semanas ainda.

---

## Decisões obrigatórias (do usuário)

### 1. Prioridade absoluta: fidelidade do conteúdo
O objetivo é entregar materiais organizados, identificados e **fiéis às fontes**. Não considerar extração bem-sucedida só porque produziu texto/arquivo.

**Status por recurso (honesto):**
| Status | Significado |
|--------|-------------|
| `integral` | conteúdo extraído e validado |
| `partial` | conteúdo extraído, mas com limitações/partes ausentes |
| `inaccessible` | recurso identificado, mas conteúdo não acessível |
| `not_found` | recurso referenciado, mas não localizado |

**Nunca classificar conteúdo não validado como `integral`.**

### 2. Implementação modular e sequencial
Desenvolver e testar os módulos **separadamente**, nesta ordem:
1. Páginas HTML e conteúdo textual do AVA.
2. PDFs.
3. Livros digitais e leitores da Minha Biblioteca.
4. Videoaulas e recursos associados.

Cada módulo tem testes próprios e evidências antes de avançar.

### 3. Livro digital — instabilidade conhecida
O leitor EPUB pode não carregar a tempo. Corrigir com:
- Detecção efetiva do carregamento (não só esperas fixas).
- Retries limitados e controlados.
- Diferenciar: erro de carregamento / conteúdo vazio / conteúdo parcial.
- Verificar início, fim, estrutura e possíveis truncamentos.
- Não confundir mensagem de erro com conteúdo acadêmico.
- Não marcar `integral` sem evidências.
- **Não contornar** DRM, controles de acesso ou mecanismos de segurança.

### 4. PDFs
Diferenciar claramente:
- quantidade total de páginas do arquivo;
- numeração impressa nas páginas;
- páginas efetivamente extraídas.
`getInfo().total` é a quantidade de páginas do PDF, **não** a numeração impressa.
Preservar o PDF original quando permitido e gerar representação textual quando possível.

### 5. Videoaulas
Investigar o que está disponível no AVA: título, descrição, duração, materiais associados, transcrição/legenda quando existentes. **Não inventar transcrições** nem prometer extração de áudio/vídeo sem validar. Se não houver transcrição acessível, registrar a limitação e preservar referências.

### 6. Privacidade e segurança (mantidas)
- Login manual no produto final; senha nunca armazenada/registrada.
- Perfil de navegador temporário.
- Nenhuma transmissão externa de dados.
- Limpeza temporária em melhor esforço.
- **Nenhuma tentativa de contornar** WDAC, Defender, SmartScreen, DRM ou políticas de acesso.

### 7. Escopo e entregáveis
Para cada módulo, apresentar:
- arquivos criados/modificados;
- comportamento implementado;
- testes realizados;
- evidências concretas;
- exemplos de conteúdo extraído;
- limitações conhecidas;
- status de fidelidade;
- problemas ainda não resolvidos.
Não declarar módulo concluído só porque o código foi implementado.

### 8. Controle de escopo
- Não alterar arquitetura Electron + Playwright sem justificativa técnica concreta.
- Não introduzir backend, banco remoto, serviços pagos, APIs de IA ou dependências desnecessárias.
- Não implementar funcionalidades não solicitadas.
- Trabalhar em etapas pequenas, manter relatórios atualizados, **aguardar avaliação** antes de avançar.

---

## Estado da Etapa 3

### Módulo 1 — Páginas HTML e conteúdo textual do AVA (CONCLUÍDO ✅)
- [x] Revisar código existente
- [x] Definir design (estrutura do módulo, status de fidelidade)
- [x] Implementar (`src/extract/pages.js`)
- [x] Testar com ADM270 S1 (Início, Videoaulas, Aprofundando, Em síntese)
- [x] Evidências + relatório (`STAGE3_MODULE1_REPORT.md`)
- [x] Aprovado com correções (distinção `pageStatus` × recursos; ressalvas de completude)

> **Correção aplicada:** `pageStatus` refere-se APENAS ao texto HTML. Os recursos associados
> (PDFs, vídeos, livros) têm status próprio nos Módulos 2-4. `integral` não é garantia de
> completude — depende de validações adicionais; sinais de carga incompleta → `partial`.

### Módulo 2 — PDFs (CONCLUÍDO ✅)
- [x] Diferenciar: total de páginas do arquivo × numeração impressa × páginas extraídas
- [x] Preservar o PDF original quando permitido + representação textual quando possível
- [x] Testar com ADM270 S1 (Slides de Apoio das videoaulas)
- [x] Evidências + relatório (`STAGE3_MODULE2_REPORT.md`)
- [x] Apresentado para avaliação (62/62 páginas extraídas; aguardando aprovação)

> **Resultado:** 3 slides de apoio (S1) com status `integral` — bytes preservados,
> `totalPagesArquivo` 18/18/26, todas as páginas com texto extraído (62/62).
> Numeração impressa: `none` nos slides (heurística honesta). PDFs com DRM/autenticação
> ficam para o Módulo 3 (Minha Biblioteca).

### Módulo 3 — Livros digitais / Minha Biblioteca (IMPLEMENTADO, AGUARDANDO AVALIAÇÃO)
- [x] Detecção confiável de carregamento (sondagem, sem espera fixa)
- [x] Diferenciar leitor carregado × livro acessível × conteúdo extraído
- [x] Retries limitados e controlados (epub)
- [x] Validar começo, meio e final do conteúdo
- [x] Verificar títulos, capítulos, subtítulos e estrutura
- [x] Identificar truncamentos e repetições suspeitas
- [x] Confirmar que o conteúdo corresponde ao livro e capítulo corretos (texto e/ou faixa de páginas impressas do sumário)
- [x] Preservar metadados (URL do leitor, páginas impressas, sumário)
- [x] Documentar limitações (`docs/STAGE3_MODULE3_REPORT.md`)
- [ ] Avaliação pendente → só então avançar ao Módulo 4

> Resultado: Chiavenato (epub) e Hisrich (pageid) `integral`; Fabrete (bvpdf/canvas) `inaccessible`.
> `src/extract/books.js` + `poc/test-module3.js`. Relatório: `STAGE3_MODULE3_REPORT.md`.

### Módulo 4 — Videoaulas (PENDENTE — aguarda avaliação do Módulo 3)
