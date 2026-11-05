const fs = require('fs');
const path = require('path');
const os = require('os');
const { _electron } = require('playwright-core');

const DEBUG_LOG = path.join(os.tmpdir(), 'univesp-debug.log');
function dbg(msg) {
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] RUNPOC: ${msg}\n`); } catch {}
}

// Execução da PoC (ADM270, Semana 1) dentro do Electron — UM ÚNICO Chromium.
// O processo principal lança uma instância "browser" do próprio Electron via
// playwright-core._electron, conduz a extração, gera o ZIP e faz a limpeza
// dos temporários em melhor esforço.

const BASE = 'https://ava.univesp.br';
// Credenciais NUNCA são versionadas: vêm de variáveis de ambiente apenas para
// os testes automatizados autorizados. O app final usa login manual.
const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('Defina UNIVESP_USERNAME e UNIVESP_PASSWORD para rodar a PoC automatizada.');
const ADM270 = { code: 'ADM270', name: 'Empreendedorismo e Inovação' };

async function runPoc({ workDir, outputDir, sendStatus, evDir }) {
  const results = { startTime: new Date().toISOString(), phases: [], cleanup: {}, zip: {} };
  fs.mkdirSync(outputDir, { recursive: true });
  const tmpDir = path.join(workDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  let app = null;
  try {
    // Lança a instância browser do mesmo Electron (um único Chromium)
    const browserEntry = path.join(__dirname, 'browser.js');
    const executablePath = process.execPath;
    dbg('launch _electron executablePath=' + executablePath + ' browserEntry=' + browserEntry);
    app = await _electron.launch({ args: [browserEntry], executablePath, env: { ...process.env, UNIVESP_POC: '1' } });
    dbg('_electron launched ok');
    results.phases.push({ name: 'launch-browser', ok: true });
    sendStatus('launch-browser', { ok: true });

    const win = await app.firstWindow();
    await win.waitForSelector('body', { timeout: 30000 });

    // --- Login (automático, autorizado para automação dos testes) ---
    sendStatus('login', { message: 'Realizando login automático...' });
    await win.goto(`${BASE}/custom/univesp_saml.php?wantsurl=${encodeURIComponent(BASE + '/')}&login_hint=${encodeURIComponent(USERNAME)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await win.waitForSelector('form[name="f"]', { timeout: 30000 });
    await win.fill('input#password', PASSWORD);
    await Promise.all([
      win.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}),
      win.click('button[type="submit"]'),
    ]);
    let loginOk = false;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const url = win.url();
      if (url.includes('ava.univesp.br') && !url.includes('/login/') && !url.includes('saml') && !url.includes('login_hint')) {
        const logged = await win.evaluate(() => !document.querySelector('form[name="f"]')).catch(() => false);
        if (logged) { loginOk = true; break; }
      }
      await win.waitForTimeout(1500);
    }
    results.phases.push({ name: 'login', ok: loginOk, url: win.url() });
    sendStatus('login', { ok: loginOk, url: win.url() });
    if (!loginOk) throw new Error('Login automático não concluído.');

    // --- Detectar disciplinas ---
    await win.goto(`${BASE}/my/courses.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await win.waitForTimeout(3000);
    const courses = await win.evaluate(() => {
      const out = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="course/view.php"]').forEach((a) => {
        const text = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text || seen.has(a.href)) return;
        seen.add(a.href);
        out.push({ url: a.href, text });
      });
      return out;
    });
    results.phases.push({ name: 'discover-courses', count: courses.length });
    sendStatus('discover-courses', { count: courses.length });

    // --- Extração da PoC (ADM270 S1) ---
    const week = {};
    sendStatus('page', { id: 'inicio' });
    week.inicio = await extractPageText(win, 'https://ava.univesp.br/mod/page/view.php?id=263473');
    sendStatus('page', { id: 'videoaulas' });
    week.videoaulas = await extractPageText(win, 'https://ava.univesp.br/mod/page/view.php?id=263474');

    // Livro Chiavenato (epub) via janela do Electron
    sendStatus('book', { id: 263476, format: 'epub' });
    week.readingChiavenato = await extractBookFromWindow(app, win, 'https://ava.univesp.br/mod/lti/launch.php?id=263476&triggerview=0');

    // PDF slides (v1)
    sendStatus('pdf', { id: 's1_slides_videoaula1' });
    week.slides1 = await downloadPdfInWindow(app, 'https://assets.univesp.br/disciplinas/ADM270/pdf/s1_slides_videoaula1.pdf', path.join(tmpDir, 'slides1.pdf'));

    // --- Grava saída ---
    const subjectDir = path.join(outputDir, 'ADM270');
    fs.mkdirSync(path.join(subjectDir, 'WEEK_01', 'videos'), { recursive: true });
    fs.mkdirSync(path.join(subjectDir, 'WEEK_01', 'readings'), { recursive: true });
    fs.mkdirSync(path.join(subjectDir, 'WEEK_01', 'supplementary'), { recursive: true });

    fs.writeFileSync(path.join(subjectDir, 'WEEK_01', 'WEEK_01.md'), renderWeek(week));
    fs.writeFileSync(path.join(subjectDir, 'WEEK_01', 'videos', 'VIDEO_01.md'), renderVideos(week.videoaulas));
    if (week.readingChiavenato.ok) fs.writeFileSync(path.join(subjectDir, 'WEEK_01', 'readings', 'READING_01.md'), renderBook(week.readingChiavenato));
    if (week.slides1.ok) {
      fs.writeFileSync(path.join(subjectDir, 'WEEK_01', 'supplementary', 'SLIDES_01.md'), renderPdfMeta(week.slides1));
      try { fs.copyFileSync(week.slides1.file, path.join(subjectDir, 'WEEK_01', 'supplementary', 'SLIDES_01.pdf')); } catch {}
    }
    fs.writeFileSync(path.join(subjectDir, 'INDEX.md'), `# ${ADM270.name} (${ADM270.code})\n\nMateriais da Semana 1.\n`);
    fs.writeFileSync(path.join(subjectDir, 'SOURCES.md'), sourcesMarkdown(week));
    fs.writeFileSync(path.join(subjectDir, 'EXTRACTION_REPORT.md'), reportMarkdown(week));
    fs.writeFileSync(path.join(subjectDir, 'AI_STUDY_INSTRUCTIONS.md'), '# Instruções para a IA de estudo\n\nNenhuma IA foi usada no scraper; este documento apenas instrui a IA escolhida pelo estudante a estudar o conteúdo extraído.\n');

    // --- ZIP ---
    const zipPath = path.join(workDir, 'UNIVESP_ADM270_S1.zip');
    results.zip = await createZip(outputDir, zipPath);
    results.zip.file = zipPath;
    sendStatus('zip', results.zip);

    // Preserva evidências (ZIP + saída) em pasta persistente antes do cleanup
    if (evDir) {
      try {
        fs.mkdirSync(evDir, { recursive: true });
        fs.copyFileSync(zipPath, path.join(evDir, 'UNIVESP_ADM270_S1.zip'));
        fs.cpSync(outputDir, path.join(evDir, 'saida'), { recursive: true });
        results.evidenceCopied = true;
      } catch (e) {
        results.evidenceCopied = false;
        results.evidenceError = e.message;
      }
    }

    results.status = 'ok';
  } catch (e) {
    results.status = 'erro';
    results.error = e.message;
    results.stack = e.stack;
    sendStatus('error', { message: e.message });
  } finally {
    if (app) { try { await app.close(); } catch {} }
    results.cleanup = cleanupBestEffort(workDir);
  }
  results.endTime = new Date().toISOString();
  return results;
}

// --- Renderização de saída ---
function renderWeek(w) { return '# Semana 1\n\n' + (w.inicio && w.inicio.text ? w.inicio.text : '') + '\n\n---\n\n' + (w.videoaulas && w.videoaulas.text ? w.videoaulas.text : '') + '\n'; }
function renderVideos(v) { let s = '# Videoaulas — Semana 1\n\n'; for (const vd of (v && v.videos) || []) s += `- ${vd.title}\n  URL: ${vd.url}\n`; return s; }
function renderBook(b) { return `# Leitura — Chiavenato (Cap 1)\n\nStatus: ${b.ok ? 'extraído' : 'inacessível'}\n\n${b.text || ''}\n`; }
function renderPdfMeta(p) { return `# Slides — Videoaula 1\n\nStatus: ${p.ok ? 'extraído' : 'inacessível'}\nArquivo: SLIDES_01.pdf (${p.bytes} bytes)\n`; }
function sourcesMarkdown(w) {
  const lines = ['# Fontes\n'];
  if (w.inicio) lines.push(`- Página Início: ${w.inicio.url}`);
  if (w.videoaulas) lines.push(`- Página Videoaulas: ${w.videoaulas.url}`);
  if (w.readingChiavenato) lines.push(`- Livro Chiavenato: ${w.readingChiavenato.url} (${w.readingChiavenato.ok ? 'extraído' : w.readingChiavenato.reason})`);
  if (w.slides1) lines.push(`- Slides: ${w.slides1.url}`);
  return lines.join('\n');
}
function reportMarkdown(w) {
  const lines = ['# Relatório de Extração\n'];
  const add = (k, ok, detail) => lines.push(`- ${k}: ${ok ? 'extraído' : detail || 'inacessível'}`);
  add('Início', !!(w.inicio && w.inicio.text));
  add('Videoaulas', !!(w.videoaulas && w.videoaulas.text));
  add('Livro Chiavenato', !!(w.readingChiavenato && w.readingChiavenato.ok), w.readingChiavenato && w.readingChiavenato.reason);
  add('Slides PDF', !!(w.slides1 && w.slides1.ok), w.slides1 && w.slides1.reason);
  return lines.join('\n');
}

// --- Extração ---
async function extractPageText(win, url) {
  await win.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await win.waitForTimeout(2500);
  const text = await win.evaluate(() => {
    const scope = document.querySelector('.ava-scope') || document.querySelector('[role="main"]');
    return scope ? scope.innerText : document.body.innerText;
  });
  const title = await win.title();
  return { url, text, title };
}

// Textos que NÃO são conteúdo real (mensagens de erro/incompatibilidade do leitor).
const NONSENSE_RE =
  /n[ãa]o \u00e9 mais compat[ií]vel|navegador n[ãa]o compat[ií]vel|ver navegadores compat[ií]veis|baixar bookshelf|use um de nossos navegadores|para uma melhor experi[eê]ncia em nosso site/i;

function isMeaningfulBookText(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 100) return false;
  if (NONSENSE_RE.test(t)) return false;
  // O texto deve conter conteúdo acadêmico (palavras/parágrafos), não só a mensagem.
  const meaningfulTokens = (t.match(/[a-zà-ú]{4,}/gi) || []).length;
  if (meaningfulTokens < 20) return false;
  return true;
}

async function extractBookFromWindow(app, win, launchUrl) {
  const res = { ok: false, url: launchUrl };
  try {
    await win.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await win.waitForTimeout(15000);
    // O leitor (Minha Biblioteca) pode abrir numa nova janela do Electron.
    // Usa a API de frames do Playwright (lida com frames cross-origin) e
    // também as demais janelas do app.
    let bestText = '';
    const candidates = [];
    for (const w of app.windows()) {
      candidates.push(w);
    }
    for (const w of candidates) {
      for (const f of w.frames()) {
        try {
          const url = f.url();
          if (!url.includes('app.minhabiblioteca.com.br') && !url.includes('/epub/') && !url.includes('ava.univesp.br')) continue;
          const txt = await f.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
          if (isMeaningfulBookText(txt) && txt.length > bestText.length) bestText = txt;
        } catch { /* ignore */ }
      }
      const body = await w.evaluate(() => {
        const scope = document.querySelector('.ava-scope') || document.querySelector('[role="main"]');
        return scope ? scope.innerText : document.body.innerText;
      }).catch(() => '');
      if (isMeaningfulBookText(body) && body.length > bestText.length) bestText = body;
    }
    if (isMeaningfulBookText(bestText)) {
      res.ok = true;
      res.text = bestText;
      res.source = 'electron';
    } else {
      res.reason = 'sem-texto-ou-navegador-incompativel';
      res.rawSample = (bestText || '').slice(0, 200);
    }
  } catch (e) {
    res.reason = e.message;
  }
  return res;
}

async function downloadPdfInWindow(app, url, filePath) {
  const res = { ok: false, url, file: filePath };
  try {
    // O run-poc roda no processo principal do Electron: usa net diretamente.
    const { net } = require('electron');
    const base64 = await new Promise((resolve, reject) => {
      const req = net.request(url);
      const chunks = [];
      req.on('response', (resp) => {
        if (resp.statusCode !== 200) { reject(new Error('HTTP ' + resp.statusCode)); return; }
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      });
      req.on('error', reject);
      req.end();
    });
    if (!base64) { res.reason = 'sem-dados'; return res; }
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buf);
    res.ok = true;
    res.bytes = buf.length;
  } catch (e) {
    res.reason = e.message;
  }
  return res;
}

// --- ZIP (sem dependência externa; usa .NET do Windows) ---
function createZip(srcDir, destZip) {
  return new Promise((resolve) => {
    try {
      if (fs.existsSync(destZip)) fs.rmSync(destZip, { force: true });
      const { execFileSync } = require('child_process');
      const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${srcDir.replace(/'/g, "''")}', '${destZip.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 120000, stdio: 'pipe' });
      const size = fs.statSync(destZip).size;
      const count = countFiles(srcDir);
      resolve({ ok: true, bytes: size, files: count, path: destZip });
    } catch (e) {
      resolve({ ok: false, reason: e.message });
    }
  });
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

function cleanupBestEffort(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); return { ok: true, removed: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
}

module.exports = { runPoc };
