// Inventário SOMENTE LEITURA de recursos de livro disponíveis na conta real.
// Credenciais vêm de UNIVESP_USERNAME/UNIVESP_PASSWORD (ambiente local).
// Não registra conteúdo de livros, nem parâmetros de URL (code/token/sessão).
const path = require('path');
const { _electron } = require('playwright-core');
const discovery = require('../electron/discovery');

const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('variaveis de ambiente ausentes');
const BASE = 'https://ava.univesp.br';

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

    const coursesHtml = await win.evaluate((url) => fetch(url, { credentials: 'include' }).then((r) => r.text()), BASE + '/my/courses.php');
    const courses = discovery.parseCoursesFromHtml(coursesHtml, BASE).filter((c) => c.available !== false);
    console.log('CURSOS=' + courses.length);
    for (const c of courses.slice(0, 30)) {
      const html = await win.evaluate((url) => fetch(url, { credentials: 'include' }).then((r) => r.text()), c.url);
      const sections = discovery.parseSectionsFromHtml(html);
      const books = [];
      for (const s of sections) {
        const res = discovery.parseResourcesFromSectionHtml(s.block || '', BASE);
        for (const link of res.links) {
          const cls = discovery.classifyResource(link);
          if (cls.kind === 'book') {
            books.push({ id: (String(link.url).match(/[?&]id=(\d+)/) || [])[1] || null, text: String(link.text || '').replace(/\s+/g, ' ').trim().slice(0, 90), sub: cls.subKind });
          }
        }
      }
      if (books.length) {
        console.log(`DISCIPLINA ${c.code || '?'} ${c.title.slice(0, 45)} | livros=${books.length}`);
        for (const b of books) console.log(`  id=${b.id} sub=${b.sub} texto=${JSON.stringify(b.text)}`);
      }
    }
  } finally {
    await app.close().catch(() => {});
  }
})().catch((e) => { console.error('FATAL', String(e && e.message || e)); process.exit(1); });
