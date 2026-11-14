const { app, BrowserWindow } = require('electron');
const { installTempProfile } = require('./profile');

// Instância "browser" auxiliar de automação (Fases A1-A7).
// É lançada via playwright-core._electron pelo processo principal (main.js),
// usando o MESMO executável Electron (process.execPath) — funciona tanto em
// desenvolvimento quanto no aplicativo empacotado (P0 2.1).
// Mostra o AVA numa janela VISÍVEL onde o estudante faz o login MANUAL.
// NUNCA usa credenciais por variável de ambiente, nunca preenche senha.

// Perfil temporário isolado por execução (nunca %APPDATA%\Electron nem o perfil
// pessoal). Instalado ANTES do app ficar pronto. No modo empacotado, o perfil é
// instalado pelo main.js (mesmo processo em modo auxiliar) — aqui isso só é feito
// quando este arquivo é a ENTRADA independente (desenvolvimento).
function installAuxProfile() {
  installTempProfile(app);
}

// User-Agent derivado do Chromium REAL embutido no Electron (8.2). Não é um valor
// fixo/inventado: usa process.versions.chrome do runtime. Leitores como a Minha
// Biblioteca rejeitam o User-Agent puro do Electron; um UA de Chrome coerente com
// a versão real do runtime é mantido.
function chromiumUserAgent() {
  const chrome = process.versions && process.versions.chrome ? process.versions.chrome : '142.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function applyBrowserDefaults() {
  app.userAgentFallback = chromiumUserAgent();
}

let auxWindow = null;

function createBrowserWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'UNIVESP Study Tool — Navegador (login manual)',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL('https://ava.univesp.br/');
  auxWindow = win;
  return win;
}

// Entrada independente (desenvolvimento): electron browser.js.
function runStandalone() {
  installAuxProfile();
  applyBrowserDefaults();
  app.whenReady().then(() => {
    createBrowserWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { installAuxProfile, applyBrowserDefaults, createBrowserWindow, runStandalone, chromiumUserAgent };

// Entrada independente: este arquivo roda como processo auxiliar (janela do AVA)
// em DOIS cenários — (1) execução direta `electron browser.js` (require.main ===
// module) e (2) lançamento via playwright-core._electron em desenvolvimento, em
// que o entry é passado como ARGUMENTO e `require.main` aponta para o main do
// Electron, não para este arquivo. O sinal confiável comum é o próprio caminho
// deste arquivo em process.argv. Ao ser `require`'d pelo main.js principal (que só
// importa funções), nenhum dos sinais dispara e `runStandalone()` não roda.
const isStandaloneEntry =
  require.main === module || process.argv.some((a) => a.includes('browser.js'));
if (isStandaloneEntry) runStandalone();
