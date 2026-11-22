// Frente 1 — captura de recursos URL (mod/url do AVA).
// Separa página de origem, aba de destino e conteúdo consultável. Nunca permite
// que o texto de interface do AVA seja salvo como conteúdo extraído.
const AVA_URL_VIEW_RE = /\/mod\/url\/view\.php/i;
const UI_INSTRUCTION_RE = /Clique em .+ para abrir o recurso/i;

function sanitizar(url) {
  try { const u = new URL(String(url)); return u.origin + u.pathname; }
  catch { return String(url || '').split(/[?#]/, 1)[0]; }
}

// { subKind, origemUrl, destinoUrl, texto }
// Retorna { acao, status, detail, chars } — 'ok' só quando há destino distinto
// da origem e o texto não é instrução da interface.
function avaliarCapturaUrl({ subKind, origemUrl, destinoUrl, texto } = {}) {
  if (subKind !== 'url') return { acao: 'nao-aplicavel' };
  const origem = String(origemUrl || '');
  const destino = String(destinoUrl || '');
  const txt = String(texto || '').trim();
  const semDestino = !destino || AVA_URL_VIEW_RE.test(destino) || destino === origem || /\/course\/view\.php/i.test(destino);
  if (semDestino) return { acao: 'sem-destino', status: 'inaccessible', detail: 'destino-nao-detectado', chars: 0 };
  if (UI_INSTRUCTION_RE.test(txt)) return { acao: 'interface', status: 'inaccessible', detail: 'texto-de-interface-do-ava', chars: 0 };
  return {
    acao: 'destino',
    status: 'ok',
    detail: `destino=${sanitizar(destino)} origem=${sanitizar(origem)}`,
    chars: txt.length,
  };
}

module.exports = { avaliarCapturaUrl, sanitizar, AVA_URL_VIEW_RE, UI_INSTRUCTION_RE };
