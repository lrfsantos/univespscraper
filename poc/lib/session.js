const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { chromium } = require('playwright');

// Sessão segura para a PoC (Teste A).
// Atende às ressalvas aprovadas:
//   1) Perfil temporário exclusivo em %TEMP% (nunca permanente).
//   2) Chromium configurado para NÃO salvar credenciais nem usar
//      preenchimento automático de senhas.
//   3) Cookies/tokens ficam SOMENTE nesse perfil temporário.
//   4) Nenhuma credencial é gravada em disco pelos módulos de teste.

const BASE = 'https://ava.univesp.br';

// Flags que desabilitam o password manager e o autofill do Chromium.
const PRIVACY_ARGS = [
  '--disable-save-password-bubble',
  '--disable-autofill',
  '--disable-password-manager-reauthentication',
  '--disable-features=AutofillServerCommunication,AutofillProfileClientValidation,AutofillPasswordSaveButtonInPasswordBubble,PasswordImport,PasswordManagerOnboarding,PasswordManagerRedesign',
];

function makeTempProfileDir(label) {
  const dir = path.join(os.tmpdir(), `univesp-poc-${label}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function openPersistentContext({ label = 'test' } = {}) {
  const userDataDir = makeTempProfileDir(label);
  // Desabilita o serviço de credenciais/senhas no perfil ANTES do Chromium iniciar.
  // Isso complementa as flags de linha de comando (melhor esforço + robusto).
  writeNoCredentialPrefs(userDataDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1360, height: 900 },
    locale: 'pt-BR',
    args: PRIVACY_ARGS,
  });
  return { userDataDir, context };
}

// Escreve Preferences com gerenciador de senhas e autofill desabilitados.
function writeNoCredentialPrefs(userDataDir) {
  const defaultDir = path.join(userDataDir, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  const prefsPath = path.join(defaultDir, 'Preferences');
  let prefs = {};
  try { if (fs.existsSync(prefsPath)) prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch { /* ignore */ }
  prefs.credentials_enable_service = false;
  prefs.profile = prefs.profile || {};
  prefs.profile.password_manager_enabled = false;
  prefs.autofill = prefs.autofill || {};
  prefs.autofill.enabled = false;
  prefs.autofill.credit_card_enabled = false;
  prefs.autofill.credit_card_fido_auth_enabled = false;
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));
}

// Login manual via SAML com intervenção humana (janela visível).
// O usuário digita a senha diretamente no AVA; o harness não preenche a senha.
// Retorna true quando chega ao dashboard autenticado.
async function manualLogin(context, { username, timeoutMs = 180000 } = {}) {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(
    `${BASE}/custom/univesp_saml.php?wantsurl=${encodeURIComponent(BASE + '/')}&login_hint=${encodeURIComponent(username)}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );
  // Aguarda o usuário completar o login (formulário sumiu / redirecionado p/ dashboard)
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes('ava.univesp.br') && !url.includes('/login/') && !url.includes('saml') && !url.includes('login_hint')) {
      // verifica se já está autenticado (painel)
      const logged = await page.evaluate(() => {
        return !document.querySelector('form[name="f"]') && (!!document.querySelector('.userpicture') || !!document.querySelector('#user-menu-toggle') || document.body.innerText.includes('Painel'));
      }).catch(() => false);
      if (logged) return { ok: true, url };
    }
    await page.waitForTimeout(1500);
  }
  return { ok: false, url: page.url(), reason: 'timeout aguardando login manual' };
}

// Verifica se o perfil temporário contém senha salva (Login Data) ou autofill.
async function checkProfileForCredentials(userDataDir) {
  const findings = { passwordStoreFiles: [], savedPasswords: 0, autofillPrefs: false, notes: [] };
  const loginData = path.join(userDataDir, 'Default', 'Login Data');
  if (fs.existsSync(loginData)) {
    const stat = fs.statSync(loginData);
    findings.passwordStoreFiles.push({ file: 'Login Data', bytes: stat.size });
    // Conta senhas reais salvas na tabela 'logins' (não apenas o schema).
      try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(loginData, { readOnly: true });
        try {
          const rows = db.prepare('SELECT origin_url, username_value, LENGTH(password_value) AS pwd_len FROM logins').all();
          findings.savedPasswords = rows.length;
          findings.savedPasswordEntries = rows.map((r) => ({ origin: r.origin_url, user: r.username_value, pwdBytes: r.pwd_len }));
          if (rows.length) findings.notes.push('Senhas salvas detectadas no perfil: ' + rows.length);
          else findings.notes.push('Tabela "logins" vazia — nenhuma senha salva (arquivo contém apenas o schema padrão do Chromium).');
        } catch (e) {
          findings.notes.push('Não foi possível ler a tabela logins: ' + e.message);
        }
        db.close();
      } catch (e) {
        findings.notes.push('node:sqlite indisponível: ' + e.message);
      }
  }
  const prefs = path.join(userDataDir, 'Default', 'Preferences');
  if (fs.existsSync(prefs)) {
    try {
      const p = JSON.parse(fs.readFileSync(prefs, 'utf8'));
      const profile = p.profile || {};
      const autofill = p.autofill || {};
      if (profile.password_manager_enabled === false) findings.notes.push('password_manager_enabled=false em Preferences (esperado).');
      findings.autofillPrefs = !!(autofill.enabled === true) || !!(autofill.credit_card_enabled === true);
    } catch { /* ignore */ }
  }
  // Varredura ampla por arquivos que tipicamente guardam credenciais
  const candidates = ['Login Data', 'Login Data-journal', 'Web Data', 'Web Data-journal'];
  for (const c of candidates) {
    const fp = path.join(userDataDir, 'Default', c);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      if (!findings.passwordStoreFiles.some((f) => f.file === c)) findings.passwordStoreFiles.push({ file: c, bytes: stat.size });
    }
  }
  return findings;
}

function cleanupProfile(userDataDir) {
  // Melhor esforço (filosofia aprovada): apaga só o que o app criou.
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    return { ok: true, removed: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Login automático via SAML (autorizado pelo usuário para automação dos testes).
// A senha é derivada dos números antes do "@" do e-mail institucional.
// Usado apenas nos testes automatizados; o app final mantém o login manual.
async function autoLogin(context, { username, password, timeoutMs = 120000 } = {}) {
  const page = context.pages()[0] || (await context.newPage());
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes('ava.univesp.br') && !url.includes('/login/') && !url.includes('saml') && !url.includes('login_hint')) {
      const logged = await page.evaluate(() => !document.querySelector('form[name="f"]')).catch(() => false);
      if (logged) return { ok: true, url };
    }
    await page.waitForTimeout(1500);
  }
  return { ok: false, url: page.url(), reason: 'timeout no login automático' };
}

module.exports = { BASE, PRIVACY_ARGS, openPersistentContext, manualLogin, autoLogin, checkProfileForCredentials, cleanupProfile, makeTempProfileDir };
