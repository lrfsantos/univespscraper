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

// Filhos DIRETOS (findAll é recursivo; para coleções hierárquicas como ol>li e
// navPoint>navPoint é preciso apenas o nível imediato — senão entradas aninhadas
// são visitadas várias vezes e duplicadas).
function childrenNamed(node, name) {
  return (node && node.children ? node.children : []).filter((c) => c.name === name);
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
    if (id) manifest[id] = { href: item.attrs.href || '', mediaType: item.attrs['media-type'] || '', properties: item.attrs.properties || '' };
  }
  const spine = [];
  let spineToc = null;
  const spineEl = findAll(root, 'spine')[0];
  if (spineEl && spineEl.attrs && spineEl.attrs.toc) spineToc = spineEl.attrs.toc;
  for (const it of findAll(root, 'itemref')) {
    const idref = it.attrs.idref;
    if (idref && manifest[idref]) spine.push(idref);
  }
  if (!spine.length) return null;
  return { manifest, spine, spineToc, packageDir: path.dirname(opfPath) };
}

function resolveRel(baseDir, rel) {
  try { return path.normalize(path.resolve(baseDir, decodeURIComponent(rel.split('#')[0]))); } catch { return null; }
}

function entryPath(entry, baseDir) {
  return entry && entry.href ? resolveRel(baseDir, entry.href) : null;
}

// Resolve uma referência (href) contra uma base (diretório do filesystem OU URL).
// Fragmentos de URL (#...) NÃO fazem parte do caminho do documento — são
// removidos. Usada tanto pelo parser de diretório quanto pelo parser por string
// (produção por URL).
function resolveRef(base, ref) {
  if (!ref) return null;
  const clean = String(ref).split('#')[0];
  if (!clean) return null;
  if (typeof base === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    try { return new URL(clean, base).href; } catch { return null; }
  }
  try { return path.normalize(path.resolve(base, decodeURIComponent(clean))); } catch { return null; }
}

// Resolve um href do pacote contra a base do OPF (diretório ou URL).
// Sem base (modo string sem baseUrl), retorna o caminho relativo normalizado
// (fragmentos removidos) para permitir comparação direta com hrefs de manifest.
function pkgResolve(pkg, href) {
  if (!pkg || !href) return null;
  if (pkg.packageUrl) return resolveRef(pkg.packageUrl, href);
  if (pkg.packageDir) return resolveRef(pkg.packageDir, href);
  return normPath(String(href).split('#')[0]) || null;
}

// Caminho normalizado (minúsculas, separador '/') para comparação.
function normPath(p) {
  return (p || '').replace(/\\/g, '/').toLowerCase();
}

// ---- Navegação (EPUB 2 NCX e EPUB 3 nav.xhtml) ----

// Coleta uma cadeia de navPoint do NCX preservando a HIERARQUIA (profundidade).
// href resolvido relativamente ao diretório do arquivo NCX.
function collectNcxNavPoint(np, baseDir, depth) {
  const out = [];
  const label = firstText(findAll(np, 'navLabel')[0]);
  const content = findAll(np, 'content')[0];
  if (content && content.attrs.src) {
    out.push({ label: label.trim(), href: resolveRef(baseDir, content.attrs.src), rawHref: content.attrs.src, depth, kind: 'ncx' });
  }
  // Só filhos DIRETOS (findAll seria recursivo e duplicaria os aninhados).
  for (const child of childrenNamed(np, 'navPoint')) {
    out.push(...collectNcxNavPoint(child, baseDir, depth + 1));
  }
  return out;
}

// Verifica se um elemento nav é o SUMÁRIO (epub:type="toc"). Tolera prefixo de
// namespace alternativo (ex.: epub:type) e marcação sem prefixo.
function isTocNav(nav) {
  const t = nav.attrs && nav.attrs['epub:type'];
  if (t === 'toc' || /(^|\s)toc($|\s)/i.test(t || '')) return true;
  if (nav.attrs && nav.attrs.type === 'toc') return true;
  // sem atributo epub:type: só considera nav se for o único nav do documento
  return false;
}

// Coleta a estrutura de listas do nav.xhtml (ol > li > a, com sublistas aninhadas),
// preservando a HIERARQUIA. Só o nav epub:type="toc" é considerado sumário.
function collectNavList(ol, baseDir, depth) {
  const out = [];
  // Só li DIRETOS do ol (findAll seria recursivo e duplicaria os aninhados).
  for (const li of childrenNamed(ol, 'li')) {
    const a = findAll(li, 'a')[0];
    if (a && a.attrs.href) {
      const label = (a.children.map((c) => c.value || '').join('') || '').trim();
      out.push({ label, href: resolveRef(baseDir, a.attrs.href), rawHref: a.attrs.href, depth, kind: 'nav' });
    }
    // Só ol DIRETOS do li.
    for (const sub of childrenNamed(li, 'ol')) {
      out.push(...collectNavList(sub, baseDir, depth + 1));
    }
  }
  return out;
}

// Lê entradas de navegação: { label, href(resolvido), rawHref, depth, kind }.
// Suporta EPUB 2 (NCX) e EPUB 3 (nav.xhtml com epub:type="toc"), na ordem do
// documento. Caminhos resolvidos relativamente ao ARQUIVO de navegação.
function readNav(pkg) {
  const entries = [];
  // EPUB 2: toc.ncx (media-type application/x-dtbncx+xml ou href *.ncx)
  for (const id of Object.keys(pkg.manifest)) {
    const e = pkg.manifest[id];
    if (!/ncx/i.test(e.mediaType) && !/\.ncx$/i.test(e.href)) continue;
    const p = entryPath(e, pkg.packageDir);
    const root = readXmlFile(p);
    if (!root) continue;
    const baseDir = path.dirname(p);
    const navMap = findAll(root, 'navMap')[0] || root;
    // Só os navPoint de TOPO (collectNcxNavPoint já desce pelos filhos diretos).
    for (const np of childrenNamed(navMap, 'navPoint')) {
      for (const en of collectNcxNavPoint(np, baseDir, 0)) entries.push(en);
    }
  }
  // EPUB 3: nav.xhtml com nav[epub:type="toc"]
  for (const id of Object.keys(pkg.manifest)) {
    const e = pkg.manifest[id];
    if (!/\.x?html?$/i.test(e.href)) continue;
    const p = entryPath(e, pkg.packageDir);
    const root = readXmlFile(p);
    if (!root) continue;
    const navs = findAll(root, 'nav');
    const tocNav = navs.find(isTocNav);
    if (!tocNav) continue;
    const baseDir = path.dirname(p);
    // Apenas a PRIMEIRA lista (a de topo, ancestral de todas) — coletá-la uma vez
    // produz a árvore completa sem duplicar os itens aninhados.
    const topOl = findAll(tocNav, 'ol')[0];
    if (topOl) {
      for (const en of collectNavList(topOl, baseDir, 0)) entries.push(en);
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

// Mapeia uma entrada de navegação para um item do spine.
// Preferência: caminho RESOLVIDO (normalizado) do documento; basename apenas
// quando for ÚNICO entre os itens do spine (rejeita correspondências ambíguas).
function navEntryToSpineId(entry, pkg) {
  if (!entry || !entry.href) return null;
  const resolved = normPath(entry.href);
  const byPath = [];
  const basenames = new Map();
  for (const id of pkg.spine) {
    const href = pkg.manifest[id] && pkg.manifest[id].href;
    if (!href) continue;
    const hrefResolved = normPath(pkgResolve(pkg, href));
    if (hrefResolved === resolved) byPath.push(id);
    const base = normPath(href).split('/').pop();
    if (base) basenames.set(base, (basenames.get(base) || []).concat(id));
  }
  if (byPath.length === 1) return byPath[0];
  if (byPath.length > 1) return null; // caminho ambíguo no spine
  // fallback por basename SOMENTE se único
  const b = normPath(entry.href).split('/').pop();
  if (b && basenames.get(b) && basenames.get(b).length === 1) return basenames.get(b)[0];
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
// extractedDocIds: ids do spine, hrefs (relativos ao OPF) ou caminhos RESOLVIDOS
// dos documentos efetivamente extraídos. A comparação usa o CAMINHO RESOLVIDO
// normalizado (colisões de basename entre diretórios distintos NÃO colidem);
// basename é aceito somente quando for ÚNICO no spine.
function validateChapterExtraction({ pkg, chapter, extractedDocIds }) {
  const b = findChapterBoundary({ pkg, chapter });
  if (!b.boundaryKnown) {
    return { boundaryKnown: false, endOk: false, allChapterItemsExtracted: false, nextChapterIncluded: false, status: 'partial', reason: b.reason, chapterIds: [], nextChapterFirstId: null };
  }
  // Conjunto de formas normalizadas dos documentos extraídos: aceita id do spine,
  // href (relativo ao OPF) e caminho resolvido — todos normalizados/resolvidos.
  const extractedSet = new Set();
  for (const raw of extractedDocIds || []) {
    const s = String(raw);
    extractedSet.add(normPath(s));
    const res = pkgResolve(pkg, s);
    if (res) extractedSet.add(normPath(res));
    if (pkg.manifest[s] && pkg.manifest[s].href) {
      const r = pkgResolve(pkg, pkg.manifest[s].href);
      if (r) extractedSet.add(normPath(r));
    }
  }
  // Caminho resolvido de cada item do spine (pode haver duplicados entre ids? não, cada id tem href).
  const resolvedById = new Map();
  const basenameCount = new Map();
  for (const id of pkg.spine) {
    const href = pkg.manifest[id] && pkg.manifest[id].href;
    if (!href) continue;
    const r = normPath(pkgResolve(pkg, href));
    resolvedById.set(id, r);
    const base = normPath(href).split('/').pop();
    if (base) basenameCount.set(base, (basenameCount.get(base) || 0) + 1);
  }
  const inExtracted = (id) => {
    const r = resolvedById.get(id);
    if (r && extractedSet.has(r)) return true;
    // id do spine diretamente
    if (extractedSet.has(normPath(id))) return true;
    // basename só se único
    const href = pkg.manifest[id] && pkg.manifest[id].href;
    const base = href ? normPath(href).split('/').pop() : '';
    return !!(base && basenameCount.get(base) === 1 && extractedSet.has(base));
  };
  const allChapterItemsExtracted = b.chapterIds.every(inExtracted);
  const nextChapterIncluded = inExtracted(b.nextChapterFirstId);
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

// ---- Parser do pacote a partir de STRINGS (produção: pacote servido por URL) ----

// Parseia manifest + spine diretamente do XML do OPF (sem tocar no filesystem).
// Útil para a extração de produção, onde o EPUB é servido por URL e o OPF é
// obtido via fetch no frame de conteúdo (mesma origem).
function parseOpfFromXml(opfXml) {
  const root = parseXml(opfXml || '');
  const manifest = {};
  for (const item of findAll(root, 'item')) {
    const id = item.attrs.id;
    if (id) manifest[id] = {
      href: item.attrs.href || '',
      mediaType: item.attrs['media-type'] || '',
      properties: item.attrs.properties || '',
    };
  }
  const spine = [];
  let spineToc = null;
  const spineEl = findAll(root, 'spine')[0];
  if (spineEl && spineEl.attrs && spineEl.attrs.toc) spineToc = spineEl.attrs.toc;
  for (const it of findAll(root, 'itemref')) {
    const idref = it.attrs.idref;
    if (idref && manifest[idref]) spine.push(idref);
  }
  if (!spine.length) return null;
  return { manifest, spine, spineToc, packageDir: null, packageUrl: null };
}

// Parseia entradas de navegação do NCX (toc.ncx) a partir do XML.
// Retorna { label, href(raw), rawHref, depth, kind } — href ainda NÃO resolvido;
// a resolução contra a base acontece em resolveNavEntries.
function navFromNcxXml(ncxXml) {
  const root = parseXml(ncxXml || '');
  const entries = [];
  const navMap = findAll(root, 'navMap')[0] || root;
  // Só os navPoint de TOPO (collectNcxNavPoint desce pelos filhos diretos).
  for (const np of childrenNamed(navMap, 'navPoint')) {
    for (const en of collectNcxNavPoint(np, '.', 0)) {
      entries.push({ label: en.label, href: en.rawHref, rawHref: en.rawHref, depth: en.depth, kind: 'ncx' });
    }
  }
  return entries;
}

// Parseia a navegação EPUB 3 (nav.xhtml) a partir do HTML/XML. Identifica o
// nav[epub:type="toc"], preserva a hierarquia ol>li>a com sublistas e retorna
// entradas com href RAW (resolvido depois contra a base do pacote).
function navFromNavHtml(navHtml) {
  const root = parseXml(navHtml || '');
  const entries = [];
  const navs = findAll(root, 'nav');
  const tocNav = navs.find(isTocNav);
  if (!tocNav) return entries;
  // Apenas a PRIMEIRA lista (a de topo) — coletá-la uma vez produz a árvore
  // completa, sem duplicar os itens aninhados.
  const topOl = findAll(tocNav, 'ol')[0];
  if (topOl) {
    for (const en of collectNavList(topOl, '.', 0)) {
      entries.push({ label: en.label, href: en.rawHref, rawHref: en.rawHref, depth: en.depth, kind: 'nav' });
    }
  }
  return entries;
}

// Resolve hrefs RAW de entradas de navegação contra a base (URL ou diretório),
// removendo fragmentos e mantendo a hierarquia.
function resolveNavEntries(entries, base) {
  return (entries || []).map((e) => ({ ...e, href: resolveRef(base, e.href) }));
}

// Localiza os documentos de navegação (NCX e/ou nav.xhtml) pelos metadados do
// manifest + spine, SEM depender de nomes fixos (toc.ncx/nav.xhtml):
//   - NCX: item referenciado por <spine toc="..."> (EPUB 2), ou media-type
//     application/x-dtbncx+xml, ou href terminado em .ncx;
//   - EPUB 3 nav: item com properties="nav", ou href terminado em nav.xhtml.
// Retorna hrefs RAW (relativos ao diretório do OPF) na ordem de preferência.
function discoverNavTargets(pkg) {
  const ncxHrefs = [];
  const navHrefs = [];
  if (!pkg || !pkg.manifest) return { ncxHrefs, navHrefs };
  const push = (arr, href) => { if (href && !arr.includes(href)) arr.push(href); };
  if (pkg.spineToc && pkg.manifest[pkg.spineToc]) push(ncxHrefs, pkg.manifest[pkg.spineToc].href);
  for (const id of Object.keys(pkg.manifest)) {
    const e = pkg.manifest[id];
    const href = String(e.href || '');
    const mt = String(e.mediaType || '');
    const props = String(e.properties || '').split(/\s+/).filter(Boolean);
    if (/x-dtbncx(\+xml)?/i.test(mt) || /\.ncx$/i.test(href)) push(ncxHrefs, href);
    if (props.includes('nav')) push(navHrefs, href);
    else if (/nav\.xhtml$/i.test(href)) push(navHrefs, href);
  }
  return { ncxHrefs, navHrefs };
}

// Parser completo a partir de strings (OPF + NCX e/ou nav.xhtml).
// baseUrl: URL do diretório do OPF (produção por URL) — usada para resolver hrefs
// de manifest e navegação no mesmo espaço. ncxBase/navBase: diretórios dos arquivos
// de navegação (padrão: baseUrl) — quando o nav.xhtml/NCX está em SUBDIRETÓRIO, os
// hrefs internos são relativos ao ARQUIVO de navegação, não ao OPF.
function parsePackageFromXml({ opfXml, ncxXml, navHtml, baseUrl, ncxBase, navBase } = {}) {
  const pkg = parseOpfFromXml(opfXml);
  if (!pkg) return { ok: false, reason: 'opf-ausente-ou-invalido' };
  if (baseUrl) pkg.packageUrl = baseUrl;
  let nav = [];
  if (ncxXml) nav = nav.concat(resolveNavEntries(navFromNcxXml(ncxXml), ncxBase || baseUrl || '.'));
  if (navHtml) nav = nav.concat(resolveNavEntries(navFromNavHtml(navHtml), navBase || baseUrl || '.'));
  pkg.nav = nav;
  return { ok: true, pkg };
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
  parsePackageFromXml,
  parseOpfFromXml,
  navFromNcxXml,
  navFromNavHtml,
  resolveNavEntries,
  isTocNav,
  collectNavList,
  collectNcxNavPoint,
  readNav,
  discoverNavTargets,
  childrenNamed,
  pkgResolve,
  resolveRef,
  normPath,
};
