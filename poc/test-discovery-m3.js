const fs = require('fs');
const path = require('path');
const os = require('os');
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
  // --- A2: descoberta de disciplinas ---
  {
    const courses = parseCoursesFromHtml(COURSES_HTML);
    const byId = (id) => courses.find((c) => c.id === String(id));
    const ok =
      courses.length === 4 &&
      byId(101).title === 'Empreendedorismo e Inovacao' &&
      byId(101).code === 'ADM270' &&
      byId(101).available === true &&
      byId(101).url === 'https://ava.univesp.br/course/view.php?id=101' &&
      byId(103).status === 'indisponivel' &&
      byId(103).available === false &&
      byId(103).code === 'EST310' &&
      byId(104).available === false &&
      byId(102).title === 'Gestao de Operacoes' &&
      byId(102).code === null;
    record({ id: 'D-1', title: 'A2: parseCoursesFromHtml identifica disciplinas, codigo, URL e disponibilidade', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(courses.map((c) => ({ id: c.id, title: c.title, code: c.code, status: c.status, available: c.available }))) });
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

