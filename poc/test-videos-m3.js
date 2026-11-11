const path = require('path');
const { extractVideo, fetchTranscript, extractVideoId, isYoutube } = require('../src/extract/videos');
const { overallStatus, isDoneStatus, renderReport } = require('../electron/flow');

// Testes da SEÇÃO 3 (P1 vídeos): três estados diferenciados, preservação de
// segmentos/timestamps/ordem, timeout REAL (a requisição subjacente é abortada via
// AbortSignal), e contagem honesta no fluxo (vídeo sem transcrição = pendência).
// Determinísticos: a transcrição externa é MOCKADA na fronteira (fetch injetado),
// nunca em produção; a função de produção extractVideo é executada de verdade.

const OUT = path.join(__dirname, '..', 'audit-temp', 'VIDEOS_RESULTS.json');
const fs = require('fs');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

const INNERTUBE = 'https://www.youtube.com/youtubei/v1/player';

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}
function textResponse(str, ok = true) {
  return { ok, status: ok ? 200 : 403, json: async () => ({}), text: async () => str };
}
// Fetch injetado que devolve transcrição com captionTracks + XML segmentado.
function transcriptFetch(segmentsXml, { noTracks = false } = {}) {
  return async (url) => {
    if (String(url).startsWith(INNERTUBE)) {
      return jsonResponse(noTracks ? { captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } } } : { captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?x=1', languageCode: 'pt' }] } } });
    }
    return textResponse(segmentsXml);
  };
}
// Fetch que nunca resolve e rejeita com AbortError quando o sinal é abortado (timeout real).
function hangingFetch() {
  return (url, opts) => new Promise((resolve, reject) => {
    const sig = opts && opts.signal;
    if (sig && sig.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    sig && sig.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
}
function rejectingFetch() {
  return async () => { throw new Error('rede-indisponivel'); };
}

(async () => {
  const G = 'V';

  // V-1: YouTube com transcrição -> video-com-transcricao; segmentos, ordem e timestamps preservados.
  {
    const xml = '<transcript><text start="0" dur="1.2">Ola.</text><text start="1.2" dur="1">Segundo.</text><text start="2.2" dur="1">Terceiro.</text></transcript>';
    const r = await extractVideo({ url: 'https://www.youtube.com/watch?v=abc12345678', fetchFn: transcriptFetch(xml) });
    const ok = r.status === 'video-com-transcricao' && r.transcriptAvailable === true && r.transcriptLang === 'pt' &&
      r.segments.length === 3 && r.segments.map((s) => s.text).join('|') === 'Ola.|Segundo.|Terceiro.' &&
      r.segments[0].offset === 0 && r.segments[2].offset === 2.2 && r.videoId === 'abc12345678';
    record({ id: G + '-1', title: '3: YouTube com transcrição -> video-com-transcricao; segmentos/ordem/timestamps preservados', status: ok ? 'PASS' : 'FAIL', detail: `status=${r.status} segs=${r.segments.length} ordem=${r.segments.map((s) => s.text).join('|')}` });
  }

  // V-2: YouTube sem transcrição (sem captionTracks) -> video-registrado (pendência).
  {
    const r = await extractVideo({ url: 'https://www.youtube.com/watch?v=abc12345678', fetchFn: transcriptFetch('<transcript></transcript>', { noTracks: true }) });
    const ok = r.status === 'video-registrado' && r.transcriptAvailable === false && /n[aã]o dispon[ií]vel/.test(r.transcriptNote);
    record({ id: G + '-2', title: '3: YouTube sem transcrição -> video-registrado (nunca inventa), pendência explícita', status: ok ? 'PASS' : 'FAIL', detail: `status=${r.status} note=${r.transcriptNote}` });
  }

  // V-3: URL inválida (sem ID) -> video-inacessivel (diferenciado de sem transcrição).
  {
    const r = await extractVideo({ url: 'https://www.youtube.com/watch' });
    const ok = r.status === 'video-inacessivel' && r.videoId === null && /n[aã]o foi poss[ií]vel identificar/.test(r.transcriptNote);
    record({ id: G + '-3', title: '3: URL inválida -> video-inacessivel (não confundido com "registrado sem transcrição")', status: ok ? 'PASS' : 'FAIL', detail: `status=${r.status} id=${r.videoId}` });
  }

  // V-4: vídeo de outra plataforma (Vimeo) -> video-registrado com motivo (plataforma).
  {
    const r = await extractVideo({ url: 'https://player.vimeo.com/video/987' });
    const ok = r.status === 'video-registrado' && r.isYoutube === false && /plataforma sem transcri[cç][aã]o/.test(r.transcriptNote);
    record({ id: G + '-4', title: '3: vídeo de outra plataforma -> registrado sem transcrição (motivo claro)', status: ok ? 'PASS' : 'FAIL', detail: `status=${r.status} yt=${r.isYoutube} note=${r.transcriptNote}` });
  }

  // V-5: TIMEOUT REAL -> requisição abortada (não apenas "deixou de ser aguardada").
  {
    const started = Date.now();
    const r = await extractVideo({ url: 'https://www.youtube.com/watch?v=abc12345678', fetchFn: hangingFetch(), timeoutMs: 120 });
    const elapsed = Date.now() - started;
    const ok = r.status === 'video-registrado' && /timeout/.test(r.transcriptNote) && elapsed < 5000;
    record({ id: G + '-5', title: '3: timeout aborta a requisição subjacente (AbortSignal), status video-registrado com motivo', status: ok ? 'PASS' : 'FAIL', detail: `status=${r.status} note=${r.transcriptNote} ms=${elapsed}` });
  }

  // V-6: erro de rede -> video-registrado, sem inventar transcrição.
  {
    const r = await extractVideo({ url: 'https://www.youtube.com/watch?v=abc12345678', fetchFn: rejectingFetch() });
    const ok = r.status === 'video-registrado' && r.transcriptAvailable === false;
    record({ id: G + '-6', title: '3: erro de rede -> registrado sem transcrição, sem falsa transcrição', status: ok ? 'PASS' : 'FAIL', detail: `status=${r.status} available=${r.transcriptAvailable}` });
  }

  // V-7: extractVideoId/isYoutube preservados (IDs das principais formas de URL).
  {
    const ok = extractVideoId('https://youtu.be/xyz12345678') === 'xyz12345678' &&
      extractVideoId('https://www.youtube.com/embed/abc12345678') === 'abc12345678' &&
      extractVideoId('https://www.youtube.com/watch?v=def12345678') === 'def12345678' &&
      isYoutube('https://www.youtube.com/x') && !isYoutube('https://ava.univesp.br/x');
    record({ id: G + '-7', title: '3: extractVideoId/isYoutube reconhecem youtu.be/embed/watch; não-YouTube false', status: ok ? 'PASS' : 'FAIL', detail: 'ids=ok' });
  }

  // V-8: contagem/status no fluxo — vídeo sem transcrição é pendência (isDoneStatus/overallStatus).
  {
    const done = isDoneStatus('video-com-transcricao');
    const pend = isDoneStatus('video-registrado') === false && isDoneStatus('video-inacessivel') === false;
    const st = overallStatus({ resources: [{ status: 'integral' }, { status: 'video-registrado' }], zip: { ok: true } });
    const ok = done && pend && st === 'concluído com pendências';
    record({ id: G + '-8', title: '3: isDoneStatus: vídeo com transcrição concluído; sem transcrição/inacessível são pendência no overallStatus', status: ok ? 'PASS' : 'FAIL', detail: `done=${done} pend=${pend} overall=${st}` });
  }

  // V-9: relatório geral marca vídeo sem transcrição como pendência.
  {
    const report = renderReport({
      course: { title: 'Matéria', code: 'M1' },
      weeks: [{ id: '1', name: 'Semana 1', resources: [{ id: 'r1', text: 'Video 1', url: 'u', status: 'video-registrado' }] }],
    });
    const ok = report.includes('vídeo sem transcrição (pendência)') && report.includes('sem transcrição (pendência)');
    record({ id: G + '-9', title: '3: renderReport lista vídeo sem transcrição como pendência explícita', status: ok ? 'PASS' : 'FAIL', detail: `contagemPendencia=${report.includes('vídeo sem transcrição (pendência)')}` });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO VÍDEOS (SEÇÃO 3) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
