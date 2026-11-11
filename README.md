# UNIVESP Study Tool

Ferramenta para extrair e organizar academicamente o conteúdo das disciplinas da
UNIVESP (AVA/Moodle), **sem armazenar credenciais** e **sem utilizar IA para
resumir, interpretar ou substituir o conteúdo original**.

O aplicativo abre um navegador visível onde o estudante faz **login manualmente**,
descobre dinamicamente suas disciplinas e semanas, extrai os materiais com os
módulos de extração já desenvolvidos e gera um ZIP validado no destino escolhido.

> Uso pessoal do estudante. Não republica conteúdo: a única cópia persistente dos
> materiais extraídos é a entrega escolhida pelo estudante.

## Requisitos (Windows)

- Windows 10/11.
- Node.js 20.16+ / 22.3+ (ou 24 LTS — recomendado; somente para desenvolvimento e
  testes; exigência do parser de PDF `pdf-parse`).
- O aplicativo final é um executável portátil (Electron), sem dependências do
  sistema para o usuário final.

## Como executar em desenvolvimento

```bash
npm install
npm run app
```

Uma janela do navegador será aberta no AVA. Faça o login manualmente e o
aplicativo conduzirá a descoberta e a extração.

## Como gerar o executável

```bash
npm run build:portable
```

O executável portátil será criado em `dist/`.

## Como usar o aplicativo

1. Abra o aplicativo.
2. Clique em **Abrir navegador e fazer login manual**.
3. Conclua o login manualmente no AVA (na janela que abrir).
4. Selecione as disciplinas desejadas.
5. Selecione as semanas (todas marcadas por padrão; desmarque as que não quiser).
6. Clique em **Extrair materiais**.
7. Escolha o destino e o nome do ZIP.
8. O aplicativo valida o ZIP e apresenta o relatório honesto do resultado.

### Login manual

O login é sempre manual. O aplicativo **não** solicita, armazena, deriva ou
preenche senha. Nenhuma credencial é usada por variável de ambiente no aplicativo
final. Variáveis como `UNIVESP_USERNAME`/`UNIVESP_PASSWORD` existem **somente** em
harnesses de teste isolados (`npm run test:live`) e nunca no executável distribuído.

## Materiais suportados

Cada recurso compatível gera um **documento Markdown individual** com o conteúdo
original (nunca resumido) e metadados de rastreabilidade (fonte, disciplina,
semana, data, status, versão do extrator). Exemplos em `poc/fixtures/generated-output/`.

| Recurso | Tratamento |
|---|---|
| Página HTML do AVA | Extração de texto (Módulo 1) + recursos incorporados descobertos (vídeos/PDFs/livros) |
| PDF | Download do original + texto por página (Módulo 2), SHA-256 e paginação impressa quando identificada |
| Livro/leitor LTI compatível (Minha Biblioteca) | Extração EPUB/PAGEID (Módulo 3) com capítulo e intervalo de páginas declarados |
| Videoaula (YouTube) | Registro de link, título, transcrição com timestamps quando disponível (sem inventar) |
| Recurso desconhecido | Registrado como não suportado (nunca ignorado silenciosamente) |

## Limitações conhecidas

- A extração de livros digitais depende do leitor VitalSource (Minha Biblioteca)
  carregar o conteúdo; quando o conteúdo não monta (limite de sessão/dispositivo),
  o recurso é registrado honestamente como `inaccessible`/`not_found`.
- Transcrição de vídeo e extração de vídeo (Módulo 4) estão **fora do escopo**
  atual; os vídeos são registrados com link e metadados.
- O `integral` de PDF significa que o texto extraível foi obtido de todas as
  páginas — **não** que diagramas foram interpretados, imagens reconhecidas ou
  que houve OCR.
- O histórico do repositório pode conter conteúdo antigo não removido (ver
  pendências no relatório da auditoria).

## Como executar os testes

```bash
npm test
```

Executa as suítes determinísticas (sem AVA, sem credenciais, sem rede). O número de
suítes cresce com a cobertura; o resumo final informa `suites=`/`falhas=` e retorna
código não nulo se qualquer caso falhar.
Testes **live** (que exigem login real e acesso ao AVA) ficam em comando separado e
**não** rodam na CI:

```bash
npm run test:live
```

Os testes live exigem `UNIVESP_USERNAME` e `UNIVESP_PASSWORD` (apenas para os
harnesses de teste autorizados) e falham com código de saída não nulo se os
resultados não corresponderem aos critérios.

## Como contribuir

- Mantenha os parsers puros em `electron/discovery.js` e as decisões de
  fidelidade em `src/extract/*`.
- Não introduza credenciais, cookies, tokens ou conteúdo acadêmico protegido em
  arquivos versionados.
- Adicione/atualize testes determinísticos; nunca adicione testes live ao
  `npm test`.

## Licença

MIT (ver `LICENSE`).
