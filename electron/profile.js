const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Perfil temporário ISOLADO por execução (requisito):
//   - diretório exclusivo em %TEMP% (univesp-profile-<ts>-<rand>);
//   - fora do repositório e separado do perfil pessoal do Chrome;
//   - evita persistência acidental em %APPDATA%\<app> / %APPDATA%\Electron;
//   - PROPRIEDADE: arquivo de lock com o PID do processo dono; resíduos só são
//     removidos quando o processo proprietário NÃO está mais ativo (nunca apenas
//     por idade/mtime — uma segunda instância NÃO remove o perfil em uso);
//   - validação de caminho via path.resolve e relação REAL com os.tmpdir() (não
//     usa includes()); caminhos inesperados são REJEITADOS;
//   - se app.setPath falhar, a inicialização é ABORTADA explicitamente (nunca usa
//     silenciosamente o perfil padrão do usuário);
//   - limpeza normal no encerramento e recuperação de resíduos na inicialização.

const PREFIX = 'univesp-profile-';

// Verifica se um processo está ativo no Windows/Linux/macOS.
function isProcessAlive(pid) {
  const n = parseInt(pid, 10);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    if (process.platform === 'win32') {
      const { execFileSync } = require('child_process');
      execFileSync('tasklist', ['/FI', `PID eq ${n}`, '/NH'], { stdio: 'pipe' });
      return true;
    }
    try { process.kill(n, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
  } catch { return false; }
}

// Validação SEGURA do diretório de perfil: só aceita caminhos que resolvam DENTRO
// de os.tmpdir() (relação real de diretórios), com o prefixo esperado.
function isValidProfileDir(dir) {
  if (!dir) return false;
  const resolved = path.resolve(dir);
  const tmpResolved = path.resolve(os.tmpdir());
  const rel = path.relative(tmpResolved, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const base = path.basename(resolved);
  return base.startsWith(PREFIX);
}

function makeTempProfileDir() {
  const dir = path.join(os.tmpdir(), `${PREFIX}${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'OWNER.json'), JSON.stringify({ pid: process.pid, created: Date.now() }));
  return dir;
}

function ownerPid(dir) {
  try {
    const p = path.join(path.resolve(dir), 'OWNER.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && j.pid ? j.pid : null;
  } catch { return null; }
}

// Limpeza normal (melhor esforço): apaga só o perfil criado pelo app (após
// validação de caminho). Nunca alega exclusão segura/irrecuperável.
function cleanupProfile(dir) {
  if (!isValidProfileDir(dir)) return { ok: false, reason: 'diretorio-fora-do-escopo' };
  try { fs.rmSync(path.resolve(dir), { recursive: true, force: true }); return { ok: true, removed: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
}

// Recuperação de resíduos na inicialização: remove apenas perfis temporários do
// app cujo processo proprietário NÃO está ativo (o lock/OWNER decide, não mtime).
function cleanupResidualProfiles(skip) {
  let removed = 0;
  let failed = 0;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      const p = path.join(os.tmpdir(), name);
      if (p === skip) continue;
      if (!isValidProfileDir(p)) continue;
      const pid = ownerPid(p);
      if (pid != null && isProcessAlive(pid)) continue; // ainda em uso → preserva
      try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch { failed++; }
    }
  } catch { /* melhor esforço */ }
  return { removed, failed };
}

// Instala o perfil temporário num app Electron (ou app fake para testes).
// ABORTA (throw) se app.setPath não aplicar userData/sessionData de fato.
function installTempProfile(app) {
  const dir = makeTempProfileDir();
  let applied = true;
  if (app && typeof app.setPath === 'function') {
    try { app.setPath('userData', dir); } catch { applied = false; }
    try { app.setPath('sessionData', dir); } catch { applied = false; }
  }
  if (!app || typeof app.getPath !== 'function' || app.getPath('userData') !== path.resolve(dir) || app.getPath('sessionData') !== path.resolve(dir)) {
    try { cleanupProfile(dir); } catch {}
    throw new Error('Falha ao configurar o perfil temporário — inicialização abortada (não será usado o perfil padrão do usuário).');
  }
  const residual = cleanupResidualProfiles(dir);
  if (app && typeof app.on === 'function') {
    app.on('will-quit', () => { cleanupProfile(dir); });
  }
  return { dir, residual, cleanup: () => cleanupProfile(dir) };
}

module.exports = { PREFIX, makeTempProfileDir, cleanupProfile, cleanupResidualProfiles, installTempProfile, isValidProfileDir, isProcessAlive, ownerPid };
