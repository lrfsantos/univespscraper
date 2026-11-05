// Geração de resumos acadêmicos a partir de transcrições.
//
// NOTA DE COMPLIANCE (auditoria 2026-11-05): este projeto NÃO possui inteligência
// artificial e NÃO usa APIs pagas. O caminho de LLM via API (OpenAI) foi REMOVIDO
// por violar a regra fundamental ("sem IA / sem APIs pagas"). Resta apenas a
// extração offline de pontos-chave (sem custo, sem rede externa, sem IA).
// Este módulo pertence ao CLI legado (src/cli.js), que não é empacotado nem usado
// pelo aplicativo Electron.

function cleanTranscript(t) {
  return (t || '')
    .replace(/\[M[uú]sica\]/g, ' ')
    .replace(/\[aplausos\]/g, ' ')
    .replace(/\[risos\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 30);
}

// Fallback offline (sem API, sem IA): extração de pontos-chave e síntese estruturada.
function offlineSummary(title, transcript) {
  const clean = cleanTranscript(transcript);
  const words = clean.split(' ').filter(Boolean);
  const sentences = splitSentences(clean);

  // frequência de palavras (stopwords simples em pt)
  const stop = new Set('a o e de do da dos das em para por com sem que e um uma na no as os ao aos à às se ou mas como mais muito já não'.split(' '));
  const freq = {};
  for (const w of clean.toLowerCase().split(/\W+/)) {
    if (w.length > 3 && !stop.has(w)) freq[w] = (freq[w] || 0) + 1;
  }
  const score = (s) => {
    let sc = 0;
    for (const w of s.toLowerCase().split(/\W+/)) if (freq[w]) sc += freq[w];
    return sc;
  };
  const ranked = sentences
    .map((s, i) => ({ s, i, sc: score(s) }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 8)
    .sort((a, b) => a.i - b.i);

  const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x[0]);

  return {
    mode: 'offline',
    wordCount: words.length,
    keywords,
    summary: ranked.map((r) => r.s.trim()).join(' '),
    points: ranked.map((r) => r.s.trim()),
  };
}

async function summarizeVideo(title, transcript, opts = {}) {
  return offlineSummary(title, transcript);
}

module.exports = { summarizeVideo, offlineSummary };
