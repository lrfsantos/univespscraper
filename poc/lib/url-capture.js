// Frente 1 — captura de recursos URL (mod/url do AVA).
// Separa página de origem, aba de destino e conteúdo consultável. Nunca permite
// que o texto de interface do AVA seja salvo como conteúdo extraído.
const AVA_URL_VIEW_RE = /\/mod\/url\/view\.php/i;
const UI_INSTRUCTION_RE = /Clique em .+ para abrir o recurso/i;

function sanitizar(url) {
  try { const u = new URL(String(url)); return u.origin + u.pathname; }
  catch { return String(url || '').split(/[?#]/, 1)[0]; }
}

function classificarPagina(url) {
  const u = String(url || '');
  if (!u) return 'sem-url';
  if (/^(about:|chrome-error:|chrome:\/\/|data:)/i.test(u)) return 'invalida';
  if (AVA_URL_VIEW_RE.test(u)) return 'intermediaria';
  if (/\/course\/view\.php/i.test(u)) return 'origem';
  try {
    const x = new URL(u);
    if (x.hostname.endsWith('univesp.br') && /\/mod\//i.test(x.pathname)) return 'intermediaria';
  } catch {}
  return 'externa';
}

// janelas: [{ url }] — decide qual janela corresponde ao destino final.
function avaliarDestinoNavegacao({ origemUrl, janelaUrl, janelas = [] } = {}) {
  const origem = String(origemUrl || '');
  const externas = janelas
    .map((j, indice) => ({ indice, url: String((j && j.url) || '') }))
    .filter((j) => j.url && j.url !== origem && classificarPagina(j.url) === 'externa');
  if (externas.length === 1) return { acao: 'usar-janela', indice: externas[0].indice };
  if (externas.length > 1) return { acao: 'ambigua' };
  const atual = classificarPagina(janelaUrl);
  if (atual === 'externa' && janelaUrl !== origem) return { acao: 'usar-atual' };
  return { acao: 'sem-destino' };
}

// { subKind, origemUrl, destinoUrl, texto }
// Retorna { acao, status, detail, chars } — 'ok' só quando há destino distinto
// da origem e o texto não é instrução da interface.
function avaliarCapturaUrl({ subKind, origemUrl, destinoUrl, texto } = {}) {
  if (subKind !== 'url') return { acao: 'nao-aplicavel' };
  const origem = String(origemUrl || '');
  const destino = String(destinoUrl || '');
  const txt = String(texto || '').trim();
  const semDestino = !destino || AVA_URL_VIEW_RE.test(destino) || destino === origem || /\/course\/view\.php/i.test(destino) || classificarPagina(destino) === 'invalida';
  if (semDestino) return { acao: 'sem-destino', status: 'inaccessible', detail: 'destino-nao-detectado', chars: 0 };
  if (/^\s*(404\b|página não encontrada|page not found|internal server error|err_[a-z_]+)/i.test(txt)) return { acao: 'pagina-erro', status: 'inaccessible', detail: 'pagina-de-erro', chars: 0 };
  if (UI_INSTRUCTION_RE.test(txt)) return { acao: 'interface', status: 'inaccessible', detail: 'texto-de-interface-do-ava', chars: 0 };
  if (!txt) return { acao: 'sem-texto', status: 'inaccessible', detail: 'destino-sem-texto-consultavel', chars: 0 };
  return {
    acao: 'destino',
    status: 'ok',
    detail: `destino=${sanitizar(destino)} origem=${sanitizar(origem)}`,
    chars: txt.length,
  };
}

module.exports = { avaliarCapturaUrl, avaliarDestinoNavegacao, classificarPagina, sanitizar, AVA_URL_VIEW_RE, UI_INSTRUCTION_RE };
