// Memória LOCAL de navegação de leitores (fora do Git quando contém dados do AVA).
// Guarda apenas referências sanitizadas: host+caminho, id do recurso e motivo.
// NUNCA grava código temporário de URL, token, cookie, senha ou texto de livro.
const fs = require('fs');
const path = require('path');

function sanitizeUrl(u) {
  try {
    const x = new URL(String(u || ''));
    const id = x.searchParams.get('id');
    return x.origin + x.pathname + (id ? '?id=' + id : '');
  } catch { return '<url-indisponivel>'; }
}

function load(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : { erros: {}, preferencias: {} };
  } catch { return { erros: {}, preferencias: {} }; }
}

function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function keyFor(record) {
  return [record.formato || 'unknown', record.host || 'unknown', record.motivo || 'unknown'].join('|');
}

// Registra falha de leitura e aumenta a preferência por Clássico quando o
// Beta/Pearson falha em reconhecer o leitor ou não expõe texto.
function learnFailure(state, record) {
  const key = keyFor(record);
  const item = state.erros[key] || { quantidade: 0, exemplos: [] };
  item.quantidade += 1;
  const exemplo = {
    disciplina: record.disciplina || null,
    semana: record.semana || null,
    titulo: record.titulo || null,
    recursoId: record.recursoId || null,
    url: sanitizeUrl(record.url),
    formato: record.formato || null,
    motivo: record.motivo || null,
    idsObservados: record.idsObservados || [],
  };
  if (!item.exemplos.some((e) => e.recursoId === exemplo.recursoId && e.url === exemplo.url)) {
    item.exemplos.push(exemplo);
  }
  if (item.exemplos.length > 30) item.exemplos = item.exemplos.slice(-30);
  state.erros[key] = item;
  if (/bvpdf|pearson|reader-selection-required|no-text/i.test(key)) {
    state.preferencias[key] = 'classic';
  }
  return key;
}

function preferredFor(state, record) {
  return state.preferencias[keyFor(record)] || null;
}

function renderMarkdown(state) {
  const keys = Object.keys(state.erros).sort();
  const lines = ['# Leituras com erro — memória local', '', 'Links sanitizados (sem code/token/senha).', ''];
  for (const k of keys) {
    const e = state.erros[k];
    lines.push(`## ${k} (${e.quantidade})`, '');
    for (const x of e.exemplos) lines.push(`- ${x.disciplina || '?'} S${x.semana || '?'} — ${x.titulo || '?'} — ${x.url} — motivo=${x.motivo} — ids=${JSON.stringify(x.idsObservados)}`);
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { sanitizeUrl, load, save, learnFailure, preferredFor, renderMarkdown, keyFor };
