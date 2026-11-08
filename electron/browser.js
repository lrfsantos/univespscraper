const { app, BrowserWindow } = require('electron');
const { installTempProfile } = require('./profile');

// Instância "browser" auxiliar de automação (Fases A1-A7).
// É lançada via playwright-core._electron pelo processo principal (main.js).
// Mostra o AVA numa janela VISÍVEL onde o estudante faz o login MANUAL.
// NUNCA usa credenciais por variável de ambiente, nunca preenche senha.

// Perfil temporário isolado por execução (nunca %APPDATA%\Electron nem o perfil
// pessoal). Deve ser instalado ANTES do app ficar pronto.
installTempProfile(app);

// User-Agent de Chrome comum (não o do Electron), pois leitores como a
// Minha Biblioteca rejeitam o User-Agent do Electron ("navegador não compatível").
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

app.userAgentFallback = CHROME_UA;

// B1: o auxiliar nunca pede o single-instance-lock (só a instância principal);
// a proteção de instância única não bloqueia este processo.
function createBrowserWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'UNIVESP Study Tool — Navegador (login manual)',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL('https://ava.univesp.br/');
  return win;
}

app.whenReady().then(() => {
  createBrowserWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
