// Fluxo integrado do aplicativo (Fases A1-A7): login manual → descoberta
// dinâmica de disciplinas/semanas/recursos → extração com os Módulos 1-3 →
// organização acadêmica → ZIP validado no destino escolhido.
//
// Este módulo é a orquestração: NÃO implementa extração própria — delega aos
// módulos src/extract/{pages,pdfs,books}.js (uma única implementação).
// Opera sobre a janela do navegador Electron (Page do playwright-core) já
// autenticada manualmente pelo estudante. Credenciais NUNCA são usadas aqui.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractPage } = require('../src/extract/pages');
const { extractPdf } = require('../src/extract/pdfs');
const { extractBook } = require('../src/extract/books');
const {
  parseCoursesFromHtml,
  parseSectionsFromHtml,
  parseResourcesFromSectionHtml,
  classifyResource,
} = require('./discovery');
const { createLogger } = require('./log');

const BASE = 'https://ava.univesp.br';

// Sinais de "não autenticado" na página do AVA (formulário de login).
const LOGIN_FORM_RE = /form\s*name=["']?f["']?|name=["']password["']|id=["']login|href=["'][^"']*\/login\/index\.php/i;

// Detecta se a janela atual está autenticada no AVA (não basta a página aberta).
async function isLoggedIn(win) {
  try {
    const url = String(win.url() || '');
    if (!url.includes('ava.univesp.br')) return false;
    const body = await win.evaluate(() => (document.body ? document.body.innerHTML.slice(0, 20000) : '')).catch(() => '');
    if (LOGIN_FORM_RE.test(body)) return false;
    const scope = await win.evaluate(() => !!document.querySelector('.ava-scope, [role="main"], #page-header, .course-content')).catch(() => false);
    return !!scope;
  } catch { return false; }
}

// Aguarda o login manual do estudante (janela já aberta no AVA).
// Retorna true quando detecta autenticação; timeoutMs com false (não é erro).
async function waitForManualLogin(win, { timeoutMs = 60000, interval = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(win)) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

// Descoberta de disciplinas (A2): navega para /my/courses.php e usa o parser puro.
async function discoverCourses(win) {
  await win.goto(`${BASE}/my/courses.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await win.waitForTimeout(2500);
  const html = await win.evaluate(() => document.documentElement.outerHTML).catch(() => '');
  const courses = parseCoursesFromHtml(html, BASE);
  return { courses, htmlLength: html.length };
}

// Descoberta de semanas (A3): navega para a página do curso e usa o parser puro.
// Preserva o bloco HTML de cada seção para a etapa de recursos.
async function discoverWeeks(win, course) {
  await win.goto(course.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await win.waitForTimeout(2500);
  const html = await win.evaluate(() => document.documentElement.outerHTML).catch(() => '');
  const sections = parseSectionsFromHtml(html, BASE);
  const weeks = sections.filter((s) => s.relevant).map((s) => ({ id: s.id, name: s.name, order: s.order }));
  return { weeks, sections };
}

// Descoberta de recursos de uma seção (A4/A5): usa o parser puro sobre o bloco.
// Atribui um id CURTO e estável a cada recurso (baseado no final da URL/âncora)
// para uso como nome de arquivo — nunca a URL completa.
function discoverResourcesFromSection(section, baseUrl = BASE) {
  const { links, iframes } = parseResourcesFromSectionHtml(section.block || '', baseUrl);
  const resources = [];
  let n = 0;
  for (const l of links) {
    n++;
    const cls = classifyResource(l);
    const id = resourceId(l, cls, n);
    resources.push({ ...l, id, classification: cls });
  }
  for (const fr of iframes) {
    n++;
    const r = { text: '', url: fr, type: 'iframe' };
    const cls = classifyResource(r);
    const id = resourceId(r, cls, n);
    resources.push({ ...r, id, classification: cls });
  }
  return resources;
}

// Nome de arquivo curto e determinístico a partir da URL do recurso.
function resourceId(r, cls, n) {
  const base = String(r.url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || 'recurso';
  const ext = base.includes('.') ? '' : `.${cls.kind}`;
  const safe = safeName(base + ext).slice(0, 60) || `recurso-${n}`;
  return `r${n}-${safe}`;
}

// --- Classificação de status honesto do fluxo (A6) ---
// concluído | concluído com pendências | falhou
function overallStatus({ resources, zip }) {
  if (!zip || !zip.ok) return 'falhou';
  const pendings = resources.filter((r) => r.status === 'partial' || r.status === 'inaccessible' || r.status === 'not_found' || r.status === 'unsupported');
  const failures = resources.filter((r) => r.status === 'inaccessible' || r.status === 'not_found' || r.status === 'unsupported');
  if (failures.length === 0 && resources.every((r) => r.status === 'integral')) return 'concluído';
  if (failures.length === 0) return 'concluído com pendências';
  return 'concluído com pendências';
}

// Extrai um recurso usando o módulo adequado (A4/A5). Recebe o contexto do
// Electron (app, win) e o diretório da semana (para PDFs/organização).
async function extractResource({ app, win, resource, weekDir, logger }) {
  const cls = resource.classification || classifyResource(resource);
  const entry = { id: resource.id || resource.url, text: resource.text, url: resource.url, kind: cls.kind, subKind: cls.subKind, status: 'inaccessible' };

  if (cls.kind === 'page') {
    const p = await extractPage(win, resource.url);
    entry.status = p.pageStatus;
    entry.title = p.title;
    entry.textLen = p.text.length;
    entry.hasScope = p.hasScope;
    entry.httpStatus = p.httpStatus;
    entry.loadWarnings = p.loadWarnings || [];
    if (p.pageStatus === 'integral' && p.text) {
      fs.writeFileSync(path.join(weekDir, `${entry.id}.txt`), p.text, 'utf8');
      entry.savedTextFile = `${entry.id}.txt`;
    }
  } else if (cls.kind === 'pdf') {
    const filePath = path.join(weekDir, `${entry.id}.pdf`);
    const pdf = await extractPdf({ url: resource.url, filePath, useElectronNet: true });
    entry.status = pdf.status;
    entry.bytes = pdf.bytes;
    entry.totalPagesArquivo = pdf.totalPagesArquivo;
    entry.pagesExtracted = pdf.pagesExtracted;
    entry.printedPagination = pdf.printedPagination;
    entry.error = pdf.error;
    if (pdf.status === 'integral' || pdf.status === 'partial') {
      const text = pdf.pages.map((p) => p.text).join('\n\n');
      if (text.trim()) { fs.writeFileSync(path.join(weekDir, `${entry.id}.txt`), text, 'utf8'); entry.savedTextFile = `${entry.id}.txt`; }
      entry.pdfFile = `${entry.id}.pdf`;
    }
  } else if (cls.kind === 'book') {
    const expected = {};
    const b = await extractBook({ app, win, launchUrl: resource.url, expected });
    entry.status = b.status || (b.ok ? 'integral' : 'inaccessible');
    entry.failureType = b.failureType;
    entry.reason = b.reason || b.error;
    entry.chars = b.text ? b.text.length : 0;
    if (b.text && b.text.trim().length > 100) {
      fs.writeFileSync(path.join(weekDir, `${entry.id}.txt`), b.text, 'utf8');
      entry.savedTextFile = `${entry.id}.txt`;
    }
  } else if (cls.kind === 'video') {
    // A5: preserva link, título e disponibilidade de transcrição (sem resumo).
    entry.status = 'video-registrado';
    entry.transcriptAvailable = false;
    entry.transcriptNote = 'transcrição não extraída nesta versão (Módulo 4 fora de escopo)';
  } else {
    entry.status = 'unsupported';
    entry.note = 'recurso desconhecido registrado (não ignorado silenciosamente)';
  }

  if (logger) logger.log('recurso ' + entry.id + ' kind=' + entry.kind + ' status=' + entry.status);
  return entry;
}

// --- Renderização da estrutura do ZIP (A7) ---
function safeName(s) { return String(s || '').replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'recurso'; }

function buildCourseStructure({ course, weeks, outputDir }) {
  const courseDir = path.join(outputDir, safeName(course.code || course.id));
  fs.mkdirSync(courseDir, { recursive: true });
  fs.writeFileSync(path.join(courseDir, 'INDEX.md'), renderIndex({ course, weeks }));
  fs.writeFileSync(path.join(courseDir, 'AI_STUDY_INSTRUCTIONS.md'), renderAiInstructions());
  fs.writeFileSync(path.join(courseDir, 'SOURCES.md'), renderSources({ course, weeks }));
  fs.writeFileSync(path.join(courseDir, 'EXTRACTION_REPORT.md'), renderReport({ course, weeks }));
  return courseDir;
}

function renderIndex({ course, weeks }) {
  const lines = [`# ${course.title}${course.code ? ` (${course.code})` : ''}`, '', 'Materiais organizados por semana.', ''];
  for (const w of weeks) {
    if (!w.name) continue;
    lines.push(`- ${w.name}: [${w.name}](${safeName(w.name)}/${safeName(w.name)}.md)`);
  }
  return lines.join('\n') + '\n';
}

function renderAiInstructions() {
  return '# Instruções para a IA de estudo\n\nNenhuma IA foi usada no scraper. Este documento apenas instrui a IA escolhida pelo estudante a estudar o conteúdo extraído — nunca substituir o material original.\n';
}

function renderSources({ course, weeks }) {
  const lines = ['# Fontes', '', `- Disciplina: ${course.title}`, `  - URL: ${course.url}`, ''];
  for (const w of weeks) {
    if (!w.name) continue;
    lines.push(`## ${w.name}`);
    for (const r of w.resources || []) {
      lines.push(`- ${r.text || r.id}: ${r.url}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderReport({ course, weeks }) {
  const lines = ['# Relatório de Extração', '', `- Disciplina: ${course.title}${course.code ? ` (${course.code})` : ''}`, ''];
  const totals = { integral: 0, partial: 0, inaccessible: 0, not_found: 0, unsupported: 0, video: 0 };
  for (const w of weeks) {
    for (const r of w.resources || []) {
      if (r.status === 'integral') totals.integral++;
      else if (r.status === 'partial') totals.partial++;
      else if (r.status === 'inaccessible') totals.inaccessible++;
      else if (r.status === 'not_found') totals.not_found++;
      else if (r.status === 'unsupported') totals.unsupported++;
      else if (r.status === 'video-registrado') totals.video++;
    }
  }
  lines.push(`## Resumo: ${totals.integral} integral, ${totals.partial} parcial, ${totals.inaccessible} inacessível, ${totals.not_found} não encontrado, ${totals.unsupported} não suportado, ${totals.video} vídeo registrado.`, '');
  for (const w of weeks) {
    if (!w.name) continue;
    lines.push(`## ${w.name}`);
    for (const r of w.resources || []) {
      const extra = r.status === 'integral' ? '' : (r.reason ? ` — ${r.reason}` : '');
      lines.push(`- [${r.status}] ${r.text || r.id}: ${r.url}${extra}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// --- ZIP com validação (A6) ---
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

function createZip(srcDir, destZip) {
  return new Promise((resolve) => {
    try {
      if (fs.existsSync(destZip)) fs.rmSync(destZip, { force: true });
      const { execFileSync } = require('child_process');
      const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${srcDir.replace(/'/g, "''")}', '${destZip.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 120000, stdio: 'pipe' });
      const size = fs.statSync(destZip).size;
      const files = countFiles(srcDir);
      resolve({ ok: size > 0, bytes: size, files, path: destZip, reason: size > 0 ? null : 'zip-vazio' });
    } catch (e) {
      resolve({ ok: false, reason: e.message, path: destZip, bytes: 0, files: 0 });
    }
  });
}

function validateZip(zip) {
  if (!zip || !zip.ok) return { valid: false, reason: zip && zip.reason ? zip.reason : 'zip-nao-criado' };
  let st;
  try { st = fs.statSync(zip.path); } catch { return { valid: false, reason: 'arquivo-inexistente' }; }
  if (!st.isFile() || st.size <= 0) return { valid: false, reason: 'arquivo-vazio' };
  try {
    const { execFileSync } = require('child_process');
    const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${zip.path.replace(/'/g, "''")}'); try { $z.Entries.Count } finally { $z.Dispose() }`;
    const count = parseInt(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 30000, stdio: 'pipe' }).toString().trim(), 10);
    if (!Number.isInteger(count) || count < 0) return { valid: false, reason: 'nao-e-zip' };
    return { valid: true, entries: count, matches: count === zip.files };
  } catch (e) { return { valid: false, reason: 'nao-e-zip' }; }
}

// Constrói o logger sanitizado do fluxo.
function makeFlowLogger(filePath) {
  return createLogger(filePath || path.join(os.tmpdir(), 'univesp-app.log'));
}

module.exports = {
  BASE,
  isLoggedIn,
  waitForManualLogin,
  discoverCourses,
  discoverWeeks,
  discoverResourcesFromSection,
  classifyResource,
  extractResource,
  overallStatus,
  buildCourseStructure,
  createZip,
  validateZip,
  safeName,
  makeFlowLogger,
};
