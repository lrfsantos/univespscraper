// npm test — executa todas as suítes relevantes em sequência e retorna código
// diferente de zero se QUALQUER uma falhar.
//
// Agregação estrita: cada suíte precisa gerar resumo quantitativo válido na
// execução atual. Processo verde com casos FAIL, resumo ausente/inconsistente ou
// JSON antigo não podem produzir um npm test verde.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseSuiteSummary } = require('./test-summary');

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
  { name: 'poc/test-test-summary-m3.js', out: 'TEST_SUMMARY_RESULTS.json' },
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
  { name: 'poc/test-bvirtual-m3.js', out: 'BVIRTUAL_RESULTS.json' },
  { name: 'poc/test-my-courses-m3.js', out: 'MYCOURSES_RESULTS.json' },
  { name: 'poc/test-embedded-m3.js', out: 'EMBEDDED_RESULTS.json' },
  { name: 'poc/test-pearson-m3.js', out: 'PEARSON_RESULTS.json' },
  { name: 'poc/test-pearson-production-m3.js', out: 'PEARSON_PRODUCTION_RESULTS.json' },
  { name: 'poc/test-vitalsource-m3.js', out: 'VITALSOURCE_RESULTS.json' },
  { name: 'poc/test-ocr-m3.js', out: 'OCR_RESULTS.json' },
];

let failed = 0;
let totalPassed = 0;
let totalCases = 0;
let noSummary = 0;

for (const s of suites) {
  process.stdout.write(`\n=== ${s.name} ===\n`);
  const file = path.join(auditDir, s.out);
  // Remove resultados anteriores: nunca reutilizar JSON verde de execução passada.
  try { fs.rmSync(file, { force: true }); } catch {}

  const r = spawnSync(process.execPath, [s.name], { cwd: root, stdio: 'inherit' });
  let suiteFailed = Boolean(r.error) || r.status !== 0;
  if (suiteFailed) {
    console.log(`>>> FALHOU na execução: ${s.name}`);
    if (r.error) console.log('    erro:', r.error.message);
    else console.log('    exit code:', r.status);
  }

  // Processo verde não basta: resumo ausente, malformado ou com FAIL também reprova.
  try {
    if (!fs.existsSync(file)) {
      noSummary++;
      suiteFailed = true;
      console.log('>>> FALHOU: resumo JSON ausente para', s.name);
    } else {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      const sum = parseSuiteSummary(json);
      if (!sum.valid) {
        noSummary++;
        suiteFailed = true;
        console.log(`>>> FALHOU: resumo inválido (${sum.error}) para ${s.name}`);
      } else {
        totalCases += sum.total;
        totalPassed += sum.passed;
        console.log(`  [resumo da suíte] casos=${sum.total} pass=${sum.passed} fail=${sum.failed}`);
        if (sum.failed > 0) {
          suiteFailed = true;
          console.log(`>>> FALHOU: ${sum.failed} caso(s) reprovado(s) em ${s.name}`);
        }
      }
    }
  } catch (e) {
    noSummary++;
    suiteFailed = true;
    console.log(`>>> FALHOU: não foi possível ler o resumo de ${s.name}: ${e.message}`);
  }

  if (suiteFailed) failed++;
}

console.log('\n=== RESUMO npm test ===');
console.log(`suites=${suites.length} falhas=${failed} casosAgregados=${totalCases} pass=${totalPassed} fail=${totalCases - totalPassed} semResumo=${noSummary}`);
process.exit(failed ? 1 : 0);
