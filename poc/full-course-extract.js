// Extração COMPLETA de uma disciplina, navegando pela UI real do AVA autenticado.
// Uso: node poc/full-course-extract.js <courseId> [<courseId> ...]
// Saída: <Desktop>\univesp\<CODIGO>\ ... (pasta criada se necessário).
// Credenciais vêm de UNIVESP_USERNAME/UNIVESP_PASSWORD (ambiente local).
// Nunca registra senhas, tokens, códigos de URL nem URLs assinadas.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { _electron } = require('playwright-core');
const discovery = require('../electron/discovery');
const pages = require('../src/extract/pages');
const pdfs = require('../src/extract/pdfs');
const videos = require('../src/extract/videos');
const books = require('../src/extract/books');
const markdown = require('../src/extract/markdown');
const learning = require('./lib/reader-learning');
const reconcile = require('./lib/reconcile');
const urlCapture = require('./lib/url-capture');
const { seguirDestinoUrl, aguardarPopupFinal } = require('./lib/url-navigation');
const { seguirBvirtual } = require('./lib/bvirtual-nav');
const { classificarLeitor, hostnameDe, deveGravarConteudo } = require('./lib/reader-classifier');
const pdfFlow = require('./lib/pdf-flow');

const USERNAME = process.env.UNIVESP_USERNAME;
const PASSWORD = process.env.UNIVESP_PASSWORD;
if (!USERNAME || !PASSWORD) throw new Error('variaveis de ambiente ausentes');
const BASE = 'https://ava.univesp.br';
const ROOT = process.env.UNIVESP_OUT || path.join(os.homedir(), 'Desktop', 'univesp');
const IDS = process.argv.slice(2).map(Number).filter(Number.isFinite);
const RUN_ID = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');

function log(line) { console.log(`[${new Date().toISOString()}] ${line}`); }
function safeName(s) { return String(s || 'recurso').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90); }
function cleanTitle(s, id) { return String(s || '').replace(/\s*\|\s*.*$/, '').replace(/\s+Ferramenta externa\s*$/i, '').replace(/\s+/g, ' ').trim() || `Recurso ${id}`; }

async function login(win) {
  if (!(await gotoSafe(win, `${BASE}/custom/univesp_saml.php?wantsurl=${encodeURIComponent(BASE + '/')}&login_hint=${encodeURIComponent(USERNAME)}`))) return false;
  await win.waitForSelector('form[name="f"]', { timeout: 30000 });
  await win.fill('input#password', PASSWORD);
  await Promise.all([win.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}), win.click('button[type="submit"]')]);
  const dl = Date.now() + 120000;
  while (Date.now() < dl) {
    const u = win.url();
    if (u.includes('ava.univesp.br') && !/login|saml/.test(u) && await win.evaluate(() => !document.querySelector('form[name="f"]')).catch(() => false)) return true;
    await win.waitForTimeout(1500);
  }
  return false;
}

async function withTimeout(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout-' + label)), ms); })]); }
  finally { clearTimeout(timer); }
}

// AVA pode travar uma navegação esporadicamente — tenta de novo antes de falhar.
async function gotoSafe(win, url) {
  for (let i = 0; i < 3; i++) {
    try { await win.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); return true; }
    catch (e) { if (i === 2) return false; await win.waitForTimeout(1500); }
  }
  return false;
}

// Somente links de MATERIAL — ignora controles da UI ("Contrair Expandir"),
// âncoras, fóruns, questionários e lives (fora do escopo do produto).
const RESOURCE_RE = /\/mod\/(page|url|resource|lti|book)\/view\.php\?|\.pdf($|[?#])|assets\.univesp\.br/i;

// Recursos mod/url abrem uma página intermediária do AVA; seguirDestinoUrl()
// (poc/lib/url-navigation.js) clica no link real e escolhe a aba final.
//
// Clique REAL no link do recurso dentro da página da disciplina (como usuário).
async function clickResource(app, win, courseUrl, id, resourceUrl) {
  if (!RESOURCE_RE.test(String(resourceUrl || ''))) return null;
  if (!(await gotoSafe(win, courseUrl))) return null;
  await win.waitForTimeout(500);
  const before = win.url();
  const locator = win.locator(`a[href*="id=${id}"]:not(.courseindex-link):not(.courseindex-chevron)`).first();
  if (!(await locator.count().catch(() => 0))) return null;
  const baseline = new Set(app.windows());
  const popupPromise = win.waitForEvent('popup', { timeout: 2000 }).catch(() => null);
  let clicked = false;
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await locator.click({ timeout: 7000 });
    clicked = true;
  } catch (e) {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await locator.click({ timeout: 5000, force: true });
      clicked = true;
    } catch (e2) {
      try {
        const okDom = await win.evaluate((i) => {
          const a = Array.from(document.querySelectorAll('a[href*="id=' + i + '"]')).find((e) => !e.classList.contains('courseindex-link'));
          if (!a) return false;
          a.click();
          return true;
        }, id).catch(() => false);
        clicked = !!okDom;
      } catch {}
      if (!clicked) log(`    clique-falhou id=${id} motivo=${String(e2 && e2.message || e2).slice(0, 160).replace(/\s+/g, ' ')}`);
    }
  }
  if (!clicked) return null;
  const popup = await popupPromise;
  if (popup) {
    return await aguardarPopupFinal(app, popup, courseUrl, (m) => log(`    popup-sem-destino id=${id} motivo=${m}`));
  }
  await win.waitForTimeout(700);
  // Moodle abre materiais em nova aba; seguir a janela criada pelo clique.
  const opened = app.windows().filter((w) => !baseline.has(w));
  if (opened.length === 1) {
    const u = typeof opened[0].url === 'function' ? opened[0].url() : '';
    return urlCapture.AVA_URL_VIEW_RE.test(String(u)) ? (await seguirDestinoUrl(app, opened[0], courseUrl) || null) : opened[0];
  }
  if (opened.length > 1) return null; // ambiguidade: falha conservadora
  await win.waitForTimeout(700);
  const after = win.url();
  if (urlCapture.AVA_URL_VIEW_RE.test(String(after))) return await seguirDestinoUrl(app, win, courseUrl) || null;
  if (after !== before && (String(after).includes('id=' + id) || String(after).includes('assets.univesp.br'))) return win;
  log(`    clique-sem-navegacao id=${id} antes=${books.sanitizeUrlForReport(before)} depois=${books.sanitizeUrlForReport(after)} janelas=${app.windows().length}`);
  return null;
}

async function extractResource({ app, win, r, dir, seq, state, course, week, courseUrl }) {
  const cls = discovery.classifyResource(r);
  const title = cleanTitle(r.text, r.id);
  const base = path.join(dir, String(seq).padStart(2, '0') + '_' + safeName(title));
  const out = { id: r.id, title, kind: cls.kind, sub: cls.subKind || null, status: 'partial', chars: 0, detail: null, file: null };
  try {
    if (cls.kind === 'page' || cls.kind === 'unknown') {
      // Leitura direta da página JÁ aberta pelo clique (sem novo goto/espera).
      const res = await withTimeout(win.evaluate(() => {
        const scope = document.querySelector('.ava-scope') || document.querySelector('[role="main"]') || document.body;
        return { text: scope ? scope.innerText : '', title: document.title };
      }), 10000, 'page');
      const text = String(res && res.text || '');
      // Frente 1: recurso URL — a página mod/url do AVA só contém instrução de
      // clique. Nunca salvar esse texto como conteúdo; exigir aba de destino.
      if (cls.subKind === 'url') {
        const cap = urlCapture.avaliarCapturaUrl({
          subKind: cls.subKind, origemUrl: courseUrl,
          destinoUrl: typeof win.url === 'function' ? win.url() : '', texto: text,
        });
        if (cap.acao === 'sem-destino' || cap.acao === 'interface' || cap.acao === 'sem-texto' || cap.acao === 'pagina-erro') {
          out.status = cap.status; out.detail = cap.detail; out.chars = 0; out.file = null;
          return out;
        }
        if (cap.acao === 'destino') out.detail = cap.detail;
      }
      out.chars = text.length;
      out.status = text.length >= 100 ? 'integral' : 'partial';
      out.file = path.basename(base) + '.md';
      fs.writeFileSync(base + '.md', `# ${title}\n\n${text}\n`);
    } else if (cls.kind === 'pdf') {
      // Contrato de pdfs.extractPdf(): { status, pages: [{text}], totalPagesArquivo }.
      // NÃO existem res.text nem res.ok — status vem pronto do módulo (statusFor).
      const tmp = path.join(os.tmpdir(), `univesp-pdf-${r.id}-${Date.now()}.pdf`);
      const res = await withTimeout(pdfs.extractPdf({ url: r.url, filePath: tmp, request: win.request || (win.context && win.context().request), useElectronNet: false, timeoutMs: 20000 }), 25000, 'pdf');
      const resultadoPdf = pdfFlow.processarResultadoPdf(res, { title, courseId: course && course.code });
      let text = resultadoPdf.texto;
      out.chars = resultadoPdf.chars;
      out.status = resultadoPdf.status;
      out.detail = resultadoPdf.detail;
      const persistencia = pdfFlow.persistirMarkdownPdf({ resultado: resultadoPdf, caminhoBase: base, titulo: title });
      out.file = persistencia.arquivo;
      try { fs.rmSync(tmp, { force: true }); } catch {}
    } else if (cls.kind === 'video') {
      const res = await withTimeout(videos.extractVideo({ url: r.url, title, fetchFn: globalThis.fetch, timeoutMs: 10000 }), 15000, 'video');
      const text = String(res && (res.text || res.transcript || '') || '');
      out.chars = text.length;
      out.status = text.length >= 80 ? 'integral' : 'partial';
      out.detail = res && res.status ? String(res.status) : null;
      out.file = path.basename(base) + '.md';
      fs.writeFileSync(base + '.md', `# ${title}\n\n${text}\n`);
    } else if (cls.kind === 'book') {
      const expected = discovery.parseExpectedFromResource({ text: r.text, url: r.url });
      // Aprendizado: se uma sessão anterior ensinou que o Clássico funciona
      // para este tipo de leitor, tenta ele antes do Beta.
      const opts = { observeTimeoutMs: 5000, waitTimeoutMs: 8000 };
      if (Object.values((state && state.preferencias) || {}).includes('classic')) opts.preferred = 'classic';
      // Frente 4: somente em bvirtual, seguir tela de escolha/prompt Beta
      // condicionalmente; sem confirmação, falha honesta sem arquivo.
      let bloqueado = false;
      let navInfo = '';
      if (/bvirtual|bibliotecavirtual/i.test(String(r.url || ''))) {
        const nav = await seguirBvirtual(win);
        if (nav.acao !== 'nenhuma') {
          navInfo = ` navegacao=${nav.acao}:${nav.motivo || 'ok'}`;
          if (nav.confirmado) opts.jaAberto = true; // extrair no leitor já selecionado
        }
        if (nav.pageid != null) navInfo += ` pageid=${nav.pageid}`;
        if (nav.status === 'inaccessible') {
          out.status = 'inaccessible';
          out.detail = `formato=bv falha=${nav.motivo}${navInfo}`;
          out.chars = 0; out.file = null;
          bloqueado = true;
        }
      }
      // Frente 5: domínio externo desconhecido ou acesso negado confirmado
      // impedem qualquer extração/arquivo — com motivo honesto e distinto.
      if (!bloqueado) {
        const urlAtual = typeof win.url === 'function' ? win.url() : '';
        const host = hostnameDe(urlAtual);
        if (host && !host.endsWith('univesp.br')) {
          const cls = classificarLeitor({ url: urlAtual, hostname: host });
          if (!deveGravarConteudo(cls) && ['sem-autorizacao', 'dominio-desconhecido'].includes(cls.motivo)) {
            out.status = 'inaccessible';
            out.detail = `formato=${cls.leitor || 'unknown'} falha=${cls.motivo}`;
            out.chars = 0; out.file = null;
            bloqueado = true;
          }
        }
      }
      if (!bloqueado) {
        const res = await withTimeout(books.extractBook({ app, win, launchUrl: r.url, expected, opts }), 30000, 'book');
        const text = String(res && (res.text || '') || '');
        out.chars = text.length;
        out.status = res && res.status === 'integral' ? 'integral' : 'partial';
        out.detail = `formato=${res && res.format} status=${res && res.status} falha=${res && res.failureType || '-'}${navInfo}`;
        out.file = path.basename(base) + '.md';
        fs.writeFileSync(base + '.md', `# ${title}\n\nStatus: ${out.status} (${out.detail})\n\n${text}\n`);
      }
    }
  } catch (e) {
    out.status = 'inaccessible';
    out.detail = String(e && e.message || e).slice(0, 160);
  }
  // Salva link SANITIZADO + assinatura do leitor para treinar a navegação.
  if (out.status !== 'integral' && state && /formato=|reader|pagina-nao/i.test(out.detail || '')) {
    const diag = await win.evaluate(() => ({
      url: location.href,
      ids: Array.from(document.querySelectorAll('[id]')).map((e) => e.id)
        .filter((x) => /^(pdf|pdf-novo|summary|input-navigate|ExibicaoAtual|divBookMark|page-canvas|id_)/i.test(x)).slice(0, 12),
    })).catch(() => null);
    const formato = ((out.detail || '').match(/formato=(\w+)/) || [])[1] || 'unknown';
    const motivo = ((out.detail || '').match(/falha=([\w-]+)/) || [])[1] || (out.detail || 'erro').slice(0, 40);
    learning.learnFailure(state, {
      disciplina: course && course.code, semana: week, titulo: out.title, recursoId: out.id,
      url: (diag && diag.url) || r.url, formato, motivo, idsObservados: (diag && diag.ids) || [],
    });
  }
  return out;
}

async function extractCourse({ app, win, course, rootDir, state }) {
  const code = course.code || ('D' + course.id);
  const dir = path.join(rootDir, safeName(code + ' ' + course.title));
  fs.mkdirSync(dir, { recursive: true });
  log(`INICIO disciplina=${code} id=${course.id}`);
  if (!(await gotoSafe(win, course.url))) throw new Error('curso-nao-abriu');
  await win.waitForTimeout(1500);
  const html = await win.evaluate(() => document.documentElement.outerHTML);
  const sections = discovery.parseSectionsFromHtml(html);
  const results = [];
  let seq = 0;
  const maxWeeks = Number(process.env.UNIVESP_MAX_WEEKS) > 0 ? Number(process.env.UNIVESP_MAX_WEEKS) : Infinity;
  for (const sec of sections) {
    if (!sec.relevant) continue;
    if (results.length && sec.order > sections.find((s) => s.relevant).order + maxWeeks - 1) break;
    const res = discovery.parseResourcesFromSectionHtml(sec.block, BASE);
    const links = res.links.filter((l) => !discovery.isIgnoredActivity(l.text || '') && !/live\s+com\s+facilitador/i.test(l.text || '') && RESOURCE_RE.test(String(l.url || '')));
    if (!links.length) continue;
    const weekDir = path.join(dir, safeName('SEMANA_' + sec.id));
    fs.mkdirSync(weekDir, { recursive: true });
    log(`SEMANA ${sec.id} recursos=${links.length}`);
    for (const link of links) {
      seq++;
      const id = (String(link.url).match(/[?&]id=(\d+)/) || [])[1] || String(seq);
      let target = await clickResource(app, win, course.url, id, link.url);
      if (!target) {
        // Cursos legados abrem o material fora do Electron (sem popup):
        // usa a URL do link da própria UI, na janela autenticada.
        if (await gotoSafe(win, link.url)) target = win;
      }
      if (!target) { results.push({ id, title: cleanTitle(link.text, id), week: sec.id, status: 'inaccessible', detail: 'clique-nao-abriu-recurso', chars: 0 }); continue; }
      const r = await extractResource({ app, win: target, r: link, dir: weekDir, seq, state, course, week: sec.id, courseUrl: course.url });
      r.week = sec.id;
      results.push(r);
      log(`  ${sec.id}/${r.title.slice(0, 45)} => ${r.status} chars=${r.chars} ${r.detail || ''}`);
      // Fecha a aba aberta pelo clique (como usuário), preservando a original.
      if (target !== win) { try { await target.close().catch(() => {}); } catch {} }
    }
  }
  const total = results.length;
  const groups = reconcile.countGroups(results);
  const quality = { disciplina: code, total, groups, status: groups.integral === total ? 'PASS' : 'REVIEW' };
  fs.writeFileSync(path.join(dir, 'RECORDS.json'), JSON.stringify({ runId: RUN_ID, disciplina: code, titulo: course.title, cursoId: course.id, registros: results }, null, 2));
  fs.writeFileSync(path.join(dir, 'QUALITY.md'), ['# Qualidade da extração', '', `- Disciplina: ${course.title} (${code})`, `- Recursos: ${total}`, `- Integral: ${groups.integral}`, `- Partial: ${groups.partial}`, `- Sem texto: ${groups.no_text}`, `- Falhas: ${groups.failed}`, `- Sem classificação: ${groups.unclassified}`, `- Resultado: ${quality.status}`, '', '## Detalhes', ...results.map((r) => `- S${r.week} ${r.title}: ${r.status} (${r.chars} chars)${r.detail ? ' — ' + r.detail : ''}`)].join('\n'));
  log(`FIM disciplina=${code} total=${total} ${JSON.stringify(groups)}`);
  return quality;
}

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  const learningFile = path.join(ROOT, 'APRENDIZADO.json');
  const state = learning.load(learningFile);
  const electronPath = require('electron');
  const app = await _electron.launch({ args: [path.join(__dirname, '..', 'electron', 'browser.js')], executablePath: typeof electronPath === 'string' ? electronPath : process.execPath });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('body', { timeout: 30000 });
    if (!(await login(win))) throw new Error('login-nao-concluido');
    log('LOGIN=OK');
    await gotoSafe(win, BASE + '/my/courses.php');
    await win.waitForTimeout(2500);
    const html = await win.evaluate(() => document.documentElement.outerHTML);
    const courses = discovery.parseCoursesFromHtml(html, BASE).filter((c) => c.available !== false);
    log(`CURSOS=${courses.length}`);
    const targets = IDS.length ? IDS.map((id) => courses.find((c) => String(c.id) === String(id))).filter(Boolean) : courses;
    const summary = [];
    for (const c of targets) summary.push(await extractCourse({ app, win, course: c, rootDir: ROOT, state }));
    learning.save(learningFile, state);
    fs.writeFileSync(path.join(ROOT, 'ERROS_LEITURA.md'), learning.renderMarkdown(state));
    fs.writeFileSync(path.join(ROOT, 'RESUMO_GERAL.md'), ['# Resumo das extrações', '', ...summary.map((s) => { const g = s.groups || {}; return `- ${s.disciplina}: ${g.integral ?? '?'}/${s.total} integrais, ${g.partial ?? '?'} partial, ${g.failed ?? '?'} falhas, ${g.unclassified ?? '?'} sem classificação — ${s.status}`; })].join('\n'));
    log('CONCLUIDO=' + JSON.stringify(summary));
  } finally { await app.close().catch(() => {}); }
})().catch((e) => { console.error('FATAL', String(e && e.message || e)); process.exit(1); });
