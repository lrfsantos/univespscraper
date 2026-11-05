const fs = require('fs');
const path = require('path');
const { _electron } = require('playwright');

// Teste D — Executável portátil (viabilidade técnica)
// Escopo da Etapa 1 (ressalva aprovada): verificar a VIABILIDADE do
// empacotamento portátil e do uso de UM ÚNICO Chromium (UI + automação).
// A implementação/validação COMPLETA do .exe fica para a Etapa 2.

const OUT = path.join(__dirname, 'evidence', 'test-D');
const APP_DIR = path.join(__dirname, 'test-D-app');

function log(ev, data) {
  const line = `[${new Date().toISOString()}] ${ev} ${data ? JSON.stringify(data) : ''}`;
  fs.appendFileSync(path.join(OUT, 'run.log'), line + '\n');
  console.log(line);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const result = { test: 'D', status: 'PENDING', steps: [], approval: [] };

  // --- 1) Um único Chromium: Playwright conduz o Electron ---
  let electronApp;
  try {
    electronApp = await _electron.launch({ args: [path.join(APP_DIR, 'main.js')] });
    result.steps.push({ step: 'electron-launch-via-playwright', ok: true });
    log('ELECTRON-LAUNCH', { ok: true });

    const window = await electronApp.firstWindow();
    await window.waitForSelector('#title', { timeout: 15000 });
    const title = await window.locator('#title').innerText();
    const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());

    // Interação na UI (prova de que o mesmo Chromium opera a UI)
    await window.click('#btn');
    await window.waitForTimeout(300);
    const outText = await window.locator('#out').innerText();

    result.electron = { title, appVersion, outText, ok: true };
    result.steps.push({ step: 'ui-interaction', title, outText });
    log('ELECTRON-UI', { title, appVersion, outText });
  } catch (e) {
    result.electron = { ok: false, reason: e.message };
    result.steps.push({ step: 'electron-launch-via-playwright', ok: false, reason: e.message });
    log('ELECTRON-ERR', { error: e.message });
  } finally {
    if (electronApp) await electronApp.close();
  }

  // --- 2) Viabilidade do target portable (electron-builder) ---
  // Não executa o build completo (fica para Etapa 2), apenas verifica que
  // a config reconhece o target "portable" e o electron-builder está instalado.
  let builderInfo;
  try {
    const eb = require('electron-builder');
    const pkg = require(path.join(APP_DIR, 'package.json'));
    const hasPortableTarget = (pkg.build.win.target || []).includes('portable');
    result.builder = { version: require('electron-builder/package.json').version, targetConfigured: hasPortableTarget, ok: hasPortableTarget && !!eb };
    result.steps.push({ step: 'portable-target-viability', hasPortableTarget });
    log('BUILDER', { version: result.builder.version, hasPortableTarget });
  } catch (e) {
    result.builder = { ok: false, reason: e.message };
    result.steps.push({ step: 'portable-target-viability', ok: false, reason: e.message });
    log('BUILDER-ERR', { error: e.message });
  }

  // --- Critérios ---
  const crit = {};
  crit.electronConduzidoPorPlaywright = result.electron && result.electron.ok;
  crit.uiOperadaNoMesmoProcesso = result.electron && result.electron.outText === 'Botão clicado - UI responsiva';
  crit.portableTargetDisponivel = result.builder && result.builder.targetConfigured;

  result.approval = Object.entries(crit).map(([k, v]) => ({ criterion: k, met: v }));
  result.status = Object.values(crit).every(Boolean) ? 'PASS' : 'FAIL';
  result.elapsedMs = Date.now() - started();

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log('\n=== RESULTADO TESTE D (viabilidade) ===');
  console.log('Status:', result.status);
  console.log('  Electron via Playwright:', result.electron && result.electron.ok ? 'OK' : 'FALHOU');
  console.log('  UI operada:', result.electron && result.electron.outText);
  console.log('  Portable target configurado:', result.builder && result.builder.targetConfigured);
  for (const c of result.approval) console.log(`  * ${c.criterion}: ${c.met ? 'PASSOU' : 'FALHOU'}`);
  console.log('Elapsed:', (result.elapsedMs / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

function started() { return Date.now(); }
