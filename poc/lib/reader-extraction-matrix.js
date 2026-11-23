// Frente 6 — matriz diagnóstica de extração de livros.
// Não extrai do AVA: avalia evidências de páginas já obtidas (fixtures/artifacts)
// e classifica a capacidade de leitura sem inventar conteúdo nem esconder lacunas.
function normalizar(texto) { return String(texto || '').replace(/\r/g, '').trim(); }

function analisarPaginas(paginas = []) {
  const arr = Array.isArray(paginas) ? paginas : [];
  const comTexto = arr.filter((p) => normalizar(p && p.texto).length > 0);
  const ids = arr.map((p) => (p && p.id) || null);
  const impressas = arr.map((p) => (p && Number.isInteger(p.impressa) ? p.impressa : null)).filter((n) => n != null);
  const duplicatas = ids.filter((id, i) => id != null && ids.indexOf(id) !== i).length;
  const ordemCrescente = ids.every((id, i) => id == null || i === 0 || id > ids[i - 1]);
  return {
    total: arr.length,
    comTexto: comTexto.length,
    semTexto: arr.length - comTexto.length,
    chars: comTexto.reduce((n, p) => n + normalizar(p.texto).length, 0),
    ids, impressas, duplicatas, ordemCrescente,
    inicio: impressas.length ? Math.min(...impressas) : null,
    fim: impressas.length ? Math.max(...impressas) : null,
    primeiroTrecho: comTexto.length ? normalizar(comTexto[0].texto).slice(0, 120) : null,
  };
}

function classificarExtracao({ tipo, paginas = [], esperado = {} } = {}) {
  const a = analisarPaginas(paginas);
  const inicioEsperado = Number.isInteger(esperado.inicio) ? esperado.inicio : a.inicio;
  const fimEsperado = Number.isInteger(esperado.fim) ? esperado.fim : a.fim;
  let classe = 'extraível';
  const motivos = [];
  if (a.comTexto === 0) { classe = 'não extraível'; motivos.push('nenhuma-pagina-com-texto'); }
  else {
    if (a.semTexto > 0) { classe = 'parcialmente extraível'; motivos.push('paginas-sem-texto=' + a.semTexto); }
    if (a.duplicatas > 0) { classe = 'parcialmente extraível'; motivos.push('ids-duplicados=' + a.duplicatas); }
    if (!a.ordemCrescente) { classe = 'parcialmente extraível'; motivos.push('ordem-nao-crescente'); }
    if (a.fim != null && a.fim < fimEsperado) { classe = 'parcialmente extraível'; motivos.push(`cobertura-ate-${a.fim}/esperado-${fimEsperado}`); }
    if (a.inicio != null && a.inicio > inicioEsperado) { classe = 'parcialmente extraível'; motivos.push(`inicio-${a.inicio}/esperado-${inicioEsperado}`); }
  }
  return {
    tipo: tipo || 'desconhecido', classe, motivos,
    paginas: a.total, comTexto: a.comTexto, semTexto: a.semTexto, chars: a.chars,
    inicio: a.inicio, fim: a.fim, inicioEsperado, fimEsperado,
    evidencia: a.primeiroTrecho,
  };
}

function compararTentativas(a = [], b = []) {
  const idsA = JSON.stringify((Array.isArray(a) ? a : []).map((p) => p && p.id));
  const idsB = JSON.stringify((Array.isArray(b) ? b : []).map((p) => p && p.id));
  const textoA = JSON.stringify((Array.isArray(a) ? a : []).map((p) => normalizar(p && p.texto)));
  const textoB = JSON.stringify((Array.isArray(b) ? b : []).map((p) => normalizar(p && p.texto)));
  return { repetivel: idsA === idsB && textoA === textoB, idsIguais: idsA === idsB, textoIgual: textoA === textoB };
}

module.exports = { analisarPaginas, classificarExtracao, compararTentativas };
