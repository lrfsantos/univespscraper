// UI local do UNIVESP Study Tool — separado em arquivo externo (ui.js) para
// obedecer à CSP (script-src 'self') da seção 12: scripts inline são bloqueados
// pela política, então a lógica da interface vive num arquivo próprio carregado
// via <script src="ui.js">. Nenhuma credencial/conteúdo é tratado aqui.
const $ = (id) => document.getElementById(id);
const screens = ['screen-welcome', 'screen-session', 'screen-courses', 'screen-weeks', 'screen-progress', 'screen-result'];
function show(screen) {
  screens.forEach((x) => $(x).classList.remove('active'));
  $(screen).classList.add('active');
}
function setLive(msg, cls) {
  const el = $('liveStatus');
  el.textContent = msg || '';
  el.className = cls || '';
}
let courses = [];
let selectedCourseIds = new Set();
let weeksByCourse = {};
let cancelled = false;
let courseFilter = 'todas';
let periodoMaisRecente = null;

window.api.onStatus((s) => {
  // Contrato de eventos (correção C): o envelope sempre usa step='extracao'
  // durante a extração e o sub-tipo vem em `event` ('recurso', 'progresso',
  // 'cancelado', 'concluida', 'sem-recursos'). Aceita também 'progresso' no
  // campo `step` por compatibilidade com versões anteriores.
  if (s.step === 'extracao' || s.step === 'progresso') {
    if (s.event === 'recurso') {
      $('current').textContent = `Matéria ${s.course} — ${s.week}: processando material...`;
    }
    if (typeof s.done === 'number') {
      $('nDone').textContent = s.done;
      $('nPending').textContent = s.pending;
      $('nTotal').textContent = s.total;
      const pct = s.total ? Math.round(((s.done + s.pending) / s.total) * 100) : 0;
      $('barGeneral').style.width = pct + '%';
      if (s.done + s.pending >= s.total) $('progressStatus').textContent = 'Finalizando...';
    }
    if (s.event === 'cancelado') { setLive('Extração cancelada.'); }
  }
});

async function init() {
  const env = await window.api.getEnv();
  $('ver').textContent = env.appVersion;
}

$('btn-enter').addEventListener('click', async () => {
  $('btn-enter').disabled = true;
  setLive('Abrindo o navegador do AVA...');
  await window.api.launchBrowser();
  show('screen-session');
  $('sessionMsg').textContent = 'O navegador do AVA foi aberto. Conclua o seu login lá e volte aqui.';
  $('btn-enter').disabled = false;
});

$('btn-check-session').addEventListener('click', async () => {
  $('btn-check-session').disabled = true;
  setLive('Verificando sua sessão...');
  const auth = await window.api.checkAuth();
  if (!auth.loggedIn) {
    $('sessionMsg').className = 'notice warn';
    $('sessionMsg').textContent = 'Ainda não identificamos sua sessão. Se você já fez login no navegador, clique novamente. Se a sessão expirou, refaça o login.';
    $('btn-check-session').disabled = false;
    return;
  }
  setLive('Localizando suas matérias...');
  const r = await window.api.discoverCourses();
  if (r.error) {
    $('sessionMsg').className = 'notice err';
    $('sessionMsg').textContent = r.message || 'Não foi possível localizar suas matérias. Tente novamente.';
    $('btn-check-session').disabled = false;
    return;
  }
  courses = r.courses || [];
  selectedCourseIds = new Set(courses.filter((c) => c.available !== false).map((c) => String(c.id)));
  periodoMaisRecente = (r.summary && r.summary.periodoMaisRecente) || null;
  if (!courses.length) {
    $('sessionMsg').className = 'notice warn';
    $('sessionMsg').textContent = 'Nenhuma matéria foi encontrada na sua conta. Verifique sua sessão e tente novamente.';
    $('btn-check-session').disabled = false;
    return;
  }
  renderCourses();
  show('screen-courses');
  $('btn-check-session').disabled = false;
});

// Rótulos de situação acadêmica (correção B): "concluída", "encerrada" e
// "inativa" NÃO tornam a matéria indisponível — o estudante ainda pode
// selecioná-la e tentar o acesso. Somente evidência concreta de
// indisponibilidade desabilita o item.
const SITUACAO_LABEL = {
  ativa: { cls: 'ativa', txt: 'ativa' },
  concluida: { cls: 'concluida', txt: 'concluída' },
  encerrada: { cls: 'concluida', txt: 'encerrada' },
  inativa: { cls: 'concluida', txt: 'inativa' },
  indisponivel: { cls: 'indisponivel', txt: 'indisponível' },
};
function applyCourseFilter() {
  if (courseFilter === 'todas') return courses;
  if (courseFilter === 'ativas') {
    return courses.filter((c) => {
      const situ = String(c.situacao || c.situation || 'ativa').toLowerCase();
      return situ === 'ativa' || situ === 'em andamento' || situ === 'andamento';
    });
  }
  if (courseFilter === 'recentes') {
    return courses.filter((c) => {
      const p = String(c.period || '');
      if (periodoMaisRecente && p && p !== periodoMaisRecente) return false;
      const situ = String(c.situacao || c.situation || 'ativa').toLowerCase();
      return situ === 'ativa' || situ === 'em andamento' || situ === 'andamento';
    });
  }
  return courses;
}

function renderCourses() {
  const box = $('courseList');
  box.innerHTML = '';
  const visible = applyCourseFilter();
  visible.forEach((c) => {
    const real = c.available !== false;
    const situ = c.situacao || 'ativa';
    const s = SITUACAO_LABEL[situ] || SITUACAO_LABEL.ativa;
    const div = document.createElement('div');
    div.className = 'item';
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const courseId = String(c.id);
    cb.checked = selectedCourseIds.has(courseId);
    cb.disabled = !real;
    cb.dataset.id = courseId;
    cb.addEventListener('change', () => {
      if (cb.checked) selectedCourseIds.add(courseId);
      else selectedCourseIds.delete(courseId);
      updateCourseCounter();
    });
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = c.title || c.name || '';
    // Dados do AVA são texto não confiável: nunca interpolar code/status em innerHTML.
    const metadata = document.createElement('span');
    if (c.code) {
      const codeEl = document.createElement('span');
      codeEl.className = 'code';
      codeEl.textContent = c.code;
      metadata.appendChild(codeEl);
      metadata.appendChild(document.createTextNode(' '));
    }
    const statusEl = document.createElement('span');
    statusEl.className = 'status ' + s.cls;
    statusEl.textContent = s.txt;
    metadata.appendChild(statusEl);
    label.appendChild(cb);
    label.appendChild(name);
    label.appendChild(metadata);
    div.appendChild(label);
    box.appendChild(div);
  });
  updateCourseCounter();
  $('courseCount').textContent = visible.length;
}

$('filter-courses').addEventListener('change', (e) => {
  courseFilter = e.target.value;
  renderCourses();
});

function updateCourseCounter() {
  $('courseCounter').textContent = selectedCourseIds.size + ' selecionada(s)';
}

$('btn-all-courses').addEventListener('click', () => {
  selectedCourseIds = new Set(courses.filter((c) => c.available !== false).map((c) => String(c.id)));
  renderCourses();
});
$('btn-none-courses').addEventListener('click', () => {
  selectedCourseIds.clear();
  renderCourses();
});

$('btn-to-weeks').addEventListener('click', async () => {
  const selected = [];
  document.querySelectorAll('#courseList input:checked').forEach((cb) => selected.push(cb.dataset.id));
  if (!selected.length) { setLive('Selecione ao menos uma matéria para continuar.', 'notice warn'); return; }
  setLive('Localizando as semanas...');
  const r = await window.api.discoverWeeks(selected);
  if (r.error) { setLive(r.error, 'notice err'); return; }
  weeksByCourse = r.weeksByCourse || {};
  renderWeeks();
  show('screen-weeks');
  setLive('');
});

function renderWeeks() {
  const box = $('weekList');
  box.innerHTML = '';
  let totalWeeks = 0;
  for (const id of Object.keys(weeksByCourse)) {
    const { course, weeks } = weeksByCourse[id];
    const g = document.createElement('div');
    g.className = 'group-title';
    g.textContent = (course.code ? course.code + ' — ' : '') + course.title;
    box.appendChild(g);
    if (!weeks.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Nenhuma semana detectada nesta matéria.';
      box.appendChild(p);
      continue;
    }
    weeks.forEach((w) => {
      const div = document.createElement('div');
      div.className = 'item';
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.course = id;
      cb.dataset.week = String(w.id);
      cb.addEventListener('change', updateWeekCounter);
      label.appendChild(cb);
      const span = document.createElement('span');
      span.className = 'name';
      span.textContent = w.name;
      label.appendChild(span);
      div.appendChild(label);
      box.appendChild(div);
      totalWeeks++;
    });
  }
  $('weekCounter').textContent = totalWeeks + ' semana(s) encontrada(s), todas selecionadas.';
}

function updateWeekCounter() {
  const n = document.querySelectorAll('#weekList input:checked').length;
  const total = document.querySelectorAll('#weekList input').length;
  $('weekCounter').textContent = n + ' de ' + total + ' semana(s) selecionada(s).';
}

$('btn-all-weeks').addEventListener('click', () => {
  document.querySelectorAll('#weekList input').forEach((cb) => { cb.checked = true; });
  updateWeekCounter();
});
$('btn-none-weeks').addEventListener('click', () => {
  document.querySelectorAll('#weekList input').forEach((cb) => { cb.checked = false; });
  updateWeekCounter();
});

$('btn-extract').addEventListener('click', async () => {
  const selection = [];
  for (const courseId of Object.keys(weeksByCourse)) {
    const weekIds = [];
    document.querySelectorAll('#weekList input[data-course="' + courseId + '"]:checked').forEach((cb) => weekIds.push(cb.dataset.week));
    selection.push({ courseId, weekIds });
  }
  const anyChecked = selection.some((s) => s.weekIds.length);
  if (!anyChecked) { setLive('Selecione ao menos uma semana para extrair.', 'notice warn'); return; }
  cancelled = false;
  $('btn-extract').disabled = true;
  $('btn-cancel').disabled = false;
  $('current').textContent = '';
  $('nDone').textContent = '0'; $('nPending').textContent = '0'; $('nTotal').textContent = '...';
  $('barGeneral').style.width = '0%';
  $('progressStatus').textContent = 'Extraindo seus materiais. Isso pode levar alguns minutos.';
  show('screen-progress');
  const r = await window.api.runExtraction(selection);
  if (r.cancelled) {
    $('progressStatus').textContent = 'Extração cancelada. Os materiais já processados foram mantidos.';
    $('btn-cancel').disabled = true;
    $('btn-extract').disabled = false;
    $('btn-save-partial-zip').classList.remove('hidden');
    $('btn-discard').classList.remove('hidden');
    setLive('Você pode salvar o que já foi processado, descartar esta extração ou iniciar uma nova.', 'notice warn');
    return;
  }
  if (!r.ok) {
    $('progressStatus').textContent = r.error || 'Houve um problema durante a extração.';
    $('btn-cancel').disabled = true;
    $('btn-extract').disabled = false;
    return;
  }
  showResult(r);
});

$('btn-cancel').addEventListener('click', () => {
  cancelled = true;
  window.api.cancelExtraction();
  $('progressStatus').textContent = 'Cancelando... aguarde a conclusão do material atual.';
  $('btn-cancel').disabled = true;
});

function showResult(r) {
  // Contrato de resposta (correção D): status/título/mensagem/counts no nível
  // externo. Fallback para o objeto aninhado r.result por compatibilidade.
  const res = r.result && !r.title && !r.counts ? r.result : r;
  const counts = res.counts || {};
  const status = res.statusLabel || '';
  $('rIntegral').textContent = counts.integral || 0;
  $('rPartial').textContent = counts.partial || 0;
  $('rInacc').textContent = counts.inaccessible || 0;
  $('rNotFound').textContent = counts.not_found || 0;
  $('rVideoTr').textContent = counts.videoComTranscricao || 0;
  $('rVideoSemTr').textContent = counts.videoSemTranscricao || 0;
  const st = $('resultStatus');
  st.className = 'statusline ' + (status === 'concluído' ? 'ok' : status === 'falhou' ? 'err' : 'warn');
  st.textContent = res.title || '';
  $('resultMsg').textContent = res.message || '';
  $('zipInfo').classList.add('hidden');
  show('screen-result');
}

// P0: distingue os estados do salvamento. Só `validado` mostra sucesso; falha de
// validação NUNCA exibe "verificado" e reabilita o botão para nova tentativa.
function handleSaveZipResult(btn, r) {
  if (r.ok && r.state === 'validado') {
    $('zipPath').textContent = r.zip.path;
    $('zipInfo').classList.remove('hidden');
    setLive('ZIP salvo e verificado com sucesso (' + r.zip.bytes + ' bytes, ' + (r.validation ? r.validation.entries : 0) + ' arquivos).', 'notice ok');
    return true;
  }
  if (r.canceled || r.state === 'cancelado') {
    setLive('Salvamento cancelado. Você pode tentar novamente.', 'notice warn');
  } else if (r.state === 'nao-validado') {
    setLive('O ZIP foi criado, mas a validação falhou (integridade). Nenhum arquivo foi substituído; os materiais foram preservados. Tente novamente.', 'notice err');
  } else {
    setLive('Não foi possível criar o ZIP: ' + (r.error || 'erro inesperado'), 'notice err');
  }
  return false;
}

$('btn-save-zip').addEventListener('click', async () => {
  $('btn-save-zip').disabled = true;
  setLive('Aguardando a escolha do destino...');
  const r = await window.api.saveZip();
  const ok = handleSaveZipResult($('btn-save-zip'), r);
  $('btn-save-zip').disabled = false;
  if (ok) $('btn-save-zip').classList.add('hidden');
});

// Seção 3.5: após cancelamento, salvar o que já foi processado ou descartar
// explicitamente (a pasta de trabalho é removida pelo backend após validação).
$('btn-save-partial-zip').addEventListener('click', async () => {
  $('btn-save-partial-zip').disabled = true;
  setLive('Aguardando a escolha do destino...');
  const r = await window.api.saveZip();
  const ok = handleSaveZipResult($('btn-save-partial-zip'), r);
  $('btn-save-partial-zip').disabled = false;
  if (ok) {
    $('btn-save-partial-zip').classList.add('hidden');
    $('btn-discard').classList.add('hidden');
  }
});

$('btn-discard').addEventListener('click', async () => {
  await window.api.discardExtraction();
  $('btn-save-partial-zip').classList.add('hidden');
  $('btn-discard').classList.add('hidden');
  setLive('Extração descartada. Os dados temporários foram removidos.', 'notice warn');
  show('screen-weeks');
});

$('btn-reveal').addEventListener('click', () => {
  const p = $('zipPath').textContent;
  if (p) window.api.revealZip(p);
});

init();
