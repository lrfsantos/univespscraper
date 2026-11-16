# Revisão de segurança e histórico do Git

> Data: 2026-11-05. Varredura local (sem reproduzir conteúdo sensível).

## 1. Credenciais / segredos

## 1A. Atualização de segurança — 2026-11-16

- Uma revisão independente posterior comparou o segredo informado pelo proprietário com o histórico público. Foi confirmada uma correspondência com o valor de senha em texto claro no commit **`87420125d40ee622622fd345dfa8b46f795a7369`**, no arquivo `docs/AUDIT_2026-11-05.md`. O valor não é reproduzido aqui.
- O commit **`c82423792b0cb136fea622b78bcd133738386287`** substituiu os valores por marcadores `<REDACTED>` no snapshot posterior. Isso corrigiu a árvore atual, mas **não removeu a exposição do commit anterior**.
- A varredura do snapshot atual da branch em 2026-11-16 não encontrou os valores informados nos 146 arquivos de texto rastreados. Os logs da execução de CI examinada também não continham esses valores. Isso não equivale a purgar ou auditar cópias/forks/clones externos.
- **Ação recomendada ao proprietário:** rotacionar a senha comprometida imediatamente. A purga do histórico Git é uma operação separada, com impacto em clones, forks, links e branches; não foi executada sem autorização explícita.
- O texto integral de livros licenciados mencionado na seção 2 também permanece um risco histórico distinto; a remoção do arquivo da árvore atual não apaga blobs de commits antigos.

- **A afirmação de ausência de credenciais commitadas não é válida para todo o histórico:** veja a atualização de segurança de 2026-11-16 acima.
- Varredura de todo o histórico (`git rev-list --all`) para padrões de segredo (senha literal, `sk-…`, `AKIA…`, `BEGIN … PRIVATE KEY`, `Authorization: Bearer …`): **0 ocorrências** de credencial.
- A única ocorrência da string de senha do teste (`<REDACTED>`) no histórico está em `docs/AUDIT_2026-11-05.md`, que **descreve** que a credencial hardcoded foi encontrada e removida (documentação). O valor foi **redigido** nesta auditoria (commits futuros); o histórico anterior contém a menção literal — ver item 3.
- As credenciais hardcoded em código foram removidas antes do primeiro commit (vêm de `UNIVESP_USERNAME`/`UNIVESP_PASSWORD`); nunca entraram no histórico.

## 2. Conteúdo protegido (livros/materiais)

**Achado importante:**

- O commit inicial **`8742012`** continha `poc/evidence/module3/result.json` (≈160 KB) com **texto integral extraído de livros licenciados** (maior bloco ≈105.000 chars — capítulo do Hisrich; além de ≈45.000 chars — capítulo do Chiavenato).
- O commit `d6cf122` **removeu o arquivo da árvore**, mas o conteúdo **permanece no histórico** do Git (a remoção em novo commit não apaga commits anteriores).
- **Recomendação (aguardando autorização):** se o repositório for público, considerar purgar o histórico (ex.: `git filter-repo`) para remover o conteúdo licenciado de `8742012`. **Não reescrevi o histórico por conta própria** (regra da auditoria). Alternativa: manter o repositório privado.
- Fragmentos menores no histórico: `poc/evidence/test-B/result.json` contém `textSample` de ~300 chars (fragmento não substancial). Não é texto integral.
- Evidências de texto bruto (`poc/evidence/**/tmp/`, `module1/*.txt`, `module1|module2/result.json`, `test-e2e/saida/`) nunca foram versionadas (gitignore) — permanecem apenas locais.

## 3. Dados pessoais / logs de autenticação

- `debug-mycourses.html` (dump autenticado "Meus cursos") está no `.gitignore` e **nunca foi commitado**.
- Testes M1/M3 pararam de registrar o nome de usuário no log (commits `1a46321`, `c667673`).
- `run.log` e `result.json` de evidências estão no `.gitignore` desde `d9fd379`.

## 4. Arquivos rastreados × .gitignore (correção aplicada)

`.gitignore` não remove arquivos já rastreados. Estavam rastreados (herdados do commit inicial) e foram **removidos do índice** (`git rm --cached`) para honrar a política `poc/evidence/**/result.json`:
- `poc/evidence/test-A/result.json`
- `poc/evidence/test-B/result.json`
- `poc/evidence/test-C/result.json`
- `poc/evidence/test-D/result.json`
- `poc/evidence/test-e2e/result.json`

Mantido: `poc/evidence/test-e2e/build-info.json` (apenas hashes/tamanhos/datas de artefatos — sem conteúdo protegido ou pessoal). Os arquivos permanecem no disco local.

## 5. Resumo

| Item | Status |
|---|---|
| Credenciais no histórico | **Exposição histórica confirmada** no commit `8742012`; snapshot atual corrigido, histórico ainda não purgado |
| Senha de teste em doc (menção) | Redigida (commit desta auditoria); histórico anterior documentado |
| Texto integral de livro no histórico | **Sim, em `8742012`** (removido da árvore em `d6cf122`) — decisão de purgar pendente |
| Evidências futuras | Fora do versionamento (gitignore + `git rm --cached`) |
| Logs com credenciais | Não há |
