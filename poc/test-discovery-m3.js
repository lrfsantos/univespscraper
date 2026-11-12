const fs = require('fs');
const path = require('path');
const os = require('os');
const discovery = require('../electron/discovery');
const flow = require('../electron/flow');
const {
  parseCoursesFromHtml,
  parseSectionsFromHtml,
  parseResourcesFromSectionHtml,
  classifyResource,
} = require('../electron/discovery');
const { overallStatus, validateZip, safeName, buildCourseStructure, createZip } = require('../electron/flow');

// Testes DETERMINISTICOS da descoberta dinamica (A2/A3/A4/A5) e do fluxo (A6):
// fixtures HTML locais, sem AVA, sem credenciais, sem internet. Nao sao testes
// live -- validam os parsers puros e as decisoes puras do fluxo.

const OUT = path.join(__dirname, '..', 'audit-temp', 'DISCOVERY_RESULTS.json');
const results = [];
function sanitize(s) { return String(s == null ? '' : s).split(os.tmpdir()).join('<TEMP>'); }
function record(entry) {
  results.push({ ...entry, title: sanitize(entry.title), detail: sanitize(entry.detail) });
  console.log('[' + entry.status + '] ' + entry.id + ': ' + entry.title);
  if (entry.detail) console.log('    ', sanitize(entry.detail));
}

const COURSES_HTML = [
  '<html><body>',
  '  <div class="card">',
  '    <a href="https://ava.univesp.br/course/view.php?id=101">',
  '      <span class="course-title">Empreendedorismo e Inovacao</span>',
  '      <span class="badge">ADM270</span>',
  '    </a>',
  '  </div>',
  '  <div class="card">',
  '    <a href="https://ava.univesp.br/course/view.php?id=102">Gestao de Operacoes</a>',
  '  </div>',
  '  <div class="card">',
  '    <a href="https://ava.univesp.br/course/view.php?id=103">Estatistica (EST310) - encerrada</a>',
  '  </div>',
  '  <div class="card">',
  '    <a href="https://ava.univesp.br/course/view.php?id=104"><span>Curso indisponivel para voce</span></a>',
  '  </div>',
  '</body></html>',
].join('\n');

const COURSE_HTML = [
  '<html><body>',
  '  <div class="course-content">',
  '    <ul class="sections">',
  '      <li class="section main" id="section-0">',
  '        <h3>Geral</h3>',
  '      </li>',
  '      <li class="section main" id="section-1">',
  '        <h3>Semana 1</h3>',
  '        <div class="activityinstance">',
  '          <a href="https://ava.univesp.br/mod/page/view.php?id=11">S1 - Inicio</a>',
  '          <a href="https://ava.univesp.br/mod/page/view.php?id=12">S1 - Videoaulas</a>',
  '          <a href="https://ava.univesp.br/mod/lti/launch.php?id=13&triggerview=0">Texto-base</a>',
  '          <a href="https://ava.univesp.br/mod/url/view.php?id=14">Material extra</a>',
  '          <a href="https://assets.univesp.br/ADM270/s1_slides.pdf">Slides PDF</a>',
  '          <iframe src="https://www.youtube.com/embed/abc123"></iframe>',
  '          <a href="javascript:void(0)">JS link (deve ser ignorado)</a>',
  '        </div>',
  '      </li>',
  '      <li class="section main" id="section-2">',
  '        <h3>Semana 2</h3>',
  '        <div class="activityinstance">',
  '          <a href="https://ava.univesp.br/mod/page/view.php?id=21">S2 - Inicio</a>',
  '        </div>',
  '      </li>',
  '    </ul>',
  '  </div>',
  '</body></html>',
].join('\n');

(async () => {
  // --- A2: descoberta de disciplinas (correção B: situação ≠ disponibilidade) ---
  {
    const courses = parseCoursesFromHtml(COURSES_HTML);
    const byId = (id) => courses.find((c) => c.id === String(id));
    const ok =
      courses.length === 4 &&
      byId(101).title === 'Empreendedorismo e Inovacao' &&
      byId(101).code === 'ADM270' &&
      byId(101).available === true &&
      byId(101).url === 'https://ava.univesp.br/course/view.php?id=101' &&
      // Encerrada/concluída permanece ACESSÍVEL (situação separada de acesso).
      byId(103).situacao === 'encerrada' &&
      byId(103).available === true &&
      byId(103).code === 'EST310' &&
      // "indisponível para você" = evidência concreta de inacessibilidade.
      byId(104).available === false &&
      byId(104).situacao === 'indisponivel' &&
      byId(102).title === 'Gestao de Operacoes' &&
      byId(102).code === null;
    record({ id: 'D-1', title: 'B: materias encerradas/concluidas seguem acessiveis; so evidencia concreta desabilita', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(courses.map((c) => ({ id: c.id, title: c.title, code: c.code, situacao: c.situacao, status: c.status, available: c.available }))) });
  }

  // --- A3: descoberta de semanas ---
  {
    const sections = parseSectionsFromHtml(COURSE_HTML);
    const weeks = sections.filter((s) => s.relevant);
    const ok =
      sections.length === 3 &&
      weeks.length === 2 &&
      weeks[0].name === 'Semana 1' &&
      weeks[0].order === 1 &&
      weeks[1].name === 'Semana 2' &&
      weeks[0].block && weeks[0].block.includes('mod/page/view.php?id=11') &&
      sections.find((s) => s.id === '0').relevant === false;
    record({ id: 'D-2', title: 'A3: parseSectionsFromHtml identifica semanas dinamicamente e preserva bloco HTML', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(sections.map((s) => ({ id: s.id, name: s.name, relevant: s.relevant, order: s.order, blockLen: s.block ? s.block.length : 0 }))) });
  }

  // --- A4/A5: recursos de uma secao + classificacao ---
  {
    const section1 = parseSectionsFromHtml(COURSE_HTML).find((s) => s.id === '1');
    const resources = parseResourcesFromSectionHtml(section1.block);
    const cls = (u) => classifyResource({ url: u });
    const links = resources.links;
    const ok =
      links.some((l) => l.url === 'https://ava.univesp.br/mod/page/view.php?id=11' && cls(l.url).kind === 'page') &&
      links.some((l) => l.url.includes('/mod/lti/') && cls(l.url).kind === 'book') &&
      links.some((l) => l.url === 'https://assets.univesp.br/ADM270/s1_slides.pdf' && cls(l.url).kind === 'pdf') &&
      links.every((l) => !l.url.startsWith('javascript:')) &&
      resources.iframes.length === 1 &&
      resources.iframes[0] === 'https://www.youtube.com/embed/abc123' &&
      cls('https://www.youtube.com/embed/abc123').kind === 'video';
    record({ id: 'D-3', title: 'A4/A5: recursos da secao extraidos e classificados (page/pdf/book/video); javascript ignorado', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ links: links.map((l) => l.url), iframes: resources.iframes }) });
  }

  // --- P0 2.4: classificação de iframes por evidência (não "todo iframe = vídeo") ---
  {
    const cls = (u, type) => classifyResource({ url: u, type: type || 'link' });
    const checks = {
      youtubeIframe: cls('https://www.youtube.com/embed/abc123', 'iframe').kind === 'video',
      youtubeLink: cls('https://www.youtube.com/watch?v=abc123').kind === 'video',
      vimeoIframe: cls('https://player.vimeo.com/video/987654', 'iframe').kind === 'video',
      vimeoLink: cls('https://vimeo.com/987654').kind === 'video',
      readerIframe: cls('https://reader.vitalsource.com/reader/books/978X/pageid/3', 'iframe').kind === 'book',
      readerLink: cls('https://integrada.minhabiblioteca.com.br/reader/books/978Y', 'link').kind === 'book',
      pdfIframe: cls('https://assets.univesp.br/ADM270/s1_slides.pdf', 'iframe').kind === 'pdf',
      pdfViewerIframe: cls('https://docs.google.com/viewer?url=https%3A%2F%2Fexemplo.br%2Fa.pdf', 'iframe').kind === 'pdf',
      htmlIframe: cls('https://ava.univesp.br/pluginfile.php/1/mod_thing/conteudo.html', 'iframe').kind === 'page',
      htmlIframeNotVideo: cls('https://ava.univesp.br/mod/page/view.php?id=99', 'iframe').kind === 'page',
      noUrlIframe: cls('', 'iframe').kind === 'unknown',
      unknownLink: cls('https://externo.exemplo/arquivo.bin').kind === 'unknown',
    };
    const ok = Object.values(checks).every(Boolean);
    record({ id: 'D-6', title: 'P0 2.4: iframe classificado por evidência (vídeo só com plataforma reconhecida; leitor=book; pdf=pdf; html=page; sem URL=unknown)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(checks) });
  }

  // --- P0 2.4: múltiplos recursos distintos na mesma semana, com iframes mistos ---
  {
    const html = [
      '<div class="activityinstance">',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=21">S2 Inicio</a>',
      '  <iframe src="https://www.youtube.com/embed/AAA111"></iframe>',
      '  <iframe src="https://player.vimeo.com/video/222"></iframe>',
      '  <iframe src="https://reader.vitalsource.com/reader/books/978Z/pageid/1"></iframe>',
      '  <iframe src="https://assets.univesp.br/ADM270/s2_extra.pdf"></iframe>',
      '  <iframe src="https://ava.univesp.br/mod/url/view.php?id=23"></iframe>',
      '</div>',
    ].join('\n');
    const rs = parseResourcesFromSectionHtml(html);
    const cls = (u, type) => classifyResource({ url: u, type: type || 'link' });
    const iframeKinds = rs.iframes.map((f) => cls(f, 'iframe').kind);
    const has = (k) => iframeKinds.includes(k);
    const ok =
      rs.links.length === 1 &&
      cls(rs.links[0].url).kind === 'page' &&
      rs.iframes.length === 5 &&
      has('video') && has('book') && has('pdf') && has('page') &&
      iframeKinds.filter((k) => k === 'video').length === 2 &&
      !iframeKinds.includes('unsupported');
    record({ id: 'D-7', title: 'P0 2.4: múltiplos recursos distintos na mesma semana (vídeo/leitor/pdf/html por iframe) classificados sem colapso em vídeo', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ links: rs.links.map((l) => l.url), iframes: rs.iframes, iframeKinds }) });
  }

  // --- P1 (seção 2): regras de descoberta — Geral não é semana; Início/Em síntese ignorados ---
  {
    const html = [
      '<html><body><ul class="sections">',
      '<li id="section-0" class="section main"><h3>Geral</h3><div class="activityinstance"><a href="https://ava.univesp.br/mod/page/view.php?id=0">Avisos</a></div></li>',
      '<li id="section-1" class="section main"><h3>Semana 1</h3><div class="activityinstance">',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=1">S1 Início</a>',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=2">S1 Videoaulas</a>',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=3">S1 Material base</a>',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=4">S1 Atividade avaliativa</a>',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=5">S1 Aprofundando o tema</a>',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=6">S1 Fórum temático</a>',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=7">S1 Live com facilitador</a>',
      '  <a href="https://ava.univesp.br/mod/page/view.php?id=8">S1 Em síntese</a>',
      '  <a href="https://assets.univesp.br/ADM270/s1_slides.pdf">Slides</a>',
      '  <iframe src="https://www.youtube.com/embed/zzz999"></iframe>',
      '</div></li>',
      '</ul></body></html>',
    ].join('\n');
    const sections = discovery.parseSectionsFromHtml(html);
    const geral = sections.find((s) => s.id === '0');
    const s1 = sections.find((s) => s.id === '1');
    const resources = flow.discoverResourcesFromSection({ block: s1.block });
    const texts = resources.map((r) => r.text);
    const urls = resources.map((r) => r.url);
    const ok =
      geral.relevant === false &&
      s1.relevant === true &&
      !texts.some((t) => /in[ií]cio/i.test(t)) &&
      !texts.some((t) => /em s[ií]ntese/i.test(t)) &&
      texts.some((t) => /Videoaulas/i.test(t)) &&
      texts.some((t) => /Material base/i.test(t)) &&
      texts.some((t) => /Atividade avaliativa/i.test(t)) &&
      texts.some((t) => /Aprofundando/i.test(t)) &&
      texts.some((t) => /F[oó]rum/i.test(t)) &&
      texts.some((t) => /Live com facilitador/i.test(t)) &&
      texts.some((t) => t === 'Slides') &&
      resources.some((r) => r.classification.kind === 'video');
    record({ id: 'D-8', title: 'P1 (2): Geral não é semana; Início e Em síntese ignorados; demais atividades e recursos preservados', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ texts, urls: urls.filter((u) => !u.includes('id=')) }) });
  }

  // --- P1 (2): variações de acentuação/maiúsculas/espaços/numeração na identificação ---
  {
    const samples = {
      'S1 Início': true,
      'S2 inicio': true,
      'início': true,
      'INICIO': true,
      'S1  Início ': true,
      'S1Em Síntese': true, // sem espaço entre S1 e Em -> ainda é o rótulo Em síntese após normalizar numeração
      'S1 Em Síntese': true,
      'Em síntese': true,
      'em síntese': true,
      'EM SINTESE': true,
      'S1 Videoaulas': false,
      'S1 Material base': false,
      'Aprofundando o tema': false,
      'Introdução': false, // não é Início — não deve ser descartado
      'Texto-base - Capítulo 1': false,
    };
    const ok = Object.entries(samples).every(([label, expectIgnored]) => discovery.isIgnoredActivity(label) === expectIgnored);
    record({ id: 'D-9', title: 'P1 (2): isIgnoredActivity normaliza acentos/caixa/espaços/numeração e não descarta "Introdução"', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(samples) });
  }

  // --- P1 (3.4): disciplinas antigas — "sem oferta"/"vagas encerradas" são situação
  // acadêmica, NÃO bloqueio de acesso; só evidência concreta desabilita.
  {
    const html = [
      '<div class="course-list">',
      '  <a href="https://ava.univesp.br/course/view.php?id=201">Administracao Publica (ADM201) - sem oferta</a>',
      '  <a href="https://ava.univesp.br/course/view.php?id=202">Calculo Numerico (CAL202) - vagas encerradas</a>',
      '  <a href="https://ava.univesp.br/course/view.php?id=203">Direito (DIR203) - acesso negado</a>',
      '  <a href="https://ava.univesp.br/course/view.php?id=204">Economia (ECO204)</a>',
      '</div>',
    ].join('\n');
    const courses = parseCoursesFromHtml(html);
    const byId = (id) => courses.find((c) => c.id === String(id));
    const ok =
      byId(201).available === true && byId(201).situacao === 'inativa' &&
      byId(202).available === true && (byId(202).situacao === 'sem vagas' || byId(202).situacao === 'encerrada') &&
      byId(203).available === false && byId(203).situacao === 'indisponivel' &&
      byId(204).available === true && byId(204).situacao === 'ativa';
    record({ id: 'D-10', title: 'P1 (3.4): disciplinas "sem oferta"/"vagas encerradas" continuam consultáveis; só bloqueio concreto desabilita', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(courses.map((c) => ({ id: c.id, titulo: c.title, situacao: c.situacao, available: c.available }))) });
  }

  // --- A6: status geral honesto ---
  {
    const c1 = overallStatus({ resources: [{ status: 'integral' }, { status: 'integral' }], zip: { ok: true } });
    const c2 = overallStatus({ resources: [{ status: 'integral' }, { status: 'inaccessible' }], zip: { ok: true } });
    const c3 = overallStatus({ resources: [{ status: 'integral' }], zip: { ok: false } });
    const ok = c1 === 'conclu\u00eddo' && c2 === 'conclu\u00eddo com pend\u00eancias' && c3 === 'falhou';
    record({ id: 'D-4', title: 'A6: overallStatus distingue concluido / concluido com pendencias / falhou', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ c1, c2, c3 }) });
  }

  // --- A7: estrutura do ZIP ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'univesp-test-flow-'));
    const course = { id: '101', code: 'ADM270', title: 'Empreendedorismo e Inovacao', url: 'https://ava.univesp.br/course/view.php?id=101' };
    const weeks = [
      { id: '1', name: 'Semana 1', resources: [{ id: 'r1', text: 'Inicio', url: 'https://ava.univesp.br/mod/page/view.php?id=11', status: 'integral' }] },
    ];
    const outDir = path.join(tmp, 'saida');
    const courseDir = buildCourseStructure({ course, weeks, outputDir: outDir });
    const files = fs.readdirSync(courseDir).sort();
    const weekDir = path.join(courseDir, safeName('Semana 1'));
    fs.mkdirSync(weekDir, { recursive: true });
    fs.writeFileSync(path.join(weekDir, 'WEEK_01.md'), '# Semana 1\n');
    const zipPath = path.join(tmp, 'out.zip');
    const zip = await createZip(outDir, zipPath);
    const val = validateZip(zip);
    const ok = files.includes('INDEX.md') && files.includes('EXTRACTION_REPORT.md') && files.includes('SOURCES.md') && files.includes('AI_STUDY_INSTRUCTIONS.md') && zip.ok && val.valid && val.matches === true;
    record({ id: 'D-5', title: 'A7: estrutura academica + ZIP valido no destino (validacao abre como ZIP)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ files, zipOk: zip.ok, zipBytes: zip.bytes, valid: val.valid, entries: val.entries, filesCounted: zip.files }) });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO DESCOBERTA/FLUXO ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

