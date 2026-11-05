# UNIVESP Study Tool — Relatório da Prova de Conceito (Etapa 1)

> Caso de teste: **ADM270 — Empreendedorismo e Inovação, Semana 1**.
> Data: 2026-11-03. Ambiente: Windows 10/11, Node v24.19.0, Playwright 1.64.1, Electron 45.2.1, electron-builder 26.18.0.
> Escopo: **Testes A–D**, cobrindo apenas a **viabilidade técnica** no Teste D (implementação/validação completa do .exe fica para a Etapa 2).

---

## Resumo executivo

| Teste | Resultado | Evidência principal |
|-------|-----------|---------------------|
| A — Autenticação e navegação | **PASSOU** | Login manual OK; 10 disciplinas detectadas; 9 seções no ADM270; `logins` vazia; autofill desabilitado; cleanup OK |
| B — Leitura LTI/livro | **PASSOU** (extração técnica) | Fabrete inacessível (bvirtual/canvas); Chiavenato epub 45.267 chars; Hisrich pageid 365.625 chars — **fidelidade integral NÃO validada nesta PoC** (ver seção B) |
| C — PDF | **PASSOU** | 3 PDFs de slides baixados; texto extraído; total de páginas do arquivo (18, 18, 26) — **paginação impressa NÃO validada** (ver seção C) |
| D — Executável portátil (viabilidade) | **PASSOU** | Electron conduzido por Playwright (um único Chromium); target `portable` reconhecido |

**Conclusão da PoC:** a arquitetura proposta (Electron + Node.js + Playwright, um único Chromium, login manual em perfil temporário sem persistir credenciais) é **viável**. As limitações de leitura conhecidas foram confirmadas recurso a recurso, sem generalizar.

---

## Teste A — Autenticação e navegação

### Critérios de aprovação
| Critério | Resultado |
|----------|-----------|
| Sessão utilizável durante automação | ✅ PASSOU |
| Lista de disciplinas e semanas detectada sem erro | ✅ PASSOU |
| Credenciais não persistem em disco | ✅ PASSOU |
| Cookies/tokens ficam apenas no perfil temporário de `%TEMP%` | ✅ PASSOU |
| Perfil não salva senha nem usa preenchimento automático | ✅ PASSOU |

### Detalhes
- **Login manual** via SAML (`ava.univesp.br/custom/univesp_saml.php?...&login_hint=<email>`), janela visível; usuário digitou a senha **diretamente no AVA** (o harness não automatiza o preenchimento).
- **Descoberta de disciplinas**: a URL que efetivamente lista os cursos é `https://ava.univesp.br/my/courses.php` (10 links de curso). As candidatas `custompage/view.php?id=3`, `my/` e `/` não expõem os links no DOM (0 links) — **achado relevante para o módulo de descoberta**.
- **10 disciplinas detectadas**: ADM290, ADM270, SOC200, CIN200, ADM250, ADM260, AIA, LEGADO_INT100, ADM230, ADM240.
- **Estrutura de semanas (ADM270)**: 9 seções detectadas via `data-sectionname` (Geral + S1–S6 + extras) e 88 links `/mod/` — inclui os 3 textos-base LTI da S1, Videoaulas (Slides/PDF), Videoaula YouTube, Fórum, Atividade, Aprofundando, Em síntese, Live.
- **Privacidade/credenciais**: o perfil temporário (`%TEMP%\univesp-poc-A-*`) foi criado com `credentials_enable_service: false`, `password_manager_enabled: false` e autofill desabilitado (flags + `Preferences`). Verificação pós-login:
  - Tabela `logins` do `Login Data` **vazia** → **0 senhas salvas**.
  - `autofillPrefs: false`.
  - Cookies/tokens da sessão ficaram **somente** dentro do perfil temporário.
  - Cleanup do perfil: **OK** (removido) — aplicada a filosofia "melhor esforço" (fechar contexto antes de apagar).

---

## Teste B — Leitura autenticada (LTI/livro)

### Critérios de aprovação
| Critério | Resultado |
|----------|-----------|
| Todos os recursos recebem status individual | ✅ PASSOU |
| Livros acessíveis conhecidos extraídos (extração técnica bem-sucedida) | ✅ PASSOU |
| Livro inacessível conhecido marcado como inacessível (não inventado) | ✅ PASSOU |
| Sem resumo/invenção (texto bruto, autoria/título preservados) | ✅ PASSOU |
| Fidelidade integral validada (início/fim, estrutura, sem truncamento) | ⏳ **NÃO CONCLUÍDO nesta PoC** — requer validação separada |

### Resultados por recurso (S1)
| id | Recurso | Formato | Status (extração) | Evidência |
|----|---------|---------|-------------------|-----------|
| 263475 | Fabrete "Empreendedorismo" (Unidade 1) | `bvpdf` (plataforma.bvirtual, canvas) | **inacessível** | Conteúdo em canvas, não exposto ao DOM; registrado sem inventar texto |
| 263476 | Chiavenato "dando asas" (Cap 1) | `epub` | **extraído** (extração técnica OK) | 45.267 chars, fonte `epub` — ver validação de fidelidade abaixo |
| 263477 | Hisrich "Empreendedorismo" (Cap 1) | `pageid` | **extraído** (extração técnica OK) | 365.625 chars, fonte `pageid-chapter` — ver validação de fidelidade abaixo |

### Notas
- Confirma recurso a recurso as limitações conhecidas: **bvirtual/plataforma** (canvas) não expõe texto via DOM; **Minha Biblioteca** funciona nos formatos `epub` (Chiavenato) e `pageid` (Hisrich).
- Nenhum conteúdo inventado para o recurso inacessível — a referência (título/autoria/URL) é preservada e o status registrado como inacessível.
- `profileCheck.savedPasswords: 0` confirmado também neste teste (após reforço das flags de perfil).

### Fidelidade da extração (limitação reconhecida)
- **Os números de caracteres (45.267 / 365.625) NÃO comprovam extração integral.** Eles indicam apenas que a extração técnica foi bem-sucedida (texto obtido via DOM/epub/pageid).
- **Não validado nesta PoC:** início e fim exatos do capítulo indicado, integridade estrutural (tabelas, exemplos, notas), e ausência de **truncamentos** no meio do conteúdo. A navegação `pageid` percorre páginas até um limite de segurança (guard), o que pode parar antes do fim do capítulo em casos específicos.
- **Plano para o app completo:** validação de fidelidade por amostragem (comparar início/fim do capítulo indicado no título vs. texto extraído), sinalizar truncamentos (heurísticas de "continua na próxima página"/fim de capítulo) e registrar status **parcialmente extraído** quando houver indício de corte — sem transformar sucesso técnico em garantia de integralidade.

---

## Teste C — PDF

### Critérios de aprovação
| Critério | Resultado |
|----------|-----------|
| PDFs baixados com sucesso | ✅ PASSOU |
| Texto extraído | ✅ PASSOU |
| Total de páginas do arquivo capturado (metadado) | ✅ PASSOU |
| Todos os recursos classificados | ✅ PASSOU |

### Resultados
| PDF (S1 - Slides de Apoio) | Tamanho | Texto | Total de páginas do arquivo* | Status |
|----------------------------|---------|-------|-------------------------------|--------|
| Videoaula 1 | 939.805 B | 5.844 chars | 18 | extraído integralmente |
| Videoaula 2 | 1.379.827 B | 4.562 chars | 18 | extraído integralmente |
| Videoaula 3 | 1.698.417 B | 7.265 chars | 26 | extraído integralmente |

\* Total de páginas do arquivo via metadado `getInfo().total` — **não** é a paginação impressa (ver Notas).

### Notas
- PDFs diretos em `assets.univesp.br` — download e extração de texto funcionam.
- **Quantidade total de páginas do arquivo** (via metadado `getInfo().total`): 18, 18 e 26. **Atenção:** esse metadado é o número total de páginas do PDF, **não a paginação impressa** (numeração que aparece no rodapé/impresso do documento pode diferir). **Nenhuma afirmação de paginação impressa é feita** com base apenas nesse metadado; a identificação da paginação impressa será tratada separadamente, quando possível, no app completo.
- Sem falhas de visualizador canvas nesta etapa (todos os PDFs de S1 são diretos); a regra "registrar inacessível recurso a recurso, sem generalizar" permanece para o app completo.

---

## Teste D — Executável portátil (viabilidade técnica — escopo da Etapa 1)

> Ressalva aprovada: na Etapa 1, o Teste D verifica **apenas a viabilidade** do empacotamento portátil e do **um único Chromium**. Implementação e validação completa do .exe (abrir sozinho, PoC completa no executável, ZIP, limpeza/recuperação, máquina sem Node) ficam para a **Etapa 2**.

### Critérios de aprovação (Etapa 1)
| Critério | Resultado |
|----------|-----------|
| Electron é conduzido pelo Playwright (`_electron.launch`) | ✅ PASSOU |
| UI operada no mesmo processo (um único Chromium) | ✅ PASSOU |
| Target `portable` reconhecido pelo electron-builder | ✅ PASSOU |

### Detalhes
- **Um único Chromium**: `playwright._electron.launch()` conduziu o Electron (v45.2.1) com uma janela (`ui.html`); interação de UI (clique) executada e confirmada. Isso prova que **o mesmo Chromium embutido do Electron** serve para a UI **e** para a automação, sem baixar um segundo Chromium do Playwright → **evita o Chromium duplicado** (reduz o tamanho do .exe em ~150–170 MB).
- **Empacotamento portátil**: `electron-builder` 26.18.0 instalado; configuração `win.target: ["portable"]` e `portable.artifactName` reconhecidas → **target portable disponível**.
- **Pendência para a Etapa 2**: executar o build `portable` real, gerar o .exe, e validar em máquina sem Node (abrir sozinho, extração completa, ZIP, limpeza normal + recuperação após crash).

---

## Decisões confirmadas durante a PoC

1. **Sessão única por execução**: o usuário faz login **1 vez por execução** e a sessão é usada para todos os recursos; ao encerrar, o perfil temporário é apagado em melhor esforço. A sessão **não** é persistida entre execuções (reabrir exige nova autenticação) — registrado no `PLANO_TECNICO.md`.
2. **Perfil sem credenciais/autofill**: reforçado com `credentials_enable_service: false` no `Preferences` (além das flags de linha de comando) — confirmado `logins` vazia pós-login.

## Limitações e achados registrados
- **Fabrete (plataforma.bvirtual)**: texto em canvas, não extraível via DOM → **inacessível** (por recurso, sem generalizar).
- **Descoberta de disciplinas**: usar `my/courses.php` (as demais URLs não expõem os links no DOM).
- **PDF direto `assets.univesp.br`**: OK (baixável e com texto).
- **Paginação impressa dos PDFs não validada**: `getInfo().total` é apenas o total de páginas do arquivo; a paginação impressa (numeração do documento) exige validação separada.
- **Fidelidade dos livros não validada**: volume de caracteres não comprova integralidade (início/fim, estrutura, truncamentos) — pendente no app completo.
- **Não foi validado nesta PoC** (Etapa 2): build real do .exe, máquina sem Node, ZIP, limpeza/recuperação após crash, vídeo/transcrição.

## Arquivos de evidência
- `poc/evidence/test-A/{result.json,run.log}`
- `poc/evidence/test-B/{result.json,run.log}`
- `poc/evidence/test-C/{result.json,run.log}` + `tmp/*.pdf`
- `poc/evidence/test-D/{result.json,run.log}`
- Harness: `poc/lib/session.js`, `poc/test-A.js`, `poc/test-B.js`, `poc/test-C.js`, `poc/test-D.js`

---

## Próximo passo: Etapa 2 — Empacotamento portátil
Com a PoC **aprovada**, a Etapa 2 implementa e valida o executável portátil (electron-builder `portable` + um único Chromium + autolimpeza/recuperação), conforme o `PLANO_TECNICO.md`.
