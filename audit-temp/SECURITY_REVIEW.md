# Revisão de segurança e histórico do Git

> Data: 2026-11-05. Varredura local (sem reproduzir conteúdo sensível).

## 1. Credenciais / segredos

- **Nenhuma senha, token, chave de API, chave privada ou credencial foi commitada.**
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
| Credenciais no histórico | Nenhuma commitada |
| Senha de teste em doc (menção) | Redigida (commit desta auditoria); histórico anterior documentado |
| Texto integral de livro no histórico | **Sim, em `8742012`** (removido da árvore em `d6cf122`) — decisão de purgar pendente |
| Evidências futuras | Fora do versionamento (gitignore + `git rm --cached`) |
| Logs com credenciais | Não há |
