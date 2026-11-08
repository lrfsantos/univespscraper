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
async function fetchTranscript(videoId) {
  const langs = ['pt', 'pt-BR', 'en'];
  let lastErr = null;
  for (const lang of langs) {
    try {
      const tr = await YoutubeTranscript.fetchTranscript(videoId, lang === 'en' ? undefined : { lang });
      const text = (tr || []).map((s) => (s && s.text) || '').join(' ').replace(/\s+/g, ' ').trim();
      if (text.length > 0) return { ok: true, lang, transcript: text };
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }
  return { ok: false, reason: lastErr || 'transcricao-indisponivel' };
}

// Extrai dados de uma videoaula identificada.
// status possíveis: video-registrado (sem transcrição) | video-com-transcricao
async function extractVideo({ url, title = '' }) {
  const result = {
    url,
    title,
    status: 'video-registrado',
    videoId: extractVideoId(url),
    isYoutube: isYoutube(url),
    transcriptAvailable: false,
    transcriptLang: null,
    transcriptNote: '',
  };
  if (!result.isYoutube) {
    result.transcriptNote = 'vídeo de plataforma sem transcrição acessível nesta versão';
    return result;
  }
  if (!result.videoId) {
    result.transcriptNote = 'não foi possível identificar o vídeo (sem transcrição capturada)';
    return result;
  }
  const tr = await fetchTranscript(result.videoId);
  if (tr.ok) {
    result.status = 'video-com-transcricao';
    result.transcriptAvailable = true;
    result.transcriptLang = tr.lang;
    result.transcript = tr.transcript;
  } else {
    result.transcriptNote = 'transcrição não disponível para este vídeo';
  }
  return result;
}

module.exports = { extractVideo, fetchTranscript, extractVideoId, isYoutube };
