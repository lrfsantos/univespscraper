// Sonda sanitizada do leitor Beta real: apenas ids, números de página e
// contagens. Nenhum texto de livro, URL com code/token ou credencial.
const path = require('path');
const { _electron } = require('playwright-core');
const books = require('../src/extract/books');
const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('variaveis de ambiente ausentes');
const BASE = 'https://ava.univesp.br';

async function login(win) {
  await win.goto(`${BASE}/custom/univesp_saml.php?wantsurl=${encodeURIComponent(BASE + '/')}&login_hint=${encodeURIComponent(USERNAME)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await win.waitForSelector('form[name="f"]', { timeout: 30000 });
  await win.fill('input#password', PASSWORD);
  await Promise.all([win.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}), win.click('button[type="submit"]')]);
  const dl = Date.now() + 120000;
  while (Date.now() < dl) {
    const u = win.url();
    if (u.includes('ava.univesp.br') && !/login|saml/.test(u) && await win.evaluate(() => !document.querySelector('form[name="f"]')).catch(() => false)) return true;
    await win.waitForTimeout(1500);
  }
  return false;
}

const snapshot = (win) => win.evaluate(() => {
  const inp = document.querySelector('input#input-navigate-read, input[type="number"]');
  const ex = document.getElementById('ExibicaoAtual');
  const items = Array.from(document.querySelectorAll('button[id^="summary-item-"]'));
  return {
    input: inp ? inp.value : null,
    shown: ex ? (ex.textContent || '').replace(/\D+/g, '') : null,
    itens: items.length,
    ids: Array.from(document.querySelectorAll('[id]')).map((e) => e.id).filter((x) => /^(pdf|pdf-novo|summary|input-navigate|ExibicaoAtual|divBookMark|page-canvas)/.test(x)).slice(0, 12),
    imgs: document.querySelectorAll('img[class^="PdfImageView_pageImage"]').length,
  };
}).catch(() => null);

(async () => {
  const electronPath = require('electron');
  const app = await _electron.launch({ args: [path.join(__dirname, '..', 'electron', 'browser.js')], executablePath: typeof electronPath === 'string' ? electronPath : process.execPath });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('body', { timeout: 30000 });
    if (!(await login(win))) throw new Error('login-nao-concluido');
    await win.goto(`${BASE}/mod/lti/launch.php?id=263475&triggerview=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await win.waitForTimeout(3000);
    console.log('SELECAO=' + JSON.stringify(await snapshot(win)));
    console.log('JANELAS=' + books.allWindows(app).length);
    await win.evaluate(() => { const b = document.getElementById('pdf-novo'); if (b) b.click(); });
    for (const ms of [2000, 4000, 8000]) {
      await win.waitForTimeout(ms);
      console.log(`apos ${ms}ms=${JSON.stringify(await snapshot(win))} janelas=${books.allWindows(app).length} url=${books.sanitizeUrlForReport(win.url())}`);
    }
    const frames = await books.collectFrames(app);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const st = await f.frame.evaluate(() => {
        const inp = document.querySelector('input#input-navigate-read, input[type="number"]');
        const ex = document.getElementById('ExibicaoAtual');
        const items = Array.from(document.querySelectorAll('button[id^="summary-item-"]'));
        return { input: inp ? inp.value : null, shown: ex ? (ex.textContent || '').replace(/\D+/g, '') : null, itens: items.length, ids: Array.from(document.querySelectorAll('[id]')).map((e) => e.id).filter((x) => /^(pdf|summary|input-navigate|ExibicaoAtual|divBookMark|page-canvas|btn-sumario)/.test(x)).slice(0, 12), imgs: document.querySelectorAll('img[class^="PdfImageView_pageImage"]').length };
      }).catch(() => null);
      console.log(`FRAME ${i} url=${books.sanitizeUrlForReport(f.url)} snap=${JSON.stringify(st)}`);
      const shape = await f.frame.evaluate(() => ({
        ready: document.readyState,
        buttons: document.querySelectorAll('button').length,
        inputs: document.querySelectorAll('input').length,
        imgs: document.querySelectorAll('img').length,
        iframes: document.querySelectorAll('iframe').length,
        classes: Array.from(new Set(Array.from(document.querySelectorAll('button, input, img')).map((e) => String(e.className || '').split(' ')[0]).filter(Boolean))).slice(0, 15),
        bodyLen: document.body ? document.body.innerText.length : 0,
        blocked: /browser not supported|n[ãa]o compat[ií]vel|acesso negado|erro ao carregar/i.test(document.body ? document.body.innerText.slice(0, 3000) : ''),
      })).catch(() => null);
      console.log(`  shape=${JSON.stringify(shape)}`);
    }
    for (const n of [0, 1]) {
      const clicked = await win.evaluate((i) => { const b = document.getElementById('summary-item-' + i); if (!b) return false; b.click(); return true; }, n).catch(() => false);
      console.log(`clique sumario-${n}=${clicked}`);
      for (const ms of [1000, 3000]) {
        await win.waitForTimeout(ms);
        console.log(`  apos ${ms}ms=${JSON.stringify(await snapshot(win))}`);
      }
    }
  } finally {
    await app.close().catch(() => {});
  }
})().catch((e) => { console.error('FATAL', String(e && e.message || e)); process.exit(1); });
