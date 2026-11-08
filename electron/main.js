const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require('playwright-core');
const { installTempProfile } = require('./profile');
const { buildAuxEnv } = require('./env');
const { makeFlowLogger, discoverCourses, discoverWeeks, discoverResourcesFromSection, extractResource, buildCourseStructure, createZip, validateZip, overallStatus, waitForManualLogin, isLoggedIn, safeName, BASE } = require('./flow');

// UNIVESP Study Tool — app integrado (Fases A1-A7/B1/B4).
// Fluxo: o estudante abre o app, uma janela de navegador VISÍVEL é aberta no AVA,
// o login é MANUAL (nunca automático, nunca por variável de ambiente), o app
// detecta a autenticação e conduz: disciplinas → semanas → recursos → extração
// (Módulos 1-3) → ZIP no destino escolhido via diálogo. Nenhuma credencial é
// usada, armazenada ou repassada.

// --- B4: log de diagnóstico sanitizado (nunca credenciais/cookies/conteúdo) ---
const logger = makeFlowLogger(path.join(os.tmpdir(), 'univesp-app.log'));
logger.log('APP START execPath=' + process.execPath + ' packaged=' + app.isPackaged);

process.on('uncaughtException', (e) => { logger.error('UNCAUGHT: ' + e.message); });
process.on('unhandledRejection', (e) => { logger.error('UNHANDLED: ' + (e && e.message)); });

// --- B1: instância única do app PRINCIPAL ---
// browser.js é um processo auxiliar (lançado via playwright-core) e NÃO deve
// ser bloqueado pelo lock. O lock aplica-se apenas à instância principal do app.
// A instância auxiliar se identifica e é tratada fora do caminho do lock.
const isAuxBrowser = process.argv.some((a) => a === '--univesp-aux');
if (!isAuxBrowser) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    logger.log('outra instância principal ativa — encerrando');
    app.quit();
  }
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// --- Perfil temporário isolado por execução (B2/B3), antes do app ficar pronto ---
const profile = installTempProfile(app);
logger.log('profile userData=' + profile.dir);

// Env EXPLÍCITO para o processo auxiliar: nunca repassa process.env inteiro.
// Apenas variáveis necessárias ao funcionamento do Electron/Windows.
function auxEnv() {
  return buildAuxEnv();
}

let mainWindow = null;
let auxApp = null;      // instância auxiliar (electron via playwright)
let auxWin = null;      // Page da janela do navegador auxiliar

function sendStatus(step, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { step, ...data });
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    title: 'UNIVESP Study Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'ui.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- Lança o navegador auxiliar (janela VISÍVEL do AVA, login manual) ---
async function launchBrowser() {
  if (auxApp) return { ok: true, already: true };
  const browserEntry = path.join(__dirname, 'browser.js');
  logger.log('launch browser aux');
  auxApp = await _electron.launch({ args: [browserEntry], env: auxEnv() });
  auxWin = await auxApp.firstWindow();
  await auxWin.waitForSelector('body', { timeout: 30000 }).catch(() => {});
  return { ok: true };
}

// Verifica autenticação na janela auxiliar (não basta a página aberta).
async function checkAuth() {
  if (!auxWin) return { loggedIn: false };
  return { loggedIn: await isLoggedIn(auxWin) };
}

async function handleDiscoverCourses() {
  await launchBrowser();
  sendStatus('aguardando-login', { message: 'Faça o login manualmente na janela do navegador.' });
  const logged = await waitForManualLogin(auxWin, { timeoutMs: 30000, interval: 2000 });
  if (!logged) {
    const ainda = await isLoggedIn(auxWin);
    if (!ainda) return { error: 'aguardando-login-manual', message: 'Você ainda não está autenticado. Conclua o login manual na janela do navegador e tente novamente.' };
  }
  const { courses } = await discoverCourses(auxWin);
  sendStatus('disciplinas-descobertas', { count: courses.length });
  return { ok: true, courses };
}

async function handleDiscoverWeeks(courseIds) {
  if (!auxWin) return { error: 'navegador-nao-iniciado' };
  const result = { weeksByCourse: {} };
  const selected = courseIds && courseIds.length ? courseIds : null;
  // Descoberta das semanas de cada disciplina selecionada (ou todas as descobertas).
  // Neste fluxo, main.js já recebe a lista de disciplinas do passo anterior; aqui
  // re-descoberta é feita por disciplina para manter a relação disciplina→semana.
  // A lista de disciplinas é passada via cache em memória (ver setCourses).
  const courses = currentCourses || [];
  for (const c of courses) {
    if (selected && !selected.includes(String(c.id))) continue;
    const { weeks } = await discoverWeeks(auxWin, c);
    result.weeksByCourse[String(c.id)] = { course: c, weeks };
  }
  return { ok: true, ...result };
}

let currentCourses = [];

async function handleRunExtraction(selection) {
  if (!auxWin || !auxApp) return { error: 'navegador-nao-iniciado' };
  // selection: [{ courseId, weekIds: [...] }]
  const courses = currentCourses;
  const selectedCourses = selection && selection.length ? selection : courses.map((c) => ({ courseId: String(c.id), weekIds: null }));
  const workDir = path.join(os.tmpdir(), `univesp-work-${Date.now()}`);
  const outputDir = path.join(workDir, 'saida');
  fs.mkdirSync(outputDir, { recursive: true });
  const resources = [];
  const reportByCourse = [];

  try {
    for (const sel of selectedCourses) {
      const course = courses.find((c) => String(c.id) === String(sel.courseId));
      if (!course) continue;
      const { weeks, sections } = await discoverWeeks(auxWin, course);
      const selWeeks = sel.weekIds && sel.weekIds.length ? weeks.filter((w) => sel.weekIds.includes(String(w.id))) : weeks;
      const courseWeeks = [];
      for (const w of selWeeks) {
        const section = sections.find((s) => s.id === String(w.id));
        const weekResources = discoverResourcesFromSection(section || { block: '' });
        const weekName = safeName(w.name || 'semana-' + w.id);
        const weekDir = path.join(outputDir, String(course.code || course.id), weekName);
        fs.mkdirSync(path.join(weekDir, 'videos'), { recursive: true });
        fs.mkdirSync(path.join(weekDir, 'readings'), { recursive: true });
        fs.mkdirSync(path.join(weekDir, 'supplementary'), { recursive: true });
        const extracted = [];
        for (const r of weekResources) {
          sendStatus('recurso', { course: course.code || course.id, week: w.name, url: r.url, kind: r.classification.kind });
          const subDir = r.classification.kind === 'video' ? 'videos' : (r.classification.kind === 'page' ? '' : (r.classification.kind === 'pdf' ? 'supplementary' : (r.classification.kind === 'book' ? 'readings' : 'supplementary')));
          const targetDir = subDir ? path.join(weekDir, subDir) : weekDir;
          fs.mkdirSync(targetDir, { recursive: true });
          const e = await extractResource({ app: auxApp, win: auxWin, resource: r, weekDir: targetDir, logger });
          e.course = course.code || course.id;
          e.week = w.name;
          extracted.push(e);
          resources.push(e);
        }
        const weekMd = renderWeekMarkdown({ course, week: w, resources: extracted });
        fs.writeFileSync(path.join(weekDir, `${weekName}.md`), weekMd);
        courseWeeks.push({ id: w.id, name: w.name, resources: extracted });
      }
      // A7: INDEX.md / SOURCES.md / EXTRACTION_REPORT.md / AI_STUDY_INSTRUCTIONS.md
      buildCourseStructure({ course, weeks: courseWeeks, outputDir });
      reportByCourse.push({ course, weeks: courseWeeks });
    }

    const result = { resources, reportByCourse, workDir, outputDir };
    currentWorkResult = result;
    return { ok: true, status: 'pronto-para-zip', resourceCount: resources.length };
  } catch (e) {
    logger.error('run-extraction falhou: ' + e.message);
    return { ok: false, error: e.message };
  }
}

let currentWorkResult = null;

function renderWeekMarkdown({ course, week, resources }) {
  const lines = [`# ${week.name} — ${course.title}${course.code ? ` (${course.code})` : ''}`, ''];
  const byKind = { video: [], page: [], pdf: [], book: [], unknown: [] };
  for (const r of resources) {
    const k = byKind[r.kind] ? r.kind : 'unknown';
    byKind[k].push(r);
  }
  for (const k of ['page', 'pdf', 'book', 'video', 'unknown']) {
    for (const r of byKind[k] || []) {
      lines.push(`## [${r.status}] ${r.text || r.id}`);
      lines.push(`- Fonte: ${r.url}`);
      if (r.title) lines.push(`- Título: ${r.title}`);
      if (r.kind === 'pdf') {
        lines.push(`- Páginas do arquivo: ${r.totalPagesArquivo ?? '—'}; páginas com texto: ${r.pagesExtracted ?? '—'}`);
        if (r.pdfFile) lines.push(`- Arquivo: ${r.pdfFile}`);
      }
      if (r.kind === 'book') { if (r.chars != null) lines.push(`- Caracteres extraídos: ${r.chars}`); if (r.reason) lines.push(`- Motivo: ${r.reason}`); }
      if (r.kind === 'video') { lines.push(`- Transcrição: ${r.transcriptNote || 'não disponível'}`); }
      if (r.savedTextFile) lines.push(`- Texto: ${r.savedTextFile}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// --- A6: destino do ZIP via diálogo + validação ---
async function handleSaveZip() {
  const res = currentWorkResult;
  if (!res || !res.outputDir) return { ok: false, error: 'sem-trabalho-para-zipar' };
  const defaultName = 'UNIVESP_study_material.zip';
  const picked = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar material extraído (ZIP)',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Arquivo ZIP', extensions: ['zip'] }],
  });
  if (picked.canceled || !picked.filePath) return { ok: false, error: 'cancelado', canceled: true };

  // O ZIP é criado DIRETAMENTE no destino escolhido (fora do dir temporário).
  const zip = await createZip(res.outputDir, picked.filePath);
  const validation = zip.ok ? validateZip(zip) : { valid: false, reason: zip.reason };
  const status = zip.ok ? overallStatus({ resources: res.resources, zip }) : 'falhou';
  sendStatus('zip', { ok: zip.ok, path: picked.filePath, validation });
  return { ok: zip.ok, zip: { ...zip, path: picked.filePath }, validation, status };
}

async function handleRevealZip(zipPath) {
  try { await require('electron').shell.showItemInFolder(zipPath); return { ok: true }; }
  catch { return { ok: false }; }
}

app.whenReady().then(() => {
  createMainWindow();
  ipcMain.handle('get-env', () => ({ appVersion: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('launch-browser', () => launchBrowser());
  ipcMain.handle('check-auth', () => checkAuth());
  ipcMain.handle('discover-courses', async () => {
    const r = await handleDiscoverCourses();
    if (r.courses) currentCourses = r.courses;
    return r;
  });
  ipcMain.handle('discover-weeks', (e, ids) => handleDiscoverWeeks(ids));
  ipcMain.handle('run-extraction', (e, selection) => handleRunExtraction(selection));
  ipcMain.handle('save-zip', () => handleSaveZip());
  ipcMain.handle('reveal-zip', (e, p) => handleRevealZip(p));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (profile && profile.cleanup) { try { profile.cleanup(); } catch {} }
  logger.log('APP EXIT');
});
