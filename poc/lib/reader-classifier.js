// Frente 5 — classificação conservadora de leitores e motivos de falha.
// Usa hostname/estrutura/sinais reais. Nunca inventa conteúdo, não tenta burlar
// autenticação, não confunde domínio desconhecido com falta de autorização.
const LEITORES = [
  { leitor: 'minhabiblioteca', hosts: ['minhabiblioteca.com.br'] },
  { leitor: 'vitalsource', hosts: ['vitalsource.com'] },
  { leitor: 'bvirtual', hosts: ['bvirtual.com.br'] },
];
const AUTORIZACAO_RE = /not[- ]?authorized|not authorized|acesso negado|forbidden|sess[ãa]o expirou|session expired|unauthorized/i;
const SELECAO_RE = /escolha (o )?formato desejado|choose your desired format|reader selection|sele[çc][aã]o de leitor|reader-selection-required/i;
const CONTEUDO_LEITOR_RE = /pages\/\d+\/content|jigsaw\.minhabiblioteca|bookshelf\.vitalsource|\/reader\/books\/|\/Leitor\/Publicacao\/\d+\/pdf\//i;

function hostnameDe(url) {
  try { return String(new URL(String(url)).hostname || '').toLowerCase(); }
  catch { return ''; }
}
function leitorDeHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  const encontrado = LEITORES.find((x) => x.hosts.some((d) => h === d || h.endsWith('.' + d)));
  return encontrado ? encontrado.leitor : null;
}

// { url, hostname, texto, frames = [{url}], sinais = [] }
function classificarLeitor({ url, hostname, texto, frames = [], sinais = [], leituraOk = true } = {}) {
  if (!leituraOk) return { leitor: null, dominio: 'indeterminado', formato: null, motivo: 'inconclusivo' };
  const host = String(hostname || hostnameDe(url) || '').toLowerCase();
  const leitor = leitorDeHost(host);
  const txt = String(texto || '');
  const sinaisTexto = sinais.concat([txt]);
  const urlsFrames = (Array.isArray(frames) ? frames : []).map((f) => String((f && f.url) || f || '')).filter(Boolean);
  const urlsTodas = [String(url || ''), ...urlsFrames].filter(Boolean);

  if (!host) return { leitor: null, dominio: 'desconhecido', formato: null, motivo: 'dominio-desconhecido' };
  if (!leitor) return { leitor: null, dominio: 'desconhecido', formato: null, motivo: 'dominio-desconhecido' };

  const negado = urlsTodas.some((u) => AUTORIZACAO_RE.test(u)) || sinaisTexto.some((s) => AUTORIZACAO_RE.test(s));
  if (negado) return { leitor, dominio: 'conhecido', formato: null, motivo: 'sem-autorizacao' };

  const selecao = sinaisTexto.some((s) => SELECAO_RE.test(s));
  if (selecao) return { leitor, dominio: 'conhecido', formato: null, motivo: 'reader-selection-required' };

  const frameConteudo = urlsFrames.find((u) => CONTEUDO_LEITOR_RE.test(u));
  if (!urlsFrames.length) return { leitor, dominio: 'conhecido', formato: null, motivo: 'iframe-inacessivel' };
  if (!frameConteudo) return { leitor, dominio: 'conhecido', formato: null, motivo: 'iframe-sem-conteudo-consultavel' };

  const formato = leitor === 'vitalsource' ? 'vitalsource'
    : leitor === 'minhabiblioteca' && /jigsaw|pages\/\d+\/content/.test(frameConteudo) ? 'pageid'
      : leitor === 'bvirtual' && /\/pdf\/\d+/.test(frameConteudo) ? 'bvpdf'
        : 'epub';
  return { leitor, dominio: 'conhecido', formato, motivo: null };
}

const fs = require('fs');
const path = require('path');

function deveGravarConteudo(classificacao) { return Boolean(classificacao && !classificacao.motivo); }
function ehDominioInstitucional(host) {
  const h = String(host || '').toLowerCase();
  return h === 'univesp.br' || h.endsWith('.univesp.br');
}
function devePersistirBook(res) {
  const texto = String((res && res.text) || '');
  return Boolean(res && res.status !== 'inaccessible' && texto.trim().length > 0);
}
function persistirMarkdownBook({ resultado, classificacao, caminhoBase, titulo, detalhe }) {
  if (!deveGravarConteudo(classificacao) || !devePersistirBook(resultado)) return { arquivo: null, gravado: false };
  fs.mkdirSync(path.dirname(caminhoBase), { recursive: true });
  const arquivo = caminhoBase + '.md';
  fs.writeFileSync(arquivo, `# ${titulo}\n\nStatus: ${resultado.status} (${detalhe || ''})\n\n${resultado.text}\n`);
  return { arquivo, gravado: true };
}

// Decisão de fluxo: com evidência inconclusiva ou seleção pendente, NÃO extrair.
function decidirExtracaoLeitor({ classificacao, leituraOk = true } = {}) {
  if (!leituraOk || !classificacao || classificacao.motivo === 'inconclusivo') {
    return { extrair: false, bloqueio: 'evidencias-inconclusivas' };
  }
  const bloqueantes = ['sem-autorizacao', 'dominio-desconhecido', 'reader-selection-required', 'iframe-inacessivel', 'iframe-sem-conteudo-consultavel'];
  if (bloqueantes.includes(classificacao.motivo)) return { extrair: false, bloqueio: classificacao.motivo };
  return { extrair: true, bloqueio: null };
}
async function executarFluxoBook({ classificacao, leituraOk = true, extrair }) {
  const decisao = decidirExtracaoLeitor({ classificacao, leituraOk });
  if (!decisao.extrair) return { extraiu: false, bloqueio: decisao.bloqueio };
  if (typeof extrair === 'function') await extrair();
  return { extraiu: true, bloqueio: null };
}

module.exports = { classificarLeitor, leitorDeHost, hostnameDe, deveGravarConteudo, ehDominioInstitucional, devePersistirBook, persistirMarkdownBook, decidirExtracaoLeitor, executarFluxoBook, LEITORES };
