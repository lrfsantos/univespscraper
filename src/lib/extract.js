// Extração de conteúdo das páginas do AVA (genérico).
// Extrai o conteúdo da região principal (.ava-scope / role=main), links,
// iframes (YouTube) e o título.

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n));
}

function stripTags(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  s = s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n');
  return s;
}

function extractBalanced(html, start) {
  let depth = 0;
  const tagRe = /<div\b[^>]*>|<\/div>/gi;
  tagRe.lastIndex = start;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const token = m[0];
    if (token.startsWith('</')) depth--;
    else depth++;
    if (depth === 0) {
      return html.slice(start, m.index + token.length);
    }
  }
  return html.slice(start);
}

function extractMain(html) {
  const scopeStart = html.indexOf('class="ava-scope"');
  if (scopeStart !== -1) {
    const start = html.lastIndexOf('<div', scopeStart);
    return extractBalanced(html, start);
  }
  const m = html.indexOf('role="main"');
  if (m !== -1) {
    const start = html.lastIndexOf('<div', m);
    return extractBalanced(html, start);
  }
  return html;
}

function extractIframes(html) {
  const out = [];
  const re = /<iframe\b[^>]*src="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(decodeEntities(m[1]));
  return out;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = decodeEntities(m[1]);
    const text = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    if (!href || href.startsWith('#') || href.includes('maincontent')) continue;
    try { href = new URL(href, baseUrl).href; } catch { continue; }
    links.push({ text, href });
  }
  return links;
}

function parsePage(html, baseUrl) {
  const main = extractMain(html);
  const text = stripTags(main).replace(/\n{2,}/g, '\n').trim();
  const links = extractLinks(main, baseUrl);
  const iframes = extractIframes(main);
  const tMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = tMatch ? stripTags(tMatch[1]).replace(/\s+/g, ' ').trim() : '';
  return { title, text, links, iframes };
}

// Classifica uma atividade pelo título (genérico)
function classifyActivity(title) {
  const t = title.toLowerCase();
  if (/material-base|texto-base|v[ií]deo-base/.test(t)) return 'reading';
  if (/videoaula/.test(t)) return 'videoaulas';
  if (/in[ií]cio/.test(t)) return 'inicio';
  if (/aprofundando/.test(t)) return 'aprofundando';
  if (/em s[ií]ntese/.test(t)) return 'sintese';
  if (/atividade avaliativa/.test(t)) return 'quiz';
  return 'other';
}

module.exports = { parsePage, classifyActivity, stripTags, decodeEntities };
