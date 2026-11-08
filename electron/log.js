const fs = require('fs');
const os = require('os');
const path = require('path');

// Log de diagnóstico SANITIZADO (requisito B4):
//   - remove query strings de URLs (inclui login_hint, tokens, etc.);
//   - nunca registra credenciais, cookies, tokens ou conteúdo de livros;
//   - limita o tamanho do arquivo e implementa retenção (rotação simples);
//   - nunca despeja JSON bruto de respostas sensíveis.

const MAX_BYTES = 512 * 1024; // 512 KB
const KEEP = 2; // arquivos retidos além do atual (rotação: .1, .2)

function sanitize(str) {
  let s = String(str == null ? '' : str);
  // remove query string de URLs http(s)
  s = s.replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, '$1');
  // remove valores de pares sensíveis caso apareçam fora de URL
  s = s.replace(/(login_hint|username|password|token|authorization|cookie|set-cookie|key)\s*[=:]\s*\S+/gi, '$1=<redigido>');
  // remove conteúdo aparentemente extenso (possível texto de livro)
  if (s.length > 2000) s = s.slice(0, 2000) + '...[truncado]';
  return s;
}

function createLogger(filePath) {
  const target = filePath || path.join(os.tmpdir(), 'univesp-debug.log');
  function rotate() {
    try {
      if (fs.existsSync(target) && fs.statSync(target).size > MAX_BYTES) {
        for (let i = KEEP; i >= 1; i--) {
          const from = i === 1 ? target : `${target}.${i - 1}`;
          const to = `${target}.${i}`;
          if (fs.existsSync(from)) fs.renameSync(from, to);
        }
      }
    } catch { /* melhor esforço */ }
  }
  function log(level, msg) {
    try {
      rotate();
      const line = `[${new Date().toISOString()}] ${level} ${sanitize(msg)}\n`;
      fs.appendFileSync(target, line);
    } catch { /* melhor esforço */ }
  }
  return { log: (msg) => log('INFO', msg), warn: (msg) => log('WARN', msg), error: (msg) => log('ERROR', msg), file: target, sanitize };
}

module.exports = { createLogger, sanitize };
