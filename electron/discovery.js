// Descoberta DINÂMICA de disciplinas, semanas e recursos no AVA (A2/A3/A4/A5).
// Os parsers são PUROS (HTML -> dados) e testáveis com fixtures locais — não
// dependem de AVA, internet ou credenciais. Nenhum ID fixo é usado.
// As URLs de recursos são sempre normalizadas e resolvidas contra a base.
//
// Parsing ESTRUTURAL (correção A): em vez de expressões regulares que encerram
// uma seção no primeiro </li>, usamos um scanner de balanceamento de tags que
// respeita elementos <li> aninhados — preservando TODOS os recursos de cada
// semana e os limites corretos entre semanas.

function resolveUrl(href, baseUrl) {
  try {
    if (/^(https?:|mailto:|javascript:)/i.test(href)) return href;
    if (/^\/\//.test(href)) return 'https:' + href;
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

// ---------- Scanner estrutural de tags (HTML -> tokens com posições) ----------

// Separa o HTML em tokens: texto, tags (open/close/selfclose), comentários e
// declarações. Cada token guarda a posição (start/end) no HTML original.
// Respeita aspas em atributos e ignora comentários/declarações.
function scanTags(html) {
  const tokens = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      if (i < n) tokens.push({ type: 'text', name: null, raw: html.slice(i), start: i, end: n });
      break;
    }
    if (lt > i) tokens.push({ type: 'text', name: null, raw: html.slice(i, lt), start: i, end: lt });
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      const end = close === -1 ? n : close + 3;
      tokens.push({ type: 'comment', name: null, raw: html.slice(lt, end), start: lt, end });
      i = end;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const gt = html.indexOf('>', lt);
      const end = gt === -1 ? n : gt + 1;
      tokens.push({ type: 'decl', name: null, raw: html.slice(lt, end), start: lt, end });
      i = end;
      continue;
    }
    // Encontra o fim da tag respeitando aspas.
    let j = lt + 1;
    let quote = null;
    for (; j < n; j++) {
      const ch = html[j];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '>') break;
    }
    const end = j < n ? j + 1 : n;
    const raw = html.slice(lt, end);
    const inner = raw.slice(1, raw.length - (raw.endsWith('>') ? 1 : 0));
    const isClose = inner.startsWith('/');
    const isSelfClose = /\/\s*$/.test(inner);
    const nameMatch = inner.match(/^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/);
    const name = nameMatch ? nameMatch[1].toLowerCase() : null;
    tokens.push({ type: isClose ? 'close' : isSelfClose ? 'selfclose' : 'open', name, raw, start: lt, end });
    i = end;
  }
  return tokens;
}

// Extrai os atributos de uma tag HTML (suporta aspas simples/duplas e sem aspas).
function attrsOf(rawTag) {
  const out = {};
  const inner = rawTag.replace(/^<\/?[a-zA-Z][a-zA-Z0-9]*/, '').replace(/\/\s*>$/, '').trim();
  const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m;
  while ((m = attrRe.exec(inner)) !== null) {
    out[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
  }
  return out;
}

// Retorna os tokens que formam o conteúdo do elemento `name` começando no token
// open `startIdx` (índice do token de abertura). Devolve { open, close, innerStart, innerEnd }
// ou null se não fechar. Respeita aninhamento do mesmo nome de tag.
function balancedElement(tokens, startIdx, name) {
  let depth = 0;
  for (let k = startIdx; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'open' && t.name === name) depth++;
    else if (t.type === 'close' && t.name === name) {
      depth--;
      if (depth === 0) {
        return { open: tokens[startIdx], close: t, innerStart: tokens[startIdx].end, innerEnd: t.start };
      }
    }
  }
  return null;
}

// ---------- Parser de disciplinas (/my/courses.php) ----------

// Separa a SITUAÇÃO acadêmica da DISCIPLINA da DISPONIBILIDADE real de acesso.
// Correção B: palavras como "concluída", "encerrada", "inativa" ou "antiga"
// descrevem a situação acadêmica, NÃO provam que o conteúdo está inacessível.
// Uma matéria só é desabilitada (available=false) quando há evidência concreta
// de que o conteúdo não pode ser acessado.
const INDISPONIVEL_EVIDENCIA_RE = /indispon[ií]vel|n[aã]o dispon[ií]vel|sem oferta|fora do ar|acesso negado|n[aã]o autorizado|matr[ií]cula n[aã]o dispon[ií]vel|vagas encerradas/i;
const SITUACAO_RE = [
  { nome: 'indisponivel', re: INDISPONIVEL_EVIDENCIA_RE },
  { nome: 'concluida', re: /conclu[ií]da|conclu[ií]do/ },
  { nome: 'encerrada', re: /encerrada|encerrado|fechada/ },
  { nome: 'inativa', re: /\binativa\b|\binativo\b|sem oferta/ },
];

function inferSituacao(texto) {
  const t = String(texto || '').toLowerCase();
  for (const s of SITUACAO_RE) {
    if (s.re.test(t)) return s.nome;
  }
  return 'ativa';
}

function parseCoursesFromHtml(html, baseUrl = 'https://ava.univesp.br') {
  const out = [];
  const seen = new Map();
  const hrefRe = /<a[^>]*href=["']([^"']*course\/view\.php\?id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const id = m[2];
    const url = resolveUrl(m[1], baseUrl);
    if (!url || seen.has(id)) continue;
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
    const code =
      (c.rawTitle.match(/\(([A-Z]{2,6}\d{2,4})\)/) || [])[1] ||
      (c.rawTitle.match(/\b([A-Z]{2,6}\d{2,4})\b/) || [])[1] ||
      null;
    let title = c.rawTitle;
    if (code) title = c.rawTitle.replace(new RegExp(`\\b${code}\\b|\\s*\\(${code}\\)`, 'g'), '').replace(/\s*[-–—|]\s*/g, ' ').trim();
    title = (title || c.rawTitle || `Disciplina ${c.id}`).replace(/\s+/g, ' ').trim();
    // Situação acadêmica (rótulo) × disponibilidade real (só evidência concreta).
    const situacao = inferSituacao(c.rawTitle + ' ' + title);
    const available = !INDISPONIVEL_EVIDENCIA_RE.test((c.rawTitle + ' ' + title).toLowerCase());
    out.push({ id: c.id, url: c.url, title, code, situacao, available, status: available ? situacao : 'indisponivel' });
  }
  return out;
}

// ---------- Parser de semanas/seções (course/view.php?id=N) ----------

// Parsing ESTRUTURAL (correção A): localiza <li class="section ..." id="section-N">
// e extrai o BLOCO balanceado — respeitando <li> aninhados dentro da semana, sem
// encerrar no primeiro </li>. Preserva TODOS os recursos de cada semana.
// A seção 0 (geral) é retornada, mas marcada como não-semana.
function parseSectionsFromHtml(html) {
  const tokens = scanTags(html);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'open' || t.name !== 'li') continue;
    const attrs = attrsOf(t.raw);
    const classes = String(attrs.class || '');
    if (!/\bsection\b/.test(classes)) continue;
    const idM = String(attrs.id || '').match(/^section-(\d+)$/);
    if (!idM) continue;
    const id = idM[1];
    const el = balancedElement(tokens, i, 'li');
    if (!el) continue;
    const block = html.slice(el.innerStart, el.innerEnd);
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
      block,
    });
    i = el.close ? tokens.indexOf(el.close) : i;
  }
  return out;
}

// ---------- Parser de recursos de uma seção ----------
// Extrai links e iframes de um BLOCO de seção usando o scanner estrutural
// (links/iframes são elementos balanceados, não regex sobre a tag inteira).

function parseResourcesFromSectionHtml(html, baseUrl = 'https://ava.univesp.br') {
  const links = [];
  const iframes = [];
  const tokens = scanTags(html);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'open') continue;
    if (t.name === 'a') {
      const el = balancedElement(tokens, i, 'a');
      const href = attrsOf(t.raw).href || '';
      const url = resolveUrl(href, baseUrl);
      if (!url || /^(mailto:|#|javascript:)/i.test(url)) continue;
      const inner = el ? html.slice(el.innerStart, el.innerEnd) : '';
      const text = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 200);
      links.push({ text, url, type: 'link' });
      if (el) i = tokens.indexOf(el.close);
    } else if (t.name === 'iframe') {
      const src = attrsOf(t.raw).src || '';
      const url = resolveUrl(src, baseUrl);
      if (url) iframes.push(url);
    }
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

// Correção E: extrai do texto do âncora do AVA a identificação esperada do
// material (livro e capítulo) QUANDO o AVA a fornece explicitamente — ex.:
// "Texto-base - X (Leia o Capítulo 1) | Autor". Nunca inventa capítulo/páginas:
// quando ausente, representa a ausência EXPLÍCITA (hasChapter:false,
// chapter:null, hasPageRange:false). Esse objeto é passado a extractBook para
// navegação e validação estrutural conservadora (capítulo esperado × aberto).
function parseExpectedFromResource({ text = '', url = '' } = {}) {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const expected = {
    book: null,
    chapter: null,
    hasChapter: false,
    pageRange: null,
    hasPageRange: false,
    source: 'ancora-do-ava',
  };
  const capM = t.match(/cap[ií]tulo\s*(\d+)/i);
  if (capM) {
    expected.chapter = parseInt(capM[1], 10);
    expected.hasChapter = true;
  }
  const pagM = t.match(/(?:p[aá]ginas?|p\.)\s*(\d+)\s*(?:[-–—aà]\s*(\d+))?/i);
  if (pagM) {
    expected.pageRange = { start: parseInt(pagM[1], 10), end: pagM[2] ? parseInt(pagM[2], 10) : null };
    expected.hasPageRange = true;
  }
  let book = t.split('|')[0].trim();
  book = book.replace(/^(texto[- ]base|leitura|material)\s*[-–—:]\s*/i, '').trim();
  book = book.replace(/\(\s*leia\s+o\s+cap[ií]tulo\s+\d+\s*\)\s*$/i, '').trim();
  book = book.replace(/\(\s*p[aá]ginas?\s+[\d\s\-–—aà]+\s*\)\s*$/i, '').trim();
  book = book.replace(/[-–—]\s*leia\s+(?:o\s+cap[ií]tulo\s+\d+|as\s+p[aá]ginas?\s+[\d\s\-–—aà]+)\s*$/i, '').trim();
  if (book) expected.book = book;
  return expected;
}

module.exports = { parseCoursesFromHtml, parseSectionsFromHtml, parseResourcesFromSectionHtml, classifyResource, resolveUrl, parseExpectedFromResource, scanTags, attrsOf, balancedElement, inferSituacao };
