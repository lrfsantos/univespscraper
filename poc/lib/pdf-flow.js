// Frente 3 — fluxo do ramo PDF do runner, isolado para teste de integração.
// Recebe o resultado de pdfs.extractPdf e produz texto/status/detail finais.
const cobertura = require('./coverage-check');

function processarResultadoPdf(res, { title, courseId } = {}) {
  const paginas = (res && Array.isArray(res.pages)) ? res.pages : [];
  let texto = paginas.map((p) => p.text).filter(Boolean).join('\n\n');
  let status = (res && res.status) || 'partial';
  let detail = `paginas=${paginas.length}/${(res && res.totalPagesArquivo) || '?'}`;
  if (res && res.status !== 'inaccessible') {
    const detectadas = (res.printedPagination && res.printedPagination.detected) || [];
    const ultimaFisica = detectadas.length ? detectadas[detectadas.length - 1] : null;
    const ultima = Number.isInteger(ultimaFisica) ? ultimaFisica : null;
    const contexto = { courseId };
    const avaliar = (t, ignorarCapa) => cobertura.avaliarCobertura({
      texto: t, titulo: title, ultimaPaginaImpressa: ultima,
      textoCapa: ignorarCapa ? '' : (paginas.length ? paginas[0].text : t),
      fimCalibrado: cobertura.fimCalibradoParaTitulo(title, contexto),
    });
    const aval0 = avaliar(texto, false);
    if (aval0.acao === 'so-capa' && paginas.length > 1) {
      const avanco = cobertura.avancarAteConteudo(paginas.slice(1));
      if (avanco.indice >= 0) {
        const restante = paginas.slice(avanco.indice + 1).map((p) => p.text).filter(Boolean).join('\n\n');
        texto = restante || avanco.texto;
        detail += ` avanco-pagina-${avanco.indice + 2}`;
      } else detail += ' avanco-sem-conteudo';
    }
    const aval = avaliar(texto, true); // capa já tratada: avalia apenas o intervalo
    if (aval.status) { status = aval.status; detail += ' ' + aval.detail; }
  }
  const gravarArquivo = status !== 'inaccessible';
  return { texto, status, detail, chars: texto.length, gravarArquivo };
}

module.exports = { processarResultadoPdf };
