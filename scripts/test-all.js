// npm test — executa todas as suítes relevantes em sequência e retorna código
// diferente de zero se QUALQUER uma falhar.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const suites = [
  'poc/test-regression-m3.js',
  'poc/test-integration-m3.js',
  'poc/test-production-m3.js',
  'poc/test-adapters-m3.js',
  'poc/test-orchestration-m3.js',
  'poc/test-http-security-m3.js',
  'poc/test-electron-profile-m3.js',
  'poc/test-workdir-m3.js',
  'poc/test-extraction-qa-m3.js',
  'poc/test-discovery-m3.js',
  'poc/test-modules12-m3.js',
  'poc/test-c-fidelity-m3.js',
  'poc/test-electron-flow-m3.js',
  'poc/test-product-m3.js',
  'poc/test-correcoes-m3.js',
  'poc/test-pagerange-m3.js',
  'poc/test-zip-m3.js',
  'poc/test-videos-m3.js',
  'poc/test-html-m3.js',
  'poc/test-pdf-m3.js',
];

let failed = 0;
let totalPassed = 0;
let totalCases = 0;

for (const s of suites) {
  process.stdout.write(`\n=== ${s} ===\n`);
  const r = spawnSync(process.execPath, [s], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.log(`>>> FALHOU: ${s}`);
  }
}

console.log('\n=== RESUMO npm test ===');
console.log(`suites=${suites.length} falhas=${failed}`);
process.exit(failed ? 1 : 0);
