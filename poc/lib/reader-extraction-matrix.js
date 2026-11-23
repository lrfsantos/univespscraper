// Frente 6 — matriz diagnóstica de extração de livros.
// Não extrai do AVA: avalia evidências de páginas já obtidas (fixtures/artifacts)
// e classifica a capacidade de leitura sem inventar conteúdo nem esconder lacunas.
function normalizar(texto) { return String(texto || '').replace(/\r/g, '').trim(); }

function analisarPaginas(paginas = []) {
  const arr = Array.isArray(paginas) ? paginas : [];
  const uteis = arr.filter((p) => normalizar(p && p.texto).length > 0);
  const ids = arr.map((p) => (p && p.id) || null);
  const impressas = arr.map((p) => (p && Number.isInteger(p.impressa) ? p.impressa : null)).filter((n) => n != null);
  const impressasUteis = uteis.map((p) => (p && Number.isInteger(p.impressa) ? p.impressa : null)).filter((n) => n != null);
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
    ids, impressas, impressasUteis, duplicatas, repetidasImpressas,
    ordemCaptura, ordemCapturaValida, ordemImpressaValida,
    inicio: impressasUteis.length ? Math.min(...impressasUteis) : null,
    fim: impressasUteis.length ? Math.max(...impressasUteis) : null,
    primeiroTrecho: uteis.length ? normalizar(uteis[0].texto).slice(0, 120) : null,
  };
}

function classificarExtracao({ tipo, paginas = [], esperado = {}, origemEvidencia = 'fixture-sintetica' } = {}) {
  const a = analisarPaginas(paginas);
  const inicioEsperado = Number.isInteger(esperado.inicio) ? esperado.inicio : a.inicio;
  const fimEsperado = Number.isInteger(esperado.fim) ? esperado.fim : a.fim;
  let classe = 'extraível';
  const motivos = [];
  if (a.comTexto === 0) { classe = 'não extraível'; motivos.push('nenhuma-pagina-com-texto'); }
  else {
    if (a.semTexto > 0) { classe = 'parcialmente extraível'; motivos.push('paginas-sem-texto=' + a.semTexto); }
    const vistas = new Set(a.impressasUteis);
    const lacunas = [];
    for (let n = inicioEsperado; n <= fimEsperado; n++) if (!vistas.has(n)) lacunas.push(n);
    if (lacunas.length) { classe = 'parcialmente extraível'; motivos.push('lacunas=' + lacunas.join(',')); }
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

function compararTentativas(a = [], b = []) {
  const A = Array.isArray(a) ? a : [];
  const B = Array.isArray(b) ? b : [];
  const detalhes = {
    mesmaQuantidade: A.length === B.length,
    mesmaPaginacao: JSON.stringify(A.map((p) => p && p.impressa)) === JSON.stringify(B.map((p) => p && p.impressa)),
    mesmaOrdem: JSON.stringify(A.map((p) => p && p.ordem)) === JSON.stringify(B.map((p) => p && p.ordem)),
    mesmosIds: JSON.stringify(A.map((p) => p && p.id)) === JSON.stringify(B.map((p) => p && p.id)),
    mesmoTexto: JSON.stringify(A.map((p) => normalizar(p && p.texto))) === JSON.stringify(B.map((p) => normalizar(p && p.texto))),
  };
  detalhes.repetivel = Object.values(detalhes).every(Boolean);
  return detalhes;
}

module.exports = { analisarPaginas, classificarExtracao, compararTentativas };
