# Plano de correção proposto — Fase 3 (PROPOSTA, NÃO IMPLEMENTADA)

Este documento apenas converte os achados aprovados da Fase 2.2 em hipóteses de causa e critérios de aceite. **Nenhuma linha do extrator foi alterada.** A implementação depende de: (a) autorização explícita do auditor para a etapa; (b) confirmação humana da rotação da credencial histórica (o auditor não autorizou a frente 1 antes disso).

Referência: `DIAGNOSTICO_FALHAS.json` / `DIAGNOSTICO_FALHAS.md` (commit `8a6084c`).

## Princípios de congelamento

- Não modificar os 468 registros históricos, QUALITY.md antigos, INVENTARIO.json ou artefatos da Fase 2.2.
- Não fazer merge, PR, force-push nem alterar master (`eb1985e`).
- Cada correção só é considerada pronta após: teste automatizado novo + `npm test` verde + entrega auditada separadamente.
- Falha de acesso continua registrada como falha de acesso; nunca vira `no_text` nem conteúdo inventado.
- Nunca gravar credenciais, tokens ou URLs assinadas.

## Ordem proposta (menor risco primeiro)

### 1. Captura de interface — 4 casos comprovados (D18491, recursos URL)
- **Evidência:** arquivos com 67–78 chars, todos `"Clique em <título> para abrir o recurso."`; o clique abre YouTube e livros no minhabiblioteca.
- **Hipótese:** o extrator leu a página do AVA (`mod/url/view.php`) em vez da aba de destino aberta pelo clique, ou capturou o texto antes da navegação.
- **Correção candidata:** após o clique, aguardar e selecionar explicitamente a aba/documento de destino; ler o escopo do destino. Distinguir três coisas: página de origem (AVA), aba de destino e conteúdo efetivamente consultável. Se o destino não tiver texto consultável, preservar o **motivo real** (vídeo sem transcrição, leitor bloqueado, ausência confirmada de texto) — "sem texto consultável" **não** vira automaticamente `no_text`. Nunca gravar texto de interface.
- **Aceite:** os 4 recursos não contêm mais "Clique em ..."; os testes provam que o conteúdo veio da aba de destino correta, não de aba aberta anteriormente, da página original do AVA ou de página intermediária; cobertura de: página de origem, nova aba, destino sem texto consultável e navegação que não se completa. Cada caso resulta em conteúdo do destino ou falha explícita com motivo honesto.
- **Validação em duas etapas:** testes com fixture e registro de navegação são necessários, mas não provam sozinhos o comportamento real do navegador. A implementação e os testes podem ser feitos sem AVA; a validação real dos 4 recursos fica como **etapa separada**, dependente de autorização específica de acesso.

### 2. Fonte errada — 1 caso comprovado (ADM270, Manual de Oslo)
- **Evidência:** arquivo com `"404 / Página não encontrada / Ir para Home"` (38 chars); clique abre PDF válido (`HTTP 200`, `application/pdf`, 763338 bytes, `%PDF-1.2`).
- **Hipótese:** a requisição do PDF caiu em HTML de erro e o extrator escreveu o corpo sem validar tipo/magic bytes.
- **Correção candidata:** validar `status`, `content-type` e assinatura (`%PDF`) antes de converter em texto; em caso de divergência, marcar `failed` com motivo e não escrever arquivo de conteúdo.
- **Aceite:** fixture com resposta 404 HTML produz `failed`, zero arquivo de conteúdo; PDF válido continua extraindo; teste unitário no módulo PDF.

### 3. Cobertura incompleta — 2 casos
- **Evidência:** ADM210 só a página de título (121 chars); CIN200 capítulo 217–250 correto, sem verificação página a página.
- **Hipótese:** seleção de página inicial/paginação do leitor bvirtual não percorre o intervalo solicitado. Uma capa ou página de título **não** é erro por si só: a validação precisa considerar o intervalo pedido no título do recurso.
- **Correção candidata:** quando o intervalo for conhecido, detectar capa/índice e avançar até a primeira página do intervalo; conferir o pageid final; quando não houver intervalo explícito, não presumir erro.
- **Aceite:** os 2 recursos passam a cobrir o intervalo pedido ou permanecem `partial` com página inicial/final registradas; fixture de capa + capítulo.

### 4. Erro de navegação — 5 casos (bvirtual, publicação 3789)
- **Evidência:** clique para na tela "Escolha o formato desejado" com os pageids corretos (22, 134, 199, 217, 107); histórico marcou `failed` / `bvpdf`.
- **Hipótese:** o adaptador não dá o passo seguinte (escolher PDF/EPUB) após o LTI.
- **Correção candidata:** detectar a tela de escolha e clicar em "Ler em PDF" **somente quando essa tela aparecer**; se houver prompt beta, escolher o leitor clássico de forma condicional — nunca uma sequência fixa aplicada a qualquer livro.
- **Aceite:** os 5 recursos chegam ao leitor de PDF; teste com HTML da tela de escolha.

### 5. Seleção de leitor / autorização — 14 casos (hipótese; 2 confirmados sem autorização)
- **Evidência:** leitores abertos em Minha Biblioteca/VitalSource/bvirtual; ADM290 S6 redirecionou para `not-authorized`, S7 ficou em "validando autorização".
- **Hipótese:** combinação de domínio de leitor, prompt beta e sessão não autorizada.
- **Correção candidata:** normalizar a detecção de domínio/formatos e registrar motivo distinto para "sem autorização" vs "domínio desconhecido". Não tentar burlar autorização.
- **Aceite:** 2 casos sem autorização permanecem `failed` com motivo preciso; demais leitores ou extraem texto ou falham com motivo auditável.

### Encerramento de diagnóstico (sem frente de implementação) — metadados de tipo
O novo `RECORDS.json` já grava `kind`; o histórico não preservou essa informação e não deve ser reconstruído por inferência. Não é uma frente de correção.

## Fora de escopo

- Não reescrever o histórico público nem o inventário.
- Não reexecutar os 468 recursos sem autorização específica de acesso ao AVA.
- Não alterar a amostra de 60 nem os resultados da Fase 2.2.
- Não tocar em credenciais nem em fluxos de autenticação.

## Riscos

- Correções em leitores podem regredir os 30 PASS; por isso a ordem acima e a bateria completa antes de cada entrega.
- Reexecução controlada exigirá novo acesso ao AVA e autorização explícita.
- A pendência de segurança (senha histórica) é independente e não é resolvida por este plano.
