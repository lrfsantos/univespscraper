const fs = require('fs');
const path = require('path');
const os = require('os');
const { _electron } = require('playwright-core');
const { extractPage } = require('../src/extract/pages');

// Teste do Módulo 1 — Páginas HTML e conteúdo textual do AVA (Etapa 3).
// Lança o app Electron (um único Chromium), faz login automático e extrai as
// páginas da Semana 1 do ADM270, registrando status de fidelidade por recurso.

const OUT = path.join(__dirname, 'evidence', 'module1');
// Credenciais NUNCA versionadas: vêm do ambiente (testes automatizados autorizados).
const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('Defina UNIVESP_USERNAME e UNIVESP_PASSWORD para rodar o teste do Módulo 1.');

// Páginas de texto da Semana 1 (mod/page) + uma página LTI (leitor) p/ comparação.
const PAGES = [
  { key: 'inicio', title: 'S1 - Início', url: 'https://ava.univesp.br/mod/page/view.php?id=263473' },
  { key: 'videoaulas', title: 'S1 - Videoaulas', url: 'https://ava.univesp.br/mod/page/view.php?id=263474' },
  { key: 'aprofundando', title: 'S1 - Aprofundando o tema', url: 'https://ava.univesp.br/mod/page/view.php?id=263481' },
  { key: 'sintese', title: 'S1 - Em síntese', url: 'https://ava.univesp.br/mod/page/view.php?id=263482' },
];

function log(ev, data) {
  const line = `[${new Date().toISOString()}] ${ev} ${data ? JSON.stringify(data) : ''}`;
  fs.appendFileSync(path.join(OUT, 'run.log'), line + '\n');
  console.log(line);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const result = { test: 'module1', status: 'PENDING', pages: [] };

  const browserEntry = path.join(__dirname, '..', 'electron', 'browser.js');
  // Em dev (node), o executável do Electron fica em node_modules; em pacote, é process.execPath.
  const electronPath = require('electron');
  const executablePath = typeof electronPath === 'string' ? electronPath : process.execPath;
  let app = null;
  try {
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

    // Extrai cada página
    for (const p of PAGES) {
      log('EXTRACT', { key: p.key, url: p.url });
      const page = await extractPage(win, p.url);
      page.key = p.key;
      page.label = p.title;
      result.pages.push(page);
      log('PAGE', { key: p.key, status: page.status, textLen: page.text.length, http: page.httpStatus });

      // Grava texto extraído como evidência
      const safe = p.key;
      fs.writeFileSync(path.join(OUT, `${safe}.txt`), page.text);
    }

    // Resumo
    result.status = 'ok';
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

  console.log('\n=== RESULTADO MÓDULO 1 ===');
  console.log('Status:', result.status);
  for (const p of result.pages) {
    console.log(`  - ${p.key} [${p.status}] texto=${p.text.length} chars http=${p.httpStatus}`);
    if (p.resources) {
      console.log(`      pdfs=${p.resources.pdfs.length} videos=${p.resources.videos.length} links=${p.links.length} iframes=${p.iframes.length}`);
    }
  }
  console.log('Elapsed:', (result.elapsedMs / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
