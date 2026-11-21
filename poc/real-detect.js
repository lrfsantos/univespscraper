// Classificação REAL (somente leitura) de recursos de livro no AVA autenticado.
// Imprime formato/estado e contagens — nunca URLs com code/token, nem conteúdo.
const path = require('path');
const { _electron } = require('playwright-core');
const books = require('../src/extract/books');
const pearson = require('../src/extract/pearson');

const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('variaveis de ambiente ausentes');
const BASE = 'https://ava.univesp.br';
const IDS = process.argv.slice(2).map(Number).filter(Number.isFinite);

async function login(win) {
  await win.goto(`${BASE}/custom/univesp_saml.php?wantsurl=${encodeURIComponent(BASE + '/')}&login_hint=${encodeURIComponent(USERNAME)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await win.waitForSelector('form[name="f"]', { timeout: 30000 });
  await win.fill('input#password', PASSWORD);
  await Promise.all([
    win.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}),
    win.click('button[type="submit"]'),
  ]);
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const u = win.url();
    if (u.includes('ava.univesp.br') && !/login|saml/.test(u)) {
      if (await win.evaluate(() => !document.querySelector('form[name="f"]')).catch(() => false)) return true;
    }
    await win.waitForTimeout(1500);
  }
  return false;
}

(async () => {
  const electronPath = require('electron');
  const executablePath = typeof electronPath === 'string' ? electronPath : process.execPath;
  const app = await _electron.launch({ args: [path.join(__dirname, '..', 'electron', 'browser.js')], executablePath });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('body', { timeout: 30000 });
    if (!(await login(win))) throw new Error('login-nao-concluido');
    console.log('LOGIN=OK');
    for (const id of IDS) {
      const url = `${BASE}/mod/lti/launch.php?id=${id}&triggerview=0`;
      await win.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await win.waitForTimeout(3000);
      const det = await books.observeReader(app, 15000, 1500);
      const ids = await win.evaluate(() => Array.from(document.querySelectorAll('[id]')).map((e) => e.id).filter((x) => /^(pdf|pdf-novo|summary|input-navigate|ExibicaoAtual|divBookMark)/.test(x))).catch(() => []);
      const choices = pearson.detectReaderChoices({ ids });
      const frames = await books.collectFrames(app);
      console.log(`ID=${id} formato=${det.format} failure=${det.failureType || '-'} janelas=${books.allWindows(app).length} frames=${frames.length} selecaoPearson=${choices.recognized ? choices.reason : 'nao'} ids=${JSON.stringify(ids.slice(0, 8))}`);
    }
  } finally {
    await app.close().catch(() => {});
  }
})().catch((e) => { console.error('FATAL', String(e && e.message || e)); process.exit(1); });
