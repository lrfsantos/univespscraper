const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { installTempProfile } = require('./profile');

// UNIVESP Study Tool — Etapa 2: app Electron de validação do empacotamento portátil.
// Escopo: abrir o app, login manual, executar a PoC (ADM270 S1) dentro do próprio
// .exe usando UM ÚNICO Chromium (o do Electron), gerar ZIP, limpeza em melhor esforço.

// Log de diagnóstico em local fixo (independente do cwd do processo).
const DEBUG_LOG = path.join(os.tmpdir(), 'univesp-debug.log');
function dbg(msg) {
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
dbg('APP START execPath=' + process.execPath + ' argv=' + JSON.stringify(process.argv) + ' cwd=' + process.cwd());

process.on('uncaughtException', (e) => { try { fs.appendFileSync(DEBUG_LOG, 'UNCAUGHT: ' + e.message + '\n' + (e.stack || '') + '\n'); } catch {} });
process.on('unhandledRejection', (e) => { try { fs.appendFileSync(DEBUG_LOG, 'UNHANDLED: ' + (e && e.message) + '\n' + (e && e.stack || '') + '\n'); } catch {} });

const isDev = !app.isPackaged;

// Perfil temporário isolado por execução (requisito): evita persistência acidental
// em %APPDATA%\<app> / %APPDATA%\Electron. Instalado ANTES do app ficar pronto.
const profile = installTempProfile(app);
dbg('profile userData=' + profile.dir + ' residualRemoved=' + profile.residual.removed);

// Diretórios (melhor esforço, tudo temporário)
function makeTempDir(label) {
  const dir = path.join(require('os').tmpdir(), `univesp-study-${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let mainWindow = null;
const workDir = makeTempDir('poc');
const outputDir = path.join(workDir, 'saida');
const currentWorkDir = workDir;

// Recuperação em melhor esforço: remove diretórios temporários do app
// deixados por execuções anteriores/interrompidas (só os antigos, p/ não
// interferir em outra instância em andamento).
function cleanupResiduals() {
  const tmp = require('os').tmpdir();
  let removed = 0, failed = 0;
  try {
    for (const name of fs.readdirSync(tmp)) {
      if (!name.startsWith('univesp-study-')) continue;
      const p = path.join(tmp, name);
      if (p === currentWorkDir) continue;
      let stat;
      try { stat = fs.statSync(p); } catch { continue; }
      if (!stat.isDirectory()) continue;
      if (Date.now() - stat.mtimeMs > 60000) {
        try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch { failed++; }
      }
    }
  } catch { /* melhor esforço */ }
  dbg('cleanupResiduals removed=' + removed + ' failed=' + failed);
  return { removed, failed };
}

function sendStatus(step, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { step, ...data });
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    title: 'UNIVESP Study Tool — PoC (Etapa 2)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'ui.html'));
}

async function runPoC() {
  sendStatus('starting', { workDir, outputDir });
  const evDir = path.join(process.cwd(), 'poc', 'evidence', 'test-e2e');
  try {
    const { runPoc } = require('./run-poc');
    const result = await runPoc({ workDir, outputDir, sendStatus, evDir });
    sendStatus('done', result);
    // Evidência persistente (fora da área temporária que é limpa)
    try {
      fs.mkdirSync(evDir, { recursive: true });
      fs.writeFileSync(path.join(evDir, 'result.json'), JSON.stringify(result, null, 2));
      fs.writeFileSync(path.join(evDir, 'run.log'), JSON.stringify(result.phases, null, 2));
    } catch (e) { /* evidência é melhor esforço */ }
    return result;
  } catch (e) {
    sendStatus('error', { message: e.message, stack: e.stack });
    throw e;
  }
}

app.whenReady().then(() => {
  const residualCleanup = cleanupResiduals();
  createMainWindow();
  ipcMain.handle('start-poc', async () => {
    await runPoC();
    return { ok: true };
  });
  ipcMain.handle('get-env', () => ({
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    workDir,
    outputDir,
  }));
  // Modo automático para validação (Etapa 2): inicia a PoC ao abrir e fecha ao terminar
  if (process.argv.includes('--auto-poc')) {
    setTimeout(async () => {
      try {
        const r = await runPoC();
        console.log('AUTO-POC-RESULT', JSON.stringify({ status: r.status, zip: r.zip, cleanup: r.cleanup, phases: r.phases }));
        setTimeout(() => app.quit(), 1000);
      } catch (e) {
        console.error('AUTO-POC-ERROR', e.message, e.stack);
        setTimeout(() => app.quit(), 1000);
      }
    }, 1500);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
