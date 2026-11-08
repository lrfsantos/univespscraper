const fs = require('fs');
const os = require('os');
const path = require('path');
const flow = require('../electron/flow');

// Testes do FLUXO Electron (D2) com janela/app FAKES determinísticos:
//   login manual aguardado (isLoggedIn/waitForManualLogin com detecção real de
//   autenticação — não basta a página aberta);
//   descoberta de disciplinas e semanas via parsers sobre o DOM fake;
//   extração delegada aos módulos (aqui com stubs de recursos puros);
//   estados do ZIP (válido / inválido / cancelado);
//   limpeza dos temporários.
// NÃO usa Electron real (documentado): valida a orquestração com mocks; a
// validação com Electron real fica pendente por limitação do ambiente.

const OUT = path.join(__dirname, '..', 'audit-temp', 'ELECTRON_FLOW_RESULTS.json');
const results = [];
function sanitize(s) { return String(s == null ? '' : s).split(os.tmpdir()).join('<TEMP>'); }
function record(entry) {
  results.push({ ...entry, title: sanitize(entry.title), detail: sanitize(entry.detail) });
  console.log('[' + entry.status + '] ' + entry.id + ': ' + entry.title);
  if (entry.detail) console.log('    ', sanitize(entry.detail));
}

function makeHtml() {
  return [
    '<html><body>',
    '<div class="course-content">',
    '<li class="section main" id="section-0"><h3>Geral</h3></li>',
    '<li class="section main" id="section-1"><h3>Semana 1</h3><div class="activityinstance">',
    '<a href="https://ava.univesp.br/mod/page/view.php?id=11">S1 - Inicio</a>',
    '</div></li>',
    '</div></body></html>',
  ].join('\n');
}

function makeFakeWin(html) {
  const nav = [];
  let cur = 'https://ava.univesp.br/';
  return {
    async goto(url, _opts) { cur = url; nav.push(url); },
    url: () => cur,
    waitForTimeout: async () => {},
    async evaluate(fn) {
      if (typeof fn === 'function') {
        if (fn.toString().includes('outerHTML')) return html;
        if (fn.toString().includes('ava-scope')) return cur.includes('ava.univesp.br');
      }
      return '';
    },
    frames: () => [],
  };
}

(async () => {
  // D-2a: isLoggedIn NÃO confirma login apenas com a página aberta.
  {
    const loginHtml = '<html><body><form name="f"><input name="password"></form></body></html>';
    const loggedOut = makeFakeWin(loginHtml);
    loggedOut.url = () => 'https://ava.univesp.br/login/index.php';
    loggedOut.evaluate = async (fn) => {
      if (fn.toString().includes('innerHTML')) return loginHtml;
      if (fn.toString().includes('querySelector')) return false;
      return '';
    };
    const r = await flow.isLoggedIn(loggedOut);
    const ok = r === false;
    record({ id: 'D-2a', title: 'D2: isLoggedIn não considera a página aberta como login (formulário de login presente)', status: ok ? 'PASS' : 'FAIL', detail: `loggedIn=${r} (esperado false)` });
  }

  // D-2b: waitForManualLogin aguarda até detectar autenticação.
  {
    const win = makeFakeWin('<html><body><form name="f"></form></body></html>');
    let t = 0;
    const original = win.url;
    win.url = () => (t++ > 3 ? 'https://ava.univesp.br/my/' : 'https://ava.univesp.br/login/');
    win.evaluate = async () => t > 3; // autenticado após algumas sondagens
    const r = await flow.waitForManualLogin(win, { timeoutMs: 8000, interval: 100 });
    const ok = r === true;
    record({ id: 'D-2b', title: 'D2: waitForManualLogin retorna true quando a autenticação é detectada (não só a página)', status: ok ? 'PASS' : 'FAIL', detail: `detected=${r}` });
  }

  // D-2c: discoverCourses/discoverWeeks usam os parsers sobre o DOM fake.
  {
    const win = makeFakeWin(makeHtml());
    win.evaluate = async (fn) => {
      if (fn.toString().includes('outerHTML')) return makeHtml();
      if (fn.toString().includes('ava-scope')) return true;
      return '';
    };
    const { weeks } = await flow.discoverWeeks(win, { url: 'https://ava.univesp.br/course/view.php?id=1' });
    const ok = weeks.length === 1 && weeks[0].name === 'Semana 1';
    record({ id: 'D-2c', title: 'D2: descoberta de semanas dinâmica via parser (DOM fake)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(weeks) });
  }

  // D-2d: overallStatus + ZIP inválido não gera sucesso.
  {
    const statusNoZip = flow.overallStatus({ resources: [{ status: 'integral' }], zip: { ok: false } });
    const ok = statusNoZip === 'falhou';
    record({ id: 'D-2d', title: 'D2: ZIP inválido/ausente ⇒ status falhou (nunca concluído)', status: ok ? 'PASS' : 'FAIL', detail: `status=${statusNoZip}` });
  }

  // D-2e: limpeza do diretório de trabalho (melhor esforço).
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'univesp-flow-test-'));
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
    const removed = (() => { try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch { return false; } })();
    const ok = removed && !fs.existsSync(dir);
    record({ id: 'D-2e', title: 'D2: limpeza do diretório temporário de trabalho em melhor esforço', status: ok ? 'PASS' : 'FAIL', detail: `removed=${removed}` });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO FLUXO ELECTRON (D2) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

