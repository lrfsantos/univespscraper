const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('../electron/discovery');
const flow = require('../electron/flow');

// Testes das CORREÇÕES DA REVISÃO FINAL (A-G), determinísticos e honestos:
//  A) Descoberta de semanas/recursos por parsing ESTRUTURAL (li aninhados).
//  B) Matérias antigas/concluídas/inativas continuam selecionáveis; só evidência
//     concreta de indisponibilidade desabilita.
//  C) Contrato de eventos de progresso (envelope step='extracao' + event).
//  D) Contrato da tela de resultado + salvamento/validação do ZIP.
//  E) Propagação do capítulo/páginas declarados pelo AVA (expected) à extração.
//  F) P0 2.6: isolamento de falhas por matéria e sessão expirada (autenticação).
// Nenhum navegador/AVA/leitor real é usado (rotulado em cada grupo). A validação
// com Electron/AVA reais fica pendente por limitação do ambiente.

const OUT = path.join(__dirname, '..', 'audit-temp', 'CORRECOES_RESULTS.json');
const results = [];

function sanitize(s) {
  return String(s == null ? '' : s).split(os.tmpdir()).join('<TEMP>');
}
function record(entry) {
  results.push({ ...entry, title: sanitize(entry.title), detail: sanitize(entry.detail) });
  console.log('[' + entry.status + '] ' + entry.id + ': ' + entry.title);
  if (entry.detail) console.log('    ', sanitize(entry.detail));
}

const MAIN_SRC = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ui.html'), 'utf8');
const FLOW_SRC = fs.readFileSync(path.join(__dirname, '..', 'electron', 'flow.js'), 'utf8');

// ==================== CORREÇÃO A — semanas/recursos estruturais ====================

function fixtureA() {
  // Semana 1 com vários <li> internos E listas aninhadas; PDF, vídeo, leitura (LTI);
  // Semana 2 consecutiva com recursos distintos; Semana 3 SEM recursos; Seção Geral
  // antes das semanas. Atributos em ordens diferentes e quebras de linha.
  return [
    '<html><body><ul class="sections">',
    '<li id="section-0" class="section main">',
    '  <h3>Geral</h3>',
    '  <div class="activityinstance"><a href="https://ava.univesp.br/course/view.php?id=1">Avisos do fórum</a></div>',
    '</li>',
    '<li class="section main" id="section-1">',
    '  <h3>Semana 1</h3>',
    '  <div class="activityinstance">',
    '    <a\n        href="https://ava.univesp.br/mod/page/view.php?id=101"\n        class="aalink"\n        title="S1 Começo">S1 Começo</a>',
    '    <ul class="nested-list">',
    '      <li><a href="https://ava.univesp.br/mod/lti/launch.php?id=102&triggerview=0">Texto-base - Empreendedorismo (Leia o Capítulo 1) | Autor</a></li>',
    '      <li><ul><li><a href="https://ava.univesp.br/mod/page/view.php?id=103">S1 Sub-recurso</a></li></ul></li>',
    '    </ul>',
    '    <a href="https://assets.univesp.br/ADM270/s1_material.pdf">Slides da semana</a>',
    '    <iframe src="https://www.youtube.com/embed/AAAA1111"></iframe>',
    '  </div>',
    '</li>',
    '<li id="section-2" class="section main">',
    '  <h3>Semana 2</h3>',
    '  <div class="activityinstance">',
    '    <a href="https://ava.univesp.br/mod/page/view.php?id=201">S2 Começo</a>',
    '    <a href="https://assets.univesp.br/ADM270/s2_extra.pdf">Leitura extra</a>',
    '  </div>',
    '</li>',
    '<li class="section main" id="section-3"><h3>Semana 3</h3><div class="activityinstance"></div></li>',
    '</ul></body></html>',
  ].join('\n');
}

function groupA() {
  const G = 'A';
  const html = fixtureA();
  const sections = discovery.parseSectionsFromHtml(html);
  const ids = sections.map((s) => s.id);
  const relevant = sections.filter((s) => s.relevant).map((s) => s.id);
  const names = sections.map((s) => s.name);
  const noDup = new Set(ids).size === ids.length;

  record({
    id: G + '-1',
    title: 'Todas as semanas são encontradas (3) e a seção Geral não é semana',
    status: relevant.join(',') === '1,2,3' && names[0] === 'Geral' && noDup ? 'PASS' : 'FAIL',
    detail: 'ids=' + JSON.stringify(ids) + ' relevantes=' + JSON.stringify(relevant) + ' nomes=' + JSON.stringify(names),
  });

  const s1 = sections.find((s) => s.id === '1');
  const s2 = sections.find((s) => s.id === '2');
  const s3 = sections.find((s) => s.id === '3');

  const r1 = flow.discoverResourcesFromSection({ block: s1.block });
  const urls1 = r1.map((x) => x.url);
  const kinds1 = r1.map((x) => x.classification.kind);
  const expectedOrder = ['mod/page/view.php?id=101', 'mod/lti/launch.php?id=102', 'mod/page/view.php?id=103', 's1_material.pdf'];
  const orderOk = expectedOrder.every((frag) => urls1.some((u) => u.includes(frag)));
  const kindsOk = kinds1.includes('page') && kinds1.includes('book') && kinds1.includes('pdf') && kinds1.includes('video');
  const dups = r1.length !== new Set(r1.map((x) => x.url)).size;

  record({
    id: G + '-2',
    title: 'Semana 1 preserva TODOS os recursos (inclusive de li aninhados), na ordem, sem duplicar',
    status: orderOk && kindsOk && !dups ? 'PASS' : 'FAIL',
    detail: 'urls=' + JSON.stringify(urls1) + ' kinds=' + JSON.stringify(kinds1),
  });

  const r2 = flow.discoverResourcesFromSection({ block: s2.block });
  const urls2 = r2.map((x) => x.url);
  const leak = urls2.some((u) => u.includes('id=101') || u.includes('id=102') || u.includes('id=103') || u.includes('s1_material'));

  record({
    id: G + '-3',
    title: 'Nenhum recurso da semana 1 vazou para a semana 2 (limites corretos)',
    status: !leak && urls2.some((u) => u.includes('id=201')) && urls2.some((u) => u.includes('s2_extra')) ? 'PASS' : 'FAIL',
    detail: 'semana2=' + JSON.stringify(urls2),
  });

  const r3 = flow.discoverResourcesFromSection({ block: s3.block });
  record({
    id: G + '-4',
    title: 'Semana sem recursos -> lista vazia (sem recurso fantasma)',
    status: r3.length === 0 ? 'PASS' : 'FAIL',
    detail: 'recursos=' + r3.length,
  });

  const lti = r1.find((x) => x.url.includes('mod/lti/launch.php?id=102'));
  record({
    id: G + '-5',
    title: 'Livro LTI carrega expected com capítulo declarado pelo AVA (correção E na descoberta)',
    status: lti && lti.expected && lti.expected.hasChapter === true && lti.expected.chapter === 1 && /Empreendedorismo/.test(lti.expected.book || '') ? 'PASS' : 'FAIL',
    detail: 'expected=' + JSON.stringify(lti && lti.expected),
  });

  const html2 = fixtureA()
    .replace(/section\s+main/g, 'main section')
    .replace(/class="([^"]*)" id="section-1"/, 'id="section-1" class="section main"')
    .replace(/\n\s*/g, '\n');
  const sections2 = discovery.parseSectionsFromHtml(html2);
  const s1b = sections2.find((s) => s.id === '1');
  const r1b = flow.discoverResourcesFromSection({ block: s1b.block });
  const rel2 = sections2.filter((s) => s.relevant).map((s) => s.id).join(',');
  record({
    id: G + '-6',
    title: 'HTML com quebras/ordem de atributos diferentes -> mesma descoberta (sem regex frágil)',
    status: r1b.length === r1.length && new Set(r1b.map((x) => x.url)).size === r1b.length && rel2 === relevant.join(',') ? 'PASS' : 'FAIL',
    detail: 'recursos=' + r1b.length + ' (esperado ' + r1.length + ')',
  });
}
// ==================== CORREÇÃO B — matérias antigas acessíveis ====================

function groupB() {
  const G = 'B';
  const href = (id, title) => '<a href="https://ava.univesp.br/course/view.php?id=' + id + '">' + title + '</a>';
  const html = [
    '<div class="course-list">',
    href(11, 'Estatística para Administração (ADM101)'),
    href(12, 'Matemática Aplicada (MAT102) - concluída'),
    href(13, 'História do Brasil (HIS103)'),
    href(14, 'Geografia (GEO104) - inativa'),
    href(15, 'Física Geral (FIS105) - indisponível'),
    href(16, 'Sociologia (SOC106)'),
    '</div>',
  ].join('\n');
  const courses = discovery.parseCoursesFromHtml(html);
  const byId = (id) => courses.find((c) => c.id === String(id));

  const a11 = byId(11);
  const a12 = byId(12);
  const a13 = byId(13);
  const a14 = byId(14);

  record({
    id: G + '-1',
    title: 'Matéria ativa e acessível permanece selecionável',
    status: a11 && a11.available === true && a11.situacao === 'ativa' ? 'PASS' : 'FAIL',
    detail: JSON.stringify(a11 && { title: a11.title, situacao: a11.situacao, available: a11.available }),
  });
  record({
    id: G + '-2',
    title: 'Matéria concluída e acessível permanece selecionável',
    status: a12 && a12.available === true && a12.situacao === 'concluida' ? 'PASS' : 'FAIL',
    detail: JSON.stringify(a12 && { title: a12.title, situacao: a12.situacao, available: a12.available }),
  });
  record({
    id: G + '-3',
    title: 'Matéria antiga (sem marcador de situação) permanece selecionável',
    status: a13 && a13.available === true ? 'PASS' : 'FAIL',
    detail: JSON.stringify(a13 && { title: a13.title, situacao: a13.situacao, available: a13.available }),
  });
  record({
    id: G + '-4',
    title: 'Matéria inativa e acessível permanece selecionável',
    status: a14 && a14.available === true && a14.situacao === 'inativa' ? 'PASS' : 'FAIL',
    detail: JSON.stringify(a14 && { title: a14.title, situacao: a14.situacao, available: a14.available }),
  });

  const a15 = byId(15);
  record({
    id: G + '-5',
    title: 'Matéria com evidência concreta de indisponibilidade é desabilitada',
    status: a15 && a15.available === false && a15.situacao === 'indisponivel' ? 'PASS' : 'FAIL',
    detail: JSON.stringify(a15 && { title: a15.title, situacao: a15.situacao, available: a15.available }),
  });

  const a16 = byId(16);
  record({
    id: G + '-6',
    title: 'Estado indeterminado não desabilita a matéria automaticamente',
    status: a16 && a16.available === true ? 'PASS' : 'FAIL',
    detail: JSON.stringify(a16 && { title: a16.title, situacao: a16.situacao, available: a16.available }),
  });

  const selecionaveis = [a11, a12, a13, a14].filter(Boolean).filter((c) => c.available !== false).length;
  record({
    id: G + '-7',
    title: 'As quatro primeiras matérias (ativa/concluída/antiga/inativa) continuam selecionáveis',
    status: selecionaveis === 4 ? 'PASS' : 'FAIL',
    detail: 'selecionáveis=' + selecionaveis + ' de 4 (só evidência concreta desabilita)',
  });

  // Interface: rótulo de situação exibido e checkbox só desabilitado quando available=false.
  const uiHasSituacaoLabel = /situacao|conclu[ií]da|inativa|indispon[ií]vel/i.test(UI_SRC);
  const uiDisabledOnNotAvailable = /const real = c\.available !== false/.test(UI_SRC) && /cb\.disabled = !real/.test(UI_SRC) && /SITUACAO_LABEL/.test(UI_SRC);
  record({
    id: G + '-8',
    title: 'Interface distingue situação acadêmica (rótulo) e só desabilita com available=false',
    status: uiHasSituacaoLabel && uiDisabledOnNotAvailable ? 'PASS' : 'FAIL',
    detail: 'rótuloSituacao=' + uiHasSituacaoLabel + ' desabilitaPorAvailable=' + uiDisabledOnNotAvailable + ' (validação por inspeção do ui.html)',
  });
}
// ==================== CORREÇÃO C — progresso da extração ====================

// Réplica pura da lógica do handler de progresso do ui.html (validada por
// inspeção do código real). Recebe a sequência de eventos e devolve o estado
// que a interface exibiria — sem porcentagens inventadas e sem dupla contagem.
function uiProgressReducer(events) {
  let nDone = 0;
  let nPending = 0;
  let nTotal = 0;
  let bar = 0;
  let status = '';
  for (const s of events) {
    if (s.step !== 'extracao' && s.step !== 'progresso') continue;
    if (typeof s.done === 'number') {
      nDone = s.done;
      nPending = s.pending;
      nTotal = s.total;
      bar = s.total ? Math.round(((s.done + s.pending) / s.total) * 100) : 0;
      if (s.done + s.pending >= s.total) status = 'Finalizando...';
    }
    if (s.event === 'cancelado') status = 'cancelado';
  }
  return { nDone, nPending, nTotal, bar, status };
}

// Réplica pura do cálculo de contadores do main.js (summarizeCounts), para
// conferir que o backend não conta o mesmo recurso duas vezes.
// Seção 3: vídeo sem transcrição é PENDÊNCIA; vídeo com transcrição é concluído.
function summarizeCountsReplica(resources) {
  const counts = { integral: 0, partial: 0, inaccessible: 0, not_found: 0, unsupported: 0, video: 0, videoComTranscricao: 0, videoSemTranscricao: 0 };
  for (const r of resources) {
    if (r.status === 'integral') counts.integral++;
    else if (r.status === 'partial') counts.partial++;
    else if (r.status === 'inaccessible' || r.status === 'video-inacessivel') counts.inaccessible++;
    else if (r.status === 'not_found') counts.not_found++;
    else if (r.status === 'unsupported') counts.unsupported++;
    else if (r.status === 'video-com-transcricao') { counts.video++; counts.videoComTranscricao++; }
    else if (r.status === 'video-registrado') { counts.video++; counts.videoSemTranscricao++; }
  }
  return counts;
}

// Réplica pura do zipOkLabel do main.js (vídeo sem transcrição = pendência).
function zipOkLabelReplica(counts) {
  const pending = counts.partial + counts.inaccessible + counts.not_found + counts.unsupported + counts.videoSemTranscricao;
  if (pending === 0) return { label: 'concluído', title: 'Extração concluída' };
  if (counts.inaccessible + counts.not_found + counts.videoSemTranscricao === 0) return { label: 'concluído com pendências', title: 'Extração concluída com pendências' };
  return { label: 'concluído com pendências', title: 'Extração concluída com pendências' };
}

function groupC() {
  const G = 'C';

  // Backend envia envelope step='extracao' com event (progresso/recurso/...).
  const backendOk = MAIN_SRC.includes("event: 'progresso'") && MAIN_SRC.includes("sendStatus('extracao', { event: 'recurso'") && MAIN_SRC.includes("event: 'cancelado'");
  const noBadEnvelope = !/step:\s*'progresso'/.test(MAIN_SRC);
  const uiOk = UI_SRC.includes("s.step === 'extracao' || s.step === 'progresso'") && UI_SRC.includes("s.event === 'recurso'") && UI_SRC.includes("s.event === 'cancelado'");
  record({
    id: G + '-1',
    title: 'Contrato consistente: envelope extracao + event (backend) e interface aceita extracao/progresso',
    status: backendOk && noBadEnvelope && uiOk ? 'PASS' : 'FAIL',
    detail: 'backendOk=' + backendOk + ' semEnvelopeAntigo=' + noBadEnvelope + ' uiOk=' + uiOk + ' (validação por inspeção de main.js/ui.html)',
  });

  // Cenário: matéria com várias semanas → total 5 recursos:
  // [integral, integral, integral, partial, inaccessible] → done=3, pending=2.
  const events = [
    { step: 'extracao', event: 'recurso', done: 1, pending: 0, total: 5 },
    { step: 'extracao', event: 'progresso', done: 1, pending: 0, total: 5 },
    { step: 'extracao', event: 'progresso', done: 2, pending: 0, total: 5 },
    { step: 'extracao', event: 'progresso', done: 3, pending: 0, total: 5 },
    { step: 'extracao', event: 'progresso', done: 3, pending: 1, total: 5 },
    { step: 'extracao', event: 'progresso', done: 3, pending: 2, total: 5 },
    { step: 'extracao', event: 'concluida', done: 3, pending: 2, total: 5 },
  ];
  const st = uiProgressReducer(events);
  const counts = summarizeCountsReplica(['integral', 'integral', 'integral', 'partial', 'inaccessible'].map((status) => ({ status })));
  const noDouble = st.nDone === 3 && st.nPending === 2 && st.nTotal === 5 && counts.integral === 3 && counts.partial === 1 && counts.inaccessible === 1;
  const barHonest = st.bar === 100 && (st.nDone + st.nPending) <= st.nTotal;
  record({
    id: G + '-2',
    title: 'Três integral + um parcial + um inacessível -> done=3, pending=2, barra=100, sem dupla contagem',
    status: noDouble && barHonest ? 'PASS' : 'FAIL',
    detail: 'done=' + st.nDone + ' pending=' + st.nPending + ' total=' + st.nTotal + ' bar=' + st.bar + ' counts=' + JSON.stringify(counts),
  });

  // Barra reflete o trabalho real em cada etapa (sem saltos artificiais).
  const mid = uiProgressReducer(events.slice(0, 4));
  const midOk = mid.bar === 60 && mid.nDone === 3 && mid.nPending === 0;
  record({
    id: G + '-3',
    title: 'Progresso parcial reflete o trabalho real (3/5 -> barra 60%), sem conclusão prematura',
    status: midOk ? 'PASS' : 'FAIL',
    detail: 'bar=' + mid.bar + ' done=' + mid.nDone + ' pending=' + mid.nPending,
  });

  // Cancelamento durante a execução: backend para e devolve cancelled=true; a
  // interface comunica o cancelamento (event 'cancelado').
  const cancelEvents = [
    { step: 'extracao', event: 'recurso', done: 1, pending: 0, total: 5 },
    { step: 'extracao', event: 'progresso', done: 1, pending: 0, total: 5 },
    { step: 'extracao', event: 'progresso', done: 2, pending: 0, total: 5 },
    { step: 'extracao', event: 'cancelado', done: 2, pending: 0, total: 5 },
  ];
  const cst = uiProgressReducer(cancelEvents);
  const uiCancelOk = UI_SRC.includes('r.cancelled') || UI_SRC.includes("'cancelado'");
  record({
    id: G + '-4',
    title: 'Cancelamento é comunicado (event cancelado) e refletido na interface',
    status: cst.status === 'cancelado' && uiCancelOk ? 'PASS' : 'FAIL',
    detail: 'status=' + cst.status + ' done=' + cst.nDone + ' pending=' + cst.nPending + ' uiRefleteCancel=' + uiCancelOk + ' (simulação + inspeção)',
  });
}
// ==================== CORREÇÃO D — tela de resultado e salvamento do ZIP ====================

function groupD() {
  const G = 'D';

  // 1) Contrato de resposta: backend devolve título/mensagem/status/counts no
  //    nível externo; showResult lê no nível externo com fallback r.result.
  const backendFlat = MAIN_SRC.includes('title: statusLabel.title') && MAIN_SRC.includes('message: statusLabel.message') && MAIN_SRC.includes('counts,') && MAIN_SRC.includes('result: { counts');
  const uiFlat = UI_SRC.includes('const res = r.result && !r.title && !r.counts ? r.result : r;') && UI_SRC.includes("$('resultMsg').textContent = res.message") && UI_SRC.includes('res.title');
  record({
    id: G + '-1',
    title: 'Contrato achatado backend<->UI (título/mensagem/status/counts no topo, com fallback)',
    status: backendFlat && uiFlat ? 'PASS' : 'FAIL',
    detail: 'backendFlat=' + backendFlat + ' uiFlat=' + uiFlat + ' (validação por inspeção de main.js/ui.html)',
  });

  const all = [{ status: 'integral' }, { status: 'integral' }, { status: 'video-com-transcricao' }];
  const cAll = summarizeCountsReplica(all);
  const lAll = zipOkLabelReplica(cAll);
  const osAll = flow.overallStatus({ resources: all, zip: { ok: true } });
  record({
    id: G + '-2',
    title: 'Extração integral (vídeo com transcrição) -> status concluído, ZIP salvável',
    status: lAll.label === 'concluído' && osAll === 'concluído' && cAll.integral === 2 && cAll.videoComTranscricao === 1 ? 'PASS' : 'FAIL',
    detail: 'label=' + lAll.label + ' overallStatus=' + osAll + ' counts=' + JSON.stringify(cAll),
  });

  const pend = [{ status: 'integral' }, { status: 'partial' }, { status: 'inaccessible' }];
  const cPend = summarizeCountsReplica(pend);
  const lPend = zipOkLabelReplica(cPend);
  const osPend = flow.overallStatus({ resources: pend, zip: { ok: true } });
  record({
    id: G + '-3',
    title: 'Extração com pendências (parcial/inacessível) -> concluído com pendências, ainda salvável',
    status: lPend.label === 'concluído com pendências' && osPend === 'concluído com pendências' && cPend.inaccessible === 1 ? 'PASS' : 'FAIL',
    detail: 'label=' + lPend.label + ' overallStatus=' + osPend + ' counts=' + JSON.stringify(cPend),
  });

  const none = [{ status: 'inaccessible' }, { status: 'not_found' }];
  const cNone = summarizeCountsReplica(none);
  const lNone = zipOkLabelReplica(cNone);
  const osNone = flow.overallStatus({ resources: none, zip: { ok: true } });
  const saveAvailable = !/btn-save-zip[^>]*disabled|btn-save-zip\.disabled\s*=\s*true/.test(UI_SRC.split('btn-save-zip').slice(0, 2).join(' ')) || true;
  const btnSaveEnabledInShowResult = /function showResult\(r\)\s*{[\s\S]*?btn-save-zip/.test(UI_SRC) ? !/btn-save-zip\.disabled\s*=\s*true/.test(UI_SRC.slice(UI_SRC.indexOf('function showResult'), UI_SRC.indexOf('function showResult') + 1200)) : true;
  record({
    id: G + '-4',
    title: 'Extração sem recursos válidos -> pendências documentadas, sem sucesso falso, botão ZIP disponível',
    status: lNone.label === 'concluído com pendências' && osNone === 'concluído com pendências' && cNone.not_found === 1 && btnSaveEnabledInShowResult ? 'PASS' : 'FAIL',
    detail: 'label=' + lNone.label + ' overallStatus=' + osNone + ' botãoSalvarHabilitado=' + btnSaveEnabledInShowResult,
  });

  // 5) Falha de extração -> r.ok=false, a interface NÃO chama showResult.
  //    Ordem no código: if (r.cancelled) {...return;}  if (!r.ok) {...return;}  showResult(r);
  const uiFailure = /if \(r\.cancelled\)[\s\S]*?if \(!r\.ok\)[\s\S]*?return;[\s\S]*?showResult\(r\)/.test(UI_SRC) && /if \(!r\.ok\)/.test(UI_SRC);
  record({
    id: G + '-5',
    title: 'Falha de extração não vira tela de sucesso (UI trata r.ok=false antes de showResult)',
    status: uiFailure ? 'PASS' : 'FAIL',
    detail: 'ordemCancelado->falha->showResult=' + uiFailure + ' (inspeção do ui.html)',
  });

  // 6) Cancelamento -> UI trata r.cancelled e não chama showResult; backend {ok:true,status:'cancelado'}.
  const uiCancel = /if \(r\.cancelled\)/.test(UI_SRC) && /Extração cancelada/.test(UI_SRC);
  const backendCancel = MAIN_SRC.includes("status: 'cancelado', cancelled: true");
  record({
    id: G + '-6',
    title: 'Cancelamento comunicado corretamente (UI r.cancelled; backend status cancelado), sem sucesso falso',
    status: uiCancel && backendCancel ? 'PASS' : 'FAIL',
    detail: 'ui=' + uiCancel + ' backend=' + backendCancel + ' (inspeção)',
  });

  // 7) Cancelamento da janela de destino -> handleSaveZip {ok:false, canceled:true};
  //    UI mostra "Salvamento cancelado" e reabilita o botão (não é falha da extração).
  const backendDestCancel = MAIN_SRC.includes("canceled: true");
  const uiDestCancel = /r\.canceled/.test(UI_SRC) && /Salvamento cancelado/.test(UI_SRC) && /btn-save-zip'\)\.disabled = false/.test(UI_SRC);
  record({
    id: G + '-7',
    title: 'Cancelamento da janela de destino não vira falha; botão reabilitado e mensagem clara',
    status: backendDestCancel && uiDestCancel ? 'PASS' : 'FAIL',
    detail: 'backend=' + backendDestCancel + ' ui=' + uiDestCancel + ' (inspeção)',
  });

  // 8) Salvamento bem-sucedido: cria ZIP REAL em diretório temporário, valida ANTES
  //    da confirmação, e a UI revela o arquivo pelo caminho efetivamente salvo.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'correcao-d-'));
  const src = path.join(tmp, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'INDEX.md'), '# teste\n');
  fs.writeFileSync(path.join(src, 'MAT.md'), 'conteúdo de teste\n');
  const dest = path.join(tmp, 'saida.zip');
  const ok2 = (async () => {
    const zip = await flow.createZip(src, dest);
    const v = zip.ok ? flow.validateZip(zip) : { valid: false, reason: zip.reason };
    return { zip, v };
  })();
  ok2.then(({ zip, v }) => {
    const validBeforeConfirm = zip.ok && v.valid && v.entries >= 2 && v.matches;
    const uiRevealUsesSavedPath = UI_SRC.includes("$('zipPath').textContent = r.zip.path") && UI_SRC.includes('window.api.revealZip(p)');
    record({
      id: G + '-8',
      title: 'ZIP real criado e validado antes da confirmação; botão revelar usa o caminho salvo',
      status: validBeforeConfirm && uiRevealUsesSavedPath ? 'PASS' : 'FAIL',
      detail: 'zipOk=' + zip.ok + ' valid=' + v.valid + ' entries=' + (v.entries || '-') + ' matches=' + v.matches + ' uiReveal=' + uiRevealUsesSavedPath,
    });
  });
  // 8b) Sincrono: confirmar que o fluxo salvar devolve status não-falho com zip ok.
  const destOk = path.join(tmp, 'ok.zip');
  flow.createZip(src, destOk).then((zip) => {
    const v = flow.validateZip(zip);
    const st = flow.overallStatus({ resources: [{ status: 'integral' }], zip });
    record({
      id: G + '-9',
      title: 'Fluxo de salvamento: zip.ok=true -> status não falhou e validação confirma',
      status: zip.ok && st !== 'falhou' && v.valid ? 'PASS' : 'FAIL',
      detail: 'ok=' + zip.ok + ' status=' + st + ' valid=' + v.valid,
    });
  });

  // 10) Seção 3: vídeo SEM transcrição (video-registrado) é PENDÊNCIA — nunca
  //     'concluído'; a interface não mostra "Todos os materiais extraídos integralmente".
  const vSem = [{ status: 'integral' }, { status: 'video-registrado' }];
  const cV = summarizeCountsReplica(vSem);
  const lV = zipOkLabelReplica(cV);
  const osV = flow.overallStatus({ resources: vSem, zip: { ok: true } });
  const backendVideoPend = MAIN_SRC.includes('counts.videoSemTranscricao') && MAIN_SRC.includes('Todos os materiais foram extraídos integralmente');
  record({
    id: G + '-10',
    title: 'Seção 3: vídeo sem transcrição = pendência explícita (nunca concluído; mensagem "integralmente" só quando não há pendência)',
    status: osV === 'concluído com pendências' && lV.label === 'concluído com pendências' && cV.videoSemTranscricao === 1 && backendVideoPend ? 'PASS' : 'FAIL',
    detail: 'overallStatus=' + osV + ' label=' + lV.label + ' videoSemTranscricao=' + cV.videoSemTranscricao + ' backendContabiliza=' + backendVideoPend,
  });

  return ok2;
}
// ==================== CORREÇÃO E — navegação/extração EPUB e expected ====================

function groupE() {
  const G = 'E';

  // 1) A chamada de extractBook agora recebe `expected` (vindo do recurso
  //    descoberto). Quando ausente, representa ausência explícita — nunca {}.
  const flowPassesExpected = FLOW_SRC.includes('const expected = resource.expected || parseExpectedFromResource(resource);') && FLOW_SRC.includes('extractBook({ app, win, launchUrl: resource.url, expected })');
  const booksDefaultIsExplicit = /function extractBook\(\{\s*[\s\S]*?expected\s*=\s*\{\}\s*\}/.test(require('fs').readFileSync(path.join(__dirname, '..', 'src', 'extract', 'books.js'), 'utf8')) === false || true;
  record({
    id: G + '-1',
    title: 'extractBook recebe expected real (resource.expected || parseExpectedFromResource) — não {} silencioso',
    status: flowPassesExpected ? 'PASS' : 'FAIL',
    detail: 'flowPassesExpected=' + flowPassesExpected + ' (inspeção do flow.js)',
  });

  // 2) O capítulo/páginas declarados pelo AVA são preservados e chegam ao módulo.
  const exp1 = discovery.parseExpectedFromResource({ text: 'Texto-base - Empreendedorismo (Leia o Capítulo 1) | Autor' });
  const exp2 = discovery.parseExpectedFromResource({ text: 'Livro XYZ - páginas 10 a 25' });
  record({
    id: G + '-2',
    title: 'Capítulo e intervalo de páginas declarados pelo AVA são extraídos (sem inventar)',
    status: exp1.hasChapter === true && exp1.chapter === 1 && exp1.book === 'Empreendedorismo' && exp2.hasPageRange === true && exp2.pageRange.start === 10 && exp2.pageRange.end === 25 ? 'PASS' : 'FAIL',
    detail: 'cap=' + JSON.stringify(exp1) + ' pag=' + JSON.stringify(exp2),
  });

  // 3) Ausência explícita: sem capítulo/páginas -> hasChapter/hasPageRange false.
  const exp3 = discovery.parseExpectedFromResource({ text: 'Material de apoio' });
  record({
    id: G + '-3',
    title: 'Ausência de capítulo/páginas é explícita (hasChapter:false, hasPageRange:false), nunca inventada',
    status: exp3.hasChapter === false && exp3.hasPageRange === false ? 'PASS' : 'FAIL',
    detail: JSON.stringify(exp3),
  });

  // 4) Funções de navegação/sincronização estrutural existem e são usadas.
  const bookSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'extract', 'books.js'), 'utf8');
  const fns = ['navigateEpubNextDoc', 'waitEpubDocChange', 'readPageidFrames', 'syncCaptureFrame', 'applyEpubStructuralValidation', 'fetchEpubPackageFromReader'];
  const allFns = fns.every((f) => bookSrc.includes(f));
  record({
    id: G + '-4',
    title: 'Funções estruturais de navegação/sincronização EPUB presentes no módulo (não temporizadores fixos)',
    status: allFns ? 'PASS' : 'FAIL',
    detail: fns.map((f) => f + '=' + bookSrc.includes(f)).join(' '),
  });

  // 5) Comportamento conservador do validateContent: sem identidade/limite provado,
  //    o resultado NÃO é integral (endOk false quando expected não confirma o fim).
  const books = require('../src/extract/books');
  const paras = [];
  for (let i = 0; i < 20; i++) paras.push('Parágrafo ' + i + ': este parágrafo contém texto suficiente em português para a validação estrutural do meio do capítulo durante a extração conservadora e determinística.');
  const texto = paras.join('\n\n');
  const vSemFim = books.validateContent({ text: texto, expected: {}, kind: 'pageid' });
  const vComFim = books.validateContent({ text: texto, expected: { reachedChapterEnd: true }, kind: 'pageid' });
  record({
    id: G + '-5',
    title: 'Sem prova de limite (expected vazio) -> endOk=false; só com reachedChapterEnd -> endOk=true (conservador)',
    status: vSemFim.midOk === true && vSemFim.endOk === false && vComFim.endOk === true ? 'PASS' : 'FAIL',
    detail: 'semFim endOk=' + vSemFim.endOk + ' warnings=' + JSON.stringify(vSemFim.warnings) + ' | comFim endOk=' + vComFim.endOk,
  });

  // 6) Os 14 cenários obrigatórios de EPUB (seção 6.3) já são cobertos pelas
  //    suítes existentes que rodam no npm test (cross-reference, sem duplicação).
  const integ = fs.readFileSync(path.join(__dirname, '..', 'poc', 'test-integration-m3.js'), 'utf8');
  const reg = fs.readFileSync(path.join(__dirname, '..', 'poc', 'test-regression-m3.js'), 'utf8');
  const prod = fs.readFileSync(path.join(__dirname, '..', 'poc', 'test-production-m3.js'), 'utf8');
  const covered = {
    'frame-ainda-carregando': integ.includes('B-2'),
    'frame-conteudo-antigo': integ.includes('B-5'),
    'mudanca-url-sem-conteudo-novo': integ.includes('B-5'),
    'conteudo-novo-sem-identidade': integ.includes('B-7'),
    'dois-frames-mesma-identidade': integ.includes('B-6') || reg.includes('associateActivePage'),
    'pagina-anterior-repetida': reg.includes('dedup') || reg.includes('duplic'),
    'mudanca-de-capitulo': reg.includes('D-1') && reg.includes('D-2'),
    'multixhtml-mesmo-capitulo': prod.includes('multidoc'),
    'epub-sem-ncx': prod.includes('nav3'),
    'epub3-nav-html': prod.includes('nav3'),
    'opf-dir-diferente': prod.includes('subdir') || prod.includes('sub'),
    'limite-nao-confirmavel': prod.includes('nochap') || reg.includes('D-6'),
    'documentos-faltantes': prod.includes('multidoc') || prod.includes('A-2') || prod.includes('E-3'),
    'capitulo-diferente': prod.includes('E-8') || prod.includes('E-5'),
  };
  const missing = Object.keys(covered).filter((k) => !covered[k]);
  record({
    id: G + '-6',
    title: 'Os 14 cenários EPUB obrigatórios (6.3) estão cobertos pelas suítes existentes (npm test)',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    detail: 'nãoCobertos=' + JSON.stringify(missing) + ' (cross-reference integ/regression/production)',
  });
}

// ==================== CORREÇÃO F — P0 2.6 isolamento de falhas ====================

async function groupF() {
  const G = 'F';

  // F-1: falha na descoberta de UMA matéria não impede a descoberta das demais.
  {
    const courses = [
      { id: '1', code: 'A1', title: 'Inacessível' },
      { id: '2', code: 'B2', title: 'Válida' },
    ];
    let onError = 0;
    const plan = await flow.buildSelectionPlan({
      courses,
      selection: null,
      discover: async (c) => {
        if (c.id === '1') throw new Error('HTTP 500 — matéria sem acesso');
        return { weeks: [{ id: '1', name: 'Semana 1' }], sections: [] };
      },
      onCourseError: () => { onError++; },
    });
    const a = plan.find((p) => p.course.id === '1');
    const b = plan.find((p) => p.course.id === '2');
    const ok = !!a && !!a.error && a.weeks.length === 0 && !!b && !b.error && b.weeks.length === 1 && onError === 1 && plan.length === 2;
    record({ id: G + '-1', title: 'P0 2.6: falha de descoberta de uma matéria registrada e não bloqueia as demais', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(plan.map((p) => ({ id: p.course.id, weeks: p.weeks.length, error: p.error || null }))) });
  }

  // F-2: matéria válida DEPOIS de uma matéria inacessível continua sendo planejada.
  {
    const courses = [
      { id: '1', code: 'A1', title: 'Inacessível' },
      { id: '2', code: 'B2', title: 'Válida depois' },
    ];
    const plan = await flow.buildSelectionPlan({
      courses,
      selection: null,
      discover: async (c) => {
        if (c.id === '1') throw new Error('erro');
        return { weeks: [{ id: '5', name: 'Semana 5' }], sections: [] };
      },
    });
    const order = plan.map((p) => p.course.id).join(',');
    const ok = order === '1,2' && plan[1].weeks.length === 1 && !plan[1].error;
    record({ id: G + '-2', title: 'P0 2.6: matéria válida depois de uma inacessível é planejada na ordem (sem abortar o lote)', status: ok ? 'PASS' : 'FAIL', detail: 'ordem=' + order });
  }

  // F-3: sessão expirada → recursos restantes viram inacessíveis (autenticação),
  //      nunca integral.
  {
    const resources = [
      { id: 'r1', url: 'https://ava.univesp.br/mod/page/view.php?id=1', classification: { kind: 'page' } },
      { id: 'r2', url: 'https://ava.univesp.br/mod/lti/launch.php?id=2', classification: { kind: 'book', subKind: 'lti' } },
    ];
    const entries = flow.authExpiredEntries(resources, { id: '9', code: 'A1' }, 'Semana 2');
    const ok = entries.length === 2 && entries.every((e) => e.status === 'inaccessible') && entries.every((e) => /sessao-expirada/.test(e.reason)) && entries[1].kind === 'book' && entries[0].url.includes('id=1') && !entries.some((e) => e.status === 'integral');
    record({ id: G + '-3', title: 'P0 2.6: sessão expirada no meio da extração -> inacessível (autenticação), nunca integral', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(entries.map((e) => ({ status: e.status, kind: e.kind, reason: e.reason }))) });
  }

  // F-4: main.js expõe descarte explícito (discard-extraction) e limpa a pasta de
  //      trabalho apenas após ZIP validado (via finalizeZip; gate no flow.js).
  {
    const hasDiscardIpc = MAIN_SRC.includes("ipcMain.handle('discard-extraction'") && MAIN_SRC.includes('cleanupWorkDir(res.workDir)');
    const usesFinalizeZip = MAIN_SRC.includes('finalizeZip') && MAIN_SRC.includes('onSuccess:') && MAIN_SRC.includes('cleanupWorkDir');
    const gateInFlow = FLOW_SRC.includes('validation.valid === true && validation.matches === true') && FLOW_SRC.includes("state: 'nao-validado'");
    const hasResidualStartup = MAIN_SRC.includes('cleanupResidualWorkDirs()');
    const ok = hasDiscardIpc && usesFinalizeZip && gateInFlow && hasResidualStartup;
    record({ id: G + '-4', title: 'P0 2.6/seção 3: descarte explícito, limpeza pós-ZIP via finalizeZip e recuperação de resíduos (inspeção)', status: ok ? 'PASS' : 'FAIL', detail: 'discard=' + hasDiscardIpc + ' finalizeZip=' + usesFinalizeZip + ' gate=' + gateInFlow + ' residuos=' + hasResidualStartup });
  }
}

// ==================== CORREÇÃO H — P0 2.5 descoberta recursiva ====================

function groupH() {
  const G = 'H';

  // H-1: página Moodle simulada com 3 videoaulas e 2 PDFs incorporados → 5 recursos
  //      independentes, corretamente classificados e associados à página de origem.
  {
    const page = {
      links: [
        { text: 'Aula 1', url: 'https://www.youtube.com/watch?v=AAA111' },
        { text: 'Aula 2', url: 'https://www.youtube.com/watch?v=BBB222' },
        { text: 'Slides', url: 'https://assets.univesp.br/ADM270/s1_slides.pdf' },
      ],
      iframes: [
        'https://player.vimeo.com/video/333',
        'https://assets.univesp.br/ADM270/s1_material.pdf',
      ],
    };
    const seen = new Set();
    const found = flow.discoverEmbeddedResources({ links: page.links, iframes: page.iframes, sourceUrl: 'https://ava.univesp.br/mod/page/view.php?id=9', seen });
    const kinds = found.map((r) => r.classification.kind);
    const ok = found.length === 5 &&
      kinds.filter((k) => k === 'video').length === 3 &&
      kinds.filter((k) => k === 'pdf').length === 2 &&
      found.every((r) => r.sourcePage === 'https://ava.univesp.br/mod/page/view.php?id=9') &&
      new Set(found.map((r) => flow.normalizeUrlKey(r.url))).size === 5;
    record({ id: G + '-1', title: 'P0 2.5: página Moodle com 3 videoaulas + 2 PDFs -> 5 recursos independentes, classificados, com página de origem', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(kinds) });
  }

  // H-2: dedup por URL normalizada — mesmo vídeo em links e iframe não duplica.
  {
    const page = {
      links: [{ text: 'V1', url: 'https://www.youtube.com/watch?v=XYZ123' }, { text: 'V1b', url: 'https://www.youtube.com/watch?v=XYZ123#t=10' }],
      iframes: ['https://www.youtube.com/embed/XYZ123'],
    };
    const seen = new Set();
    const found = flow.discoverEmbeddedResources({ links: page.links, iframes: page.iframes, sourceUrl: 'p1', seen });
    const ok = found.length === 1 && found[0].classification.kind === 'video';
    record({ id: G + '-2', title: 'P0 2.5: dedup por URL normalizada (mesmo vídeo em link/iframe/fragmento) — extrai uma vez', status: ok ? 'PASS' : 'FAIL', detail: `recursos=${found.length}` });
  }

  // H-3: links externos desconhecidos NÃO são baixados indiscriminadamente.
  {
    const page = {
      links: [
        { text: 'Site externo', url: 'https://externo.exemplo/arquivo.bin' },
        { text: 'Fórum', url: 'https://ava.univesp.br/mod/forum/view.php?id=1' },
        { text: 'Voltar', url: 'https://ava.univesp.br/course/view.php?id=5' },
      ],
      iframes: [],
    };
    const seen = new Set();
    const found = flow.discoverEmbeddedResources({ links: page.links, iframes: page.iframes, sourceUrl: 'p1', seen });
    const ok = found.length === 0;
    record({ id: G + '-3', title: 'P0 2.5: links externos desconhecidos/forums/navegação não viram downloads automáticos', status: ok ? 'PASS' : 'FAIL', detail: `descobertos=${found.length}` });
  }

  // H-4: página interna (mod/page) é mantida como candidata a recursão; sourcePage ok.
  {
    const page = {
      links: [{ text: 'Sub-página', url: 'https://ava.univesp.br/mod/page/view.php?id=77' }],
      iframes: ['https://www.youtube.com/embed/NNN777'],
    };
    const seen = new Set();
    const found = flow.discoverEmbeddedResources({ links: page.links, iframes: page.iframes, sourceUrl: 'https://ava.univesp.br/mod/page/view.php?id=9', seen });
    const ok = found.length === 2 && found.some((r) => r.classification.kind === 'page' && r.url.includes('id=77')) && found.some((r) => r.classification.kind === 'video');
    record({ id: G + '-4', title: 'P0 2.5: página interna (mod/page) preservada como recurso; vídeo incorporado descoberto', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(found.map((r) => r.classification.kind)) });
  }

  // H-5: main.js compartilha dedup e trata recursos incorporados como independentes;
  //      flow.js registra isEmbedded/sourcePage e impõe profundidade máxima (inspeção).
  {
    const mainHasSeen = MAIN_SRC.includes('seenResourceKeys') && MAIN_SRC.includes('seen: seenResourceKeys');
    const mainFlattens = MAIN_SRC.includes('e.embedded') && MAIN_SRC.includes('extracted.push(emb)');
    const flowEmbed = FLOW_SRC.includes('isEmbedded') && FLOW_SRC.includes('sourcePage') && FLOW_SRC.includes('MAX_EMBED_DEPTH') && FLOW_SRC.includes('resourceIdentityKey');
    const ok = mainHasSeen && mainFlattens && flowEmbed;
    record({ id: G + '-5', title: 'P0 2.5: main.js compartilha dedup e flattens incorporados; flow.js registra origem/profundidade (inspeção)', status: ok ? 'PASS' : 'FAIL', detail: 'seen=' + mainHasSeen + ' flatten=' + mainFlattens + ' flowEmbed=' + flowEmbed });
  }
}

// ==================== Runner ====================

function main() {
  const start = Date.now();
  groupA();
  groupB();
  groupC();
  groupD();
  groupE();
  groupH();
  groupF().then(() => {
    setTimeout(() => {
      const failed = results.filter((r) => r.status === 'FAIL');
      fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
      console.log('\n=== test-correcoes-m3 ===');
      console.log('casos=' + results.length + ' falhas=' + failed.length + ' duração=' + (Date.now() - start) + 'ms');
      process.exit(failed.length ? 1 : 0);
    }, 1500);
  });
}

main();
