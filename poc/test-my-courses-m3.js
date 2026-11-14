const fs = require('fs');
const path = require('path');
const { parseCourseCardsFromHtml, classifySelectorOption } = require('../electron/discovery');
const { discoverAllCoursesViaDriver } = require('../electron/my-courses');

// Testes da NOVA SEÇÃO — descoberta COMPLETA de disciplinas no "Meus cursos":
// seletor (Situação/Períodos/Categorias), espera de carregamento, paginação,
// dedup por ID canônico preservando categorias, disciplinas antigas (Legado/
// encerradas/sem período) e relatório por categoria. O orquestrador é o de
// PRODUÇÃO (discoverAllCoursesViaDriver) com um driver SIMULADO na fronteira.

const OUT = path.join(__dirname, '..', 'audit-temp', 'MYCOURSES_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

function card(id, name, opts = {}) {
  const code = opts.code || name.match(/\(([A-Z]{2,8}\d{2,4})\)/)?.[1] || null;
  return `<div class="course-card" data-courseid="${id}" data-code="${code || ''}" data-period="${opts.period || ''}" data-situation="${opts.situation || ''}" data-progress="${opts.progress || ''}"><a href="https://ava.univesp.br/course/view.php?id=${id}">${name}</a></div>`;
}

// Driver simulado determinístico: mapa opção -> { páginas: [htmlCardString], deny?:Set<id> }
function fakeDriver(options) {
  let current = options[0].value;
  const sel = new Map(options.map((o) => [o.value, o]));
  return {
    async readSelectorOptions() { return options.map((o) => ({ value: o.value, label: o.label })); },
    async selectOption(v) { current = v; return sel.has(v); },
    async readStabilityState() { return { loading: false, statusText: '', contentHash: String(current) }; },
    async readCardsHtml() {
      const o = sel.get(current);
      let html = '';
      for (const page of o.pages) html += page + '\n';
      // disciplinas com acesso negado explicitamente marcado
      return html;
    },
    async setShowAll() { return true; },
    async goNextPage() { return false; }, // uma página por opção
    async readCurrentLabel() { return current; },
    async checkCourseAccess(card) {
      // Verificação simulada: honra o valor já inferido do cartão (a menos que um
      // deny map por id seja fornecido na opção atual — ver testes M-10).
      return { accessible: card.accessible !== false, reason: card.accessible === false ? 'acesso-negado' : 'aberto' };
    },
  };
}

// Driver com paginação: a primeira opção tem 2 páginas.
function fakePagedDriver(options) {
  const base = fakeDriver(options);
  let pages = 0;
  const sel = new Map(options.map((o) => [o.value, o]));
  base.goNextPage = async () => { const o = sel.get(current); if (o.pages2 && pages === 0) { pages = 1; return true; } return false; };
  base.readCardsHtml = async () => {
    const o = sel.get(current);
    const p = pages === 0 ? o.pages : o.pages2;
    return (p || []).join('\n');
  };
  return base;
}
let current = 'todos';
function selVal() { return current; }

(async () => {
  const G = 'M';

  // M-1: classificação de opções do seletor (heurística, sem valores fixos).
  {
    const ok = classifySelectorOption('Todos') === 'situacao' &&
      classifySelectorOption('Em andamento') === 'situacao' &&
      classifySelectorOption('Não iniciados') === 'situacao' &&
      classifySelectorOption('Encerrados') === 'situacao' &&
      classifySelectorOption('1º Bimestre (2026)') === 'periodo' &&
      classifySelectorOption('4º Bimestre (2026)') === 'periodo' &&
      classifySelectorOption('Legado') === 'categoria' &&
      classifySelectorOption('Nenhum Período') === 'categoria';
    record({ id: G + '-1', title: 'Meus cursos: opções do seletor classificadas por heurística (situação/período/categoria)', status: ok ? 'PASS' : 'FAIL', detail: 'classificacao-ok' });
  }

  // M-2: parser de cartões extrai metadados (nome, código, período, situação, progresso).
  {
    const html = card(101, 'Empreendedorismo e Inovação', { code: 'ADM270', period: '4º Bimestre (2026)', situation: 'Em andamento', progress: '75%' }) +
      card(102, 'LEGADO_COM100 - Comunicação', { period: 'Legado', situation: 'Legado' });
    const cards = parseCourseCardsFromHtml(html);
    const c101 = cards.find((c) => c.id === '101');
    const c102 = cards.find((c) => c.id === '102');
    const ok = cards.length === 2 && c101.code === 'ADM270' && c101.period === '4º Bimestre (2026)' && c101.situation === 'Em andamento' && c101.progress === '75%' && c102.code === 'LEGADO_COM100';
    record({ id: G + '-2', title: 'Meus cursos: cartão preserva nome/código/período/situação/progresso (código LEGADO_ incluso)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(cards.map((c) => ({ id: c.id, code: c.code, period: c.period, situation: c.situation, progress: c.progress }))) });
  }

  // M-3: descoberta completa percorre situações + períodos + Legado + Nenhum Período.
  {
    const options = [
      { label: 'Todos', value: 'todos', pages: [card(101, 'Empreendedorismo e Inovação', { code: 'ADM270', period: '4º Bimestre (2026)' })] },
      { label: 'Em andamento', value: 'andamento', pages: [card(101, 'Empreendedorismo e Inovação', { code: 'ADM270', period: '4º Bimestre (2026)' })] },
      { label: 'Não iniciados', value: 'nainiciados', pages: [card(103, 'Sociologia (SOC300)')] },
      { label: 'Encerrados', value: 'encerrados', pages: [card(104, 'Estatística (EST310)', { situation: 'Encerrados' })] },
      { label: '1º Bimestre (2026)', value: 'b1', pages: [card(105, 'Matemática (MAT100)')] },
      { label: '4º Bimestre (2026)', value: 'b4', pages: [card(101, 'Empreendedorismo e Inovação', { code: 'ADM270', period: '4º Bimestre (2026)' })] },
      { label: 'Legado', value: 'legado', pages: [card(110, 'LEGADO_COM100 - Comunicação'), card(111, 'LEGADO_INT100 - Informática')] },
      { label: 'Nenhum Período', value: 'semperiodo', pages: [card(112, 'História (HIS400)')] },
    ];
    const r = await discoverAllCoursesViaDriver(fakeDriver(options));
    const ids = r.courses.map((c) => String(c.id)).sort();
    const c101 = r.courses.find((c) => c.id === '101');
    const ok = r.courses.length === 7 &&
      ids.includes('101') && ids.includes('103') && ids.includes('104') && ids.includes('105') && ids.includes('110') && ids.includes('111') && ids.includes('112') &&
      c101.categories.includes('Todos') && c101.categories.includes('Em andamento') && c101.categories.includes('4º Bimestre (2026)') &&
      r.summary.categoriasPercorridas === 8 && r.summary.completo === true;
    record({ id: G + '-3', title: 'Meus cursos: percorre situações+períodos+Legado+sem período; dedup por id preservando categorias', status: ok ? 'PASS' : 'FAIL', detail: `unicos=${r.courses.length} ocorrencias=${r.summary.ocorrencias} dedup=${r.summary.deduplicados} categorias=${r.summary.categoriasPercorridas} ids=${ids.join(',')} c101Cat=${(c101 && c101.categories || []).join('|')}` });
  }

  // M-4: paginação — resultados em páginas adicionais NÃO são perdidos.
  {
    const options = [
      { label: 'Todos', value: 'todos', pages: [card(201, 'Curso A (CUR201)'), card(202, 'Curso B (CUR202)')], pages2: [card(203, 'Curso C (CUR203)')] },
    ];
    const r = await discoverAllCoursesViaDriver(fakePagedDriver(options));
    const ok = r.courses.length === 3 && r.courses.some((c) => c.id === '203') && r.summary.ocorrencias === 3;
    record({ id: G + '-4', title: 'Meus cursos: paginação percorrida (página 2 não é perdida)', status: ok ? 'PASS' : 'FAIL', detail: `unicos=${r.courses.length} ids=${r.courses.map((c) => c.id).join(',')}` });
  }

  // M-5: disciplinas antigas (Legado) e encerradas permanecem acessíveis.
  {
    const options = [
      { label: 'Legado', value: 'legado', pages: [card(301, 'LEGADO_LET100 - Letras')] },
      { label: 'Encerrados', value: 'encerrados', pages: [card(302, 'Economia (ECO200)', { situation: 'Encerrados' })] },
    ];
    const r = await discoverAllCoursesViaDriver(fakeDriver(options));
    const ok = r.courses.length === 2 && r.courses.every((c) => c.accessible === true) && r.summary.acessoNegado === 0;
    record({ id: G + '-5', title: 'Meus cursos: Legado e encerrados continuam acessíveis (situação ≠ permissão)', status: ok ? 'PASS' : 'FAIL', detail: `unicos=${r.courses.length} negados=${r.summary.acessoNegado}` });
  }

  // M-6: acesso negado explícito é registrado (sem desativar a descoberta).
  {
    const options = [
      { label: 'Todos', value: 'todos', pages: [card(401, 'Acesso (ACC401)') + `<div class="course-card" data-courseid="402"><a href="https://ava.univesp.br/course/view.php?id=402">Negado (NEG402)</a><span class="course-situation">acesso negado</span></div>`] },
    ];
    const r = await discoverAllCoursesViaDriver(fakeDriver(options));
    const neg = r.courses.find((c) => c.id === '402');
    const ok = r.courses.length === 2 && neg && neg.accessible === false && r.summary.acessoNegado === 1;
    record({ id: G + '-6', title: 'Meus cursos: acesso negado explícito marcado e contabilizado (sem quebrar descoberta)', status: ok ? 'PASS' : 'FAIL', detail: `negados=${r.summary.acessoNegado} neg402=${neg ? neg.accessible : 'n/a'}` });
  }

  // M-7: relatório por categoria com contagens corretas.
  {
    const options = [
      { label: 'Todos', value: 'todos', pages: [card(501, 'A (AAA501)'), card(502, 'B (BBB502)')] },
      { label: 'Legado', value: 'legado', pages: [card(503, 'LEGADO_CCC503 - C')] },
      { label: 'Em andamento', value: 'andamento', pages: [card(501, 'A (AAA501)')] },
    ];
    const r = await discoverAllCoursesViaDriver(fakeDriver(options));
    const ok = r.byCategory['Todos'] === 2 && r.byCategory['Legado'] === 1 && r.byCategory['Em andamento'] === 1 && r.summary.ocorrencias === 4 && r.summary.cursosUnicos === 3 && r.summary.deduplicados === 1;
    record({ id: G + '-7', title: 'Meus cursos: relatório por categoria (ocorrências/deduplicados/únicos) honesto', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ byCategory: r.byCategory, summary: r.summary }) });
  }

  // M-8: "Removido da visualização" é inspecionado separadamente, registrado e NÃO restaurado.
  {
    const options = [
      { label: 'Todos', value: 'todos', pages: [card(601, 'Ativo (ATV601)')] },
      { label: 'Removido da visualização', value: 'removido', pages: [card(602, 'Oculta (OCR602)'), card(603, 'Antiga (ANT603)')] },
    ];
    const r = await discoverAllCoursesViaDriver(fakeDriver(options));
    const oculta = r.courses.find((c) => c.id === '602');
    const ok = r.summary.removidos === 2 &&
      r.removidosDaVisualizacao.length === 2 &&
      oculta && oculta.hiddenFromView === true &&
      oculta.categories.includes('Removido da visualização') &&
      r.summary.completo === true;
    record({ id: G + '-8', title: 'Meus cursos: "Removido da visualização" inspecionado separadamente, registrado e sem restaurar nada', status: ok ? 'PASS' : 'FAIL', detail: `removidos=${r.summary.removidos} listados=${r.removidosDaVisualizacao.length} hidden=${oculta ? oculta.hiddenFromView : 'n/a'} completo=${r.summary.completo}` });
  }

  // M-9: período MAIS RECENTE determinado pelos rótulos REAIS do AVA (sem valores fixos).
  {
    const options = [
      { label: '1º Bimestre (2026)', value: 'b1', pages: [card(701, 'A (AAA701)')] },
      { label: '4º Bimestre (2026)', value: 'b4', pages: [card(702, 'B (BBB702)')] },
      { label: '2º Bimestre (2025)', value: 'b2a', pages: [card(703, 'C (CCC703)')] },
    ];
    const r = await discoverAllCoursesViaDriver(fakeDriver(options));
    const ok = r.summary.periodoMaisRecente === '4º Bimestre (2026)';
    record({ id: G + '-9', title: 'Meus cursos: período mais recente determinado pela informação real do AVA', status: ok ? 'PASS' : 'FAIL', detail: `maisRecente=${r.summary.periodoMaisRecente}` });
  }

  // M-10: acesso REAL avaliado pela ABERTURA do curso (link real), não só pelo texto do cartão.
  {
    const deny = new Set(['801']);
    const base = fakeDriver([
      { label: 'Todos', value: 'todos', pages: [card(801, 'Negado por abertura (NEG801)'), card(802, 'Liberado (LIB802)')] },
    ]);
    base.checkCourseAccess = async (card) => {
      if (deny.has(String(card.id))) return { accessible: false, reason: 'acesso-negado' };
      return { accessible: true, reason: 'aberto' };
    };
    const r = await discoverAllCoursesViaDriver(base);
    const neg = r.courses.find((c) => c.id === '801');
    const lib = r.courses.find((c) => c.id === '802');
    const ok = r.summary.verificadosPorAbertura === 2 &&
      neg && neg.accessible === false && neg.accessReason === 'acesso-negado' && neg.accessChecked === true &&
      lib && lib.accessible === true && lib.accessChecked === true &&
      r.summary.acessoNegado === 1;
    record({ id: G + '-10', title: 'Meus cursos: acesso avaliado abrindo o curso (link real), não só pelo texto do cartão', status: ok ? 'PASS' : 'FAIL', detail: `verificados=${r.summary.verificadosPorAbertura} neg801=${neg ? neg.accessible : 'n/a'} lib802=${lib ? lib.accessible : 'n/a'} negados=${r.summary.acessoNegado}` });
  }

  // M-11: Favoritos é visão ADICIONAL — não exigido para "completo".
  {
    const options = [
      { label: 'Todos', value: 'todos', pages: [card(901, 'Curso (CUR901)')] },
      { label: 'Favoritos', value: 'fav', pages: [card(902, 'Fav (FAV902)')] },
    ];
    const r = await discoverAllCoursesViaDriver(fakeDriver(options));
    const ok = r.summary.favoritosAdicionais === 1 && r.summary.completo === true && r.courses.some((c) => c.categories.includes('Favoritos'));
    record({ id: G + '-11', title: 'Meus cursos: Favoritos tratado como visão adicional (não bloqueia "completo")', status: ok ? 'PASS' : 'FAIL', detail: `favAdicional=${r.summary.favoritosAdicionais} completo=${r.summary.completo}` });
  }

  // M-12: funções PURAS do driver real testadas com `document` fake (seletor/estabilidade/abrir).
  {
    const { collectSelectorOptions, applySelectOption, readStability, readCards, applyShowAll, applyNextPage, readActiveLabel } = require('../electron/my-courses');
    const mkEl = (text, extra = {}) => ({ textContent: text, outerHTML: `<div>${text}</div>`, click: () => { extra.clicked = true; }, getAttribute: (a) => extra[a] || null, ...extra });
    const fakeDoc = {
      querySelectorAll: (sel) => {
        if (sel === 'select') return [];
        if (sel.includes('course-card')) return [mkEl('A'), mkEl('B')];
        if (sel === 'button, [role="button"], select, a') return [mkEl('Mostrar: Todos')];
        if (sel === 'button, [role="button"], a, [aria-label]') return [mkEl('Próxima página')];
        if (sel === 'button, [role="tab"], [role="button"], a') return [mkEl('Em andamento'), mkEl('Próxima página')];
        if (sel === '[aria-selected="true"], .active, [class*="selected"]') return [mkEl('Legado')];
        return [];
      },
      querySelector: (sel) => {
        if (sel.includes('selected') || sel.includes('active')) return mkEl('Legado');
        return null;
      },
      body: { innerText: 'lista de cursos', outerHTML: '<body>lista</body>' },
    };
    const opts = collectSelectorOptions(fakeDoc);
    const selOk = opts.some((o) => o.label === 'Em andamento');
    const cards = readCards(fakeDoc);
    const st = readStability(fakeDoc);
    const showAll = applyShowAll(fakeDoc);
    const next = applyNextPage(fakeDoc);
    const label = readActiveLabel(fakeDoc);
    const ok = selOk && cards.includes('A') && cards.includes('B') && st.loading === false && showAll === true && next === true && label === 'Legado';
    record({ id: G + '-12', title: 'Meus cursos: funções puras do driver real testadas com document fake (sem navegador)', status: ok ? 'PASS' : 'FAIL', detail: `opts=${opts.length} cards=${cards.length} loading=${st.loading} showAll=${showAll} next=${next} label=${label}` });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO DESCOBERTA "MEUS CURSOS" (NOVA SEÇÃO) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
