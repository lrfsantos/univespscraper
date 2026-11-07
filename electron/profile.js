const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Perfil temporário ISOLADO por execução (requisito da auditoria):
//   - diretório exclusivo em %TEMP% (univesp-profile-<ts>-<rand>);
//   - fora do repositório e separado do perfil pessoal do Chrome;
//   - evita persistência acidental em %APPDATA%\<app> / %APPDATA%\Electron;
//   - limpeza normal (ao fechar) e residual (na inicialização seguinte, após
//     crash) — melhor esforço, nunca alega exclusão segura/irrecuperável.

const PREFIX = 'univesp-profile-';

function makeTempProfileDir() {
  const dir = path.join(os.tmpdir(), `${PREFIX}${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Limpeza normal (melhor esforço): apaga só o perfil criado pelo app.
function cleanupProfile(dir) {
  if (!dir || !String(dir).includes(path.join(os.tmpdir(), PREFIX))) return { ok: false, reason: 'diretorio-fora-do-escopo' };
  try { fs.rmSync(dir, { recursive: true, force: true }); return { ok: true, removed: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
}

// Limpeza residual (inicialização seguinte após crash): remove apenas perfis
// temporários antigos do app (> olderThanMs), nunca os de outros aplicativos.
function cleanupResidualProfiles(skip, olderThanMs = 60000) {
  let removed = 0;
  let failed = 0;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      const p = path.join(os.tmpdir(), name);
      if (p === skip) continue;
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (Date.now() - st.mtimeMs > olderThanMs) {
        try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch { failed++; }
      }
    }
  } catch { /* melhor esforço */ }
  return { removed, failed };
}

// Instala o perfil temporário num app Electron (ou em um app fake para testes).
// Deve ser chamado ANTES de app.whenReady(). Retorna { dir, residual, cleanup }.
function installTempProfile(app) {
  const dir = makeTempProfileDir();
  if (app && typeof app.setPath === 'function') {
    try { app.setPath('userData', dir); } catch { /* melhor esforço */ }
    try { app.setPath('sessionData', dir); } catch { /* melhor esforço */ }
  }
  const residual = cleanupResidualProfiles(dir);
  if (app && typeof app.on === 'function') {
    app.on('will-quit', () => { cleanupProfile(dir); });
  }
  return { dir, residual, cleanup: () => cleanupProfile(dir) };
}

module.exports = { PREFIX, makeTempProfileDir, cleanupProfile, cleanupResidualProfiles, installTempProfile };
