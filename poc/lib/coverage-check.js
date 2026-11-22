// Frente 3 — detecção de cobertura incompleta sem inventar conteúdo.
// Uma página curta NÃO é automaticamente capa: exigimos sinais de folha de
// título (autor/edição/editora) e ausência de parágrafo de corpo.
const SINAIS_CAPA = /(2[ªa]|1[ªa]|3[ªa])\s*edição|editora|copyright|©|professor da|universidade|sumário|índice/i;

// Calibração local (auditoria Fase 2.2 + agente local): o texto impresso do
// CIN200 S4 vai até 248, embora o título declare 217-250. Não exigir 249-250.
const FINS_CALIBRADOS = [{ padrao: /fundamentos de gestão de projetos/i, fim: 248 }];
function fimCalibradoParaTitulo(titulo) {
  const h = FINS_CALIBRADOS.find((x) => x.padrao.test(String(titulo || '')));
  return h ? h.fim : undefined;
}

function normalizar(texto) { return String(texto || '').replace(/\r/g, '').trim(); }

function ehSomenteCapa(texto) {
  const t = normalizar(texto);
  if (!t || t.length > 600) return false;
  const linhas = t.split('\n').map((x) => x.trim()).filter(Boolean);
  if (linhas.length > 12) return false;
  const temCorpo = linhas.some((x) => x.length >= 80 && !SINAIS_CAPA.test(x));
  if (temCorpo) return false;
  return SINAIS_CAPA.test(t) && linhas.length <= 10;
}

function intervaloDeclarado(titulo) {
  const m = String(titulo || '').match(/p\.?\s*(\d+)\s*[-–—]\s*(\d+)/i);
  if (!m) return null;
  const inicio = Number(m[1]);
  const fim = Number(m[2]);
  return inicio > 0 && fim >= inicio ? { inicio, fim } : null;
}

// { texto, titulo, ultimaPaginaImpressa, fimCalibrado }
// Quando o título declara intervalo mas a fonte foi calibrada localmente para
// outro fim (ex.: CIN200 impresso até 248), fimCalibrado tem precedência.
function avaliarCobertura({ texto, titulo, ultimaPaginaImpressa, fimCalibrado } = {}) {
  if (ehSomenteCapa(texto)) {
    return { acao: 'so-capa', status: 'partial', detail: 'somente-folha-de-titulo', requerAvanco: true };
  }
  const faixa = intervaloDeclarado(titulo);
  const fim = Number.isInteger(fimCalibrado) ? fimCalibrado : (faixa ? faixa.fim : null);
  if (fim == null) {
    return { acao: 'sem-intervalo', status: null, detail: null, requerAvanco: false };
  }
  if (!Number.isInteger(ultimaPaginaImpressa)) {
    return { acao: 'inconclusivo', status: 'partial', detail: 'ultima-pagina-impressa-desconhecida', requerAvanco: false };
  }
  if (ultimaPaginaImpressa >= fim) {
    return { acao: 'coberto', status: null, detail: null, requerAvanco: false };
  }
  return { acao: 'incompleto', status: 'partial', detail: `intervalo-incompleto:ultima=${ultimaPaginaImpressa}/esperado=${fim}`, requerAvanco: true };
}

module.exports = { ehSomenteCapa, intervaloDeclarado, avaliarCobertura, fimCalibradoParaTitulo };
