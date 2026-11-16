const fs = require('fs');
const path = require('path');
const ocr = require('../src/extract/ocr');

// Testes SINTÉTICOS da camada de OCR (seção 5) — decisão e qualidade:
// identificação de páginas escaneadas, planejamento de OCR (sem OCR desnecessário),
// validação de qualidade (vazio, curto, ilegível, substituição, repetição,
// confiança), preservação da ordem/paginação. A execução real de um motor de OCR
// NÃO é executada nesta máquina (documentado como pendente no relatório).

const OUT = path.join(__dirname, '..', 'audit-temp', 'OCR_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

(async () => {
  const G = 'O';

  // O-1: PDF com texto convencional em todas as páginas -> NÃO precisa OCR.
  {
    const plan = ocr.planOcr([
      { pageIndex: 1, text: 'x'.repeat(200), chars: 200 },
      { pageIndex: 2, text: 'y'.repeat(200), chars: 200 },
    ]);
    const ok = plan.needsOcr === false && plan.toOcr.length === 0 && plan.withText === 2;
    record({ id: G + '-1', title: 'OCR: PDF com camada textual em todas as páginas não requer OCR', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ toOcr: plan.toOcr, needsOcr: plan.needsOcr, withText: plan.withText }) });
  }

  // O-2: PDF totalmente digitalizado (nenhuma página com texto) -> todas precisam OCR.
  {
    const plan = ocr.planOcr([
      { pageIndex: 1, text: '', chars: 0 },
      { pageIndex: 2, text: '', chars: 0 },
      { pageIndex: 3, text: '', chars: 0 },
    ]);
    const ok = plan.allScanned === true && plan.toOcr.length === 3 && plan.withText === 0;
    record({ id: G + '-2', title: 'OCR: PDF totalmente digitalizado identificado (todas as páginas precisam OCR)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ toOcr: plan.toOcr, allScanned: plan.allScanned }) });
  }

  // O-3: PDF parcialmente digitalizado -> apenas páginas sem texto vão para OCR.
  {
    const plan = ocr.planOcr([
      { pageIndex: 1, text: 'x'.repeat(200), chars: 200 },
      { pageIndex: 2, text: '', chars: 0 },
      { pageIndex: 3, text: 'z'.repeat(150), chars: 150 },
      { pageIndex: 4, text: 'w'.repeat(10), chars: 10 },
    ]);
    const ok = plan.needsOcr === true && plan.toOcr.join(',') === '2,4' && plan.withText === 2 && plan.allScanned === false;
    record({ id: G + '-3', title: 'OCR: PDF parcialmente digitalizado — só páginas sem/insuficiente texto vão para OCR', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ toOcr: plan.toOcr, withText: plan.withText }) });
  }

  // O-4: página vazia após OCR -> FAIL.
  {
    const v = ocr.validateOcrQuality({ text: '   ', confidence: 0.9 });
    const ok = v.status === 'FAIL' && v.reason === 'pagina-vazia';
    record({ id: G + '-4', title: 'OCR: página vazia após OCR marcada como FAIL', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  // O-5: texto curto demais -> PARTIAL (nunca PASS).
  {
    const v = ocr.validateOcrQuality({ text: 'abc', confidence: 0.8 });
    const ok = v.status === 'PARTIAL' && v.reason === 'texto-curto';
    record({ id: G + '-5', title: 'OCR: texto curto demais é PARTIAL (nunca PASS)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  // O-6: caracteres de substituição em proporção alta -> PARTIAL.
  {
    const v = ocr.validateOcrQuality({ text: 'O empreendedor � � � cria neg�cios novos para o mercado. '.repeat(3), confidence: 0.9 });
    const ok = v.status === 'PARTIAL' && v.reason === 'caracteres-de-substituicao';
    record({ id: G + '-6', title: 'OCR: caracteres de substituição detectados (PARTIAL)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  // O-7: texto quase sem letras (ilegível) -> PARTIAL.
  {
    const v = ocr.validateOcrQuality({ text: '#### $$$$ @@@@ #### $$$$ @@@@ #### $$$$ @@@@ #### $$$$ @@@@ #### $$$$ @@@@', confidence: 0.9 });
    const ok = v.status === 'PARTIAL' && v.reason === 'poucas-letras-ilegivel';
    record({ id: G + '-7', title: 'OCR: texto ilegível (quase sem letras) identificado como PARTIAL', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  // O-8: repetição anormal de linhas -> PARTIAL.
  {
    const line = 'Esta é uma linha de texto longa o suficiente para ser considerada uma repetição anormal do OCR.';
    const v = ocr.validateOcrQuality({ text: [line, line, line].join('\n'), confidence: 0.9 });
    const ok = v.status === 'PARTIAL' && v.reason === 'repeticao-anormal-de-linhas';
    record({ id: G + '-8', title: 'OCR: repetição anormal de linhas detectada (PARTIAL)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  // O-9: confiança baixa -> PARTIAL.
  {
    const v = ocr.validateOcrQuality({ text: 'Conteúdo acadêmico legível com palavras suficientes para passar no mínimo. '.repeat(4), confidence: 0.3 });
    const ok = v.status === 'PARTIAL' && v.reason === 'confianca-baixa';
    record({ id: G + '-9', title: 'OCR: confiança baixa registrada como PARTIAL', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  // O-10: OCR de boa qualidade -> PASS.
  {
    const v = ocr.validateOcrQuality({ text: 'O empreendedorismo reflete a iniciativa de criar novos negócios e revitalizar organizações maduras. '.repeat(5), confidence: 0.9 });
    const ok = v.status === 'PASS' && v.confidence === 0.9;
    record({ id: G + '-10', title: 'OCR: texto reconhecido com boa qualidade é PASS', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  // O-11: preservação da ordem das páginas na composição.
  {
    const composed = ocr.composeOcrPages([
      { pageIndex: 3, text: 'Terceira página' },
      { pageIndex: 1, text: 'Primeira página' },
      { pageIndex: 2, text: 'Segunda página' },
    ]);
    const ok = composed.indexOf('Primeira página') < composed.indexOf('Segunda página') && composed.indexOf('Segunda página') < composed.indexOf('Terceira página');
    record({ id: G + '-11', title: 'OCR: composição preserva a ordem das páginas', status: ok ? 'PASS' : 'FAIL', detail: `ordem=${composed.split('\n\n').map((p) => p.slice(0, 18)).join(' | ')}` });
  }

  // O-12: separação explícita entre páginas preservada.
  {
    const composed = ocr.composeOcrPages([{ pageIndex: 1, text: 'A' }, { pageIndex: 2, text: 'B' }]);
    const ok = /\[página 1\]/.test(composed) && /\[página 2\]/.test(composed);
    record({ id: G + '-12', title: 'OCR: separação entre páginas preservada (marcadores)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(composed.slice(0, 60)) });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO OCR (SINTÉTICO) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
