// Validação REAL dos adaptadores Pearson em recursos autenticados do AVA.
// Imprime APENAS metadados de status/contagens — nenhum texto de livro,
// nenhuma URL com code/token/sessão e nenhuma credencial.
const path = require('path');
const { _electron } = require('playwright-core');
const books = require('../src/extract/books');

const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('variaveis de ambiente ausentes');
const BASE = 'https://ava.univesp.br';
const CASES = [
  { id: 263475, label: 'Beta/Unidade1', expected: { chapter: 1, chapterKind: 'unidade', book: 'Empreendedorismo' }, preferred: 'beta' },
  { id: 263486, label: 'Classico/Unidade2', expected: { chapter: 2, chapterKind: 'unidade', book: 'Empreendedorismo' }, preferred: 'classic' },
  { id: 292910, label: 'Beta/Intervalo79-110', expected: { chapter: 3, chapterKind: 'unidade', hasPageRange: true, pageRange: { start: 79, end: 110 }, book: 'Empreendedorismo' }, preferred: 'beta' },
  { id: 263475, label: 'Fallback-controlado/Beta-bloqueado', expected: { chapter: 1, chapterKind: 'unidade', book: 'Empreendedorismo' }, preferred: 'beta', blockBeta: true },
].filter((c) => !process.argv[2] || c.label.includes(process.argv[2]));

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
    const baseline = new Set(books.allWindows(app));
    for (const c of CASES) {
      const url = `${BASE}/mod/lti/launch.php?id=${c.id}&triggerview=0`;
      await win.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await win.waitForTimeout(3000);
      const before = books.allWindows(app).length;
      // Falha CONTROLADA do Beta: a seleção retorna false; o fallback real
      // Clássico é exercitado em janelas reais, sem tocar no DOM do leitor.
      const originalEvaluate = win.evaluate.bind(win);
      if (c.blockBeta) {
        win.evaluate = (fn, arg) => {
          if (arg === 'beta' && String(fn).includes('pdf-novo')) return Promise.resolve(false);
          return originalEvaluate(fn, arg);
        };
      }
      let r;
      try {
        r = await books.tryPearsonAutomation({ app, win, expected: c.expected, opts: { preferred: c.preferred, pearsonMaxPages: 30, attempts: [] } });
      } finally {
        win.evaluate = originalEvaluate;
      }
      const after = books.allWindows(app).length;
      const summary = r ? {
        ok: r.ok, status: r.status, failure: r.failureType || null, reader: r.reader || null,
        pages: r.pagesExtracted || 0, chars: r.chars || 0, located: r.chapterLocated === true,
        stopped: r.stoppedBy || null, boundaryKnown: r.boundaryKnown === null || r.boundaryKnown === undefined ? null : r.boundaryKnown,
      } : null;
      console.log(`CASO ${c.label}: janelas antes=${before} depois=${after} resultado=${JSON.stringify(summary)}`);
      if (r && r.attempts) console.log(`  tentativas=${JSON.stringify(r.attempts.filter((a) => /localizar|fronteira=|paginas-extraidas|fallback|janela|navegacao|selecionar/.test(a)))}`);
    }
    // Fecha somente janelas abertas por esta validação (baseline preservado).
    const opened = books.allWindows(app).filter((w) => !baseline.has(w));
    console.log(`JANELAS_ABERTAS_PELA_VALIDACAO=${opened.length}`);
  } finally {
    await app.close().catch(() => {});
  }
})().catch((e) => { console.error('FATAL', String(e && e.message || e)); process.exit(1); });
