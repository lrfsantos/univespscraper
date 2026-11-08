// Descoberta DINÂMICA de disciplinas, semanas e recursos no AVA (A2/A3/A4/A5).
// Os parsers são PUROS (HTML -> dados) e testáveis com fixtures locais — não
// dependem de AVA, internet ou credenciais. Nenhum ID fixo é usado.
// As URLs de recursos são sempre normalizadas e resolvidas contra a base.

function resolveUrl(href, baseUrl) {
  try {
    if (/^(https?:|mailto:|javascript:)/i.test(href)) return href;
    if (/^\/\//.test(href)) return 'https:' + href;
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

// ---- Parser de disciplinas (/my/courses.php) ----
// Reconhece links de curso (course/view.php?id=N), extrai título e, quando
// presente, código (ex.: "ADM270") a partir de padrões no texto. Marca
// disponibilidade por marcadores de texto ("indisponível", "encerrada", etc.).
function parseCoursesFromHtml(html, baseUrl = 'https://ava.univesp.br') {
  const out = [];
  const seen = new Map();
  const hrefRe = /<a[^>]*href=["']([^"']*course\/view\.php\?id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const id = m[2];
    const url = resolveUrl(m[1], baseUrl);
    if (!url || seen.has(id)) continue;
    // Título preferencial: textos menores e com código (ex.: "ADM270 - Nome")
    // são melhores que o texto completo do cartão do curso.
    let rawTitle = m[3].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
    rawTitle = rawTitle.replace(/\s+/g, ' ').trim();
    if (!rawTitle) continue;
    const prev = seen.get(id);
    const prevCode = prev && prev.rawTitle.match(/\(([A-Z]{2,6}\d{2,4})\)/);
    const curCode = rawTitle.match(/\(([A-Z]{2,6}\d{2,4})\)/);
    if (prev && (curCode ? (prevCode && rawTitle.length >= prev.rawTitle.length) : rawTitle.length >= prev.rawTitle.length)) continue;
    seen.set(id, { id, url, rawTitle });
  }
  for (const c of seen.values()) {
    // Código: "ADM270" isolado, "ADM270 -", ou "(ADM270)".
    const code =
      (c.rawTitle.match(/\(([A-Z]{2,6}\d{2,4})\)/) || [])[1] ||
      (c.rawTitle.match(/\b([A-Z]{2,6}\d{2,4})\b/) || [])[1] ||
      null;
    let title = c.rawTitle;
    if (code) title = c.rawTitle.replace(new RegExp(`\\b${code}\\b|\\s*\\(${code}\\)`, 'g'), '').replace(/\s*[-–—|]\s*/g, ' ').trim();
    title = (title || c.rawTitle || `Disciplina ${c.id}`).replace(/\s+/g, ' ').trim();
    const text = (c.rawTitle + ' ' + title).toLowerCase();
    const unavailable = /indispon[ií]vel|encerrada|fechada|n[aã]o dispon[ií]vel|sem oferta|conclu[ií]da/.test(text);
    out.push({ id: c.id, url: c.url, title, code, available: !unavailable, status: unavailable ? 'indisponivel' : 'ativa' });
  }
  return out;
}

// ---- Parser de semanas/seções (course/view.php?id=N) ----
// Moodle: <li class="section main" id="section-N"> com heading. Retorna TODAS as
// seções com um flag `relevant` (semana) e o BLOCO HTML da seção (para extração
// de recursos por seção) — nada some silenciosamente. A seção 0 (tópico geral)
// é retornada, mas marcada como não-semana.
function parseSectionsFromHtml(html, baseUrl = 'https://ava.univesp.br') {
  const out = [];
  // Casamento robusto: identifica o <li> de seção do Moodle pela classe
  // ("section") e pelo id ("section-N"), independentemente da ordem dos
  // atributos. O bloco interno é preservado para extração de recursos.
  const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const attrs = m[1];
    if (!/\bclass=["'][^"']*\bsection\b[^"']*["']/i.test(attrs)) continue;
    const idM = attrs.match(/\bid=["']section-(\d+)["']/i);
    if (!idM) continue;
    const id = idM[1];
    const block = m[2];
    const nameMatch =
      block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
      block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
      block.match(/<div[^>]*class=["'][^"']*sectionname["'][^"']*["']>([\s\S]*?)<\/div>/i) ||
      block.match(/<span[^>]*class=["'][^"']*sectionname["'][^"']*["']>([\s\S]*?)<\/span>/i);
    const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().replace(/\s+/g, ' ') : '';
    const displayName = name || `Seção ${id}`;
    const relevant = /semana|week/i.test(displayName) || /^\s*\d+\s*$/.test(displayName);
    out.push({
      id,
      name: displayName,
      rawName: name,
      relevant,
      order: Number(id),
      // Seção não tem página própria: os recursos estão no próprio bloco HTML da
      // seção, dentro da página do curso. O bloco é preservado para extração.
      block,
    });
  }
  return out;
}

// ---- Parser de recursos de uma seção ----
// Extrai links e iframes de um BLOCO de seção (HTML). Retorna recursos com URL
// normalizada e texto do âncora. Inclui apenas o essencial para classificação.
function parseResourcesFromSectionHtml(html, baseUrl = 'https://ava.univesp.br') {
  const links = [];
  const iframes = [];
  const linkRe = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const url = resolveUrl(href, baseUrl);
    if (!url || /^(mailto:|#|javascript:)/i.test(url)) continue;
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 200);
    links.push({ text, url, type: 'link' });
  }
  const iframeRe = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((m = iframeRe.exec(html)) !== null) {
    const url = resolveUrl(m[1], baseUrl);
    if (url) iframes.push(url);
  }
  return { links, iframes };
}

// ---- Classificação de recurso (A4/A5) ----
// page (HTML do AVA) | pdf | book (LTI/leitor) | video | unknown
function classifyResource({ url, text = '', type = 'link' }) {
  const u = String(url || '').toLowerCase();
  if (type === 'iframe' || /youtube\.com|youtu\.be|youtube-nocookie|vimeo\.com/.test(u)) {
    return { kind: 'video', subKind: 'embed' };
  }
  if (/\.pdf($|[?#])/i.test(u)) return { kind: 'pdf' };
  if (/\/mod\/lti\//.test(u)) return { kind: 'book', subKind: 'lti' };
  if (/\/mod\/page\//.test(u)) return { kind: 'page', subKind: 'page' };
  if (/\/mod\/url\//.test(u) || /\/mod\/resource\//.test(u)) return { kind: 'page', subKind: 'url' };
  if (/\/mod\/book\//.test(u)) return { kind: 'book', subKind: 'moodle-book' };
  return { kind: 'unknown' };
}

module.exports = { parseCoursesFromHtml, parseSectionsFromHtml, parseResourcesFromSectionHtml, classifyResource, resolveUrl };
