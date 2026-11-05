const fs = require('fs');
const path = require('path');
const { login, detectRoute } = require('./lib/auth');
const { createHttpClient } = require('./lib/http');
const { discoverCourses, discoverWeeks } = require('./lib/discover');
const { parsePage, classifyActivity } = require('./lib/extract');
const { downloadPdf, pdfText } = require('./lib/pdf');
const { getYoutubeTranscript } = require('./lib/transcripts');
const { extractReading, parseRanges, parseChapter } = require('./lib/books');
const { saveReport } = require('./lib/report');

const PDF_RE = /\.pdf($|[?#])/i;
const YT_RE = /youtube\.com|youtu\.be/i;

// Extrai os PDFs e vídeos (YouTube) de uma página já parseada
function collectResources(parsed, baseUrl) {
  const pdfs = [];
  const videos = [];
  for (const link of parsed.links) {
    if (PDF_RE.test(link.href)) pdfs.push({ title: link.text, url: link.href });
    else if (YT_RE.test(link.href)) videos.push({ title: link.text, url: link.href, type: 'youtube' });
  }
  for (const iframe of parsed.iframes || []) {
    if (YT_RE.test(iframe)) videos.push({ title: '', url: iframe, type: 'youtube' });
  }
  return { pdfs, videos };
}

// Extrai o conteúdo de uma página do curso (genérico)
async function fetchActivity({ client, url }) {
  const r = await client.fetch(url);
  if (r.status !== 200) return { error: 'HTTP ' + r.status, url };
  const parsed = parsePage(r.body.toString('utf8'), url);
  const { pdfs, videos } = collectResources(parsed, url);
  return { title: parsed.title, text: parsed.text, pdfs, videos, url };
}

// Processa um curso completo: descobre semanas, extrai tudo, gera resumo e relatório
async function processCourse({ cookies, course, opts }) {
  const outDir = opts.outputDir;
  const cacheDir = opts.cacheDir;
  fs.mkdirSync(path.join(cacheDir, course.id), { recursive: true });

  const client = createHttpClient(cookies);
  const { weeks } = await discoverWeeks({ cookies, course });

  const result = { week: {}, course };
  const weekOrder = Object.keys(weeks).filter((k) => k !== 'Geral').sort((a, b) => Number(a) - Number(b));

  for (const wk of weekOrder) {
    const acts = weeks[wk];
    const w = { week: Number(wk), readings: [], videos: [] };

    for (const act of acts) {
      const kind = classifyActivity(act.title);
      if (kind === 'other') continue;

      if (kind === 'reading') {
        const page = await fetchActivity({ client, url: act.url });
        const reading = { title: act.title, url: act.url, text: page.text, pdfs: [] };

        // PDFs diretos
        for (const p of page.pdfs || []) {
          const pdfFile = path.join(cacheDir, course.id, `w${wk}-${p.title.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '_').slice(0, 60)}.pdf`);
          try {
            await downloadPdf({ client, url: p.url, filePath: pdfFile });
            const txt = await pdfText(pdfFile);
            reading.pdfs.push({ title: p.title, url: p.url, text: txt, file: pdfFile });
          } catch {
            reading.pdfs.push({ title: p.title, url: p.url, text: '', file: null });
          }
        }

        // Se é LTI (livro BV), tenta extrair o texto
        if (act.url.includes('/mod/lti/') && !page.pdfs.length) {
          const book = await extractReading({ cookies, reading: { title: act.title, url: act.url } });
          if (book.ok) reading.text = book.text;
          reading.bookSource = book.ok ? book.source : null;
        }

        w.readings.push(reading);
      } else if (kind === 'videoaulas') {
        const page = await fetchActivity({ client, url: act.url });
        w.videoaulas = { text: page.text, videos: [] };
        // vídeos (iframes) + slides PDF
        const iframes = (page.iframes || []).filter((x) => YT_RE.test(x));
        for (const ifr of iframes) w.videoaulas.videos.push({ url: ifr, title: '', type: 'youtube' });
        for (const v of page.videos || []) if (YT_RE.test(v.url)) w.videoaulas.videos.push(v);
        w.videoaulas.slides = page.pdfs || [];
        // processa transcrição de cada vídeo (sem resumo — regra: não resumir)
        for (const v of w.videoaulas.videos) {
          const tr = await getYoutubeTranscript(v.url);
          if (tr.ok) v.transcript = tr.transcript;
        }
      } else if (kind === 'inicio') {
        w.inicio = await fetchActivity({ client, url: act.url });
      } else if (kind === 'aprofundando') {
        w.aprofundando = await fetchActivity({ client, url: act.url });
        for (const v of (w.aprofundando.videos || [])) {
          if (YT_RE.test(v.url)) {
            const tr = await getYoutubeTranscript(v.url);
            if (tr.ok) v.transcript = tr.transcript;
          }
        }
      } else if (kind === 'sintese') {
        w.sintese = await fetchActivity({ client, url: act.url });
      } else if (kind === 'quiz') {
        w.quiz = await fetchActivity({ client, url: act.url });
      }
    }
    result.week[wk] = w;
  }

  // Gera o documento de estudo
  const report = saveReport(course, result.week, outDir);
  return { course, weeks: result.week, report };
}

async function runScrape({ username, password, opts }) {
  // 1. Login (em memória — nada gravado)
  console.log('🔐 Realizando login (credenciais não serão salvas)...');
  const auth = await login({ username, password });
  if (!auth.ok) throw new Error('Falha no login. Verifique e-mail/senha.');
  console.log('✅ Logado. Rota:', auth.route);

  // 2. Descobre cursos
  console.log('📚 Descobrindo cursos...');
  const { courses } = await discoverCourses({ cookies: auth.cookies });

  // 3. Filtro opcional por curso (nome/parcial)
  const filter = opts.courseFilter;
  const selected = filter
    ? courses.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
    : courses;
  if (!selected.length) throw new Error('Nenhum curso encontrado' + (filter ? ' para "' + filter + '"' : ''));

  const results = [];
  for (const course of selected) {
    console.log(`\n⚙️  Processando: ${course.title}`);
    const res = await processCourse({ cookies: auth.cookies, course, opts });
    results.push(res);
    console.log(`   → ${res.report.file} (${res.report.size} chars)`);
  }
  return results;
}

module.exports = { runScrape };
