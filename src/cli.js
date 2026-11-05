#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { runScrape } = require('./scraper');

const pkg = require('../package.json');

// Lê credenciais de forma SEGURA: via variáveis de ambiente ou prompt oculto.
// NUNCA grava em disco.
function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (buf) => {
      // mascara a digitação
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(query + ': ' + '*'.repeat(buf.toString().length));
    };
    process.stdin.on('data', onData);
    rl.question(query + ': ', (ans) => {
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      rl.close();
      resolve(ans.trim());
    });
  });
}

function promptPlain(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query + ': ', (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function askCredentials() {
  let username = process.env.UNIVESP_USERNAME;
  let password = process.env.UNIVESP_PASSWORD;

  if (!username) username = await promptPlain('E-mail (@aluno.univesp.br) ou CPF');
  if (!password) password = await promptHidden('Senha');

  return { username, password };
}

function printHelp() {
  console.log(`
univespscraper v${pkg.version} — Extrai e organiza academicamente as disciplinas da UNIVESP

USO:
  node src/cli.js scrape [opções]

OPÇÕES:
  --course "<nome parcial>"   Processa apenas cursos que contêm o texto (ex.: "ADM290")
  --out "<pasta>"             Pasta de saída dos documentos (padrão: ./output)
  --cache "<pasta>"           Pasta de cache de PDFs (padrão: ./.cache)
  --all-courses               Processa todos os cursos ativos (padrão)
  -h, --help                  Mostra esta ajuda

CREDENCIAIS (nunca salvas em disco):
  Use variáveis de ambiente UNIVESP_USERNAME / UNIVESP_PASSWORD, ou
  o app irá pedir no terminal (senha oculta).

EXEMPLO:
  node src/cli.js scrape --course "ADM290"
  node src/cli.js scrape --all-courses
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { printHelp(); return; }

  const getArg = (name) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };

  const opts = {
    courseFilter: getArg('--course'),
    outputDir: path.resolve(getArg('--out') || 'output'),
    cacheDir: path.resolve(getArg('--cache') || '.cache'),
  };

  const { username, password } = await askCredentials();
  if (!username || !password) { console.error('Credenciais não fornecidas.'); process.exit(1); }

  try {
    const results = await runScrape({ username, password, opts });
    console.log(`\n🎉 Concluído! ${results.length} documento(s) em ${opts.outputDir}`);
  } catch (e) {
    console.error('\n❌ Erro:', e.message);
    process.exit(1);
  }
}

main();
