// npm test — executa todas as suítes relevantes em sequência e retorna código
// diferente de zero se QUALQUER uma falhar.
//
// Agregação HONESTA (seção 10): cada suíte grava audit-temp/<SUITE>_RESULTS.json
// com summary { total, passed, failed }. Este script SOMA esses totais reais dos
// arquivos gerados na própria execução (não inventa números); suítes sem arquivo
// entram apenas como "sem-resumo". O exit code vem da falha de execução + contagem.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const auditDir = path.join(root, 'audit-temp');
const suites = [
  { name: 'poc/test-regression-m3.js', out: 'REGRESSION_RESULTS.json' },
  { name: 'poc/test-integration-m3.js', out: 'INTEGRATION_RESULTS.json' },
  { name: 'poc/test-production-m3.js', out: 'PRODUCTION_RESULTS.json' },
  { name: 'poc/test-adapters-m3.js', out: 'ADAPTERS_RESULTS.json' },
  { name: 'poc/test-orchestration-m3.js', out: 'ORCHESTRATION_RESULTS.json' },
  { name: 'poc/test-http-security-m3.js', out: 'HTTP_SECURITY_RESULTS.json' },
  { name: 'poc/test-electron-profile-m3.js', out: 'ELECTRON_PROFILE_RESULTS.json' },
  { name: 'poc/test-workdir-m3.js', out: 'WORKDIR_RESULTS.json' },
  { name: 'poc/test-extraction-qa-m3.js', out: 'EXTRACTION_QA_RESULTS.json' },
  { name: 'poc/test-discovery-m3.js', out: 'DISCOVERY_RESULTS.json' },
  { name: 'poc/test-modules12-m3.js', out: 'MODULES12_RESULTS.json' },
  { name: 'poc/test-c-fidelity-m3.js', out: 'CFIDELITY_RESULTS.json' },
  { name: 'poc/test-electron-flow-m3.js', out: 'ELECTRON_FLOW_RESULTS.json' },
  { name: 'poc/test-product-m3.js', out: 'PRODUCT_RESULTS.json' },
  { name: 'poc/test-correcoes-m3.js', out: 'CORRECOES_RESULTS.json' },
  { name: 'poc/test-pagerange-m3.js', out: 'PAGERANGE_RESULTS.json' },
  { name: 'poc/test-zip-m3.js', out: 'ZIP_RESULTS.json' },
  { name: 'poc/test-videos-m3.js', out: 'VIDEOS_RESULTS.json' },
  { name: 'poc/test-html-m3.js', out: 'HTML_RESULTS.json' },
  { name: 'poc/test-pdf-m3.js', out: 'PDF_RESULTS.json' },
  { name: 'poc/test-books-m3.js', out: 'BOOKS_RESULTS.json' },
];

let failed = 0;
let totalPassed = 0;
let totalCases = 0;
let noSummary = 0;

for (const s of suites) {
  process.stdout.write(`\n=== ${s.name} ===\n`);
  const r = spawnSync(process.execPath, [s.name], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.log(`>>> FALHOU: ${s.name}`);
  }
  // Agrega o resumo REAL gravado pela suíte nesta execução.
  try {
    const file = path.join(auditDir, s.out);
    if (fs.existsSync(file)) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      const sum = (json && json.summary) || {};
      const t = Number(sum.total) || 0;
      const f = Number(sum.failed) || 0;
      totalCases += t;
      totalPassed += t - f;
      console.log(`  [resumo da suíte] casos=${t} pass=${t - f} fail=${f}`);
    } else {
      noSummary++;
    }
  } catch (e) {
    noSummary++;
  }
}

console.log('\n=== RESUMO npm test ===');
console.log(`suites=${suites.length} falhas=${failed} casosAgregados=${totalCases} pass=${totalPassed} fail=${totalCases - totalPassed} semResumo=${noSummary}`);
process.exit(failed ? 1 : 0);
