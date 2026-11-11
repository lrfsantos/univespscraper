// Conversor ESTRUTURAL HTML → Markdown (seção 4). Processa o HTML REAL da página
// (não o innerText) preservando headings, parágrafos, listas (inclusive aninhadas),
// tabelas, negrito, itálico, links, blockquotes, código, quebras de linha, texto
// alternativo de imagens e referências de recursos incorporados. Exclui elementos
// de interface (script/style/nav/header/footer/button/form/aside) e NÃO resume nem
// reescreve o conteúdo. Funções PURAS (HTML string -> Markdown string), testáveis
// com fixtures sintéticas.

// ---------- Tokenizador de tags (respeita aspas; ignora comentários/declarações) ----------
function tokenize(html) {
  const tokens = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      if (i < n) tokens.push({ type: 'text', name: null, raw: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: 'text', name: null, raw: html.slice(i, lt) });
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      const end = close === -1 ? n : close + 3;
      tokens.push({ type: 'comment', name: null, raw: html.slice(lt, end) });
      i = end;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const gt = html.indexOf('>', lt);
      const end = gt === -1 ? n : gt + 1;
      tokens.push({ type: 'decl', name: null, raw: html.slice(lt, end) });
      i = end;
      continue;
    }
    let j = lt + 1;
    let quote = null;
    for (; j < n; j++) {
      const ch = html[j];
      if (quote) { if (ch === quote) quote = null; continue; }
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
    tokens.push({ type: isClose ? 'close' : isSelfClose ? 'selfclose' : 'open', name, raw });
    i = end;
  }
  return tokens;
}

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

// ---------- Árvore DOM leve ----------
function buildTree(html) {
  const tokens = tokenize(html);
  const root = { type: 'root', tag: null, attrs: {}, children: [] };
  const stack = [root];
  for (const t of tokens) {
    if (t.type === 'text') { stack[stack.length - 1].children.push({ type: 'text', text: t.raw }); continue; }
    if (t.type === 'comment' || t.type === 'decl') continue;
    if (t.type === 'open' || t.type === 'selfclose') {
      const node = { type: 'element', tag: t.name, attrs: attrsOf(t.raw), children: [], selfClose: t.type === 'selfclose' };
      stack[stack.length - 1].children.push(node);
      if (t.type === 'open' && !VOID_TAGS.has(t.name)) stack.push(node);
    } else if (t.type === 'close') {
      if (stack.length > 1 && stack[stack.length - 1].tag === t.name) stack.pop();
    }
  }
  return root;
}

// ---------- Elementos de interface a EXCLUIR ----------
const UI_TAGS = new Set(['script', 'style', 'nav', 'header', 'footer', 'button', 'input', 'select', 'textarea', 'form', 'aside', 'iframe', 'video', 'audio', 'canvas', 'noscript']);
const SKIP_BLOCK = new Set(['script', 'style', 'nav', 'header', 'footer', 'button', 'form', 'aside', 'noscript', 'head', 'title', 'meta', 'link', 'base']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function textOf(children) {
  let s = '';
  for (const c of children) s += (c.type === 'text' ? c.text : (SKIP_BLOCK.has(c.tag) ? '' : textOf(c.children)));
  return s;
}
function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function resolveHref(href, baseUrl) {
  if (!href) return null;
  try {
    if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
    if (/^(javascript:|#)/i.test(href)) return null;
    if (/^\/\//.test(href)) return 'https:' + href;
    if (baseUrl) return new URL(href, baseUrl).href;
    return href;
  } catch { return null; }
}

// ---------- Inline ----------
function inline(node, baseUrl) {
  const parts = [];
  for (const c of node.children) {
    if (c.type === 'text') { parts.push(c.text); continue; }
    if (SKIP_BLOCK.has(c.tag)) continue;
    // sublistas dentro de li NÃO entram no texto inline (são emitidas como bloco)
    if (c.tag === 'ul' || c.tag === 'ol') continue;
    const inner = inline(c, baseUrl);
    switch (c.tag) {
      case 'strong': case 'b': parts.push('**' + inner + '**'); break;
      case 'em': case 'i': parts.push('*' + inner + '*'); break;
      case 'code': parts.push('`' + inner + '`'); break;
      case 'a': {
        const href = resolveHref(c.attrs.href, baseUrl);
        const label = cleanText(inner);
        parts.push(href ? `[${label || href}](${href})` : label);
        break;
      }
      case 'img': {
        const alt = cleanText(c.attrs.alt || '');
        const src = resolveHref(c.attrs.src, baseUrl) || c.attrs.src || '';
        parts.push(src ? `![${alt}](${src})` : (alt ? `*[imagem: ${alt}]*` : ''));
        break;
      }
      case 'br': parts.push('  \n'); break;
      case 'sub': parts.push('~' + inner + '~'); break;
      case 'sup': parts.push('^' + inner + '^'); break;
      default: parts.push(inner);
    }
  }
  return parts.join('');
}

// ---------- Listas ----------
function listItems(node, baseUrl, depth, ordered) {
  const lines = [];
  let counter = 1;
  for (const c of node.children) {
    if (c.type !== 'element') continue;
    if (c.tag === 'li') {
      const text = inline(c, baseUrl).trim();
      const prefix = ordered ? `${counter}. ` : '- ';
      // sub-listas dentro do li
      const sub = [];
      for (const cc of c.children) {
        if (cc.type === 'element' && (cc.tag === 'ul' || cc.tag === 'ol')) {
          sub.push(listItems(cc, baseUrl, depth + 1, cc.tag === 'ol'));
        }
      }
      const pad = '  '.repeat(depth);
      lines.push(pad + prefix + text);
      for (const s of sub) lines.push(...s);
      counter++;
    } else if (c.tag === 'ul' || c.tag === 'ol') {
      lines.push(...listItems(c, baseUrl, depth, c.tag === 'ol'));
    }
  }
  return lines;
}

// ---------- Tabelas ----------
function tableToMd(node, baseUrl) {
  const rows = [];
  for (const tr of node.children) {
    if (tr.type !== 'element' || tr.tag !== 'tr') continue;
    const cells = [];
    for (const td of tr.children) {
      if (td.type !== 'element') continue;
      if (td.tag === 'th' || td.tag === 'td') cells.push(cleanText(inline(td, baseUrl)));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return '';
  const header = rows[0];
  const out = ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |'];
  for (let i = 1; i < rows.length; i++) out.push('| ' + rows[i].join(' | ') + ' |');
  return out.join('\n');
}

// ---------- Bloco ----------
function block(node, baseUrl, depth) {
  const out = [];
  for (const c of node.children) {
    if (c.type === 'text') {
      const t = c.text.replace(/\s+/g, ' ').trim();
      if (t) out.push({ text: t });
      continue;
    }
    if (c.type !== 'element') continue;
    if (SKIP_BLOCK.has(c.tag)) continue;
    switch (c.tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = Number(c.tag[1]);
        const t = cleanText(inline(c, baseUrl));
        if (t) out.push({ md: '#'.repeat(level) + ' ' + t });
        break;
      }
      case 'p': {
        const t = cleanText(inline(c, baseUrl));
        if (t) out.push({ text: t });
        break;
      }
      case 'ul': case 'ol': {
        const items = listItems(c, baseUrl, depth, c.tag === 'ol');
        if (items.length) out.push({ md: items.join('\n') });
        break;
      }
      case 'blockquote': {
        const inner = block(c, baseUrl, depth);
        const text = inner.map((x) => (x.text || x.md || '')).join('\n\n').trim();
        if (text) out.push({ md: text.split('\n').map((l) => '> ' + l).join('\n') });
        break;
      }
      case 'pre': {
        const code = textOf(c.children).replace(/\s+$/g, '');
        if (code.trim()) out.push({ md: '```\n' + code.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '') + '\n```' });
        break;
      }
      case 'table': {
        const md = tableToMd(c, baseUrl);
        if (md) out.push({ md });
        break;
      }
      case 'hr': out.push({ md: '---' }); break;
      case 'div': case 'section': case 'article': case 'main': case 'span': case 'li': case 'figure':
      case 'html': case 'body': {
        // container: mescla blocos filhos; spans/li tratados como inline quando sem quebra
        const inner = block(c, baseUrl, depth);
        if (inner.length) out.push(...inner);
        break;
      }
      default: {
        // inline/desconhecido: mantém como parágrafo se houver texto
        const t = cleanText(inline(c, baseUrl));
        if (t) out.push({ text: t });
      }
    }
  }
  return out;
}

// Converte HTML em Markdown (estrutura preservada; interface excluída).
function htmlToMarkdown(html, { baseUrl } = {}) {
  const tree = buildTree(String(html || ''));
  const blocks = block(tree, baseUrl, 0);
  const lines = [];
  for (const b of blocks) {
    if (b.md) lines.push(b.md, '');
    else if (b.text) lines.push(b.text, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { htmlToMarkdown, tokenize, attrsOf, buildTree, textOf, cleanText, resolveHref };
