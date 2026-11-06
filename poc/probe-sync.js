const path = require('path');
const { _electron } = require('playwright-core');
const crypto = require('crypto');
const books = require('../src/extract/books');

const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('Defina UNIVESP_USERNAME e UNIVESP_PASSWORD.');

const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex').slice(0, 16);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function dumpPage(app, label) {
  for (const w of books.allWindows(app)) {
    const wu = w.url();
    const pageid = (wu.match(/pageid\/(\d+)/) || [])[1] || null;
    let printed = null;
    try {
      printed = await w.evaluate(() => {
        const t = document.body ? document.body.innerText : '';
        const mm = t.match(/P[áa]gina\s+(\d+)\s*\/\s*(\d+)/) || t.match(/P[áa]gina\s+(\d+)/);
        return mm ? parseInt(mm[1], 10) : null;
      }).catch(() => null);
    } catch {}
    console.log(`\n[${label}] win.url=${wu.slice(0, 90)} pageid=${pageid} printed=${printed}`);
    for (const f of w.frames()) {
      const fu = f.url();
      let sig = { url: fu.slice(0, 150) };
      try {
        const src = await f.evaluate(() => { const el = window.frameElement; return el ? el.getAttribute('src') : null; }).catch(() => null);
        if (src) sig.src = src.slice(0, 150);
        const t = await f.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
        sig.chars = (t || '').length;
        sig.sha = sha(t);
        sig.head = (t || '').replace(/\s+/g, ' ').trim().slice(0, 45);
      } catch { sig.err = 'ctx'; }
      console.log('  frame:', JSON.stringify(sig));
    }
  }
}

(async () => {
  const electronPath = require('electron');
  const executablePath = typeof electronPath === 'string' ? electronPath : process.execPath;
  const app = await _electron.launch({ args: [path.join(__dirname, '..', 'electron', 'browser.js')], executablePath });
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
  console.log('login ok');

  // ---- PAGEID: Hisrich ----
  await win.goto('https://ava.univesp.br/mod/lti/launch.php?id=263477&triggerview=0', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  // espera conteúdo significativo
  for (let i = 0; i < 20; i++) {
    await wait(5000);
    let content = 0;
    for (const w of books.allWindows(app)) for (const f of w.frames()) {
      try { const t = await f.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => ''); if ((t || '').trim().length > 500) content++; } catch {}
    }
    console.log(`poll ${(i + 1) * 5}s contentFrames=${content}`);
    if (content >= 2) break;
  }
  await dumpPage(app, 'HISRICH-carregado');
  const c1 = await books.clickNextPage(app);
  console.log('clickNextPage:', c1);
  await wait(10000);
  await dumpPage(app, 'HISRICH-apos-next-10s');
  await wait(15000);
  await dumpPage(app, 'HISRICH-apos-next-25s');

  // ---- EPUB: Chiavenato + OPF ----
  await win.goto('https://ava.univesp.br/mod/lti/launch.php?id=263476&triggerview=0', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    await wait(5000);
    const any = books.collectFrames(app).then((fs) => fs.some((f) => /epub\/OEBPS/.test(f.url)));
    console.log(`epub poll ${(i + 1) * 5}s hasEpub=${await any}`);
    if (await any) break;
  }
  await dumpPage(app, 'CHIAVENATO-carregado');
  const frames = await books.collectFrames(app);
  for (const { frame, url } of frames) {
    if (!/epub\/OEBPS\/Text\//i.test(url)) continue;
    const base = url.replace(/\/Text\/[^?#]*.*$/, '/');
    for (const cand of ['content.opf', 'package.opf', 'toc.ncx']) {
      const res = await frame.evaluate(async (u) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) return { ok: false, status: r.status };
          const t = await r.text();
          return { ok: true, status: r.status, len: t.length, spine: /<spine/.test(t), manifest: /<manifest/.test(t), navMap: /navMap/.test(t) };
        } catch (e) { return { ok: false, err: e.message }; }
      }, base + cand).catch(() => ({ ok: false, err: 'eval-failed' }));
      console.log('  OPF', cand, '->', JSON.stringify(res));
    }
  }
  await app.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
