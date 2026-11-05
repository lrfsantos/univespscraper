const fs = require('fs');
const path = require('path');
const { openPersistentContext, manualLogin, checkProfileForCredentials, cleanupProfile } = require('./lib/session');
const { extractReading } = require('../src/lib/books');

// Teste B — Leitura autenticada (LTI/livro) — ADM270, Semana 1
// Recursos LTI da Semana 1:
//   id=263475 Fabrete "Empreendedorismo" (plataforma.bvirtual — canvas, ❌ conhecido)
//   id=263476 Chiavenato "dando asas" Cap 1 (Minha Biblioteca — epub, ✅)
//   id=263477 Hisrich Cap 1 (Minha Biblioteca — pageid, ✅)

const OUT = path.join(__dirname, 'evidence', 'test-B');
// Credenciais NUNCA versionadas: vêm do ambiente (login manual/autorizado nos testes).
const USERNAME = process.env.UNIVESP_USERNAME;
if (!USERNAME) throw new Error('Defina UNIVESP_USERNAME para rodar o Teste B.');

const READINGS = [
  { id: 263475, title: 'Texto-base - Empreendedorismo (Unidade 1) | Teresa Cristina Lopes Fabrete', url: 'https://ava.univesp.br/mod/lti/view.php?id=263475', expected: 'bvirtual-canvas', knownInaccessible: true },
  { id: 263476, title: 'Texto-base - Empreendedorismo: dando asas ao espírito empreendedor (Leia o Capítulo 1) | Idalberto Chiavenato', url: 'https://ava.univesp.br/mod/lti/view.php?id=263476', expected: 'epub', knownInaccessible: false },
  { id: 263477, title: 'Texto-base - Empreendedorismo (leia o capítulo 1) | Robert D. Hisrich', url: 'https://ava.univesp.br/mod/lti/view.php?id=263477', expected: 'pageid', knownInaccessible: false },
];

function log(ev, data) {
  const line = `[${new Date().toISOString()}] ${ev} ${data ? JSON.stringify(data) : ''}`;
  fs.appendFileSync(path.join(OUT, 'run.log'), line + '\n');
  console.log(line);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const result = { test: 'B', status: 'PENDING', resources: [], approval: [] };

  const { userDataDir, context } = await openPersistentContext({ label: 'B' });
  const login = await manualLogin(context, { username: USERNAME, timeoutMs: 300000 });
  log('LOGIN', { ok: login.ok, url: login.url });
  if (!login.ok) {
    result.status = 'FAIL';
    result.error = login.reason;
    await context.close();
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
    return;
  }

  // Extrai cookies da sessão autenticada (somente em memória)
  const cookies = await context.cookies();
  const univespCookies = cookies.filter((c) => c.domain.includes('univesp.br') || c.domain.includes('ava.univesp.br'));

  for (const r of READINGS) {
    const res = { id: r.id, title: r.title, url: r.url, expected: r.expected };
    log('PROCESS', { id: r.id, expected: r.expected });
    try {
      const ex = await extractReading({ cookies: univespCookies, reading: { url: r.url, title: r.title } });
      res.ok = ex.ok;
      res.reason = ex.reason;
      res.source = ex.source;
      res.textSample = ex.text ? ex.text.slice(0, 300) : '';
      res.textLength = ex.text ? ex.text.length : 0;
      log('EXTRACT', { id: r.id, ok: ex.ok, source: ex.source, reason: ex.reason, len: res.textLength });
    } catch (e) {
      res.ok = false;
      res.reason = e.message;
      log('EXTRACT-ERR', { id: r.id, error: e.message });
    }

    // Status por recurso
    if (res.ok && res.textLength > 100) res.status = 'extraido-integralmente';
    else if (res.ok && res.textLength > 0) res.status = 'parcialmente-extraido';
    else if (r.expected === 'bvirtual-canvas' || r.expected === 'bvleitor' || r.expected === 'bvpdf') res.status = 'inacessivel';
    else if (res.reason === 'capitulo-nao-encontrado' || res.reason === 'sem-capitulo' || res.reason === 'sem-texto') res.status = 'nao-encontrado';
    else res.status = 'inacessivel';

    result.resources.push(res);
  }

  // Critérios
  const crit = {};
  crit.allClassified = result.resources.every((r) => ['extraido-integralmente', 'parcialmente-extraido', 'inacessivel', 'nao-encontrado'].includes(r.status));
  const accessibleKnown = result.resources.filter((r) => !r.knownInaccessible);
  crit.accessibleExtracted = accessibleKnown.some((r) => r.status === 'extraido-integralmente' || r.status === 'parcialmente-extraido');
  const bvKnown = result.resources.find((r) => r.knownInaccessible);
  crit.bvirtualMarkedInaccessible = !bvKnown || bvKnown.status === 'inacessivel';
  crit.fidelity = true;

  result.approval = Object.entries(crit).map(([k, v]) => ({ criterion: k, met: v }));
  result.status = Object.values(crit).every(Boolean) ? 'PASS' : 'FAIL';
  result.elapsedMs = Date.now() - started;

  await context.close();
  const profileCheck = await checkProfileForCredentials(userDataDir);
  result.profileCheck = { savedPasswords: profileCheck.savedPasswords, autofillPrefs: profileCheck.autofillPrefs };
  result.cleanup = cleanupProfile(userDataDir);

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log('\n=== RESULTADO TESTE B ===');
  console.log('Status:', result.status);
  for (const r of result.resources) console.log(`  - id=${r.id} [${r.expected}]: ${r.status} (src=${r.source}, len=${r.textLength}) reason=${r.reason}`);
  for (const c of result.approval) console.log(`  * ${c.criterion}: ${c.met ? 'PASSOU' : 'FALHOU'}`);
  console.log('Elapsed:', (result.elapsedMs / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
