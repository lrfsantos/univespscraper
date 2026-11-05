const { chromium } = require('playwright');

// Autenticação na UNIVESP (AVA) sem persistir credenciais.
// O login acontece via Playwright; a sessão (cookies) é mantida em memória
// e opcionalmente exportada para o HttpClient. Nada é gravado em disco.

const BASE = 'https://ava.univesp.br';

function detectRoute(username) {
  const v = (username || '').trim().toLowerCase();
  if (!v.includes('@')) {
    const digits = v.replace(/\D/g, '');
    if (digits.length >= 3) return 'local';
    return null;
  }
  const domain = v.split('@')[1] || '';
  if (domain === 'aluno.univesp.br') return 'saml';
  if (domain.includes('univesp.br')) return 'oauth';
  if (domain.includes('.')) return 'local';
  return null;
}

// Realiza o login e retorna os cookies de sessão (em memória).
async function login({ username, password, browser }) {
  const ownBrowser = !browser;
  const br = browser || (await chromium.launch({ headless: true }));
  try {
    const context = await br.newContext();
    const page = await context.newPage();
    const route = detectRoute(username);
    if (!route) throw new Error('Usuário não reconhecido. Use e-mail @aluno.univesp.br, @univesp.br ou CPF.');

    if (route === 'saml') {
      await page.goto(
        `${BASE}/custom/univesp_saml.php?wantsurl=${encodeURIComponent(BASE + '/')}&login_hint=${encodeURIComponent(username)}`,
        { waitUntil: 'domcontentloaded', timeout: 60000 }
      );
      await page.waitForSelector('form[name="f"]', { timeout: 30000 });
      await page.fill('input#password', password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}),
        page.click('button[type="submit"]'),
      ]);
    } else if (route === 'local') {
      await page.goto(`${BASE}/login/index.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.fill('input#username', username);
      await page.waitForSelector('#password-group.show', { timeout: 15000 });
      await page.fill('input#password', password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {}),
        page.click('#login-button-default'),
      ]);
    } else {
      // oauth (SSO Microsoft) — não automatizável sem fluxo interativo
      throw new Error('Login SSO (@univesp.br) exige autenticação Microsoft; use e-mail @aluno.univesp.br ou CPF.');
    }

    await page.waitForTimeout(4000);
    const finalUrl = page.url();
    const state = await context.storageState();
    await context.close();

    // valida se chegou logado
    const ok = finalUrl.includes('ava.univesp.br') && !finalUrl.includes('/login/index.php');
    return {
      ok,
      url: finalUrl,
      route,
      cookies: state.cookies || [],
    };
  } finally {
    if (ownBrowser) await br.close();
  }
}

module.exports = { login, detectRoute };
