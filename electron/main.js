const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require('playwright-core');
const { installTempProfile } = require('./profile');
const { makeWorkDir, cleanupWorkDir, cleanupResidualWorkDirs } = require('./workdir');
const { createBrowserWindow: createAuxWindow, applyBrowserDefaults } = require('./browser');
const { buildAuxEnv } = require('./env');
const { makeFlowLogger, discoverCourses, discoverWeeks, discoverResourcesFromSection, extractResource, buildSelectionPlan, sanitizeReason, authExpiredEntries, buildCourseStructure, buildTopLevelDocs, zipBaseName, createZip, validateZip, overallStatus, waitForManualLogin, isLoggedIn, safeName, BASE } = require('./flow');

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

// --- Seção 3: recupera resíduos de PASTAS DE TRABALHO de execuções anteriores
// (dono inativo) na inicialização — melhor esforço; nunca toca o que não pertence
// ao aplicativo. Não há pasta de trabalho própria criada ainda neste run. ---
const residualWork = cleanupResidualWorkDirs();
if (residualWork.removed) logger.log('residual work dirs removidos=' + residualWork.removed);

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
// P0 2.1: usa o MESMO executável Electron (process.execPath), que existe tanto em
// desenvolvimento quanto dentro do pacote — não depende de node_modules/.bin nem
// de instalação global. No app empacotado, o exe roda o próprio main.js em modo
// auxiliar (--univesp-aux): abre a janela do navegador sem criar a interface
// principal e sem disputar o single-instance-lock.
async function launchBrowser() {
  if (auxApp) return { ok: true, already: true };
  const browserEntry = path.join(__dirname, 'browser.js');
  const args = app.isPackaged ? ['--univesp-aux'] : [browserEntry];
  logger.log('launch browser aux executable=' + process.execPath + ' packaged=' + app.isPackaged + ' args=' + JSON.stringify(args));
  auxApp = await _electron.launch({ executablePath: process.execPath, args, env: auxEnv() });
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
  const result = { weeksByCourse: {}, failuresByCourse: [] };
  const selected = courseIds && courseIds.length ? courseIds : null;
  // Descoberta das semanas de cada disciplina selecionada (ou todas as descobertas).
  // P0 2.6: falha na descoberta de UMA matéria não impede as demais — cada curso é
  // processado isoladamente; falhas são registradas (motivo sanitizado) e o fluxo
  // continua com as próximas.
  const courses = currentCourses || [];
  for (const c of courses) {
    if (selected && !selected.includes(String(c.id))) continue;
    try {
      const { weeks } = await discoverWeeks(auxWin, c);
      result.weeksByCourse[String(c.id)] = { course: c, weeks };
    } catch (e) {
      const reason = sanitizeReason(e);
      logger.error('descoberta de semanas falhou [' + c.code + ']: ' + reason);
      result.failuresByCourse.push({ courseId: String(c.id), reason });
      result.weeksByCourse[String(c.id)] = { course: c, weeks: [], error: reason };
    }
  }
  return { ok: true, ...result };
}

let currentCourses = [];
let currentWorkResult = null;
let cancelRequested = false;

async function handleRunExtraction(selection) {
  if (!auxWin || !auxApp) return { error: 'navegador-nao-iniciado' };
  // selection: [{ courseId, weekIds: [...] }] — P0 2.3: array vazio de weekIds
  // significa NENHUMA semana daquela matéria; null/undefined significa todas.
  const courses = currentCourses;
  // Seção 3: pasta de trabalho exclusiva, com OWNER.json (PID do processo dono).
  const work = makeWorkDir();
  const workDir = work.dir;
  const outputDir = work.outputDir;
  const resources = [];
  const reportByCourse = [];
  cancelRequested = false;
  // P0 2.5: dedup por URL normalizada compartilhada em TODA a extração — um mesmo
  // recurso incorporado (ex.: videoaula em várias páginas) nunca é reextraído.
  const seenResourceKeys = new Set();

  // P0 2.6: falha na descoberta de UMA matéria não impede as demais. Falhas são
  // registradas (motivo sanitizado) e o processamento continua com as próximas.
  let planned = [];
  let totalResources = 0;
  let selectedWeeksTotal = 0;
  const courseErrors = [];
  try {
    planned = await buildSelectionPlan({
      courses,
      selection,
      discover: async (c) => discoverWeeks(auxWin, c),
      onCourseError: (course, reason) => {
        courseErrors.push({ course, reason });
        logger.error('planejamento da matéria falhou [' + (course.code || course.id) + ']: ' + reason);
      },
    });
    for (const { weeks: selWeeks, sections, error } of planned) {
      if (error) continue;
      selectedWeeksTotal += selWeeks.length;
      for (const w of selWeeks) {
        const section = sections.find((s) => s.id === String(w.id));
        totalResources += discoverResourcesFromSection(section || { block: '' }).length;
      }
    }
  } catch (e) {
    logger.error('planejamento falhou: ' + e.message);
    cleanupWorkDir(workDir);
    return { ok: false, error: 'Não foi possível preparar a extração. Verifique sua conexão e tente novamente.' };
  }
  if (planned.length && selectedWeeksTotal === 0) {
    cleanupWorkDir(workDir);
    sendStatus('extracao', { event: 'sem-recursos', message: 'Nenhuma semana foi selecionada para extração.' });
    return { ok: false, error: 'Nenhuma semana foi selecionada. Marque ao menos uma semana e tente novamente.' };
  }
  if (totalResources === 0) {
    cleanupWorkDir(workDir);
    sendStatus('extracao', { event: 'sem-recursos', message: 'Nenhum material encontrado nas semanas selecionadas.' });
    return { ok: false, error: 'Nenhum material encontrado nas semanas selecionadas.' };
  }

  let doneCount = 0;
  let pendingCount = 0;
  // Contrato de progresso: envelope step='extracao' + event='progresso'.
  // (Correção C: antes usava step='progresso', o que sobrescrevia o envelope e
  // fazia a interface descartar o evento — a barra nunca avançava.)
  const emitProgress = () => {
    sendStatus('extracao', {
      event: 'progresso',
      done: doneCount,
      pending: pendingCount,
      total: totalResources,
    });
  };

  // P0 2.6.4: sessão expirada no meio da extração = problema de AUTENTICAÇÃO,
  // nunca conteúdo integral. Recursos restantes viram inacessíveis e novas
  // navegações são interrompidas (o AVA redirecionaria para o login).
  let sessionExpired = false;

  try {
    for (const { course, weeks: selWeeks, sections, error } of planned) {
      if (cancelRequested || sessionExpired) break;
      if (error) {
        // Matéria que falhou na descoberta: pendência registrada (não silenciosa).
        reportByCourse.push({ course, weeks: [], error: 'matéria inacessível na descoberta: ' + error });
        continue;
      }
      const courseWeeks = [];
      for (const w of selWeeks) {
        if (cancelRequested || sessionExpired) break;
        // P0 2.6: falha numa semana NÃO impede as semanas seguintes.
        try {
          const section = sections.find((s) => s.id === String(w.id));
          const weekResources = discoverResourcesFromSection(section || { block: '' });
          const weekName = safeName(w.name || 'semana-' + w.id);
          const weekDir = path.join(outputDir, String(course.code || course.id), weekName);
          fs.mkdirSync(path.join(weekDir, 'videos'), { recursive: true });
          fs.mkdirSync(path.join(weekDir, 'readings'), { recursive: true });
          fs.mkdirSync(path.join(weekDir, 'supplementary'), { recursive: true });
          const extracted = [];
          for (const r of weekResources) {
            if (cancelRequested || sessionExpired) break;
            // Autenticação: antes de cada recurso, confirma que a sessão ainda é
            // válida (não basta a janela aberta). Se expirou, marca o RESTANTE da
            // semana como inacessível (motivo de autenticação) e encerra o fluxo.
            if (!(await isLoggedIn(auxWin))) {
              sessionExpired = true;
              logger.error('sessão expirada durante a extração — recursos restantes marcados como inacessíveis (autenticação)');
              const rest = authExpiredEntries(weekResources.slice(extracted.length), course, w.name);
              for (const authEntry of rest) {
                extracted.push(authEntry);
                resources.push(authEntry);
                pendingCount++;
              }
              emitProgress();
              break;
            }
            sendStatus('extracao', { event: 'recurso', course: course.code || course.id, week: w.name, url: r.url, kind: r.classification.kind, done: doneCount, pending: pendingCount, total: totalResources });
            const subDir = r.classification.kind === 'video' ? 'videos' : (r.classification.kind === 'page' ? '' : (r.classification.kind === 'pdf' ? 'supplementary' : (r.classification.kind === 'book' ? 'readings' : 'supplementary')));
            const targetDir = subDir ? path.join(weekDir, subDir) : weekDir;
            fs.mkdirSync(targetDir, { recursive: true });
            let e;
            try {
              e = await extractResource({ app: auxApp, win: auxWin, resource: r, weekDir: targetDir, logger, seen: seenResourceKeys });
            } catch (err) {
              // P0 2.6: falha num recurso NÃO interrompe os outros — registra e segue.
              const reason = sanitizeReason(err);
              logger.error('recurso falhou [' + r.url + ']: ' + reason);
              e = { id: r.id || r.url, text: r.text, url: r.url, kind: (r.classification || {}).kind, subKind: (r.classification || {}).subKind, status: 'inaccessible', reason: 'falha-durante-extracao: ' + reason };
            }
            e.course = course.code || course.id;
            e.week = w.name;
            extracted.push(e);
            resources.push(e);
            if (e.status === 'integral' || e.status === 'video-registrado' || e.status === 'video-com-transcricao') doneCount++;
            else pendingCount++;
            // P0 2.5: recursos incorporados descobertos na página são tratados como
            // recursos independentes (status próprio) — entram no progresso e no relatório.
            if (Array.isArray(e.embedded) && e.embedded.length) {
              for (const emb of e.embedded) {
                emb.course = course.code || course.id;
                emb.week = w.name;
                extracted.push(emb);
                resources.push(emb);
                if (emb.status === 'integral' || emb.status === 'video-registrado' || emb.status === 'video-com-transcricao') doneCount++;
                else pendingCount++;
              }
              totalResources += e.embedded.length;
            }
            emitProgress();
          }
          const weekMd = renderWeekMarkdown({ course, week: w, resources: extracted });
          fs.writeFileSync(path.join(weekDir, `${weekName}.md`), weekMd);
          courseWeeks.push({ id: w.id, name: w.name, resources: extracted });
        } catch (e2) {
          // Semana inteira falhou → registra pendência explícita e segue.
          const reason = sanitizeReason(e2);
          logger.error('semana falhou [' + (course.code || course.id) + ' / ' + (w.name || w.id) + ']: ' + reason);
          const wkEntry = { id: 'semana-' + w.id, text: w.name || 'Semana ' + w.id, url: course.url, kind: 'unknown', status: 'inaccessible', reason: 'falha-na-semana: ' + reason };
          wkEntry.course = course.code || course.id;
          wkEntry.week = w.name;
          courseWeeks.push({ id: w.id, name: w.name, resources: [wkEntry] });
          resources.push(wkEntry);
          pendingCount++;
          emitProgress();
        }
      }
      // A7: INDEX.md / SOURCES.md / EXTRACTION_REPORT.md / AI_STUDY_INSTRUCTIONS.md
      buildCourseStructure({ course, weeks: courseWeeks, outputDir });
      reportByCourse.push({ course, weeks: courseWeeks });
    }
    // Documentos no nível raiz do ZIP.
    buildTopLevelDocs({ courses: reportByCourse.map((r) => r.course), outputDir });

    const result = { resources, reportByCourse, workDir, outputDir, cancelled: cancelRequested, sessionExpired };
    currentWorkResult = result;
    if (cancelRequested) {
      sendStatus('extracao', { event: 'cancelado', done: doneCount, pending: pendingCount, total: totalResources });
      // Mantém a pasta de trabalho (o estudante pode salvar o que já foi processado
      // ou descartar explicitamente). Conta pendências honestamente.
      const counts = summarizeCounts(resources);
      const statusLabel = zipOkLabel(counts);
      return { ok: true, status: 'cancelado', cancelled: true, resourceCount: resources.length, counts, statusLabel: statusLabel.label, title: statusLabel.title, message: statusLabel.message, result: { counts, statusLabel: statusLabel.label, title: statusLabel.title, message: statusLabel.message } };
    }
    const counts = summarizeCounts(resources);
    const statusLabel = zipOkLabel(counts);
    sendStatus('extracao', { event: 'concluida', done: doneCount, pending: pendingCount, total: totalResources });
    // Contrato padrão (correção D): status/título/mensagem/counts no NÍVEL EXTERNO
    // da resposta. `result` aninhado é mantido apenas por compatibilidade.
    return {
      ok: true,
      status: 'pronto-para-zip',
      statusLabel: statusLabel.label,
      title: statusLabel.title,
      message: statusLabel.message,
      resourceCount: resources.length,
      counts,
      result: { counts, statusLabel: statusLabel.label, title: statusLabel.title, message: statusLabel.message },
    };
  } catch (e) {
    logger.error('run-extraction falhou: ' + e.message);
    return { ok: false, error: 'Ocorreu um erro durante a extração. Nenhum resultado foi apresentado como concluído.' };
  }
}

// Resumo honesto dos resultados para a tela final.
function summarizeCounts(resources) {
  const counts = { integral: 0, partial: 0, inaccessible: 0, not_found: 0, unsupported: 0, video: 0 };
  for (const r of resources) {
    if (r.status === 'integral') counts.integral++;
    else if (r.status === 'partial') counts.partial++;
    else if (r.status === 'inaccessible') counts.inaccessible++;
    else if (r.status === 'not_found') counts.not_found++;
    else if (r.status === 'unsupported') counts.unsupported++;
    else if (r.status === 'video-registrado' || r.status === 'video-com-transcricao') counts.video++;
  }
  return counts;
}

function zipOkLabel(counts) {
  const pending = counts.partial + counts.inaccessible + counts.not_found + counts.unsupported;
  if (pending === 0) {
    return { label: 'concluído', title: 'Extração concluída', message: 'Todos os materiais foram extraídos integralmente. Pronto para salvar o ZIP.' };
  }
  if (counts.inaccessible + counts.not_found === 0) {
    return { label: 'concluído com pendências', title: 'Extração concluída com pendências', message: 'Alguns materiais foram extraídos parcialmente. Eles constam no relatório do ZIP.' };
  }
  return { label: 'concluído com pendências', title: 'Extração concluída com pendências', message: 'Alguns materiais ficaram inacessíveis ou não foram encontrados. Eles constam no relatório do ZIP, que ainda pode ser salvo.' };
}

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
  const defaultName = zipBaseName(res.reportByCourse.map((r) => r.course)) + '.zip';
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
  // Seção 3: SÓ depois do ZIP salvo E validado a pasta de trabalho é removida
  // (melhor esforço). Falha na limpeza NUNCA vira falha do salvamento.
  if (zip.ok && validation.valid && validation.matches === true) {
    const c = cleanupWorkDir(res.workDir);
    logger.log('limpeza da pasta de trabalho após ZIP ok=' + c.ok + (c.ok ? '' : ' motivo=' + c.reason));
    if (currentWorkResult === res) currentWorkResult = null;
  }
  return { ok: zip.ok, zip: { ...zip, path: picked.filePath }, validation, status };
}

async function handleRevealZip(zipPath) {
  try { await require('electron').shell.showItemInFolder(zipPath); return { ok: true }; }
  catch { return { ok: false }; }
}

function handleCancelExtraction() {
  cancelRequested = true;
  return { ok: true };
}

// Seção 3.5: descarte EXPLÍCITO da extração — remove a pasta de trabalho
// (validação de caminho) e libera para nova extração. Melhor esforço.
function handleDiscardExtraction() {
  const res = currentWorkResult;
  if (res && res.workDir) {
    const c = cleanupWorkDir(res.workDir);
    logger.log('descarte da extração ok=' + c.ok);
  }
  currentWorkResult = null;
  return { ok: true };
}

app.whenReady().then(() => {
  // Modo AUXILIAR (app empacotado): o exe é relançado por si próprio (process.execPath)
  // com --univesp-aux para abrir a janela do navegador AVA. NÃO cria a interface
  // principal, NÃO registra IPC e não disputa o lock de instância única.
  if (isAuxBrowser) {
    applyBrowserDefaults();
    createAuxWindow();
    return;
  }
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
  ipcMain.handle('cancel-extraction', () => handleCancelExtraction());
  ipcMain.handle('save-zip', () => handleSaveZip());
  ipcMain.handle('reveal-zip', (e, p) => handleRevealZip(p));
  ipcMain.handle('discard-extraction', () => handleDiscardExtraction());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Seção 3.2: o app principal controla o ciclo de vida do navegador auxiliar — ao
// encerrar, fecha a instância auxiliar e AGUARDA o processo, depois remove a pasta
// de trabalho (se ainda existir, ex.: extração cancelada sem ZIP) e encerra.
let quitInProgress = false;
app.on('before-quit', (e) => {
  if (quitInProgress) return;
  const aux = auxApp;
  const work = currentWorkResult;
  if (!aux && !work) return;
  e.preventDefault();
  quitInProgress = true;
  (async () => {
    if (aux) { try { await aux.close(); } catch {} }
    if (work && work.workDir) { try { cleanupWorkDir(work.workDir); } catch {} }
    app.quit();
  })().catch(() => app.quit());
});

app.on('will-quit', () => {
  if (profile && profile.cleanup) { try { profile.cleanup(); } catch {} }
  logger.log('APP EXIT');
});
