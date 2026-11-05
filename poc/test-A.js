const fs = require('fs');
const path = require('path');
const { openPersistentContext, manualLogin, checkProfileForCredentials, cleanupProfile } = require('./lib/session');

// Teste A — Autenticação e navegação (ADM270, Semana 1)
// Critérios (aprovados):
//   - sessão utilizável durante automação
//   - lista de disciplinas e semanas detectada sem erro
//   - credenciais não persistem em disco
//   - cookies/tokens ficam apenas no perfil temporário de %TEMP%
//   - perfil não salva senha nem usa preenchimento automático

const OUT = path.join(__dirname, 'evidence', 'test-A');
// Credenciais NUNCA versionadas: vêm do ambiente (login manual/autorizado nos testes).
const USERNAME = process.env.UNIVESP_USERNAME;
if (!USERNAME) throw new Error('Defina UNIVESP_USERNAME para rodar o Teste A.');

function log(ev, data) {
  const line = `[${new Date().toISOString()}] ${ev} ${data ? JSON.stringify(data) : ''}`;
  fs.appendFileSync(path.join(OUT, 'run.log'), line + '\n');
  console.log(line);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const result = { test: 'A', status: 'PENDING', steps: [], approval: [] };

  const { userDataDir, context } = await openPersistentContext({ label: 'A' });
  result.steps.push({ step: 'open-profile', userDataDir });
  log('PROFILE', { userDataDir });

  // --- Login manual ---
  const login = await manualLogin(context, { username: USERNAME, timeoutMs: 300000 });
  result.steps.push({ step: 'login', ...login });
  log('LOGIN', { ok: login.ok, url: login.url });
  if (!login.ok) {
    result.status = 'FAIL';
    result.error = login.reason;
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
    await context.close();
    return;
  }

  // --- Detectar disciplinas: explorar múltiplas URLs candidatas ---
  const candidateUrls = [
    'https://ava.univesp.br/admin/tool/custompage/view.php?id=3',
    'https://ava.univesp.br/my/',
    'https://ava.univesp.br/',
    'https://ava.univesp.br/my/courses.php',
  ];
  let courses = [];
  let courseProbe = [];
  for (const url of candidateUrls) {
    try {
      const page = context.pages()[0];
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      const probe = await page.evaluate((u) => {
        const out = [];
        const seen = new Set();
        document.querySelectorAll('a[href*="course/view.php"]').forEach((a) => {
          const href = a.href;
          const text = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
          if (!text || seen.has(href)) return;
          seen.add(href);
          out.push({ url: href, text });
        });
        return { finalUrl: location.href, courseLinks: out, bodyPreview: document.body.innerText.slice(0, 400) };
      }, url);
      probe.url = url;
      courseProbe.push(probe);
      log('COURSE-PROBE', { url, finalUrl: probe.finalUrl, links: probe.courseLinks.length, body: probe.bodyPreview.slice(0, 120) });
      if (!courses.length && probe.courseLinks.length) courses = probe.courseLinks;
    } catch (e) {
      log('COURSE-PROBE-ERR', { url, error: e.message });
    }
  }
  result.steps.push({ step: 'discover-courses', count: courses.length, probes: courseProbe.map((p) => ({ url: p.url, finalUrl: p.finalUrl, links: p.courseLinks.length })) });
  log('COURSES', { count: courses.length, courses });

  // --- Detectar semanas do ADM270 ---
  const adm270 = courses.find((c) => /ADM270|Empreendedorismo/i.test(c.text));
  let weeks = [];
  let weekSections = [];
  if (adm270) {
    try {
      const page = context.pages()[0];
      await page.goto(adm270.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      // Seções (semanas) via data-sectionname + mod links
      weekSections = await page.evaluate(() => {
        const out = [];
        const seen = new Set();
        document.querySelectorAll('[data-sectionname]').forEach((s) => {
          const name = s.getAttribute('data-sectionname');
          if (!name || seen.has(name)) return;
          seen.add(name);
          out.push({ name });
        });
        return out;
      });
      weeks = await page.evaluate(() => {
        const out = [];
        const seen = new Set();
        document.querySelectorAll('a[href*="/mod/"]').forEach((a) => {
          const t = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
          if (!t || seen.has(a.href)) return;
          seen.add(a.href);
          out.push({ title: t, url: a.href });
        });
        return out;
      });
      result.steps.push({ step: 'discover-weeks', course: adm270.text, sections: weekSections.length, modLinks: weeks.length });
      log('WEEKS', { course: adm270.text, sections: weekSections.length, modLinks: weeks.length });
    } catch (e) {
      result.steps.push({ step: 'discover-weeks', error: e.message });
      log('WEEKS-ERR', e.message);
    }
  }

  // --- Verificar perfil sem credenciais/autofill ---
  // Fecha o contexto ANTES de ler o Login Data (evita "database is locked") e de limpar.
  await context.close();
  const profileCheck = await checkProfileForCredentials(userDataDir);
  result.steps.push({ step: 'profile-check', ...profileCheck });
  log('PROFILE-CHECK', profileCheck);

  // --- Cleanup (melhor esforço) ---
  const cleaned = cleanupProfile(userDataDir);
  result.steps.push({ step: 'cleanup', ...cleaned });
  log('CLEANUP', cleaned);

  // --- Avaliação ---
  const elapsedMs = Date.now() - started;
  const crit = {};
  crit.sessionUsable = login.ok;
  crit.coursesDetected = courses.length > 0;
  crit.weeksDetected = weekSections.length > 0;
  crit.noCredsPersisted = profileCheck.savedPasswords === 0;
  crit.profileNoAutofill = profileCheck.autofillPrefs === false;

  result.approval = Object.entries(crit).map(([k, v]) => ({ criterion: k, met: v }));
  result.status = Object.values(crit).every(Boolean) ? 'PASS' : 'FAIL';
  result.elapsedMs = elapsedMs;
  result.summary = {
    courses: courses.map((c) => c.text),
    weeksCount: weeks.length,
    weekTitles: weeks.slice(0, 20).map((w) => w.title),
  };

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log('\n=== RESULTADO TESTE A ===');
  console.log('Status:', result.status);
  for (const c of result.approval) console.log(`  - ${c.criterion}: ${c.met ? 'PASSOU' : 'FALHOU'}`);
  console.log('Elapsed:', (result.elapsedMs / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
