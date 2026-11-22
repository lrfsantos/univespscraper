const fs = require('fs');
const path = require('path');
const { installUniversalMute, muteWindow } = require('../electron/mute-media');

// Teste determinístico da REGRA UNIVERSAL DE ÁUDIO: toda janela do Electron
// (inclusive popups de vídeos do AVA/YouTube) nasce silenciada.
const OUT = path.join(__dirname, '..', 'audit-temp', 'MUTE_MEDIA_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

function fakeWin() {
  return {
    __muted: null,
    handlers: {},
    scripts: [],
    webContents: {
      isDestroyed: () => false,
      isLoading: () => false,
      setAudioMuted(v) { this.__owner.__muted = v; },
      on(ev, fn) { this.__owner.handlers[ev] = fn; },
      executeJavaScript(code) { this.__owner.scripts.push(code); return Promise.resolve(); },
    },
  };
}

(async () => {
  const w1 = fakeWin();
  w1.webContents.__owner = w1;
  const app = {
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; },
  };
  const r1 = installUniversalMute(app, [w1]);
  record({ id: 'M1', title: 'instala e silencia janelas existentes', status: ok(r1.installed === true && w1.__muted === true), detail: `muted=${w1.__muted}` });

  const w2 = fakeWin();
  w2.webContents.__owner = w2;
  app.handlers['browser-window-created']({}, w2);
  const injected = w2.scripts.join('\n');
  record({ id: 'M2', title: 'popup novo tambem nasce silenciado', status: ok(w2.__muted === true), detail: `muted=${w2.__muted}` });

  record({ id: 'M3', title: 'injeção DOM cobre players que ignoram muted', status: ok(/muted\s*=\s*true/.test(injected) && /HTMLMediaElement\.prototype\.play/.test(injected) && /MutationObserver/.test(injected)), detail: `scripts=${w2.scripts.length}` });

  const r2 = installUniversalMute(app, []);
  record({ id: 'M4', title: 'instalação é idempotente', status: ok(r2.installed === false), detail: `reason=${r2.reason}` });

  const closed = fakeWin();
  closed.webContents.isDestroyed = () => true;
  muteWindow(closed);
  record({ id: 'M5', title: 'janela fechada é ignorada sem erro', status: ok(closed.__muted === null), detail: `muted=${closed.__muted}` });

  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const browserSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'browser.js'), 'utf8');
  record({ id: 'M6', title: 'regra instalada no app principal E no navegador auxiliar', status: ok(/installUniversalMute\(app\)/.test(mainSrc) && /installUniversalMute\(app\)/.test(browserSrc)), detail: 'main.js + browser.js' });

  const fails = results.filter((r) => r.status !== 'PASS').length;
  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
  console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
