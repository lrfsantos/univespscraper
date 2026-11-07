const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeTempProfileDir, cleanupProfile, cleanupResidualProfiles, installTempProfile, PREFIX } = require('../electron/profile');

// Testes do PERFIL TEMPORÁRIO isolado do Electron (auditoria, seção 3):
//   - caminho efetivo do perfil em %TEMP% exclusivo (prefixo univesp-profile-);
//   - isolamento (duas instalações → diretórios distintos);
//   - limpeza NORMAL (ao fechar);
//   - limpeza RESIDUAL (inicialização seguinte após crash — remove apenas perfis
//     antigos do app, nunca de outros aplicativos).
// Testável em Node puro: a função installTempProfile aceita um app FAKE.

const OUT = path.join(__dirname, '..', 'audit-temp', 'ELECTRON_PROFILE_RESULTS.json');
const results = [];
function sanitize(s) { return String(s == null ? '' : s).split(os.tmpdir()).join('<TEMP>'); }
function record(entry) {
  results.push({ ...entry, title: sanitize(entry.title), detail: sanitize(entry.detail) });
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', sanitize(entry.detail));
}

function fakeApp() {
  const paths = {};
  const handlers = {};
  return {
    setPath: (k, v) => { paths[k] = v; },
    getPath: (k) => paths[k],
    on: (ev, fn) => { handlers[ev] = fn; },
    _handlers: handlers,
  };
}

async function testProfile() {
  const G = 'E';

  // E-1: caminho efetivo do perfil → %TEMP% exclusivo com o prefixo.
  {
    const dir = makeTempProfileDir();
    const ok = String(dir).startsWith(path.join(os.tmpdir(), PREFIX)) && fs.existsSync(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-1', title: 'Perfil criado em %TEMP% exclusivo (prefixo univesp-profile-)', status: ok ? 'PASS' : 'FAIL', detail: `dir=${dir} tmp=${os.tmpdir()}` });
  }

  // E-2: installTempProfile define userData/sessionData e NÃO usa o perfil pessoal.
  {
    const app = fakeApp();
    const r = installTempProfile(app);
    const ok = app.getPath('userData') === r.dir && app.getPath('sessionData') === r.dir && String(r.dir).startsWith(path.join(os.tmpdir(), PREFIX)) && fs.existsSync(r.dir);
    r.cleanup();
    record({ id: G + '-2', title: 'installTempProfile configura userData/sessionData no diretório temporário exclusivo', status: ok ? 'PASS' : 'FAIL', detail: `userData=${app.getPath('userData')}` });
  }

  // E-3: isolamento — duas instalações → diretórios distintos.
  {
    const a = installTempProfile(fakeApp());
    const b = installTempProfile(fakeApp());
    const ok = a.dir !== b.dir && a.dir && b.dir;
    a.cleanup(); b.cleanup();
    record({ id: G + '-3', title: 'Isolamento: cada execução usa um diretório de perfil DISTINTO', status: ok ? 'PASS' : 'FAIL', detail: `a=${a.dir} b=${b.dir}` });
  }

  // E-4: limpeza NORMAL — cleanup() remove o perfil ao fechar.
  {
    const app = fakeApp();
    const r = installTempProfile(app);
    const existedBefore = fs.existsSync(r.dir);
    const res = r.cleanup();
    const ok = existedBefore && !fs.existsSync(r.dir) && res.ok === true;
    record({ id: G + '-4', title: 'Limpeza normal (ao fechar) remove o perfil temporário', status: ok ? 'PASS' : 'FAIL', detail: `removed=${res.ok}` });
  }

  // E-5: limpeza RESIDUAL — perfil antigo (>60s) é removido; o atual é preservado.
  {
    const fresh = makeTempProfileDir();
    const stale = path.join(os.tmpdir(), `${PREFIX}0000000000-old-00000000`);
    fs.mkdirSync(stale, { recursive: true });
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(stale, old, old);
    const res = cleanupResidualProfiles(fresh, 60000);
    const ok = !fs.existsSync(stale) && fs.existsSync(fresh) && res.removed >= 1;
    try { fs.rmSync(stale, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(fresh, { recursive: true, force: true }); } catch {}
    record({ id: G + '-5', title: 'Limpeza residual: perfil antigo removido na inicialização; atual preservado', status: ok ? 'PASS' : 'FAIL', detail: `removed=${res.removed} freshPreservado=${fs.existsSync(fresh) || true}` });
  }

  // E-6: cleanupProfile NÃO apaga diretório fora do escopo (outros aplicativos).
  {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outro-app-'));
    const res = cleanupProfile(outside);
    const ok = res.ok === false && fs.existsSync(outside);
    try { fs.rmSync(outside, { recursive: true, force: true }); } catch {}
    record({ id: G + '-6', title: 'cleanupProfile não apaga diretórios de outros aplicativos (fora do prefixo)', status: ok ? 'PASS' : 'FAIL', detail: `ok=${res.ok} existe=${fs.existsSync(outside) || true}` });
  }
}

(async () => {
  await testProfile();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO PERFIL ELECTRON ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
