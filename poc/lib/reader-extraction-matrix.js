// Frente 6 — matriz diagnóstica de extração de livros.
// Não extrai do AVA: avalia evidências de páginas já obtidas (fixtures/artifacts)
// e classifica a capacidade de leitura sem inventar conteúdo nem esconder lacunas.
function normalizar(texto) { return String(texto || '').replace(/\r/g, '').trim(); }

const LIMITE_PAGINAS_INTERVALO = 5000;
const MAX_SEGURO = Number.MAX_SAFE_INTEGER;
const paginaValida = (n) => Number.isInteger(n) && n > 0 && n <= MAX_SEGURO;

function analisarPaginas(paginas = []) {
  const arr = Array.isArray(paginas) ? paginas : [];
  const uteis = arr.filter((p) => normalizar(p && p.texto).length > 0);
  const ids = arr.map((p) => (p && p.id) || null);
  const impressas = arr.map((p) => (p && paginaValida(p && p.impressa) ? p.impressa : null)).filter((n) => n != null);
  const impressasInvalidas = arr.length - impressas.length;
  const impressasUteis = uteis.map((p) => (p && paginaValida(p && p.impressa) ? p.impressa : null)).filter((n) => n != null);
  const duplicatas = ids.filter((id, i) => id != null && ids.indexOf(id) !== i).length;
  const repetidasImpressas = impressasUteis.filter((n, i) => impressasUteis.indexOf(n) !== i).length;
  // Ordem = sequência de captura e paginação impressa; IDs servem só para duplicatas.
  const ordemImpressaValida = impressasUteis.every((n, i) => i === 0 || n > impressasUteis[i - 1]);
  const ordemCaptura = arr.map((p, i) => (p && Number.isInteger(p.ordem) ? p.ordem : i + 1));
  const ordemCapturaValida = ordemCaptura.every((n, i) => i === 0 || n > ordemCaptura[i - 1]);
  const paginasVazias = arr.length - uteis.length;
  return {
    total: arr.length,
    comTexto: uteis.length,
    semTexto: paginasVazias,
    chars: uteis.reduce((n, p) => n + normalizar(p.texto).length, 0),
    ids, impressas, impressasInvalidas, impressasUteis, duplicatas, repetidasImpressas,
    ordemCaptura, ordemCapturaValida, ordemImpressaValida,
    inicio: impressasUteis.length ? Math.min(...impressasUteis) : null,
    fim: impressasUteis.length ? Math.max(...impressasUteis) : null,
    primeiroTrecho: uteis.length ? normalizar(uteis[0].texto).slice(0, 120) : null,
  };
}

function classificarExtracao({ tipo, paginas = [], esperado = {} } = {}) {
  // Nesta etapa a origem é SEMPRE sintética: um chamador não pode rotular
  // fixtures como captura autenticada. A etapa autenticada virá depois, com
  // evidências capturadas de fato e registradas por outro caminho.
  const origemEvidencia = 'fixture-sintetica';
  const exp = esperado && typeof esperado === 'object' && !Array.isArray(esperado) ? esperado : {};
  const a = analisarPaginas(paginas);
  const inicioValido = paginaValida(exp.inicio);
  const fimValido = paginaValida(exp.fim);
  const intervaloInvalido = inicioValido && fimValido && exp.inicio > exp.fim;
  const inicioEsperado = inicioValido ? exp.inicio : null;
  const fimEsperado = fimValido ? exp.fim : null;
  const intervaloExcessivo = inicioValido && fimValido && !intervaloInvalido && (fimEsperado - inicioEsperado + 1) > LIMITE_PAGINAS_INTERVALO;
  let classe = 'extraível';
  const motivos = [];
  if (intervaloInvalido || intervaloExcessivo) {
    classe = 'parcialmente extraível';
    motivos.push(intervaloInvalido ? 'intervalo-esperado-invalido' : 'intervalo-excessivo');
  }
  if (a.comTexto === 0) { classe = 'não extraível'; motivos.push('nenhuma-pagina-com-texto'); }
  else {
    if (a.semTexto > 0) { classe = 'parcialmente extraível'; motivos.push('paginas-sem-texto=' + a.semTexto); }
    if (a.impressasInvalidas > 0) { classe = 'parcialmente extraível'; motivos.push('paginacao-invalida=' + a.impressasInvalidas); }
    if (!inicioValido || !fimValido) {
      classe = 'parcialmente extraível';
      motivos.push('intervalo-esperado-nao-informado');
    } else if (!intervaloInvalido && !intervaloExcessivo) {
      const vistas = new Set(a.impressasUteis);
      const lacunas = [];
      for (let n = inicioEsperado; n <= fimEsperado && lacunas.length < LIMITE_PAGINAS_INTERVALO; n++) if (!vistas.has(n)) lacunas.push(n);
      if (lacunas.length) { classe = 'parcialmente extraível'; motivos.push('lacunas=' + lacunas.join(',')); }
    }
    if (a.repetidasImpressas > 0) { classe = 'parcialmente extraível'; motivos.push('paginas-impressas-repetidas=' + a.repetidasImpressas); }
    if (a.duplicatas > 0) { classe = 'parcialmente extraível'; motivos.push('ids-duplicados=' + a.duplicatas); }
    if (!a.ordemCapturaValida || !a.ordemImpressaValida) { classe = 'parcialmente extraível'; motivos.push('ordem-de-captura-ou-paginacao-invalida'); }
  }
  return {
    tipo: tipo || 'desconhecido', classe, motivos, origemEvidencia,
    paginas: a.total, comTexto: a.comTexto, semTexto: a.semTexto, chars: a.chars,
    inicio: a.inicio, fim: a.fim, inicioEsperado, fimEsperado,
    lacunas: motivos.find((m) => m.startsWith('lacunas=')) || null,
    evidencia: a.primeiroTrecho,
  };
}

// IDs de captura fornecidos pela camada chamadora provam apenas que os rótulos
// são distintos — NÃO autenticam que as capturas sejam independentes na origem.
// `repetivel` significa: conteúdo equivalente + IDs de captura distintos.
// Não usar como evidência de estabilidade real nem como critério de autorização.
function compararTentativas(a = [], b = []) {
  const A = Array.isArray(a) ? a : [];
  const B = Array.isArray(b) ? b : [];
  const idsA = A.map((p) => p && p.capturaId).filter((x) => x != null && String(x).length > 0);
  const idsB = B.map((p) => p && p.capturaId).filter((x) => x != null && String(x).length > 0);
  const unicA = new Set(idsA).size === idsA.length;
  const unicB = new Set(idsB).size === idsB.length;
  const distintos = idsA.length > 0 && idsB.length > 0 && idsA.every((x) => !idsB.includes(x));
  const idsDistintos = a !== b && idsA.length === A.length && idsB.length === B.length && unicA && unicB && distintos;
  const detalhes = {
    capturasComId: idsA.length === A.length && idsB.length === B.length,
    idsUnicosPorTentativa: unicA && unicB,
    idsDistintosEntreTentativas: distintos,
    mesmaReferencia: a === b,
    idsDistintos,
    mesmaQuantidade: A.length === B.length,
    mesmaPaginacao: JSON.stringify(A.map((p) => p && p.impressa)) === JSON.stringify(B.map((p) => p && p.impressa)),
    mesmaOrdem: JSON.stringify(A.map((p) => p && p.ordem)) === JSON.stringify(B.map((p) => p && p.ordem)),
    mesmosIds: JSON.stringify(A.map((p) => p && p.id)) === JSON.stringify(B.map((p) => p && p.id)),
    mesmoTexto: JSON.stringify(A.map((p) => normalizar(p && p.texto))) === JSON.stringify(B.map((p) => normalizar(p && p.texto))),
  };
  const nucleo = ['mesmaQuantidade', 'mesmaPaginacao', 'mesmaOrdem', 'mesmosIds', 'mesmoTexto'];
  const nucleoOk = nucleo.every((k) => detalhes[k]);
  detalhes.repetivelComIdsDistintos = idsDistintos && nucleoOk;
  detalhes.repetivel = detalhes.repetivelComIdsDistintos;
  detalhes.independenciaComprovada = false; // nunca afirmar sem evidência de origem
  detalhes.motivo = detalhes.repetivel ? null : (idsDistintos ? 'conteudos-diferentes' : 'independencia-nao-comprovada');
  return detalhes;
}

module.exports = { analisarPaginas, classificarExtracao, compararTentativas };
