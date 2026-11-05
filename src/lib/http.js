const https = require('https');
const http = require('http');

// Cliente HTTP com cookie jar mantido SOMENTE em memória.
// Nunca grava cookies, sessão ou credenciais em disco.

function createHttpClient(initialCookies = []) {
  const cookieMap = {}; // "domain.path.name" -> "name=value"

  for (const c of initialCookies) {
    if (c && c.name && c.value !== undefined) {
      const key = `${c.domain || ''}.${c.path || '/'}.${c.name}`;
      cookieMap[key] = `${c.name}=${c.value}`;
    }
  }

  function cookieHeader(domain) {
    return Object.values(cookieMap)
      .filter(() => true)
      .map((cv) => cv.split(';')[0])
      .join('; ');
  }

  function storeSetCookies(res, domain) {
    const setCookies = res.headers['set-cookie'] || [];
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      cookieMap[`${domain}.default.${name}`] = `${name}=${value}`;
    }
  }

  function fetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'http:' ? http : https;
      const headers = {
        Cookie: cookieHeader(u.hostname),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(opts.headers || {}),
      };
      const req = mod.get(u, { headers }, (res) => {
        storeSetCookies(res, u.hostname);
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          return resolve(fetch(next, opts));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      });
      req.on('error', reject);
      req.setTimeout(opts.timeout || 30000, () => req.destroy(new Error('timeout')));
    });
  }

  return { fetch, cookieHeader };
}

module.exports = { createHttpClient };
