const https = require('https');
const http = require('http');

// Cliente HTTP com cookie jar mantido SOMENTE em memória.
// Nunca grava cookies, sessão ou credenciais em disco.
//
// Regras de segurança (auditoria):
//   - cada requisição envia SOMENTE cookies válidos para o destino:
//     Domain/host-only, Path, Secure e expiração respeitados;
//   - comparação de hostname por sufixo com fronteira de rótulo
//     (host === domain OU host.endsWith('.' + domain)) — um domínio que apenas
//     CONTÉM o legítimo como prefixo (ex.: notava.univesp.br) NÃO recebe cookies
//     de .univesp.br;
//   - cookies institucionais nunca são enviados a hosts externos;
//   - em redirecionamento CROSS-ORIGIN, Cookie/Authorization/cabeçalhos sensíveis
//     NÃO são reutilizados: os cookies são recalculados para o novo destino e os
//     demais cabeçalhos sensíveis são descartados;
//   - limite de redirecionamentos e timeout global (evita loops/abuso).

function parseSetCookie(sc, defaultHost) {
  // sc: "name=value; Domain=...; Path=...; Secure; HttpOnly; Expires=...; Max-Age=..."
  const parts = sc.split(';');
  const pair = parts[0] || '';
  const eq = pair.indexOf('=');
  if (eq === -1) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;
  const attrs = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    const k = (i === -1 ? p : p.slice(0, i)).trim().toLowerCase();
    const v = i === -1 ? '' : p.slice(i + 1).trim();
    attrs[k] = v;
  }
  const hostOnly = !attrs.domain;
  const rawDomain = hostOnly ? String(defaultHost || '') : String(attrs.domain).replace(/^\.+/, '');
  const domain = rawDomain.toLowerCase();
  if (!domain) return null;
  // VALIDAÇÃO do atributo Domain (RFC 6265): o host da resposta só pode definir
  // um domínio que seja o próprio host ou um sufixo legítimo (fronteira de rótulo).
  // Domínios externos/não relacionados são REJEITADOS e não entram no cookie jar.
  if (!hostOnly && !canSetDomain(defaultHost, rawDomain)) return null;
  const path = attrs.path && attrs.path.startsWith('/') ? attrs.path : '/';
  const secure = Object.prototype.hasOwnProperty.call(attrs, 'secure');
  let expires = null;
  if (attrs['max-age'] !== undefined) {
    const n = parseInt(attrs['max-age'], 10);
    if (!Number.isNaN(n)) expires = n <= 0 ? 0 : Date.now() + n * 1000;
  } else if (attrs.expires) {
    const t = Date.parse(attrs.expires);
    if (!Number.isNaN(t)) expires = t;
  }
  return { name, value, domain, hostOnly, path, secure, expires };
}

// Um host só pode definir um cookie para o próprio host (exato) ou para um
// domínio do qual é subdomínio legítimo (sufixo com fronteira de rótulo).
function canSetDomain(host, declaredDomain) {
  const h = String(host || '').toLowerCase();
  const d = String(declaredDomain || '').replace(/^\.+/, '').toLowerCase();
  if (!h || !d) return false;
  if (d === h) return true;
  return h.endsWith('.' + d);
}

function domainMatches(host, cookieDomain, hostOnly) {
  const h = String(host || '').toLowerCase();
  if (hostOnly) return h === cookieDomain;
  return h === cookieDomain || h.endsWith('.' + cookieDomain);
}

function pathMatches(reqPath, cookiePath) {
  const p = reqPath || '/';
  if (cookiePath === '/') return true;
  if (p === cookiePath) return true;
  return p.startsWith(cookiePath.endsWith('/') ? cookiePath : cookiePath + '/');
}

// Efetiva a porta padrão do protocolo (https:443, http:80) antes de comparar.
function effectivePort(u) {
  if (u.port) return u.port;
  if (u.protocol === 'https:') return '443';
  if (u.protocol === 'http:') return '80';
  return '';
}

function isSameOrigin(a, b) {
  return a.protocol === b.protocol && a.hostname === b.hostname && effectivePort(a) === effectivePort(b);
}

function createHttpClient(initialCookies = []) {
  const cookieMap = {}; // "domain|path|name" -> cookie object

  // Aceita cookies no formato Playwright ({ name, value, domain, path, expires, secure })
  // e strings de Set-Cookie.
  // HOST-ONLY × DOMAIN: a representação ORIGINAL do domínio decide — um domínio
  // com ponto inicial (".example.com") é cookie de DOMÍNIO; sem ponto inicial
  // ("example.com") é HOST-ONLY (só o hostname exato). NUNCA tratar todo cookie
  // com a propriedade `domain` como cookie de domínio.
  for (const c of initialCookies) {
    const ck = typeof c === 'string'
      ? parseSetCookie(c, (c.match(/^([^;]+)/) || [''])[0])
      : c && c.name && c.value !== undefined
        ? (() => {
            const rawDomain = String(c.domain != null ? c.domain : c.urlHost || '');
            const domainCookie = rawDomain.startsWith('.');
            const domain = rawDomain.replace(/^\.+/, '').toLowerCase();
            if (!domain) return null;
            return {
              name: c.name,
              value: c.value,
              domain,
              hostOnly: !domainCookie,
              path: c.path && c.path.startsWith('/') ? c.path : '/',
              secure: !!c.secure,
              expires: typeof c.expires === 'number' ? (c.expires < 1e12 ? c.expires * 1000 : c.expires) : null,
            };
          })()
        : null;
    if (!ck || !ck.domain) continue;
    cookieMap[`${ck.domain}|${ck.path}|${ck.name}`] = ck;
  }

  function storeSetCookies(setCookies, defaultHost) {
    for (const sc of setCookies || []) {
      const ck = parseSetCookie(sc, defaultHost);
      if (!ck) continue;
      if (ck.expires != null && ck.expires <= Date.now()) continue; // já expirado
      cookieMap[`${ck.domain}|${ck.path}|${ck.name}`] = ck;
    }
  }

  // Cabeçalho Cookie para um host/path específico (respeitando domínio, host-only,
  // path, Secure e expiração). `secure` = a requisição usa HTTPS?
  function cookieHeaderFor(host, reqPath, secure) {
    const now = Date.now();
    const out = [];
    for (const key of Object.keys(cookieMap)) {
      const c = cookieMap[key];
      if (c.expires != null && c.expires < now) { delete cookieMap[key]; continue; }
      if (c.secure && !secure) continue;
      if (!domainMatches(host, c.domain, c.hostOnly)) continue;
      if (!pathMatches(reqPath || '/', c.path)) continue;
      out.push(`${c.name}=${c.value}`);
    }
    return out.join('; ');
  }

  // Backward-compat: cabeçalho para um host (path '/', HTTPS).
  function cookieHeader(domain) {
    return cookieHeaderFor(domain, '/', true);
  }

  function requestOnce(url, opts, redirectCount) {
    if (redirectCount > 10) return Promise.resolve({ status: 310, headers: {}, body: Buffer.alloc(0) });
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'http:' ? http : https;
      const secure = u.protocol === 'https:';
      const userHeaders = opts.headers || {};
      // Cookies calculados para este DESTINO (nunca herdados de origem em redirect).
      const headers = {
        ...userHeaders,
        Cookie: cookieHeaderFor(u.hostname, u.pathname, secure),
        'User-Agent': userHeaders['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        Accept: userHeaders.Accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      };
      const req = mod.get(u, { headers }, (res) => {
        storeSetCookies(res.headers['set-cookie'], u.hostname);
        const code = res.statusCode;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, u).href;
          const next = new URL(nextUrl);
          // CROSS-ORIGIN: descarta Authorization e cabeçalhos sensíveis herdados;
          // cookies serão recalculados para o novo destino em requestOnce.
          const safeHeaders = isSameOrigin(u, next) ? userHeaders : stripSensitiveHeaders(userHeaders);
          return resolve(requestOnce(nextUrl, { ...opts, headers: safeHeaders }, redirectCount + 1));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: code, headers: res.headers, body: Buffer.concat(chunks) })
        );
      });
      req.on('error', reject);
      req.setTimeout(opts.timeout || 30000, () => req.destroy(new Error('timeout')));
    });
  }

  function fetch(url, opts = {}) {
    return requestOnce(url, opts, 0).then((r) => r);
  }

  return { fetch, cookieHeader, cookieHeaderFor };
}

// Remove cabeçalhos sensíveis que NÃO devem atravessar fronteira de origem.
const SENSITIVE_HEADERS = ['cookie', 'authorization', 'proxy-authorization', 'x-csrf-token', 'x-api-key', 'set-cookie'];

function stripSensitiveHeaders(headers) {
  const out = {};
  for (const k of Object.keys(headers || {})) {
    if (!SENSITIVE_HEADERS.includes(k.toLowerCase())) out[k] = headers[k];
  }
  return out;
}

module.exports = { createHttpClient, parseSetCookie, canSetDomain, domainMatches, pathMatches, isSameOrigin };
