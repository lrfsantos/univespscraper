const path = require('path');
const { _electron } = require('playwright-core');
const discovery = require('../electron/discovery');
const U = process.env.UNIVESP_USERNAME, P = process.env.UNIVESP_PASSWORD;
if (!U || !P) throw new Error('sem credenciais');
const B = 'https://ava.univesp.br';
const ID = process.argv[2] || '18554';
(async () => {
  const ep = require('electron');
  const app = await _electron.launch({ args: [path.join(__dirname, '..', 'electron', 'browser.js')], executablePath: typeof ep === 'string' ? ep : process.execPath });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('body', { timeout: 30000 });
    await win.goto(`${B}/custom/univesp_saml.php?wantsurl=${encodeURIComponent(B + '/')}&login_hint=${encodeURIComponent(U)}`, { waitUntil: 'domcontentloaded' });
    await win.waitForSelector('form[name="f"]', { timeout: 30000 });
    await win.fill('input#password', P);
    await Promise.all([win.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}), win.click('button[type="submit"]')]);
    await win.waitForTimeout(5000);
    await win.goto(`${B}/course/view.php?id=${ID}`, { waitUntil: 'domcontentloaded' });
    await win.waitForTimeout(2500);
    console.log('URL=' + win.url());
    const html = await win.evaluate(() => document.documentElement.outerHTML);
    const secs = discovery.parseSectionsFromHtml(html);
    console.log('SECOES=' + secs.length);
    const s = secs.find((x) => x.relevant);
    const res = discovery.parseResourcesFromSectionHtml(s ? s.block : '', B);
    console.log('SECAO=' + (s && s.id) + ' LINKS=' + res.links.length);
    for (const l of res.links.slice(0, 6)) {
      const id = (String(l.url).match(/[?&]id=(\d+)/) || [])[1];
      const cnt = await win.locator(`a[href*="id=${id}"]:not(.courseindex-link):not(.courseindex-chevron)`).count().catch(() => 0);
      console.log(`id=${id} texto=${JSON.stringify(String(l.text).slice(0, 28))} href=${String(l.url).slice(0, 80)} local=${cnt}`);
    }
  } finally { await app.close().catch(() => {}); }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
