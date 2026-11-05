# UNIVESP Study Tool — Plano Técnico (Windows)

> Documento de planejamento. Substitui orientações anteriores incompatíveis.
> Objetivo: aplicativo **Windows 10/11**, **um único .exe portátil**, sem instalação de
> dependências, gratuito, que extrai e organiza materiais acadêmicos do AVA de forma
> fiel (sem IA de resumo no scraper) e entrega um ZIP local.

---

## 1. Arquitetura técnica recomendada

**Escolha recomendada: Electron + Node.js + Playwright, empacotado com `electron-builder` (target `portable`).**

> Nota: Electron **não é** a única solução tecnicamente possível — existem alternativas
> (Tauri/WebView2, pkg/nexe, instalador NSIS). É a **melhor escolha para os requisitos
> atuais**, pelos motivos justificados abaixo. A decisão deve ser revisitada se os requisitos
> mudarem ou se a PoC revelar limitações relevantes.

```
┌────────────────────────────────────────────────────────────┐
│  Electron (janela desktop + UI em PT-BR)                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Processo principal (Node.js embutido no Electron)      │ │
│  │   ├── Módulo de sessão (Playwright)                     │ │
│  │   ├── Módulo de descoberta (disciplinas/semanas)        │ │
│  │   ├── Módulo de extração (páginas/LTI/PDF/vídeo)        │ │
│  │   ├── Módulo de organização (Markdown por semana)        │ │
│  │   ├── Módulo de relatório (integridade/duplicatas)       │ │
│  │   └── Módulo de empacotamento (ZIP local)               │ │
│  └────────────────────────────────────────────────────────┘ │
│  Chromium do Playwright (incluído no pacote)                 │
└────────────────────────────────────────────────────────────┘
```

**Por que Electron (justificativa para os requisitos atuais):**
- **Interface desktop:** oferece janela nativa Windows e UI em PT-BR, sem depender do navegador do estudante.
- **Node.js integrado:** o runtime Node.js já vem **dentro do pacote** — o estudante não instala Node, não abre terminal, não executa comandos.
- **Playwright:** roda no mesmo processo principal do Electron (Node), permitindo automação do navegador com a UI.
- **Distribuição portátil:** `electron-builder` gera um `.exe` portátil único; o Playwright inclui um Chromium próprio empacotado como recurso — **sem exigir navegador instalado** no Windows do estudante.
- **Login/intervenção humana:** janela com navegador visível permite login manual, CAPTCHA, 2FA, aceite de termos e demais intervenções, o que um backend sem interface não oferece.

**Por que as alternativas não são escolhidas nesta fase (sem descartá-las definitivamente):**
- **Tauri/WebView2:** menor em tamanho, mas usa backend em Rust (desenvolvimento do scraper fora do Node) e depende do WebView2 do sistema — precisa validar em máquinas sem ele. Complexidade desnecessária agora; possível revisitar no futuro.
- **pkg/nexe:** gera `.exe` Node sem janela; a UI desktop e o navegador visível para login ficam sem suporte nativo, exigindo componentes extras.
- **PWA/estático (GitHub Pages):** impossível acessar o AVA autenticado por CORS/cookies — descartado por limitação técnica, não por preferência.

> **Decisão (aprovada):** empacotar **um único Chromium** (do Playwright), usado tanto para a automação quanto para a UI, **se os testes da PoC confirmarem compatibilidade**. Se a PoC revelar incompatibilidade, aceitamos um Chromium adicional para a UI — o custo é de tamanho, não de funcionamento. A validação desse ponto faz parte do Teste D (Executável portátil).

---

## 2. Comparação objetiva das opções de empacotamento

| Opção | Exe único | Sem instalar Node | UI desktop | Login com navegador visível | Tamanho aprox. | Adoção |
|------|-----------|-------------------|-----------|-----------------------------|----------------|--------|
| **Electron + electron-builder (portable)** | ✅ | ✅ | ✅ | ✅ | 250–350 MB | **Recomendado** |
| Electron + NSIS (instalador) | ❌ (instala) | ✅ | ✅ | ✅ | ~200 MB + instalação | Alternativa |
| pkg/nexe (só Node) | ✅ | ✅ | ❌ | ❌ | ~80–120 MB + browser avulso | Não atende UI |
| Tauri (Rust + WebView2) | ✅ | ✅ | ✅ | ⚠️ depende WebView2 | ~30–60 MB | Futuro |

**Conclusão:** Electron + `portable` é a **melhor escolha** para os requisitos atuais (sem instalação, sem terminal, com navegador para login manual e intervenções). Não é a única opção tecnicamente possível — as demais (NSIS, pkg/nexe, Tauri) atendem parcialmente ou exigem compensações; por isso ficam como alternativas futuras.

---

## 3. Tamanho realista do executável

- Electron (runtime + Chromium da UI): ~180–220 MB descompactado.
- Chromium do Playwright: ~150–170 MB.
- `portable` gera um executável **auto-extraível**; com compactação (7z/NSIS-style) o .exe final costuma ficar em **~250–350 MB** (com **um único Chromium**, o tamanho tende ao limite inferior dessa faixa).

> **Decisão (aprovada):** um executável de **~250–350 MB é aceitável**. Se a PoC confirmar compatibilidade com **um único Chromium**, priorizar essa configuração (menor tamanho). A distribuição é gratuita via GitHub Releases; a experiência de "baixar, abrir, usar" justifica o tamanho.

---

## 4. Estratégia de execução temporária e limpeza (boa prática, não requisito absoluto)

> **Filosofia:** minimizar a persistência de dados temporários e sensíveis, realizando a limpeza
> **sempre que tecnicamente possível, sem comprometer o funcionamento, a extração ou a entrega
> do ZIP**. Não há promessa de ausência absoluta de vestígios no Windows — isso seria irrealista
> e desproporcional. A limpeza é uma boa prática técnica, **não o centro da arquitetura**.

### Execução (isolar dados temporários)
- Criar diretório exclusivo: `%TEMP%\univesp-study-<hash>`.
- **Perfil temporário do navegador** (userDataDir do Playwright) → dentro desse diretório, preferencialmente.
- **Cookies e tokens podem ser gravados temporariamente nesse perfil** durante a sessão — isso é esperado e aceito. **Não podem**: ser armazenados permanentemente, aparecer em logs, ou integrar o ZIP.
- PDFs intermediários, cache e logs técnicos estritamente necessários → em diretório temporário, sempre que possível.

### Comportamento da limpeza (por situação)
| Situação | Comportamento |
|---|---|
| Encerramento normal | Tentar excluir arquivos temporários e perfis criados pelo app; tentar logout local quando houver opção. |
| Encerramento inesperado | Tentar identificar e limpar resíduos próprios em uma execução futura. |
| Arquivo bloqueado pelo Windows | Registrar a falha de limpeza e continuar normalmente. |
| Falha na limpeza | Não interromper a extração nem comprometer o ZIP. |
| Cache/arquivos internos do Electron | Controlar e redirecionar para diretório temporário quando viável, sem engenharia excessiva. |

### Regras de limpeza
- Apagar **apenas** arquivos/diretórios criados pelo próprio aplicativo. Nunca tocar em arquivos de terceiros.
- Recuperação após falhas: simples, segura e proporcional. **Não** implementar mecanismos complexos de monitoramento de processos, rastreio de PID ou recuperação sofisticada apenas para perseguir limpeza perfeita.
- A falha de limpeza **nunca** deve ser mais importante que a integridade dos materiais acadêmicos ou a entrega do ZIP.

### Limites honestos (o que NÃO é requisito)
- Garantir ausência absoluta de vestígios no Windows.
- Apagar registros internos do sistema operacional.
- Controlar históricos/registros/caches do Windows, Defender ou da plataforma AVA.
- Garantir invalidação da sessão no servidor UNIVESP pelo encerramento do navegador (logout local é tentado; invalidação remota não é prometida).
- Impedir o encerramento do app porque algum arquivo temporário não pôde ser removido.
- Não ocultar execução do SO, não desativar antivírus, não contornar SmartScreen/defesas.

---

## 5. Estratégia segura de autenticação

- **Login manual no navegador controlado (janela visível):** o estudante digita as credenciais **diretamente no AVA**. O app **não automatiza o preenchimento** de senha → a senha nunca passa pelo código do app nem é logada.
- **Perfil temporário sem credenciais (ressalva aprovada):** além de não capturar/armazenar senhas, o perfil temporário do navegador deve ser configurado para **não salvar credenciais** nem **utilizar preenchimento automático de senhas** (desabilitar o password manager do Chromium e o autofill, tanto no perfil da UI quanto no da automação).
- **Armazenamento temporário:** o navegador usa um **perfil temporário em `%TEMP%`**; cookies e tokens da sessão **podem ser gravados nesse perfil durante a execução**. Isso é aceito e necessário para a sessão funcionar.
- **Restrições de cookies/tokens:** nunca são armazenados de forma **permanente**, nunca aparecem em **logs**, nunca integram o **ZIP**, e nunca são enviados a serviços externos. A sessão local é utilizada **somente durante a execução**, sem persistência deliberada; o perfil temporário é apagado **em melhor esforço** no encerramento.
- **Fim da sessão (logout local vs. invalidação remota):**
  - O app pode **tentar fazer logout local** (acionar o mecanismo de logout da plataforma) e **limpar os dados locais** (fechar navegador, apagar perfil).
  - O app **não promete** que isso invalidou a sessão no **servidor**. A invalidação remota depende da plataforma; o navegador do app sendo fechado não garante, por si só, o fim da sessão do lado do servidor.
- **Sessão única por execução (decisão confirmada):** durante uma execução do app, o usuário faz login **uma única vez** e navega/extrai todos os recursos sem reautenticar (cookies/tokens permanecem no perfil temporário pelo tempo da execução). Ao encerrar, o perfil temporário é apagado **em melhor esforço** junto com os demais temporários. A sessão **não é persistida entre execuções**: ao reabrir o app, exige-se **nova autenticação**.
- **Intervenção humana:** a janela fica visível para o estudante resolver CAPTCHA, 2FA/MFA, aceite de termos, sessão expirada. A UI oferece: "Entrar novamente", "Continuar", "Tentar novamente", "Ignorar este recurso e continuar", "Encerrar extração".
- **Nunca** contornar mecanismos de segurança/DRM. Registrar limitação e seguir.

> Decisão pendente: como detectar "login concluído" de forma robusta (URL final, presença de elemento do painel) e quando pedir intervenção.

---

## 6. Riscos do Playwright com LTI, leitores digitais e PDFs (honesto)

> **Importante:** os resultados abaixo descrevem **casos concretos já testados** em condições
> específicas (um curso, um recurso, um momento). **Não generalize** um resultado da PoC para
> todo o conteúdo de uma plataforma. Cada recurso é avaliado individualmente durante a
> extração; o resultado real é registrado recurso a recurso no relatório.

Casos já observados em testes anteriores (referência inicial — não é garantia):

| Plataforma/leitor | Recurso/condição testada | Resultado observado naquele teste |
|-------------------|--------------------------|----------------------------------|
| AVA Moodle `mod/page`, `mod/lti/view` | Páginas server-rendered | ✅ Texto extraível via DOM |
| `assets.univesp.br` PDF direto | PDF aberto em aba nova | ✅ Baixável e com texto extraível |
| Minha Biblioteca — leitor **pageid** | Schaefer (cap. 3, p. 68–93); Hisrich; Dornelas | ✅ Navegação página a página; texto acessível |
| Minha Biblioteca — leitor **epub** | Lakatos (cap. 2); Chiavenato (cap. 1) | ✅ Capítulo acessível em frame |
| **plataforma.bvirtual** — leitor PDF (canvas) | Fabrete "Empreendedorismo" (Unidade 1/2/4) | ❌ Texto em canvas; não extraível via DOM |
| **leitor.bvirtual** — leitor próprio | Nildo "Introdução à sociologia" (cap. 3) | ❌ Conteúdo não exposto ao DOM |
| YouTube | Videoaulas e vídeos de apoio | ✅ Legendas acessíveis via `youtube-transcript` |
| DRM / 2FA / CAPTCHA | Diversos | ❌ Não contornar; pedir intervenção ou ignorar |

**Princípio:** o app **não inventa** conteúdo. Se o texto não é legível no DOM (canvas/DRM),
o **recurso específico** é registrado como **inacessível** no relatório, **sem substituí-lo por
metadados ou conteúdo inventado**. A referência da leitura (título, capítulo, páginas, URL)
é preservada como identificação, mas o relatório deixa explícito que o **conteúdo não foi
extraído**.

---

## 7. Plano de prova de conceito (não pular)

Caso de teste: **ADM270 — Empreendedorismo e Inovação, Semana 1**.
A extração da PoC ocorre **sequencialmente** (sem paralelismo desnecessário), um recurso por vez.

### Teste A — Autenticação e navegação
- Abrir AVA em janela controlada; login manual; detectar disciplinas (ativas **e inativas** acessíveis); navegar semanas.
- **Perfil sem credenciais/autofill:** o perfil temporário é criado com a persistência de senhas e o preenchimento automático desabilitados; verificar que o Chromium não salvou senha do login.
- **Aprova se:** sessão permanece utilizável durante automação; lista de disciplinas e semanas detectada sem erro; **credenciais não persistem em disco**; cookies/tokens ficam apenas no perfil temporário de `%TEMP%`; perfil não salva senha nem usa preenchimento automático.

### Teste B — Leitura autenticada (LTI/livro)
- Abrir um recurso LTI da Semana 1; identificar livro correto; navegar ao capítulo/páginas indicadas; extrair conteúdo.
- **Aprova se:** autoria/título/paginação preservados; texto extraído corresponde ao recurso certo; cada recurso recebe status individual (extraído integralmente / parcialmente extraído / inacessível / não encontrado); limitações registradas, não inventadas.

### Teste C — PDF
- Acessar PDF pela sessão; extrair páginas relevantes; preservar paginação impressa.
- **Aprova se:** paginação impressa correta (não confundir com índice do visualizador); falhas de visualizadores canvas registradas recurso a recurso, sem generalizar para toda a plataforma.

### Teste D — Executável portátil (escopo da Etapa 1: viabilidade técnica)
- **Divisão de responsabilidade (ressalva aprovada):** na Etapa 1, o Teste D verifica apenas a **viabilidade técnica** do empacotamento portátil e do uso de **um único Chromium** (UI + automação). A **implementação e validação completa** do executável portátil (abrindo sozinho, PoC completa dentro do .exe, geração de ZIP, limpeza normal/recuperação, execução em máquina sem Node) ficam para a **Etapa 2**.
- **Aprova (Etapa 1):** confirmar que o empacotamento `portable` (electron-builder) e o compartilhamento de **um único Chromium** entre UI e automação são tecnicamente viáveis — sem exigir a entrega completa do .exe nesta etapa.
- **Aprova (Etapa 2):** o .exe abre sozinho, faz a PoC completa, gera ZIP, tenta limpar temporários (inclusive perfil com cookies) sem interromper a entrega do resultado; após simulação de crash, tenta limpar resíduos próprios no próximo início (em melhor esforço); um único Chromium funciona para UI e automação. Falhas de limpeza não reprovam o teste se não comprometerem a extração e o ZIP.

**Não declarar arquitetura aprovada apenas porque a navegação simples funcionou.**

---

## 8. Organização de arquivos e módulos do projeto

```
univespscraper/
├── package.json
├── electron/
│   ├── main.js            # processo principal Electron
│   ├── preload.js         # ponte seguro IPC
│   └── windows/           # telas da UI (login, disciplinas, semanas, extração, resultado)
├── src/
│   ├── session.js         # Playwright: contexto em memória, login manual, intervenção
│   ├── discover.js        # disciplinas (ativas/inativas) + semanas dinâmicas
│   ├── extract/
│   │   ├── pages.js       # mod/page, mod/lti/view, fóruns
│   │   ├── pdf.js         # download + texto + paginação impressa
│   │   ├── books.js       # leitores pageid/epub/bvirtual (com limites)
│   │   └── videos.js      # YouTube: legendas/transcrição + slides
│   ├── organize/          # saída Markdown por disciplina/semana
│   ├── report.js          # EXTRACTION_REPORT + SOURCES + INDEX
│   └── zip.js             # gera ZIP no destino escolhido
├── cleanup.js             # autolimpeza + recuperação de resíduos
└── resources/             # Chromium do Playwright (embutido no pacote)
```

**Saída gerada (modelo):**
```
SAIDA/SUBJECT/
├── INDEX.md
├── AI_STUDY_INSTRUCTIONS.md
├── EXTRACTION_REPORT.md
├── SOURCES.md
├── WEEK_01/
│   ├── WEEK_01.md
│   ├── videos/VIDEO_01.md ...
│   ├── readings/READING_01.md ...
│   └── supplementary/RESOURCE_01.md ...
└── WEEK_02/ ...
```
Sem arquivos vazios para recursos inexistentes; sem limites arbitrários de quantidade.

**Status por recurso:** cada arquivo de fonte (vídeo, leitura, slide, complementar) registra no
relatório e no seu cabeçalho de metadados o status real da extração: **extraído integralmente**,
**parcialmente extraído**, **inacessível** ou **não encontrado**. Recursos inacessíveis aparecem
individualmente (título, autoria, páginas, URL) sem texto inventado e sem serem disfarçados
como extraídos.

---

## 9. Sequência de desenvolvimento por etapas

1. **Etapa 0 — Documento de arquitetura e decisões** (este documento; revisar pendências).
2. **Etapa 1 — Prova de conceito técnica** (Testes A–D com ADM270 Semana 1), critérios objetivos. O Teste D cobre apenas a **viabilidade técnica** do empacotamento portátil e do **um único Chromium**; a implementação/validação completa do .exe ocorre na Etapa 2.
3. **Etapa 2 — Empacotamento portátil** (electron-builder portable + **um único Chromium** + autolimpeza/recuperação), incluindo a implementação e validação completa do executável (abrir sozinho, PoC completa no .exe, ZIP, limpeza/recuperação, máquina sem Node).
4. **Etapa 3 — Módulos de extração** (páginas, PDF, livros, vídeos), **sequencial**, aplicando os limites conhecidos e registrando status individual por recurso.
5. **Etapa 4 — Organização e relatórios** (Markdown por semana, INDEX/SOURCES/EXTRACTION_REPORT/AI_STUDY_INSTRUCTIONS, duplicatas, paginação impressa, status: integral/parcial/inacessível/não encontrado).
6. **Etapa 5 — UI completa em PT-BR** (fluxo de 9 telas, progresso real, cancelamento/retomada, intervenções).
7. **Etapa 6 — Retomada (resume)** — ver detalhe abaixo.
8. **Etapa 7 — ZIP + escolha de destino + limpeza final.**
9. **Etapa 8 — Testes em máquina limpa (sem Node) + validação do .exe + distribuição via GitHub Releases.**
10. **Etapa 9 — Documentação de uso para o estudante e prompt de entrega para a IA.**

Cada etapa só avança após validação da anterior (não pular a PoC).

### Retomada (resume) — planejada desde a arquitetura

A extração pode ser interrompida. A retomada é planejada desde a arquitetura, mas com regra
clara de segurança:

- O progresso persistido é **não sensível** (disciplinas detectadas, semanas detectadas,
  recursos descobertos, recursos processados, pendentes, falhas, duplicatas, intervalos de
  páginas processados).
- **Não é permitido salvar** credenciais, cookies, tokens ou perfis de autenticação.
- Ao retomar, o estudante **se autentica novamente** (nova sessão), e o app verifica o
  conteúdo atual do AVA (a fonte pode ter mudado) e reutiliza apenas material já extraído
  cuja identidade de fonte não mudou.

---

## 10. Decisões pendentes

**Já decididas:**
- Tamanho do .exe: **~250–350 MB aceito**.
- **Um único Chromium** (UI + automação), se os testes confirmarem compatibilidade.
- **Sem custos de assinatura digital** neste momento (SmartScreen será tratado com instrução ao estudante).
- Extração **sequencial**, sem paralelismo desnecessário.
- **Disciplinas inativas** incluídas quando ainda acessíveis.
- Relatório distingue: **extraído integralmente, parcialmente extraído, inacessível, não encontrado**.

**Ainda pendentes:**
1. Método robusto de detecção de "login concluído" e de quando solicitar intervenção humana.
2. Formato do ZIP de um recurso específico quando o texto não é extraível (guardar captura de tela? só referência?).
3. Identificação de "disciplina inativa" (o AVA expõe esse status de forma confiável?).
4. Formato exato do estado de retomada (não sensível) e como verificar que a identidade da fonte não mudou.

---

## Achados da Etapa 2 (validação do empacotamento)

- **Um único Chromium confirmado**: `playwright-core._electron.launch` conduz a janela do próprio Electron, usando o mesmo binário do Chromium do Electron para UI + automação (sem Chromium separado do Playwright). Validação do app empacotado (win-unpacked) executou a PoC completa dentro do .exe.
- **User-Agent obrigatório**: leitores como a Minha Biblioteca rejeitam o User-Agent do Electron ("Seu navegador não é mais compatível"). Necessário `app.userAgentFallback` com User-Agent de Chrome comum. Sem isso, o livro é marcado erroneamente como conteúdo.
- **Validação de fidelidade do livro**: o volume de texto não basta — é preciso rejeitar textos que sejam apenas mensagens de erro/incompatibilidade e validar início/fim/estrutura. A extração epub via Electron mostrou-se **não-determinística** (às vezes o frame do leitor não carrega a tempo).
- **Bloqueio por Device Guard/WDAC da organização**: o `.exe` portable (auto-extraível) e o win-unpacked reconstruído foram **bloqueados** pela política de segurança da máquina de teste ("Application Control / Device Guard policy has blocked this file"), por não serem assinados. Isso impede a validação completa do portable nesta máquina. O app em dev roda a PoC de ponta a ponta; o win-unpacked rodou a PoC completa antes de o hash ser renovado pelo rebuild. **Não é falha do app**, mas limitação de ambiente a ser validada em máquina sem essa política (conforme o plano previa para SmartScreen).

---

## Regras invioláveis (do projeto)

- **Sem IA no scraper**: não resume, interpreta, explica nem reescreve conteúdo.
- **Fidelidade**: preserva autoria, títulos, paginação impressa, estrutura, exemplos, tabelas.
- **Descoberta dinâmica**: sem número fixo de semanas/vídeos/leituras.
- **Separação obrigatório × complementar** e rotulagem.
- **Credenciais**: nunca capturadas, armazenadas permanentemente, registradas em logs ou incluídas no ZIP; cookies/tokens existem **apenas** no perfil temporário de `%TEMP%` durante a sessão, sem persistência deliberada, e a limpeza do perfil é feita **em melhor esforço** no encerramento. Logout local é tentado; a invalidação remota **não é prometida**.
- **Retomada**: progresso persistido é apenas **não sensível**; ao retomar exige-se **nova autenticação**.
- **Limpeza**: boa prática, não requisito absoluto — apagar apenas o que o app criou; falha de limpeza nunca interrompe extração nem compromete o ZIP; sem mecanismos sofisticados de autolimpeza desproporcionais ao benefício.
- **Não contornar** DRM, CAPTCHA, 2FA ou controles de acesso — registrar limitação e seguir.
- **Transparência**: relatórios de falha reais; nunca marcar incompleto como completo; status por recurso (integral/parcial/inacessível/não encontrado).
