const { YoutubeTranscript } = require('youtube-transcript');

// Transcrições de vídeos do YouTube (sem chave de API).

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.split('/')[1] || null;
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

async function getYoutubeTranscript(videoUrl) {
  const vid = extractVideoId(videoUrl);
  if (!vid) return { ok: false, reason: 'no-video-id' };
  try {
    const tr = await YoutubeTranscript.fetchTranscript(vid, { lang: 'pt' });
    const text = (tr || []).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    return { ok: text.length > 0, transcript: text };
  } catch {
    try {
      const tr = await YoutubeTranscript.fetchTranscript(vid);
      const text = (tr || []).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
      return { ok: text.length > 0, transcript: text };
    } catch (e2) {
      return { ok: false, reason: e2.message };
    }
  }
}

module.exports = { getYoutubeTranscript, extractVideoId };
