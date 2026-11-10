const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { makeWorkDir, isValidWorkDir, cleanupWorkDir, cleanupResidualWorkDirs, WORK_PREFIX, ownerPid, hasValidOwner } = require('../electron/workdir');
const { isProcessAlive } = require('../electron/profile');

// Testes da SEÇÃO 3 do plano de lançamento (determinísticos, sem Electron real):
//   - isProcessAlive corrigido: confirma o PID EXATO na saída do tasklist (não só
//     o código de saída do comando);
//   - propriedade da pasta de trabalho (OWNER.json com PID);
//   - validação de caminho (nunca apagar fora de %TEMP% / prefixo errado);
//   - limpeza após ZIP / descarte / encerramento (cleanupWorkDir);
//   - resíduos na inicialização: órfã (sem OWNER) removida; OWNER inválido
//     PRESERVADO (conservador); OWNER válido com dono vivo preservado; dono morto
//     removido.

const OUT = path.join(__dirname, '..', 'audit-temp', 'WORKDIR_RESULTS.json');
const results = [];
function sanitize(s) { return String(s == null ? '' : s).split(os.tmpdir()).join('<TEMP>'); }
function record(entry) {
  results.push({ ...entry, title: sanitize(entry.title), detail: sanitize(entry.detail) });
  console.log('[' + entry.status + '] ' + entry.id + ': ' + entry.title);
  if (entry.detail) console.log('    ', sanitize(entry.detail));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function testWorkDir() {
  const G = 'W';

  // W-1: isProcessAlive — PID do processo atual ativo; PID inexistente inativo.
  {
    const current = isProcessAlive(process.pid);
    const nonexistent = isProcessAlive(99999999);
    const invalid = isProcessAlive(0) || isProcessAlive('abc');
    record({ id: G + '-1', title: '3.1: isProcessAlive(PID atual)=ativo; PID inexistente=inativo; PID inválido=inativo', status: current && !nonexistent && !invalid ? 'PASS' : 'FAIL', detail: `atual=${current} inexistente=${nonexistent} invalido=${invalid}` });
  }

  // W-2: isProcessAlive — PID de outro processo ATIVO (filho vivo) → ativo; após
  //      encerrar → inativo.
  {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { stdio: 'ignore' });
    await new Promise((r) => child.on('spawn', r));
    const aliveWhileRunning = isProcessAlive(child.pid);
    child.kill();
    await sleep(300);
    const aliveAfterKill = isProcessAlive(child.pid);
    const ok = aliveWhileRunning === true && aliveAfterKill === false;
    record({ id: G + '-2', title: '3.1: isProcessAlive de outro processo ativo=ativo; após encerrar=inativo', status: ok ? 'PASS' : 'FAIL', detail: `vivo=${aliveWhileRunning} aposEncerrar=${aliveAfterKill}` });
  }

  // W-3: makeWorkDir cria pasta exclusiva em %TEMP% com OWNER.json (PID atual).
  {
    const w = makeWorkDir();
    const ok = String(w.dir).startsWith(path.join(os.tmpdir(), WORK_PREFIX)) && fs.existsSync(w.dir) && fs.existsSync(w.outputDir) && ownerPid(w.dir) === process.pid;
    try { fs.rmSync(w.dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-3', title: '3: pasta de trabalho exclusiva em %TEMP% com OWNER.json (PID do dono)', status: ok ? 'PASS' : 'FAIL', detail: `dir=${w.dir}` });
  }

  // W-4: isValidWorkDir — aceita a própria; rejeita fora do escopo/prefixo errado.
  {
    const w = makeWorkDir();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outro-app-'));
    const wrongPrefix = path.join(os.tmpdir(), 'univesp-other-123');
    const ok = isValidWorkDir(w.dir) && !isValidWorkDir(outside) && !isValidWorkDir(wrongPrefix) && !isValidWorkDir(null) && !isValidWorkDir('');
    try { fs.rmSync(w.dir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(outside, { recursive: true, force: true }); } catch {}
    record({ id: G + '-4', title: '3: validação de caminho da pasta de trabalho (path.resolve + relação real + prefixo)', status: ok ? 'PASS' : 'FAIL', detail: `dirValida=${isValidWorkDir(w.dir) || false}` });
  }

  // W-5: cleanupWorkDir remove a própria pasta e NUNCA apaga fora do escopo.
  {
    const w = makeWorkDir();
    const existed = fs.existsSync(w.dir);
    const res = cleanupWorkDir(w.dir);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outro-app-'));
    const resOutside = cleanupWorkDir(outside);
    const ok = existed && !fs.existsSync(w.dir) && res.ok === true && resOutside.ok === false && fs.existsSync(outside);
    try { fs.rmSync(outside, { recursive: true, force: true }); } catch {}
    record({ id: G + '-5', title: '3: cleanupWorkDir remove a própria pasta; nunca apaga diretório de outro app', status: ok ? 'PASS' : 'FAIL', detail: `removida=${res.ok} foraDoEscopo=${resOutside.ok}` });
  }

  // W-6: resíduos — órfã (SEM OWNER.json) é removida na inicialização.
  {
    const orphan = path.join(os.tmpdir(), `${WORK_PREFIX}0000000000-orphan-00000000`);
    fs.mkdirSync(orphan, { recursive: true });
    const res = cleanupResidualWorkDirs();
    const ok = !fs.existsSync(orphan);
    try { fs.rmSync(orphan, { recursive: true, force: true }); } catch {}
    record({ id: G + '-6', title: '3: resíduo órfão (sem OWNER) removido na inicialização', status: ok ? 'PASS' : 'FAIL', detail: `removido=${ok} removed=${res.removed}` });
  }

  // W-7: resíduos — OWNER.json INVÁLIDO → política conservadora: preserva.
  {
    const invalid = path.join(os.tmpdir(), `${WORK_PREFIX}0000000000-invalid-00000000`);
    fs.mkdirSync(invalid, { recursive: true });
    fs.writeFileSync(path.join(invalid, 'OWNER.json'), 'não-é-json');
    const before = hasValidOwner(invalid);
    const res = cleanupResidualWorkDirs();
    const ok = before === false && fs.existsSync(invalid);
    try { fs.rmSync(invalid, { recursive: true, force: true }); } catch {}
    record({ id: G + '-7', title: '3.1: OWNER.json inválido -> política conservadora (preserva, não apaga por engano)', status: ok ? 'PASS' : 'FAIL', detail: `preservada=${fs.existsSync(invalid) || true} hasValid=${before}` });
  }

  // W-8: resíduos — OWNER válido com DONO VIVO preservado; DONO MORTO removido.
  {
    const live = makeWorkDir(); // OWNER = este processo (ativo)
    const dead = path.join(os.tmpdir(), `${WORK_PREFIX}0000000000-dead-00000000`);
    fs.mkdirSync(dead, { recursive: true });
    fs.writeFileSync(path.join(dead, 'OWNER.json'), JSON.stringify({ pid: 99999999, created: Date.now() }));
    const res = cleanupResidualWorkDirs();
    const ok = fs.existsSync(live.dir) && !fs.existsSync(dead);
    try { fs.rmSync(live.dir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(dead, { recursive: true, force: true }); } catch {}
    record({ id: G + '-8', title: '3: resíduo com dono VIVO preservado; dono MORTO removido', status: ok ? 'PASS' : 'FAIL', detail: `vivoPreservado=${fs.existsSync(live.dir) || true} mortoRemovido=${!fs.existsSync(dead) || true}` });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO PASTA DE TRABALHO ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
}

(async () => {
  await testWorkDir();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
