// Validação ESTRUTURAL de capítulos em pacotes EPUB (Issue A).
//
// Objetivo: não usar pontuação final nem tamanho de texto como prova de
// integridade. A integridade de um capítulo é validada pela estrutura do EPUB:
//   - META-INF/container.xml -> rootfile -> OPF
//   - OPF: manifest (id -> href) e spine (ordem de leitura)
//   - navegação (NCX toc.ncx e/ou nav.xhtml) mapeando rótulos de capítulo aos
//     itens do spine
// Um capítulo pode abranger VÁRIOS documentos do spine. O fim do capítulo é o
// primeiro item do capítulo seguinte. Sem evidência estrutural de limite,
// endOk = false (nunca integral).
//
// Usado pelos testes sintéticos (fixtures) e pela extração quando o pacote
// EPUB está acessível localmente.

const fs = require('fs');
const path = require('path');

// ---- Parser XML mínimo (sem dependência externa) ----

function parseXml(text) {
  const root = { name: '#root', children: [] };
  const stack = [root];
  const tagRe = /<([/!?]?)([A-Za-z0-9_:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let lastIndex = 0;
  let m;
  const pushText = () => {
    const gap = text.slice(lastIndex, m ? m.index : text.length);
    if (gap && gap.trim()) stack[stack.length - 1].children.push({ name: '#text', value: gap, children: [] });
  };
  while ((m = tagRe.exec(text)) !== null) {
    pushText();
    lastIndex = tagRe.lastIndex;
    const slash = m[1];
    if (slash === '?' || slash === '!') continue;
    if (slash === '/') { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    const attrRe = /([A-Za-z0-9_:.-]+)\s*=\s*"([^"]*)"|([A-Za-z0-9_:.-]+)\s*=\s*'([^']*)'/g;
    let a;
    while ((a = attrRe.exec(m[3])) !== null) attrs[a[1] || a[3]] = a[2] !== undefined ? a[2] : a[4];
    const el = { name: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (m[4] !== '/') stack.push(el);
  }
  pushText();
  return root;
}

function findAll(node, name) {
  const out = [];
  (function walk(n) {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  })(node);
  return out;
}

function firstText(node) {
  if (!node) return '';
  const t = findAll(node, '#text')[0];
  return t && t.value ? t.value : '';
}

// ---- Leitura do pacote ----

function readXmlFile(p) {
  if (!fs.existsSync(p)) return null;
  try { return parseXml(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// Localiza o caminho do OPF via META-INF/container.xml. Retorna null se ausente.
function opfPathFromContainer(dir) {
  const p = path.join(dir, 'META-INF', 'container.xml');
  const root = readXmlFile(p);
  if (!root) return null;
  const rf = findAll(root, 'rootfile').find((r) => r.attrs['full-path']);
  return rf ? path.join(dir, rf.attrs['full-path']) : null;
}

// Lê manifest e spine do OPF. Retorna null se OPF ausente/inválido.
function readOpf(opfPath) {
  const root = readXmlFile(opfPath);
  if (!root) return null;
  const manifest = {};
  for (const item of findAll(root, 'item')) {
    const id = item.attrs.id;
    if (id) manifest[id] = { href: item.attrs.href || '', mediaType: item.attrs['media-type'] || '' };
  }
  const spine = [];
  for (const it of findAll(root, 'itemref')) {
    const idref = it.attrs.idref;
    if (idref && manifest[idref]) spine.push(idref);
  }
  if (!spine.length) return null;
  return { manifest, spine, packageDir: path.dirname(opfPath) };
}

function resolveRel(baseDir, rel) {
  try { return path.normalize(path.resolve(baseDir, decodeURIComponent(rel.split('#')[0]))); } catch { return null; }
}

function entryPath(entry, baseDir) {
  return entry && entry.href ? resolveRel(baseDir, entry.href) : null;
}

// ---- Navegação (NCX e/ou nav.xhtml) ----

// Lê entradas de navegação: { label, href } na ordem do documento.
function readNav(pkg) {
  const entries = [];
  // NCX: toc.ncx em qualquer lugar do pacote
  for (const id of Object.keys(pkg.manifest)) {
    const e = pkg.manifest[id];
    if (!/ncx/i.test(e.mediaType) && !/\.ncx$/i.test(e.href)) continue;
    const p = entryPath(e, pkg.packageDir);
    const root = readXmlFile(p);
    if (!root) continue;
    for (const np of findAll(root, 'navPoint')) {
      const label = firstText(findAll(np, 'navLabel')[0]);
      const content = findAll(np, 'content')[0];
      if (content && content.attrs.src) entries.push({ label: label.trim(), href: resolveRel(pkg.packageDir, content.attrs.src) });
    }
  }
  // nav.xhtml (EPUB 3)
  for (const id of Object.keys(pkg.manifest)) {
    const e = pkg.manifest[id];
    if (!/\.x?html?$/i.test(e.href)) continue;
    const p = entryPath(e, pkg.packageDir);
    const root = readXmlFile(p);
    if (!root || !findAll(root, 'nav').length) continue;
    for (const a of findAll(root, 'a')) {
      if (a.attrs.href) entries.push({ label: (a.children.map((c) => c.value || '').join('') || '').trim(), href: resolveRel(pkg.packageDir, a.attrs.href) });
    }
  }
  return entries;
}

// ---- Análise de capítulo ----

const CHAPTER_LABEL_RE = /cap[ií]tulo\s*(\d+)\b/i;

function chapterNumber(label) {
  const m = CHAPTER_LABEL_RE.exec(label || '');
  return m ? parseInt(m[1], 10) : null;
}

// Mapeia uma entrada de navegação para um item do spine (por caminho).
function navEntryToSpineId(entry, pkg) {
  if (!entry || !entry.href) return null;
  const base = entry.href.replace(/\\/g, '/').toLowerCase();
  for (const id of pkg.spine) {
    const href = (pkg.manifest[id].href || '').replace(/\\/g, '/').toLowerCase();
    if (href === base) return id;
  }
  // fallback: mesmo nome de arquivo
  const b = path.basename(base);
  for (const id of pkg.spine) {
    if (path.basename((pkg.manifest[id].href || '').toLowerCase()) === b) return id;
  }
  return null;
}

// Identifica o intervalo estrutural do capítulo solicitado.
// Retorna { boundaryKnown, chapterIds, nextChapterFirstId, label, reason? }.
function findChapterBoundary({ pkg, chapter }) {
  if (!pkg) return { boundaryKnown: false, reason: 'pacote-epub-indisponivel' };
  const byNum = [];
  for (const entry of pkg.nav || []) {
    const n = chapterNumber(entry.label);
    if (n != null) byNum.push({ n, entry });
  }
  byNum.sort((a, b) => a.n - b.n);
  const cur = byNum.find((x) => x.n === chapter);
  if (!cur) return { boundaryKnown: false, reason: 'capitulo-nao-identificado-na-navegacao' };
  const curId = navEntryToSpineId(cur.entry, pkg);
  if (!curId) return { boundaryKnown: false, reason: 'capitulo-sem-item-correspondente-no-spine' };
  const startPos = pkg.spine.indexOf(curId);
  if (startPos === -1) return { boundaryKnown: false, reason: 'capitulo-fora-do-spine' };
  const next = byNum.find((x) => x.n === chapter + 1);
  let endPos = null;
  let nextChapterFirstId = null;
  let nextLabel = null;
  if (next) {
    const nextId = navEntryToSpineId(next.entry, pkg);
    if (nextId) {
      endPos = pkg.spine.indexOf(nextId);
      nextChapterFirstId = nextId;
      nextLabel = next.entry.label;
    }
  }
  if (endPos === null) {
    // Sem capítulo seguinte na navegação: limite NÃO identificável com confiança.
    return { boundaryKnown: false, reason: 'proximo-capitulo-nao-identificado' };
  }
  if (endPos <= startPos) return { boundaryKnown: false, reason: 'limite-invalido-no-spine' };
  const chapterIds = pkg.spine.slice(startPos, endPos);
  if (!chapterIds.length) return { boundaryKnown: false, reason: 'capitulo-sem-documentos' };
  return { boundaryKnown: true, chapterIds, nextChapterFirstId, startPos, endPos, label: cur.entry.label, nextLabel };
}

// Valida uma extração contra a estrutura do EPUB.
// extractedDocIds: ids (ou caminhos) dos documentos efetivamente extraídos.
function validateChapterExtraction({ pkg, chapter, extractedDocIds }) {
  const b = findChapterBoundary({ pkg, chapter });
  if (!b.boundaryKnown) {
    return { boundaryKnown: false, endOk: false, allChapterItemsExtracted: false, nextChapterIncluded: false, status: 'partial', reason: b.reason, chapterIds: [], nextChapterFirstId: null };
  }
  const extracted = new Set(extractedDocIds || []);
  const allChapterItemsExtracted = b.chapterIds.every((id) => extracted.has(id));
  const nextChapterIncluded = extracted.has(b.nextChapterFirstId);
  const endOk = allChapterItemsExtracted && !nextChapterIncluded;
  return {
    boundaryKnown: true,
    endOk,
    allChapterItemsExtracted,
    nextChapterIncluded,
    chapterIds: b.chapterIds,
    nextChapterFirstId: b.nextChapterFirstId,
    status: endOk ? 'integral-valid' : 'partial',
    label: b.label,
    nextLabel: b.nextLabel,
  };
}

// Parser completo de um pacote EPUB em diretório.
function parseEpubPackage(dir) {
  const opfPath = opfPathFromContainer(dir);
  if (!opfPath) return { ok: false, reason: 'container-ausente-ou-invalido' };
  const pkg = readOpf(opfPath);
  if (!pkg) return { ok: false, reason: 'opf-ausente-ou-invalido' };
  pkg.nav = readNav(pkg);
  return { ok: true, pkg, opfPath };
}

module.exports = {
  parseEpubPackage,
  findChapterBoundary,
  validateChapterExtraction,
  chapterNumber,
  CHAPTER_LABEL_RE,
  parseXml,
};
