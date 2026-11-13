// Módulo 5 — Videoaulas e recursos associados (fase de conclusão).
// Captura, quando EFETIVAMENTE disponíveis, transcrições/legendas de vídeos do
// YouTube (via youtube-transcript, sem chave de API e sem serviço pago).
//
// Honestidade (regra do projeto):
//   - NUNCA inventa transcrição; se não houver, registra a indisponibilidade;
//   - NUNCA substitui transcrição ausente por resumo gerado por IA;
//   - preserva título, URL e identificação da aula;
//   - não limita o número de aulas (a descoberta é dinâmica).

const { YoutubeTranscript } = require('youtube-transcript');

function extractVideoId(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.hostname.includes('youtu.be')) return u.pathname.split('/')[1] || null;
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) return u.searchParams.get('v');
    return null;
  } catch {
    return null;
  }
}

function isYoutube(url) {
  const h = String(url || '').toLowerCase();
  return /youtube\.com|youtu\.be|youtube-nocookie\.com/.test(h);
}

// Busca a transcrição de um vídeo (melhor esforço; nunca inventa).
// Preserva a ORDEM e os TIMESTAMPS dos segmentos (offset em ms) — não apenas o
// texto concatenado — para o documento Markdown da videoaula (seção 4.4).
//
// Timeout REAL (seção 3.4): youtube-transcript@1.3.1 aceita `config.fetch`, então
// passamos um fetch que aplica `AbortSignal.timeout(ms)` — a requisição subjacente
// É abortada de verdade em caso de timeout (não apenas "deixa de ser aguardada").
// `fetchFn` é injetável para testes determinísticos.
async function fetchTranscript(videoId, { timeoutMs = 15000, fetchFn = globalThis.fetch } = {}) {
  const langs = ['pt', 'pt-BR', 'en'];
  let lastErr = null;
  const withTimeout = async (url, opts) => {
    const fn = fetchFn || globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fn(url, { ...opts, signal: opts && opts.signal ? opts.signal : controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  for (const lang of langs) {
    try {
      const tr = await YoutubeTranscript.fetchTranscript(videoId, { ...(lang === 'en' ? {} : { lang }), fetch: withTimeout });
      let segments = (tr || [])
        .filter((s) => s && typeof s.text === 'string' && s.text.trim().length > 0)
        .map((s) => ({ offset: typeof s.offset === 'number' ? s.offset : null, text: s.text.replace(/\s+/g, ' ').trim() }));
      // Normaliza offset para MILISSEGUNDOS (o escritor formatTs espera ms). A lib
      // devolve o formato srv3 em ms, mas o fallback clássico em SEGUNDOS. Heurística:
      // se o maior offset < 100, os offsets estão em segundos (clássico) -> *1000.
      // Limitação DOCUMENTADA: vídeo longo obtido pelo fallback clássico (>100 s) pode
      // ter offsets já em ms grandes preservados como estão (sem falsa conversão).
      const maxOff = segments.reduce((m, s) => (s.offset != null && s.offset > m ? s.offset : m), 0);
      const isClassicSeconds = segments.length > 0 && maxOff > 0 && maxOff < 100;
      if (isClassicSeconds) {
        segments = segments.map((s) => ({ offset: s.offset != null ? Math.round(s.offset * 1000) : null, text: s.text }));
      }
      const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
      if (text.length > 0) return { ok: true, lang, transcript: text, segments };
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      lastErr = aborted ? 'timeout' : (e && e.message ? e.message : String(e));
    }
  }
  return { ok: false, reason: lastErr || 'transcricao-indisponivel' };
}

// Extrai dados de uma videoaula identificada.
// status possíveis (seção 3.2, diferenciados):
//   video-com-transcricao | video-registrado (identificado sem transcrição) |
//   video-inacessivel (vídeo não identificado)
// NUNCA inventa transcrição, título, idioma ou timestamps.
async function extractVideo({ url, title = '', fetchFn, timeoutMs }) {
  const result = {
    url,
    title,
    status: 'video-registrado',
    videoId: extractVideoId(url),
    isYoutube: isYoutube(url),
    transcriptAvailable: false,
    transcriptLang: null,
    transcriptNote: '',
    segments: [],
  };
  if (!result.isYoutube) {
    result.transcriptNote = 'vídeo de plataforma sem transcrição acessível nesta versão (apenas link registrado)';
    return result;
  }
  if (!result.videoId) {
    result.status = 'video-inacessivel';
    result.transcriptNote = 'não foi possível identificar o vídeo (URL inválida ou sem ID)';
    return result;
  }
  const tr = await fetchTranscript(result.videoId, { timeoutMs, fetchFn });
  if (tr.ok) {
    result.status = 'video-com-transcricao';
    result.transcriptAvailable = true;
    result.transcriptLang = tr.lang;
    result.transcript = tr.transcript;
    result.segments = tr.segments || [];
  } else {
    result.transcriptNote = tr.reason === 'timeout' ? 'transcrição não obtida: timeout (a requisição foi abortada)' : 'transcrição não disponível para este vídeo';
  }
  return result;
}

module.exports = { extractVideo, fetchTranscript, extractVideoId, isYoutube };
