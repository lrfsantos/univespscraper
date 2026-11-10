// Pasta de TRABALHO temporária da extração (univesp-work-*) — propriedade e ciclo
// de vida (seção 3 do plano de lançamento).
//
// Regras:
//   - pasta exclusiva em %TEMP% com prefixo `univesp-work-` e OWNER.json (PID);
//   - NUNCA apaga conteúdo antes do ZIP salvo e validado;
//   - após ZIP válido, remove a pasta (melhor esforço);
//   - cancelamento preserva a pasta para nova tentativa de salvamento;
//   - encerramento normal sem ZIP salvo remove a pasta;
//   - na inicialização, resíduos de execuções anteriores (dono inativo) são
//     removidos em melhor esforço;
//   - NUNCA apaga diretórios que não pertençam ao aplicativo (validação real de
//     caminho: path.resolve + relação com os.tmpdir() + prefixo);
//   - falha na limpeza NUNCA interrompe a geração do ZIP;
//   - não alega exclusão segura/irrecuperável.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { isProcessAlive } = require('./profile');

const WORK_PREFIX = 'univesp-work-';

// Validação SEGURA: só aceita caminhos que resolvam DENTRO de os.tmpdir() (relação
// real de diretórios, não includes()) e com o prefixo esperado.
function isValidWorkDir(dir) {
  if (!dir) return false;
  const resolved = path.resolve(dir);
  const tmpResolved = path.resolve(os.tmpdir());
  const rel = path.relative(tmpResolved, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return path.basename(resolved).startsWith(WORK_PREFIX);
}

function ownerPid(dir) {
  try {
    const p = path.join(path.resolve(dir), 'OWNER.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && j.pid ? j.pid : null;
  } catch { return null; }
}

// OWNER.json presente e válido (PID inteiro > 0)? Distingue "órfão" (arquivo
// ausente → pode remover) de "OWNER inválido" (arquivo presente/ilegível →
// política conservadora: preserva, pode estar em uso por engano).
function hasValidOwner(dir) {
  try {
    const p = path.join(path.resolve(dir), 'OWNER.json');
    if (!fs.existsSync(p)) return false;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const n = parseInt(j && j.pid, 10);
    return Number.isInteger(n) && n > 0;
  } catch { return false; }
}

// Cria a pasta de trabalho (base = os.tmpdir() por padrão) com OWNER.json.
function makeWorkDir(base) {
  const baseDir = base || os.tmpdir();
  const dir = path.join(baseDir, `${WORK_PREFIX}${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'OWNER.json'), JSON.stringify({ pid: process.pid, created: Date.now() }));
  const outputDir = path.join(dir, 'saida');
  fs.mkdirSync(outputDir, { recursive: true });
  return { dir, outputDir, base: baseDir };
}

// Limpeza (melhor esforço): apaga SÓ a pasta do app (após validação de caminho).
function cleanupWorkDir(dir) {
  if (!isValidWorkDir(dir)) return { ok: false, reason: 'diretorio-fora-do-escopo' };
  try { fs.rmSync(path.resolve(dir), { recursive: true, force: true }); return { ok: true, removed: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
}

// Recuperação de resíduos na inicialização: remove apenas pastas de trabalho do
// app cujo processo proprietário NÃO está ativo (OWNER decide, nunca mtime).
// Política conservadora (seção 3.1): OWNER AUSENTE = órfã → remove; OWNER presente
// porém INVÁLIDO → preserva; OWNER válido → remove só se o dono não estiver ativo.
function cleanupResidualWorkDirs(skip) {
  let removed = 0;
  let failed = 0;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(WORK_PREFIX)) continue;
      const p = path.join(os.tmpdir(), name);
      if (skip && path.resolve(p) === path.resolve(skip)) continue;
      if (!isValidWorkDir(p)) continue;
      const ownerPath = path.join(path.resolve(p), 'OWNER.json');
      if (!fs.existsSync(ownerPath)) { // órfã (sem dono) → pode remover
        try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch { failed++; }
        continue;
      }
      if (!hasValidOwner(p)) continue; // OWNER presente mas inválido → conservador
      const pid = ownerPid(p);
      if (pid != null && isProcessAlive(pid)) continue; // ainda em uso → preserva
      try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch { failed++; }
    }
  } catch { /* melhor esforço */ }
  return { removed, failed };
}

module.exports = { WORK_PREFIX, makeWorkDir, isValidWorkDir, cleanupWorkDir, cleanupResidualWorkDirs, ownerPid, hasValidOwner };
