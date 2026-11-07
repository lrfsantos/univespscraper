const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createHttpClient } = require('../src/lib/http');

// Testes de SEGURANÇA do cliente HTTP (cookie jar + redirecionamentos).
// Usa servidores LOCAIS reais (127.0.0.1 / localhost) e verifica os
// cabeçalhos REALMENTE recebidos — não apenas o retorno de uma função auxiliar.

const OUT = path.join(__dirname, '..', 'audit-temp', 'HTTP_SECURITY_RESULTS.json');
const results = [];

function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

// Servidor "espião": grava os cabeçalhos recebidos e responde conforme `handler`.
function spyServer(handler) {
  const received = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      received.push({
        url: req.url,
        headers: { ...req.headers },
        method: req.method,
      });
      handler(req, res, received);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        received,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function spyServerOnHost(host) {
  const received = [];
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      received.push({ url: req.url, headers: { ...req.headers }, method: req.method });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    server.on('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      resolve({
        port: typeof addr === 'object' ? addr.port : addr,
        url: `http://${host}:${typeof addr === 'object' ? addr.port : addr}`,
        received,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function testHttpSecurity() {
  const G = 'H';

  // H-1: cookie válido na origem (mesmo hostname) → enviado.
  {
    const s = await spyServer((req, res) => { res.writeHead(200); res.end('ok'); });
    try {
      const client = createHttpClient([{ name: 'sess', value: 'abc', domain: '127.0.0.1', path: '/' }]);
      await client.fetch(s.url + '/');
      const got = s.received[0] && s.received[0].headers.cookie || '';
      record({ id: G + '-1', title: 'Cookie válido na origem → enviado (verificado no servidor)', status: got.includes('sess=abc') ? 'PASS' : 'FAIL', detail: `Cookie=${JSON.stringify(got)}` });
    } finally { await s.close(); }
  }

  // H-2: cookie institucional NÃO enviado a host externo (domínio diferente).
  {
    const s = await spyServer((req, res) => { res.writeHead(200); res.end('ok'); });
    try {
      const client = createHttpClient([{ name: 'MoodleSession', value: 'institucional', domain: 'ava.univesp.br', path: '/' }]);
      await client.fetch(s.url + '/');
      const got = s.received[0] && s.received[0].headers.cookie || '';
      record({ id: G + '-2', title: 'Cookie institucional NÃO vaza para host externo (verificado no servidor)', status: !got ? 'PASS' : 'FAIL', detail: `Cookie=${JSON.stringify(got)} (esperado vazio)` });
    } finally { await s.close(); }
  }

  // H-3: hostname malicioso (apenas contém o domínio como prefixo) bloqueado.
  {
    const client = createHttpClient([{ name: 'c', value: 'v', domain: '.example.com', path: '/' }]);
    const forSub = client.cookieHeaderFor('sub.example.com', '/', true);
    const forEvil = client.cookieHeaderFor('notexample.com', '/', true);
    const forPrefix = client.cookieHeaderFor('example.com.evil.com', '/', true);
    const ok = forSub.includes('c=v') && forEvil === '' && forPrefix === '';
    record({ id: G + '-3', title: 'Hostname malicioso (prefixo/contém) bloqueado; subdomínio real aceito', status: ok ? 'PASS' : 'FAIL', detail: `sub.example.com=${JSON.stringify(forSub)} notexample.com=${JSON.stringify(forEvil)} example.com.evil.com=${JSON.stringify(forPrefix)}` });
  }

  // H-4: host-only não enviado a subdomínio (verificado com hosts locais 127.0.0.1 vs localhost).
  {
    const a = await spyServerOnHost('127.0.0.1');
    const b = await spyServerOnHost('localhost');
    try {
      const client = createHttpClient([{ name: 'hostonly', value: 'h', domain: '127.0.0.1', path: '/', hostOnly: true }]);
      await client.fetch(a.url + '/');
      await client.fetch(b.url + '/');
      const gotA = (a.received[0] && a.received[0].headers.cookie) || '';
      const gotB = (b.received[0] && b.received[0].headers.cookie) || '';
      const ok = gotA.includes('hostonly=h') && gotB === '';
      record({ id: G + '-4', title: 'Cookie host-only enviado ao host exato, NÃO a outro host', status: ok ? 'PASS' : 'FAIL', detail: `127.0.0.1=${JSON.stringify(gotA)} localhost=${JSON.stringify(gotB)}` });
    } finally { await a.close(); await b.close(); }
  }

  // H-5: cookie Secure não enviado por HTTP (verificado no servidor).
  {
    const s = await spyServer((req, res) => { res.writeHead(200); res.end('ok'); });
    try {
      const client = createHttpClient([{ name: 'sec', value: 's', domain: '127.0.0.1', path: '/', secure: true }]);
      await client.fetch(s.url + '/');
      const got = s.received[0] && s.received[0].headers.cookie || '';
      record({ id: G + '-5', title: 'Cookie Secure NÃO enviado por HTTP (verificado no servidor)', status: !got ? 'PASS' : 'FAIL', detail: `Cookie=${JSON.stringify(got)} (esperado vazio)` });
    } finally { await s.close(); }
  }

  // H-6: cookie expirado bloqueado.
  {
    const s = await spyServer((req, res) => { res.writeHead(200); res.end('ok'); });
    try {
      const client = createHttpClient([{ name: 'old', value: 'x', domain: '127.0.0.1', path: '/', expires: Date.now() - 60000 }]);
      await client.fetch(s.url + '/');
      const got = s.received[0] && s.received[0].headers.cookie || '';
      record({ id: G + '-6', title: 'Cookie expirado bloqueado (verificado no servidor)', status: !got ? 'PASS' : 'FAIL', detail: `Cookie=${JSON.stringify(got)} (esperado vazio)` });
    } finally { await s.close(); }
  }

  // H-7: redirecionamento SAME-ORIGIN → cookie recalculado e enviado no destino.
  {
    const finalReceived = [];
    const s = await spyServer((req, res) => {
      if (req.url === '/redir') { res.writeHead(302, { Location: s.url + '/fim' }); res.end(); return; }
      finalReceived.push({ ...req.headers });
      res.writeHead(200); res.end('ok');
    });
    try {
      const client = createHttpClient([{ name: 'same', value: 'ok', domain: '127.0.0.1', path: '/' }]);
      const r = await client.fetch(s.url + '/redir');
      const gotFinal = (finalReceived[0] && finalReceived[0].cookie) || '';
      const ok = r.status === 200 && gotFinal.includes('same=ok');
      record({ id: G + '-7', title: 'Redirecionamento same-origin → cookie recalculado e enviado no destino', status: ok ? 'PASS' : 'FAIL', detail: `status=${r.status} finalCookie=${JSON.stringify(gotFinal)}` });
    } finally { await s.close(); }
  }

  // H-8: redirecionamento CROSS-ORIGIN (127.0.0.1 → localhost) → SEM cookie institucional,
  //      SEM Authorization herdado.
  {
    const a = await spyServer((req, res) => { res.writeHead(302, { Location: bUrl + '/fim' }); res.end(); });
    const b = await spyServerOnHost('localhost');
    const bUrl = b.url;
    try {
      const client = createHttpClient([{ name: 'MoodleSession', value: 'institucional', domain: '127.0.0.1', path: '/' }]);
      const r = await client.fetch(a.url + '/inicio', { headers: { Authorization: 'Bearer segredo', 'X-Custom': 'mantido' } });
      const gotB = (b.received[0] && b.received[0].headers) || {};
      const ok = r.status === 200 && !gotB.cookie && !gotB.authorization && gotB['x-custom'] === 'mantido';
      record({ id: G + '-8', title: 'Redirect cross-origin → SEM cookie institucional, SEM Authorization; custom não-sensível mantido', status: ok ? 'PASS' : 'FAIL', detail: `status=${r.status} cookieB=${JSON.stringify(gotB.cookie || '')} authB=${JSON.stringify(gotB.authorization || '')} xCustom=${JSON.stringify(gotB['x-custom'] || '')}` });
    } finally { await a.close(); await b.close(); }
  }

  // H-9: download de PDF externo → host externo NÃO recebe cookies do AVA.
  {
    const s = await spyServerOnHost('localhost');
    try {
      const client = createHttpClient([
        { name: 'MoodleSession', value: 'ava-sessao', domain: 'ava.univesp.br', path: '/' },
        { name: 'cookie', value: 'externo', domain: 'localhost', path: '/', hostOnly: true },
      ]);
      await client.fetch(s.url + '/arquivo.pdf');
      const got = (s.received[0] && s.received[0].headers.cookie) || '';
      const ok = got === 'cookie=externo'; // apenas o cookie VÁLIDO para o host externo
      record({ id: G + '-9', title: 'PDF externo: só cookie válido p/ o host externo; NUNCA o do AVA', status: ok ? 'PASS' : 'FAIL', detail: `Cookie=${JSON.stringify(got)}` });
    } finally { await s.close(); }
  }
}

(async () => {
  await testHttpSecurity();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO SEGURANÇA HTTP ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
