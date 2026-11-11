const fs = require('fs');
const path = require('path');
const os = require('os');
const { statusFor: pageStatusFor, basicChecks } = require('../src/extract/pages');
const { statusFor: pdfStatusFor, detectPrintedPagination } = require('../src/extract/pdfs');

// Testes DETERMINISTICOS dos Modulos 1 e 2 (D1): validam as DECISOES PURAS de
// fidelidade (statusFor/basicChecks/printedPagination) com dados sinteticos —
// sem AVA, sem PDFs protegidos, sem internet. Nao sao testes live.

const OUT = path.join(__dirname, '..', 'audit-temp', 'MODULES12_RESULTS.json');
const results = [];
function sanitize(s) { return String(s == null ? '' : s).split(os.tmpdir()).join('<TEMP>'); }
function record(entry) {
  results.push({ ...entry, title: sanitize(entry.title), detail: sanitize(entry.detail) });
  console.log('[' + entry.status + '] ' + entry.id + ': ' + entry.title);
  if (entry.detail) console.log('    ', sanitize(entry.detail));
}

(async () => {
  // M1: separacao presenca x integridade (C5)
  {
    // pagina academica real (escopo + texto substancial/estrutural) -> integral
    const okPage = { title: 'S1 Inicio', text: 'Conteudo academico real da pagina extraido de forma estrutural com headings e paragrafos. Este texto representa uma pagina completa de material didatico com mais de oitenta caracteres para confirmar integralidade por evidencia.', hasScope: true, httpStatus: 200 };
    const s1 = pageStatusFor(okPage);
    // sem escopo, mesmo com texto -> parcial (nao integral)
    const noScope = { title: 'x', text: 'Texto sem escopo principal confirmado, contudo longo o bastante para o teste', hasScope: false, httpStatus: 200 };
    const s2 = pageStatusFor(noScope);
    // sinais de carregamento dinamico -> partial (nunca integral sem validacao)
    const loading = { title: 'x', text: 'Carregando... por favor aguarde. preparando o conteudo', hasScope: true, httpStatus: 200 };
    const s3 = pageStatusFor(loading);
    // erro / mensagem de incompatibilidade -> inaccessible
    const err = { title: 'x', text: 'Erro ao processar pagina ou navegador nao compativel', hasScope: true, httpStatus: 200 };
    const s4 = pageStatusFor(err);
    // 404 -> not_found
    const nf = { title: '', text: '', hasScope: false, httpStatus: 404 };
    const s5 = pageStatusFor(nf);
    // fragmento curto (>=20 chars) sem escopo valido nem estrutura -> partial
    const frag = { title: 'x', text: 'apenas um fragmento curto de interface', hasScope: false, httpStatus: 200 };
    const s6 = pageStatusFor(frag);
    const ok = s1 === 'integral' && s2 === 'partial' && s3 === 'partial' && s4 === 'inaccessible' && s5 === 'not_found' && s6 === 'partial';
    record({ id: 'M1-1', title: 'C5: pages.statusFor distingue presenca (integral) x incompleto (partial) x erro (inaccessible) x 404 (not_found)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ integral: s1, semEscopo: s2, carregando: s3, erro: s4, notFound: s5, fragmento: s6 }) });
  }

  {
    // basicChecks: verificacoes explicitas que NAO provam completude
    const bc = basicChecks({ title: 't', text: '12345678901234567890', hasScope: true, httpStatus: 200 });
    const ok = bc.httpOk === true && bc.hasScope === true && bc.hasText === true && bc.textMinLen === true;
    record({ id: 'M1-2', title: 'C5: pages.basicChecks reporta verificacoes separadas (nao provam integral)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(bc) });
  }

  // M2: statusFor PDF (C5) — integral = texto extraido de todas as paginas do arquivo
  {
    const pages = [1, 2, 3].map((i) => ({ pageIndex: i, text: 'conteudo da pagina ' + i + ' com texto extraido', chars: 30 }));
    const integral = pdfStatusFor({ ok: true, bytes: 1000, analyze: { totalPagesArquivo: 3, error: null }, pages });
    const partial = pdfStatusFor({ ok: true, bytes: 1000, analyze: { totalPagesArquivo: 3, error: null }, pages: pages.slice(0, 2) });
    const inaccessible = pdfStatusFor({ ok: false, bytes: 0, analyze: null, pages: [] });
    const analyzeErr = pdfStatusFor({ ok: true, bytes: 1000, analyze: { totalPagesArquivo: 3, error: 'falha-analise' }, pages: [] });
    const ok = integral === 'integral' && partial === 'partial' && inaccessible === 'inaccessible' && analyzeErr === 'partial';
    record({ id: 'M2-1', title: 'C5: pdfs.statusFor — todas as paginas extraidas = integral; faltando = partial; falha = inaccessible/partial', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ integral, partial, inaccessible, analyzeErr }) });
  }

  {
    // numeração impressa: heuristica honesta
    const noPagination = detectPrintedPagination([1, 2].map((i) => ({ text: 'paragrafo sem numero isolado ' + i })));
    const withNum = detectPrintedPagination([{ text: '\n23\n' }, { text: '\n24\n' }]);
    const ok = noPagination.reliable === 'none' && withNum.reliable === 'partial' && withNum.detected[0] === 23;
    record({ id: 'M2-2', title: 'C5: pdfs.detectPrintedPagination distingue ausencia de numeracao (none) de parcial', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify({ noPagination, withNum }) });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO MODULOS 1/2 ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
