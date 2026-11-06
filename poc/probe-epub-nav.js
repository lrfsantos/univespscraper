const fs = require('fs');
const path = require('path');
const { _electron } = require('playwright-core');
const books = require('../src/extract/books');

const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('Defina UNIVESP_USERNAME e UNIVESP_PASSWORD.');

(async () => {
  const browserEntry = path.join(__dirname, '..', 'electron', 'browser.js');
  const electronPath = require('electron');
  const executablePath = typeof electronPath === 'string' ? electronPath : process.execPath;
  const app = await _electron.launch({ args: [browserEntry], executablePath });
  const win = await app.firstWindow();
  await win.waitForSelector('body', { timeout: 30000 });
  await win.goto('https://ava.univesp.br/custom/univesp_saml.php?wantsurl=' + encodeURIComponent('https://ava.univesp.br/') + '&login_hint=' + encodeURIComponent(USERNAME), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await win.waitForSelector('form[name="f"]', { timeout: 30000 });
  await win.fill('input#password', PASSWORD);
  await Promise.all([
    win.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}),
    win.click('button[type="submit"]'),
  ]);
  let loginOk = false;
  const dl = Date.now() + 120000;
  while (Date.now() < dl) {
    const u = win.url();
    if (u.includes('ava.univesp.br') && !u.includes('/login/') && !u.includes('saml') && !u.includes('login_hint')) {
      const logged = await win.evaluate(() => !document.querySelector('form[name="f"]')).catch(() => false);
      if (logged) { loginOk = true; break; }
    }
    await win.waitForTimeout(1500);
  }
  if (!loginOk) throw new Error('Login não concluído');

  await win.goto('https://ava.univesp.br/mod/lti/launch.php?id=263476&triggerview=0', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await win.waitForTimeout(18000);

  const dump = async (label) => {
    const d = await books.readEpubActiveDocument(app);
    console.log(`[${label}] url=${d.url.slice(0, 140)}`);
    console.log(`[${label}] doc=${d.doc} idref=${d.idref} len=${(d.text || '').length}`);
    console.log(`[${label}] head=${JSON.stringify((d.text || '').slice(0, 90))}`);
  };

  await dump('antes');

  // Tenta buscar o OPF (spine real) via fetch no contexto do frame (mesma origem).
  const base = 'https://jigsaw.minhabiblioteca.com.br/books/9788597028089/epub/OEBPS/';
  const candidates = ['content.opf', 'package.opf', 'content.xhtml', 'toc.ncx'];
  for (const c of candidates) {
    const url = base + c;
    try {
      const result = await win.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) return { ok: false, status: r.status };
        const t = await r.text();
        return { ok: true, status: r.status, len: t.length, hasSpine: /<spine/.test(t), hasManifest: /<manifest/.test(t), head: t.slice(0, 60) };
      }, url);
      console.log('OPF probe', c, JSON.stringify(result));
    } catch (e) {
      console.log('OPF probe', c, 'erro', e.message);
    }
  }

  // tenta navegar para capítulo 2 via TOC
  const clicked = await books.navigateEpubViaToc(app, 2);
  console.log('navigateEpubViaToc(2) clicked:', clicked);
  await win.waitForTimeout(8000);
  await dump('apos-click-c2');

  await app.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
