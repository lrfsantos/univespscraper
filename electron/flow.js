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
const { extractVideo } = require('../src/extract/videos');
const { renderResourceMarkdown } = require('../src/extract/markdown');
const {
  parseCoursesFromHtml,
  parseSectionsFromHtml,
  parseResourcesFromSectionHtml,
  classifyResource,
  parseExpectedFromResource,
  isIgnoredActivity,
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
    // Regra de produto: "Início" (apresentação) e "Em síntese" NÃO são materiais
    // acadêmicos — não geram documento, não contam como extraídos nem como pendência.
    if (isIgnoredActivity(l.text)) continue;
    n++;
    const cls = classifyResource(l);
    const id = resourceId(l, cls, n);
    // Correção E: preserva a identificação esperada (livro/capítulo) que o AVA
    // declara no texto do âncora — nunca inventa. Para livros, é propagada à
    // extração/validação; para os demais, registrada como ausência explícita.
    const expected = parseExpectedFromResource(l);
    resources.push({ ...l, id, classification: cls, expected });
  }
  for (const fr of iframes) {
    n++;
    const r = { text: '', url: fr, type: 'iframe' };
    const cls = classifyResource(r);
    const id = resourceId(r, cls, n);
    const expected = parseExpectedFromResource(r);
    resources.push({ ...r, id, classification: cls, expected });
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
// - 'concluído': ZIP válido e TODOS os recursos sem pendência (integral ou vídeo
//   com transcrição capturada — registrar o link não equivale a extrair).
// - 'concluído com pendências': ZIP válido, mas há recursos parcial/inacessível/
//   não encontrado/não suportado/vídeo sem transcrição — a pendência consta no relatório.
// - 'falhou': ZIP não criado/inválido ou houve erro que impediu a conclusão.
//
// Seção 3: vídeo SEM transcrição (video-registrado) e vídeo inacessível
// (video-inacessivel) são PENDÊNCIAS explícitas — nunca contabilizados como
// concluídos. Apenas video-com-transcricao conta como concluído nessa dimensão.
function isDoneStatus(status) {
  return status === 'integral' || status === 'video-com-transcricao';
}

function overallStatus({ resources, zip }) {
  if (!zip || !zip.ok) return 'falhou';
  if (!resources.length) return 'concluído';
  const pendings = resources.filter((r) => !isDoneStatus(r.status));
  if (pendings.length === 0) return 'concluído';
  return 'concluído com pendências';
}

// Extrai um recurso usando o módulo adequado (A4/A5). Recebe o contexto do
// Electron (app, win) e o diretório da semana (para PDFs/organização).
// Seção 4: gera também o documento Markdown INDIVIDUAL do recurso (`.md`) com
// metadados, rastreabilidade e conteúdo original (nunca resumido).
async function extractResource({ app, win, resource, weekDir, logger, seen, course, week }) {
  const cls = resource.classification || classifyResource(resource);
  const entry = { id: resource.id || resource.url, text: resource.text, url: resource.url, kind: cls.kind, subKind: cls.subKind, status: 'inaccessible' };
  const courseLabel = course && (course.title || course.code || course.id);
  const weekLabel = week && (week.name || week.id);

  if (cls.kind === 'page') {
    const p = await extractPage(win, resource.url);
    entry.status = p.pageStatus;
    entry.title = p.title;
    entry.textLen = p.text.length;
    entry.hasScope = p.hasScope;
    entry.httpStatus = p.httpStatus;
    entry.loadWarnings = p.loadWarnings || [];
    entry.pageContent = p.text;
    if (p.pageStatus === 'integral' && p.text) {
      fs.writeFileSync(path.join(weekDir, `${entry.id}.txt`), p.text, 'utf8');
      entry.savedTextFile = `${entry.id}.txt`;
    }
    // P0 2.5: a página pode revelar recursos incorporados (vídeos/PDFs/livros/
    // páginas). Eles são descobertos e extraídos de acordo com o tipo, preservando
    // a página como fonte independente e registrando sourcePage. `seen` compartilhado
    // (padrão: isolado por chamada) evita reextrair o mesmo recurso em várias páginas.
    if (p.pageStatus === 'integral' || p.pageStatus === 'partial') {
      const embedded = await extractEmbeddedFromPage({ win, page: p, sourceUrl: resource.url, weekDir, app, logger, seen, course, week });
      if (embedded.length) entry.embedded = embedded;
    }
  } else if (cls.kind === 'pdf') {
    const filePath = path.join(weekDir, `${entry.id}.pdf`);
    // P0 2.2: baixa pela SESSÃO AUTENTICADA do navegador auxiliar (page.request do
    // Playwright compartilha cookies com o contexto onde o login manual foi feito).
    // electron.net (processo principal) não é usado porque tem sessão separada.
    const pdf = await extractPdf({ url: resource.url, filePath, request: win.request });
    entry.status = pdf.status;
    entry.bytes = pdf.bytes;
    entry.sha256 = pdf.sha256;
    entry.totalPagesArquivo = pdf.totalPagesArquivo;
    entry.pagesExtracted = pdf.pagesExtracted;
    entry.printedPagination = pdf.printedPagination;
    entry.pages = pdf.pages;
    entry.info = pdf.info;
    entry.error = pdf.error;
    if (pdf.filePath) entry.pdfFile = path.basename(pdf.filePath);
    if (pdf.status === 'integral' || pdf.status === 'partial') {
      const text = pdf.pages.map((p) => p.text).join('\n\n');
      if (text.trim()) { fs.writeFileSync(path.join(weekDir, `${entry.id}.txt`), text, 'utf8'); entry.savedTextFile = `${entry.id}.txt`; }
    }
  } else if (cls.kind === 'book') {
    // Correção E: o capítulo/página que o AVA declara no âncora (ex.: "Leia o
    // Capítulo 1") é passado a extractBook para navegação e validação estrutural
    // conservadora. Quando ausente, `expected` representa a ausência explícita
    // (hasChapter:false) — nada é inventado e o status nunca sobe por omissão.
    const expected = resource.expected || parseExpectedFromResource(resource);
    const b = await extractBook({ app, win, launchUrl: resource.url, expected });
    entry.status = b.status || (b.ok ? 'integral' : 'inaccessible');
    entry.failureType = b.failureType;
    entry.reason = b.reason || b.error;
    entry.chars = b.text ? b.text.length : 0;
    entry.bookText = b.text || '';
    entry.format = b.format;
    entry.expected = { chapter: expected.chapter, hasChapter: expected.hasChapter, book: expected.book, author: expected.author || null, pageRange: expected.pageRange, hasPageRange: expected.hasPageRange };
    // Seção 5.1/5.2: metadados REAIS — do OPF do EPUB (meta) quando disponível, ou
    // do âncora do AVA (expected.book/author). Nunca inventa.
    entry.bookName = (b.meta && b.meta.title) || expected.book || null;
    entry.author = (b.meta && b.meta.author) || expected.author || null;
    entry.publisher = (b.meta && b.meta.publisher) || null;
    entry.edition = (b.meta && b.meta.year) ? `ano ${b.meta.year}` : null;
    entry.metaOrigin = (b.meta && (b.meta.author || b.meta.title)) ? 'OPF do EPUB (metadados reais do pacote)' : (expected.book || expected.author ? 'âncora do AVA (título/autor declarados)' : null);
    entry.evidenceNotes = b.evidenceNotes || null;
    entry.endOk = b.validation ? b.validation.endOk : null;
    entry.pageRangeOk = b.validation ? b.validation.pageRangeOk : null;
    entry.pageRangeNote = b.validation ? b.validation.pageRangeNote : null;
    entry.identifiedPages = b.identifiedPages != null ? b.identifiedPages : (b.validation && b.validation.identifiedPages != null ? b.validation.identifiedPages : null);
    entry.capturedPages = b.capturedPages != null ? b.capturedPages : null;
    entry.duplicatePages = b.duplicatePages != null ? b.duplicatePages : null;
    entry.xhtmlDocs = b.xhtmlDocs != null ? b.xhtmlDocs : null;
    entry.syncNotes = b.syncNotes || null;
    if (b.text && b.text.trim().length > 100) {
      fs.writeFileSync(path.join(weekDir, `${entry.id}.txt`), b.text, 'utf8');
      entry.savedTextFile = `${entry.id}.txt`;
    }
  } else if (cls.kind === 'video') {
    // A5/5.4: captura transcrição quando efetivamente disponível (sem inventar).
    // Seção 4.4: segmentos com timestamps preservados na ordem original.
    const v = await extractVideo({ url: resource.url, title: resource.text });
    entry.status = v.status;
    entry.videoId = v.videoId;
    entry.isYoutube = v.isYoutube;
    entry.transcriptAvailable = v.transcriptAvailable;
    entry.transcriptLang = v.transcriptLang;
    entry.transcriptNote = v.transcriptNote || (v.transcriptAvailable ? 'transcrição capturada' : 'transcrição não disponível');
    entry.segments = v.segments || [];
    if (v.transcriptAvailable && v.transcript) {
      fs.writeFileSync(path.join(weekDir, `${entry.id}.txt`), v.transcript, 'utf8');
      entry.savedTextFile = `${entry.id}.txt`;
      entry.transcriptChars = v.transcript.length;
    }
  } else {
    entry.status = 'unsupported';
    entry.note = 'recurso desconhecido registrado (não ignorado silenciosamente)';
  }

  // Seção 4: documento Markdown individual do recurso (conteúdo original + metadados).
  try {
    const md = renderResourceMarkdown({ entry, course, week: week || { name: weekLabel, id: weekLabel }, meta: {} });
    fs.writeFileSync(path.join(weekDir, `${entry.id}.md`), md, 'utf8');
    entry.savedMarkdownFile = `${entry.id}.md`;
  } catch (e) {
    if (logger) logger.error('falha ao gerar markdown [' + entry.id + ']: ' + e.message);
  }

  if (logger) logger.log('recurso ' + entry.id + ' kind=' + entry.kind + ' status=' + entry.status);
  return entry;
}

// P0 2.3: interpretação correta da seleção de semanas consumida pelo backend.
// Regra:
//  - weekIds == null/undefined -> TODAS as semanas (contrato: chamada sem seleção
//    explícita para aquela matéria).
//  - weekIds array NÃO vazio  -> exatamente os IDs informados.
//  - weekIds array VAZIO      -> NENHUMA semana daquela matéria (o estudante
//    desmarcou tudo — nunca significa "todas").
// `discover(course)` deve retornar { weeks, sections } (injetado nos testes).
//
// P0 2.6: falha na descoberta de UMA matéria NÃO impede a descoberta das demais.
// Cada curso é descoberto num try/catch próprio; em caso de erro, o plano mantém
// a entrada { course, weeks: [], sections: [], error } (motivo sanitizado) e a
// chamada `onCourseError(course, reason)` registra a falha — o processamento
// continua com as próximas matérias.
async function buildSelectionPlan({ courses, selection, discover, onCourseError }) {
  const selected = selection && selection.length ? selection : courses.map((c) => ({ courseId: String(c.id), weekIds: null }));
  const planned = [];
  for (const sel of selected) {
    const course = courses.find((c) => String(c.id) === String(sel.courseId));
    if (!course) continue;
    try {
      const { weeks, sections } = await discover(course);
      const selWeeks = sel.weekIds == null ? weeks : weeks.filter((w) => sel.weekIds.includes(String(w.id)));
      planned.push({ course, weeks: selWeeks, sections, error: null });
    } catch (e) {
      const reason = sanitizeReason(e);
      if (onCourseError) { try { onCourseError(course, reason); } catch {} }
      planned.push({ course, weeks: [], sections: [], error: reason });
    }
  }
  return planned;
}

// Motivo de falha SANITIZADO para registros/relatórios (nunca credenciais,
// cookies, URLs de dados pessoais nem conteúdo acadêmico bruto).
function sanitizeReason(e) {
  const raw = e && e.message ? e.message : e ? String(e) : 'erro-desconhecido';
  return String(raw).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').slice(0, 200);
}

// P0 2.6.4: converte uma lista de recursos em entradas de extração marcadas como
// inacessíveis por AUTENTICAÇÃO (sessão expirada no meio da extração) — NUNCA
// vira conteúdo integral. Preserva id/texto/URL/kind e registra o motivo.
function authExpiredEntries(resources, course, week) {
  const label = course && (course.code || course.id);
  return (resources || []).map((r) => ({
    id: r.id || r.url,
    text: r.text,
    url: r.url,
    kind: (r.classification || {}).kind,
    subKind: (r.classification || {}).subKind,
    status: 'inaccessible',
    reason: 'sessao-expirada: faça login novamente no AVA e refaça a extração',
    course: label,
    week,
  }));
}

// ---------- P0 2.5: descoberta RECURSIVA de materiais incorporados em páginas ----------
// Quando uma página HTML extraída revela recursos associados (links/iframes), eles
// são processados DE ACORDO COM O TIPO (vídeo/pdf/livro/página interna), sempre com
// EVIDÊNCIA — nunca baixando links externos desconhecidos indiscriminadamente.
// A página original é preservada como fonte independente; cada recurso incorporado
// registra a página de origem (sourcePage). Dedup por URL normalizada evita
// reextrair o mesmo recurso em múltiplas páginas; profundidade máxima impede ciclos.
const MAX_EMBED_DEPTH = 3;

function normalizeUrlKey(url) {
  try {
    const u = new URL(String(url || ''), BASE);
    u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch { return String(url || ''); }
}

// Identidade do recurso para dedup (P0 2.5: "URL normalizada E identidade").
// Para plataformas de vídeo reconhecidas, usa o ID do vídeo (watch?v= e /embed/
// e /shorts/ e youtu.be são o MESMO vídeo); para o restante, a URL normalizada.
function resourceIdentityKey(url) {
  try {
    const raw = String(url || '');
    const u = new URL(raw, BASE);
    if (/youtube\.com|youtu\.be|youtube-nocookie/i.test(u.hostname)) {
      let id = null;
      if (u.hostname.includes('youtu.be')) id = u.pathname.split('/')[1] || null;
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2] || null;
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] || null;
      else id = u.searchParams.get('v');
      if (id) return 'video:youtube:' + id;
    }
    if (/vimeo\.com/i.test(u.hostname)) {
      const m = u.pathname.match(/(\d+)/);
      if (m) return 'video:vimeo:' + m[1];
    }
  } catch {}
  return 'url:' + normalizeUrlKey(url);
}

// Puro e testável: classifica candidatos (links + iframes), mantém apenas os com
// evidência de tipo útil e deduplica por URL normalizada E identidade. `seen` compartilhado.
function discoverEmbeddedResources({ links = [], iframes = [], sourceUrl = '', depth = 0, seen = new Set() }) {
  const out = [];
  const candidates = [
    ...(links || []).map((l) => ({ text: (l && l.text) || '', url: l && l.url, type: 'link' })),
    ...(iframes || []).map((f) => ({ text: '', url: f, type: 'iframe' })),
  ];
  for (const c of candidates) {
    const cls = classifyResource(c);
    if (!cls.kind || cls.kind === 'unknown') continue;
    // Página vinculada só quando for recurso interno do AVA (evita transformar
    // qualquer link de navegação em material extraído).
    if (cls.kind === 'page' && !/\/mod\/(page|url|resource)\//.test(String(c.url || ''))) continue;
    const key = resourceIdentityKey(c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, classification: cls, sourcePage: sourceUrl, depth });
  }
  return out;
}

// Extrai os recursos incorporados de uma página já extraída, com recursão limitada
// em páginas internas (mod/page) para encontrar materiais aninhados. Cada recurso é
// extraído pelo fluxo NORMAL (status próprio); a página original permanece fonte
// independente; `sourcePage` registra a origem; `seen` compartilhado evita reextrair
// o mesmo recurso em múltiplas páginas.
async function extractEmbeddedFromPage({ win, page, sourceUrl, weekDir, app, logger, seen = new Set(), course, week }) {
  const discovered = discoverEmbeddedResources({ links: page && page.links, iframes: page && page.iframes, sourceUrl, depth: 0, seen });
  const out = [];
  for (const r of discovered) {
    const subDir = r.classification.kind === 'video' ? 'videos' : (r.classification.kind === 'pdf' ? 'supplementary' : (r.classification.kind === 'book' ? 'readings' : ''));
    const targetDir = subDir ? path.join(weekDir, subDir) : weekDir;
    try { fs.mkdirSync(targetDir, { recursive: true }); } catch {}
    let e;
    try {
      e = await extractResource({ app, win, resource: r, weekDir: targetDir, logger, seen, course, week });
    } catch (err) {
      e = { id: r.id || r.url, text: r.text, url: r.url, kind: r.classification.kind, subKind: r.classification.subKind, status: 'inaccessible', reason: 'falha-durante-extracao: ' + sanitizeReason(err) };
    }
    e.sourcePage = sourceUrl;
    e.isEmbedded = true;
    e.embedDepth = r.depth + 1;
    out.push(e);
    // Recursão em páginas internas do AVA (limite de profundidade, sem ciclos).
    if (r.classification.kind === 'page' && r.depth < MAX_EMBED_DEPTH) {
      const sub = await extractPage(win, r.url).catch(() => null);
      if (sub && (sub.pageStatus === 'integral' || sub.pageStatus === 'partial')) {
        const nested = await extractEmbeddedFromPage({ win, page: sub, sourceUrl: r.url, weekDir, app, logger, seen, course, week });
        out.push(...nested);
      } else if (sub) {
        out.push({ id: r.id || r.url, text: r.text, url: r.url, kind: 'page', status: sub.pageStatus || 'inaccessible', reason: 'pagina-vinculada-inacessivel', sourcePage: sourceUrl, isEmbedded: true, embedDepth: r.depth + 1 });
      }
    }
  }
  return out;
}

// --- Renderização da estrutura do ZIP (A7) ---
function safeName(s) { return String(s || '').replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'recurso'; }

// Nome padrão do ZIP: UNIVESP_<DATA>.zip (a matéria principal, quando única, é
// incluída; com várias matérias, usa-se "materiais").
function zipBaseName(courses) {
  const list = Array.isArray(courses) ? courses.filter(Boolean) : [];
  const codes = list.map((c) => safeName(c.code || c.title || '')).filter(Boolean);
  const label = codes.length === 1 ? codes[0] : (codes.length > 1 ? 'materiais' : 'materiais');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `UNIVESP_${label}_${date}`;
}

// Documentos no nível raiz do ZIP (INDEX.md global, SOURCES.md, etc.) que
// navegam pelas matérias/semanas. Cada matéria já tem os seus dentro da pasta.
// Seção 4.6: quando `resources` é informado, gera também EXTRACTION_REPORT.md
// (resumo agregado honesto) e EXTRACTION_QA.md (nota de qualidade) na raiz.
function buildTopLevelDocs({ courses, outputDir, resources }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const links = courses.map((c) => {
    const folder = safeName(c.code || c.id);
    return `- [${c.title}${c.code ? ` (${c.code})` : ''}](./${folder}/INDEX.md)`;
  }).join('\n');
  fs.writeFileSync(path.join(outputDir, 'INDEX.md'), `# UNIVESP — Materiais extraídos\n\nMatérias incluídas:\n\n${links}\n`);
  fs.writeFileSync(path.join(outputDir, 'AI_STUDY_INSTRUCTIONS.md'), renderAiInstructions());
  fs.writeFileSync(path.join(outputDir, 'SOURCES.md'), `# Fontes\n\n${courses.map((c) => `- ${c.title}${c.code ? ` (${c.code})` : ''}: ${c.url}`).join('\n')}\n`);
  if (Array.isArray(resources)) {
    fs.writeFileSync(path.join(outputDir, 'EXTRACTION_REPORT.md'), renderTopLevelReport({ courses, resources }));
    fs.writeFileSync(path.join(outputDir, 'EXTRACTION_QA.md'), '# Qualidade das extrações\n\nConfira o relatório EXTRACTION_REPORT.md e os documentos individuais de cada recurso (status e pendências por item). Nenhum documento é apresentado como integral sem evidência.\n');
  }
}

// Relatório agregado honesto na raiz do ZIP (contagem por status).
function renderTopLevelReport({ courses, resources }) {
  const totals = { integral: 0, partial: 0, inaccessible: 0, not_found: 0, unsupported: 0, videoComTranscricao: 0, videoSemTranscricao: 0 };
  for (const r of resources || []) {
    if (r.status === 'integral') totals.integral++;
    else if (r.status === 'partial') totals.partial++;
    else if (r.status === 'inaccessible' || r.status === 'video-inacessivel') totals.inaccessible++;
    else if (r.status === 'not_found') totals.not_found++;
    else if (r.status === 'unsupported') totals.unsupported++;
    else if (r.status === 'video-com-transcricao') totals.videoComTranscricao++;
    else if (r.status === 'video-registrado') totals.videoSemTranscricao++;
  }
  const lines = [
    '# Relatório de Extração (resumo geral)',
    '',
    `- Matérias: ${courses.map((c) => `${c.title}${c.code ? ` (${c.code})` : ''}`).join('; ')}`,
    '',
    `## Resumo: ${totals.integral} integral, ${totals.partial} parcial, ${totals.inaccessible} inacessível, ${totals.not_found} não encontrado, ${totals.unsupported} não suportado, ${totals.videoComTranscricao} vídeo com transcrição, ${totals.videoSemTranscricao} vídeo sem transcrição (pendência).`,
    '',
    'Cada recurso tem documento individual com status e motivo. Este relatório não esconde pendências;',
    'vídeos sem transcrição constam como limitação/pendência, nunca como extração integral.',
    '',
  ];
  return lines.join('\n');
}

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
  const totals = { integral: 0, partial: 0, inaccessible: 0, not_found: 0, unsupported: 0, videoComTranscricao: 0, videoSemTranscricao: 0 };
  for (const w of weeks) {
    for (const r of w.resources || []) {
      if (r.status === 'integral') totals.integral++;
      else if (r.status === 'partial') totals.partial++;
      else if (r.status === 'inaccessible' || r.status === 'video-inacessivel') totals.inaccessible++;
      else if (r.status === 'not_found') totals.not_found++;
      else if (r.status === 'unsupported') totals.unsupported++;
      else if (r.status === 'video-com-transcricao') totals.videoComTranscricao++;
      else if (r.status === 'video-registrado') totals.videoSemTranscricao++;
    }
  }
  lines.push(`## Resumo: ${totals.integral} integral, ${totals.partial} parcial, ${totals.inaccessible} inacessível, ${totals.not_found} não encontrado, ${totals.unsupported} não suportado, ${totals.videoComTranscricao} vídeo com transcrição, ${totals.videoSemTranscricao} vídeo sem transcrição (pendência).`, '');
  for (const w of weeks) {
    if (!w.name) continue;
    lines.push(`## ${w.name}`);
    for (const r of w.resources || []) {
      const extra = isDoneStatus(r.status) ? '' : (r.reason ? ` — ${r.reason}` : (r.status === 'video-registrado' ? ' — sem transcrição (pendência)' : ''));
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
    const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${zip.path.replace(/'/g, "''")}'); try { ($z.Entries | Where-Object { -not $_.FullName.EndsWith('/') -and -not $_.FullName.EndsWith('\\') }).Count } finally { $z.Dispose() }`;
    const count = parseInt(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 30000, stdio: 'pipe' }).toString().trim(), 10);
    if (!Number.isInteger(count) || count < 0) return { valid: false, reason: 'nao-e-zip' };
    return { valid: true, entries: count, matches: count === zip.files };
  } catch (e) { return { valid: false, reason: 'nao-e-zip' }; }
}

// P0 ZIP — validação obrigatória do fluxo real de salvamento.
// Regra: um ZIP só é considerado VERIFICADO quando `zip.ok === true`,
// `validation.valid === true` e `validation.matches === true`. NUNCA sucesso antes
// disso.
//
// O arquivo é gravado num TEMPORÁRIO no mesmo diretório do destino e só é promovido
// (move) para o destino depois da validação positiva — um arquivo válido existente
// no destino não é corrompido/substituído por uma operação que falhou.
//
// Estados de retorno (campo `state`):
//   'cancelado'    — o estudante cancelou o diálogo (tratado pelo chamador).
//   'nao-criado'   — o ZIP não pôde ser criado.
//   'nao-validado' — o ZIP foi criado mas a validação falhou (integridade).
//   'validado'     — ZIP criado, validado e salvo no destino.
//
// `createZip`/`validateZip` são INJETÁVEIS para testes determinísticos; no app são
// as funções de produção. `onSuccess` (ex.: limpeza da pasta de trabalho) só é
// invocado após a validação positiva.
async function finalizeZip({ srcDir, destPath, createZip, validateZip, onSuccess, logger }) {
  const tmpPath = destPath + '.tmp-' + Date.now();
  let zip = { ok: false, reason: 'nao-iniciado', path: tmpPath, bytes: 0, files: 0 };
  try {
    zip = await createZip(srcDir, tmpPath);
  } catch (e) {
    zip = { ok: false, reason: e && e.message ? e.message : String(e), path: tmpPath, bytes: 0, files: 0 };
  }
  const validation = zip.ok ? validateZip(zip) : { valid: false, reason: zip.reason || 'zip-nao-criado' };
  const verified = zip.ok === true && validation.valid === true && validation.matches === true;

  if (verified) {
    try {
      fs.rmSync(destPath, { force: true });
      fs.renameSync(tmpPath, destPath);
      zip.path = destPath;
    } catch (e) {
      try { fs.rmSync(tmpPath, { force: true }); } catch {}
      return { ok: false, state: 'nao-validado', zip: { ...zip, path: destPath }, validation, preserved: true, retryable: true, error: 'Falha ao gravar o ZIP no destino: ' + e.message };
    }
    if (onSuccess) { try { onSuccess({ ...zip, path: destPath }); } catch (e) { if (logger) logger.error('onSuccess (limpeza) falhou: ' + e.message); } }
    return { ok: true, state: 'validado', zip: { ...zip, path: destPath }, validation };
  }

  // ZIP não validado: remove o temporário, preserva o resultado extraído (workdir
  // NÃO é apagado) e informa falha — nunca ok:true.
  try { fs.rmSync(tmpPath, { force: true }); } catch {}
  const state = zip.ok ? 'nao-validado' : 'nao-criado';
  const error = state === 'nao-validado'
    ? 'O ZIP foi criado, mas a validação falhou (integridade). Nenhum arquivo foi substituído; você pode tentar salvar novamente.'
    : 'Não foi possível criar o ZIP: ' + (zip.reason || 'erro desconhecido');
  return { ok: false, state, zip: { ...zip, path: destPath }, validation, preserved: true, retryable: true, error };
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
  buildSelectionPlan,
  sanitizeReason,
  authExpiredEntries,
  discoverEmbeddedResources,
  extractEmbeddedFromPage,
  normalizeUrlKey,
  resourceIdentityKey,
  MAX_EMBED_DEPTH,
  overallStatus,
  isDoneStatus,
  buildCourseStructure,
  buildTopLevelDocs,
  renderReport,
  renderTopLevelReport,
  zipBaseName,
  createZip,
  validateZip,
  finalizeZip,
  safeName,
  makeFlowLogger,
};
