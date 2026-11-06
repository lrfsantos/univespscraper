const path = require('path');
const { _electron } = require('playwright-core');
const books = require('../src/extract/books');

const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('Defina UNIVESP_USERNAME e UNIVESP_PASSWORD.');

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

  for (const id of [263476]) {
    const launchUrl = `https://ava.univesp.br/mod/lti/launch.php?id=${id}&triggerview=0`;
    await win.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    for (let t = 0; t < 12; t++) {
      await win.waitForTimeout(5000);
      const frames = await books.collectFrames(app);
      const contentUrls = frames.filter((f) => /(epub\/OEBPS\/Text\/|pages\/\d+\/content)/.test(f.url)).length;
      const title = await win.title().catch(() => '');
      let body = '';
      try { body = (await win.evaluate(() => document.body ? document.body.innerText.slice(0, 160) : '')).replace(/\s+/g, ' ').trim(); } catch { /* ignore */ }
      console.log(`t=${(t + 1) * 5}s win.url=${win.url().slice(0, 80)} | frames=${frames.length} contentUrls=${contentUrls} | title=${title} | body=${JSON.stringify(body)}`);
      if (contentUrls > 0) break;
    }
    const det = await books.detectFormat(app, win, launchUrl);
    console.log('detectFormat:', JSON.stringify(det));
  }
  await app.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
