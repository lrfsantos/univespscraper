const fs = require('fs');
const path = require('path');
const { _electron } = require('playwright-core');
const { extractBook } = require('../src/extract/books');

// Teste do Módulo 3 — Livros digitais / Minha Biblioteca (Etapa 3).
// Lança o app Electron (um único Chromium), faz login automático e extrai os
// três textos-base LTI da Semana 1 do ADM270, com validação de fidelidade:
//   id=263475 Fabrete "Empreendedorismo" (bvpdf/canvas — inacessível esperado)
//   id=263476 Chiavenato "dando asas" Cap 1 (Minha Biblioteca — epub)
//   id=263477 Hisrich "Empreendedorismo" Cap 1 (Minha Biblioteca — pageid)

// Credenciais NUNCA versionadas: vêm do ambiente (testes automatizados autorizados).
const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('Defina UNIVESP_USERNAME e UNIVESP_PASSWORD para rodar o teste do Módulo 3.');

const OUT = path.join(__dirname, 'evidence', 'module3');
const TMP = path.join(OUT, 'tmp');

const READINGS = [
  {
    key: 'fabrete', id: 263475,
    title: 'Texto-base - Empreendedorismo (Unidade 1) | Teresa Cristina Lopes Fabrete',
    expected: { book: 'Empreendedorismo', chapter: 1 },
    launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=263475&triggerview=0',
    expectInaccessible: true,
  },
  {
    key: 'chiavenato', id: 263476,
    title: 'Texto-base - Empreendedorismo: dando asas ao espírito empreendedor (Leia o Capítulo 1) | Idalberto Chiavenato',
    expected: { book: 'Empreendedorismo', chapter: 1 },
    launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=263476&triggerview=0',
    expectInaccessible: false,
  },
  {
    key: 'hisrich', id: 263477,
    title: 'Texto-base - Empreendedorismo (leia o capítulo 1) | Robert D. Hisrich',
    expected: { book: 'Empreendedorismo', chapter: 1 },
    launchUrl: 'https://ava.univesp.br/mod/lti/launch.php?id=263477&triggerview=0',
    expectInaccessible: false,
  },
];

function log(ev, data) {
  const line = `[${new Date().toISOString()}] ${ev} ${data ? JSON.stringify(data) : ''}`;
  try { fs.appendFileSync(path.join(OUT, 'run.log'), line + '\n'); } catch {}
  console.log(line);
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const started = Date.now();
  const result = { test: 'module3', status: 'PENDING', books: [], approval: [] };

  const browserEntry = path.join(__dirname, '..', 'electron', 'browser.js');
  const electronPath = require('electron');
  const executablePath = typeof electronPath === 'string' ? electronPath : process.execPath;
  let app = null;
  try {
    // Perfil TEMPORÁRIO e isolado por execução (requisito do projeto — o leitor
    // VitalSource invalida a sessão quando detecta novo dispositivo, mas a decisão
    // de reutilizar perfil persistente com cookies foi REVOGADA: .gitignore não
    // substitui o requisito de isolamento). Sem userDataDir = perfil efêmero.
    app = await _electron.launch({ args: [browserEntry], executablePath });
    log('LAUNCH', { ok: true });
    const win = await app.firstWindow();
    await win.waitForSelector('body', { timeout: 30000 });

    // Login automático
    log('LOGIN', { credentialsProvided: true });
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
    log('LOGIN-RESULT', { ok: loginOk, url: win.url() });
    if (!loginOk) throw new Error('Login não concluído');

    for (const r of READINGS) {
      log('PROCESS', { key: r.key, id: r.id });
      const startedBook = Date.now();
      const book = await extractBook({ app, win, launchUrl: r.launchUrl, expected: r.expected, opts: { maxPages: 100 } });
      book.key = r.key;
      book.id = r.id;
      book.title = r.title;
      book.expected = r.expected;
      book.expectInaccessible = r.expectInaccessible;
      book.elapsedMs = Date.now() - startedBook;
      book.textSample = book.text ? book.text.slice(0, 400) : '';
      result.books.push(book);
      log('EXTRACT', {
        key: r.key, format: book.format, status: book.status, chars: book.chars,
        source: book.source, warnings: book.validation && book.validation.warnings,
        chapterOk: book.validation && book.validation.chapterOk, elapsedMs: book.elapsedMs,
      });

      // Evidência de texto (somente se houver conteúdo real extraído)
      if (book.text && book.text.trim().length > 0) {
        fs.writeFileSync(path.join(TMP, `${r.key}.txt`), book.text);
      }
    }

    // Critérios independentes (Issue C): integridade exige evidência, não presença.
    const { evaluateCriteria } = require('./lib/m3-criteria');
    const evalRes = evaluateCriteria(result.books);
    result.approval = Object.entries(evalRes.crit).map(([k, v]) => ({ criterion: k, met: v }));
    result.status = evalRes.passed ? 'PASS' : 'FAIL';
  } catch (e) {
    result.status = 'erro';
    result.error = e.message;
    result.stack = e.stack;
    log('ERROR', { message: e.message });
  } finally {
    if (app) { try { await app.close(); } catch {} }
  }

  result.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));

  console.log('\n=== RESULTADO MÓDULO 3 ===');
  console.log('Status:', result.status);
  for (const b of result.books) {
    console.log(`  - ${b.key} [${b.format}] status=${b.status} chars=${b.chars} source=${b.source} err=${b.error || ''}`);
    if (b.validation) console.log(`      warnings=${JSON.stringify(b.validation.warnings)} chapterOk=${b.validation.chapterOk} rep=${b.validation.repetitions.length}`);
  }
  for (const c of result.approval) console.log(`  * ${c.criterion}: ${c.met ? 'PASSOU' : 'FALHOU'}`);
  console.log('Elapsed:', (result.elapsedMs / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
