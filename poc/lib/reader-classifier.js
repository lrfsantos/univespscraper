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
function classificarLeitor({ url, hostname, texto, frames = [], sinais = [] } = {}) {
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

  const formato = /jigsaw|pages\/\d+\/content/.test(frameConteudo) ? 'pageid'
    : /vitalsource|bookshelf/.test(frameConteudo) ? 'vitalsource'
      : /Leitor\/Publicacao\/\d+\/pdf\//.test(frameConteudo) ? 'bvpdf' : 'epub';
  return { leitor, dominio: 'conhecido', formato, motivo: null };
}

function deveGravarConteudo(classificacao) { return Boolean(classificacao && !classificacao.motivo); }

module.exports = { classificarLeitor, leitorDeHost, hostnameDe, deveGravarConteudo, LEITORES };
