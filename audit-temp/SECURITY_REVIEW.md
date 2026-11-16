# Revisão de segurança e histórico do Git

> Atualizado em 2026-11-16 por revisão independente do snapshot publicado, commits históricos identificados e logs da CI examinada. Nenhum valor secreto é reproduzido neste documento.

## 1. Credenciais e segredos

- **Exposição histórica confirmada:** o commit público `87420125d40ee622622fd345dfa8b46f795a7369` contém, em `docs/AUDIT_2026-11-05.md`, um valor em texto claro que corresponde à senha informada pelo proprietário para esta revisão. O valor foi omitido deste relatório.
- O commit `c82423792b0cb136fea622b78bcd133738386287` redigiu o arquivo na árvore posterior, substituindo os valores por `<REDACTED>`. Isso não removeu o valor do commit anterior.
- A recomendação ao proprietário é **rotacionar imediatamente a senha exposta** e não reutilizá-la. A rotação não pode ser realizada pelo revisor.
- A varredura do snapshot publicado em `master` em 2026-11-16 cobriu 146 arquivos de texto rastreados e não encontrou os valores informados, suas formas URL-encoded ou Base64 nos arquivos atuais. Os logs da execução de CI examinada também não continham esses valores.
- Esta revisão não equivale a uma varredura forense completa de todos os blobs, caches, clones, forks, downloads e cópias externas. Como houve exposição pública em um commit, deve-se tratar a credencial como comprometida até a rotação.
- Os harnesses live versionados obtêm credenciais de `UNIVESP_USERNAME` e `UNIVESP_PASSWORD` via ambiente; o aplicativo distribuído usa login manual. `electron/run-poc.js` é excluído do empacotamento de produção.
- **A purga do histórico Git não foi executada.** Reescrever o histórico exige autorização expressa do proprietário e coordenação de clones/forks/branches. Não fazer force push ou filter-repo sem essa autorização.

## 2. Conteúdo acadêmico protegido no histórico

- O commit `8742012` continha `poc/evidence/module3/result.json` (aproximadamente 160 KB) com texto integral extraído de livros licenciados, incluindo capítulos identificados anteriormente como Hisrich e Chiavenato.
- O commit `d6cf122` removeu o arquivo da árvore posterior, mas não apagou os blobs dos commits anteriores.
- Não reproduzir nem regenerar esse material em arquivos versionados. A eventual purga do histórico é uma decisão separada, sujeita à mesma autorização explícita descrita acima.

## 3. Dados pessoais e logs

- `debug-mycourses.html` está no `.gitignore`; a revisão anterior registrou que o dump autenticado não foi commitado.
- Os testes M1/M3 foram alterados para não registrar o nome de usuário nos logs (commits `1a46321` e `c667673`).
- Logs e evidências brutas de extração devem permanecer fora do versionamento.

## 4. Controles atuais observados

- Login manual na janela visível do AVA; nenhum preenchimento automático de senha no fluxo do aplicativo.
- Processo Electron auxiliar recebe ambiente por allowlist explícita em `electron/env.js`, em vez de herdar todo o ambiente do processo.
- `electron/run-poc.js` é excluído do bundle de produção.
- A CI executa apenas testes determinísticos, sem login no AVA ou credenciais reais.

## 5. Estado e limitações

| Item | Estado |
|---|---|
| Credencial em commit público antigo | **Exposição confirmada; rotação recomendada** |
| Snapshot atual de `master` | Sem correspondência dos valores pesquisados nos arquivos de texto examinados |
| Histórico Git | Exposição continua acessível até eventual purga autorizada |
| Texto integral de livros no histórico | **Presente em commit antigo; não reproduzir; purga pendente** |
| Segredos em logs de CI examinados | Nenhuma correspondência encontrada |
| Varredura forense de todos os objetos e cópias externas | Não concluída |

