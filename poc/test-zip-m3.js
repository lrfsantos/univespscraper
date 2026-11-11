const fs = require('fs');
const os = require('os');
const path = require('path');
const { finalizeZip } = require('../electron/flow');

// Testes P0 — validação real do ZIP (seção 1): o fluxo de produção finalizeZip é
// exercitado com dependências injetadas apenas nas fronteiras (criação/validação),
// mas com sistema de arquivos REAL. Prova que falha de validação NUNCA produz
// ok:true, nunca promove o arquivo ao destino, nunca apaga a pasta de trabalho
// (onSuccess) e preserva arquivo válido existente no destino.

const OUT = path.join(__dirname, '..', 'audit-temp', 'ZIP_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

function makeZipCreator({ ok = true, reason = null } = {}) {
  return async (srcDir, destPath) => {
    if (!ok) return { ok: false, reason: reason || 'criacao-falhou', path: destPath, bytes: 0, files: 0 };
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, 'PK\x03\x04conteudo-zip-sintetico');
    return { ok: true, bytes: 27, files: 3, path: destPath };
  };
}
function makeZipValidator({ valid = true, matches = true } = {}) {
  return (zip) => ({ valid, matches, entries: 3 });
}

function tmpDir(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
  return d;
}

(async () => {
  const G = 'Z';

  // Z-1: ZIP válido + validação positiva -> ok:true, estado validado, onSuccess chamado, arquivo no destino.
  {
    const dir = tmpDir('zip1');
    const dest = path.join(dir, 'out.zip');
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    let onSuccess = 0;
    const r = await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator(), validateZip: makeZipValidator(), onSuccess: () => { onSuccess++; } });
    const ok = r.ok === true && r.state === 'validado' && onSuccess === 1 && fs.existsSync(dest) && !fs.existsSync(dest + '.tmp-') ;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-1', title: 'P0 ZIP: válido e validação positiva -> ok:true, state=validado, onSuccess chamado', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} state=${r.state} onSuccess=${onSuccess} dest=${fs.existsSync(dest) || false}` });
  }

  // Z-2: ZIP criado mas validation.valid === false -> NUNCA ok:true, dest intocado, onSuccess NÃO chamado.
  {
    const dir = tmpDir('zip2');
    const dest = path.join(dir, 'out.zip');
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    let onSuccess = 0;
    const r = await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator(), validateZip: makeZipValidator({ valid: false }), onSuccess: () => { onSuccess++; } });
    const ok = r.ok === false && r.state === 'nao-validado' && onSuccess === 0 && !fs.existsSync(dest) && r.preserved === true && r.retryable === true;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-2', title: 'P0 ZIP: validation.valid=false -> ok:false (nunca sucesso), destino preservado, onSuccess não chamado', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} state=${r.state} onSuccess=${onSuccess} destExiste=${fs.existsSync(dest) || false}` });
  }

  // Z-3: ZIP criado mas validation.matches === false -> ok:false, sem promover.
  {
    const dir = tmpDir('zip3');
    const dest = path.join(dir, 'out.zip');
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    let onSuccess = 0;
    const r = await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator(), validateZip: makeZipValidator({ valid: true, matches: false }), onSuccess: () => { onSuccess++; } });
    const ok = r.ok === false && r.state === 'nao-validado' && onSuccess === 0 && !fs.existsSync(dest);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-3', title: 'P0 ZIP: validation.matches=false -> ok:false, não promove ao destino', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} state=${r.state} onSuccess=${onSuccess}` });
  }

  // Z-4: falha na CRIAÇÃO do ZIP -> ok:false, state=nao-criado.
  {
    const dir = tmpDir('zip4');
    const dest = path.join(dir, 'out.zip');
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    let onSuccess = 0;
    const r = await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator({ ok: false }), validateZip: makeZipValidator(), onSuccess: () => { onSuccess++; } });
    const ok = r.ok === false && r.state === 'nao-criado' && onSuccess === 0 && !fs.existsSync(dest);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-4', title: 'P0 ZIP: falha na criação -> ok:false, state=nao-criado, sem onSuccess', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} state=${r.state}` });
  }

  // Z-5: arquivo válido EXISTENTE no destino NÃO é corrompido/substituído em caso de falha.
  {
    const dir = tmpDir('zip5');
    const dest = path.join(dir, 'out.zip');
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    fs.writeFileSync(dest, 'ARQUIVO-ORIGINAL-VALIDO');
    const r = await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator(), validateZip: makeZipValidator({ valid: false }), onSuccess: () => {} });
    const content = fs.readFileSync(dest, 'utf8');
    const ok = r.ok === false && content === 'ARQUIVO-ORIGINAL-VALIDO';
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-5', title: 'P0 ZIP: falha de validação NÃO corrompe/substitui arquivo válido existente no destino', status: ok ? 'PASS' : 'FAIL', detail: `ok=${r.ok} conteudoPreservado=${content === 'ARQUIVO-ORIGINAL-VALIDO'}` });
  }

  // Z-6: nova tentativa depois de falha de validação (com validação agora positiva) -> sucesso.
  {
    const dir = tmpDir('zip6');
    const dest = path.join(dir, 'out.zip');
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    const fail = await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator(), validateZip: makeZipValidator({ valid: false }), onSuccess: () => {} });
    const okR = await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator(), validateZip: makeZipValidator(), onSuccess: () => {} });
    const ok = fail.ok === false && okR.ok === true && okR.state === 'validado' && fs.existsSync(dest);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-6', title: 'P0 ZIP: nova tentativa após falha de validação (validação positiva) -> salvo', status: ok ? 'PASS' : 'FAIL', detail: `primeira=${fail.state} segunda=${okR.state} dest=${fs.existsSync(dest) || false}` });
  }

  // Z-7: pasta de trabalho preservada em caso de falha (onSuccess é a limpeza; não chamada).
  {
    const dir = tmpDir('zip7');
    const dest = path.join(dir, 'out.zip');
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    let onSuccess = 0;
    await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator({ ok: false }), validateZip: makeZipValidator(), onSuccess: () => { onSuccess++; } });
    const ok = onSuccess === 0 && fs.existsSync(src);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-7', title: 'P0 ZIP: pasta de trabalho preservada quando o ZIP não foi validado', status: ok ? 'PASS' : 'FAIL', detail: `onSuccess=${onSuccess}` });
  }

  // Z-8: pasta de trabalho removida SOMENTE depois de validação positiva.
  {
    const dir = tmpDir('zip8');
    const dest = path.join(dir, 'out.zip');
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    let onSuccess = 0;
    await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator(), validateZip: makeZipValidator({ valid: false }), onSuccess: () => { onSuccess++; } });
    const afterFail = onSuccess;
    const r = await finalizeZip({ srcDir: src, destPath: dest, createZip: makeZipCreator(), validateZip: makeZipValidator(), onSuccess: () => { onSuccess++; } });
    const ok = afterFail === 0 && r.ok === true && onSuccess === 1;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    record({ id: G + '-8', title: 'P0 ZIP: limpeza (onSuccess) só após validação positiva — nunca após falha', status: ok ? 'PASS' : 'FAIL', detail: `onSuccessAposFalha=${afterFail} onSuccessFinal=${onSuccess}` });
  }

  // Z-9: a interface NUNCA mostra "verificado" em estado não validado (inspeção do ui.html).
  {
    const UI = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ui.html'), 'utf8');
    const hasValidadoGate = UI.includes("r.ok && r.state === 'validado'") && UI.includes('ZIP salvo e verificado com sucesso');
    const failureMsg = UI.includes('validação falhou (integridade)');
    const ok = hasValidadoGate && failureMsg;
    record({ id: G + '-9', title: 'P0 ZIP: UI só exibe "verificado" quando state=validado; falha de validação tem mensagem própria (inspeção)', status: ok ? 'PASS' : 'FAIL', detail: `gate=${hasValidadoGate} mensagemFalha=${failureMsg}` });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO VALIDAÇÃO ZIP ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
