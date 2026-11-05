const fs = require('fs');
const path = require('path');
const { _electron } = require('playwright-core');
const { extractBook } = require('../src/extract/books');

// Diagnóstico do Módulo 3 — discrepância Hisrich (pageid).
// Extrai o Cap. 1 do Hisrich (ADM270 S1, id 263477) com trace sanitizado
// (sha256 + contagens + fragmentos <= 40 chars) para explicar a diferença
// entre execuções (365.625 chars históricos × 104.066 atuais) e validar a
// deduplicação, a sequência de páginas impressas e a cobertura do capítulo.
// O texto integral NUNCA é gravado em arquivos versionados; apenas hashes,
// contagens e fragmentos não substanciais.

const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('Defina UNIVESP_USERNAME e UNIVESP_PASSWORD.');

const AUDIT_TEMP = path.join(__dirname, '..', 'audit-temp');
const LOCAL_TMP = path.join(__dirname, 'evidence', 'module3', 'tmp');
const LAUNCH_URL = 'https://ava.univesp.br/mod/lti/launch.php?id=263477&triggerview=0';
const EXPECTED = { book: 'Empreendedorismo', chapter: 1 };

(async () => {
  fs.mkdirSync(AUDIT_TEMP, { recursive: true });
  fs.mkdirSync(LOCAL_TMP, { recursive: true });
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
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const u = win.url();
    if (u.includes('ava.univesp.br') && !u.includes('/login/') && !u.includes('saml') && !u.includes('login_hint')) {
      const logged = await win.evaluate(() => !document.querySelector('form[name="f"]')).catch(() => false);
      if (logged) { loginOk = true; break; }
    }
    await win.waitForTimeout(1500);
  }
  if (!loginOk) throw new Error('Login não concluído');
  console.log('LOGIN ok');

  const trace = [];
  const started = Date.now();
  const book = await extractBook({ app, win, launchUrl: LAUNCH_URL, expected: EXPECTED, opts: { maxPages: 100, trace } });
  book.elapsedMs = Date.now() - started;

  // Texto integral apenas LOCAL (gitignored) para análise interna de parágrafos.
  if (book.text && book.text.trim()) {
    fs.writeFileSync(path.join(LOCAL_TMP, 'hisrich-diag.txt'), book.text);
  }
  delete book.text; // nunca gravar texto integral no relatório sanitizado

  const out = { ts: new Date().toISOString(), book: sanitize(book), trace };
  fs.writeFileSync(path.join(AUDIT_TEMP, 'HISRICH_TRACE.json'), JSON.stringify(out, null, 2));
  console.log('Trace salvo em audit-temp/HISRICH_TRACE.json');
  await app.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

function sanitize(b) {
  const out = JSON.parse(JSON.stringify(b));
  out.text = undefined;
  out.textSample = undefined;
  // Remover fragmentos de repetição (podem conter trechos de conteúdo protegido).
  if (out.validation && Array.isArray(out.validation.repetitions)) {
    out.validation.repetitions = out.validation.repetitions.map((r) => ({ length: r.length, count: r.count }));
  }
  return out;
}
