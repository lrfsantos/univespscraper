// Frente 3 — fluxo do ramo PDF do runner, isolado para teste de integração.
// Recebe o resultado de pdfs.extractPdf e produz texto/status/detail finais.
const cobertura = require('./coverage-check');
const fs = require('fs');
const path = require('path');

function persistirMarkdownPdf({ resultado, caminhoBase, titulo }) {
  if (!resultado || !resultado.gravarArquivo) return { arquivo: null, gravado: false };
  fs.mkdirSync(path.dirname(caminhoBase), { recursive: true });
  const arquivo = caminhoBase + '.md';
  fs.writeFileSync(arquivo, `# ${titulo}\n\nStatus: ${resultado.status} (${resultado.detail})\n\n${resultado.texto}\n`);
  return { arquivo, gravado: true };
}

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
    let semConteudoUtil = false;
    if (aval0.acao === 'so-capa' && paginas.length > 1) {
      const avanco = cobertura.avancarAteConteudo(paginas.slice(1));
      if (avanco.indice >= 0) {
        const restante = paginas.slice(avanco.indice + 1).map((p) => p.text).filter(Boolean).join('\n\n');
        texto = restante || avanco.texto;
        detail += ` avanco-pagina-${avanco.indice + 2}`;
      } else { semConteudoUtil = true; detail += ' avanco-sem-conteudo'; }
    } else if (aval0.acao === 'so-capa') {
      semConteudoUtil = true;
      detail += ' somente-folha-de-titulo';
    }
    const aval = avaliar(texto, true); // capa já tratada: avalia apenas o intervalo
    if (aval.status) { status = aval.status; detail += ' ' + aval.detail; }
    if (semConteudoUtil) status = 'partial'; // nunca integral só com capa(s)
  }
  const gravarArquivo = status !== 'inaccessible';
  return { texto, status, detail, chars: texto.length, gravarArquivo };
}

module.exports = { processarResultadoPdf, persistirMarkdownPdf };
