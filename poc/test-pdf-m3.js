const fs = require('fs');
const path = require('path');
const { statusFor, downloadViaPageRequest } = require('../src/extract/pdfs');
const { renderPdfDocument } = require('../src/extract/markdown');

// Testes da SEÇÃO 6 (P1 PDF): proteção de memória EFETIVA no download (Content-Length
// antecipado antes de resp.body(), rejeição por tamanho, %PDF magic, 401/403/404,
// HTML no lugar de PDF), status HONESTO (total desconhecido nunca integral; página
// sem texto/erro -> partial; baixado sem texto -> preservado + parcial) e link
// relativo ao PDF original no documento Markdown (funciona após extrair o ZIP).

const OUT = path.join(__dirname, '..', 'audit-temp', 'PDF_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

// Fake de APIRequestContext (playwright-core) que controla status/cabeçalhos/corpo.
function fakeRequest({ status = 200, headers = {}, body = null, throwOnGet = null } = {}) {
  const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('conteudo-sintetico-do-pdf')]);
  const b = body != null ? body : pdfBytes;
  return {
    async get(url, opts) {
      if (throwOnGet) throw throwOnGet;
      return {
        status: () => status,
        ok: () => status >= 200 && status < 300,
        headers: () => headers,
        async body() { return b; },
      };
    },
  };
}

(async () => {
  const G = 'P';

  // P-1: Content-Length antecipado > limite -> rejeita SEM chamar body().
  {
    let bodyCalled = false;
    const req = fakeRequest({ headers: { 'content-type': 'application/pdf', 'content-length': '999999999' } });
    const origBody = req.get;
    req.get = async (url, opts) => {
      const r = await origBody(url, opts);
      return { ...r, body: async () => { bodyCalled = true; return Buffer.alloc(0); } };
    };
    let err = null;
    try { await downloadViaPageRequest(req, 'https://x/y.pdf', { maxBytes: 1024 }); } catch (e) { err = e.message; }
    const ok = err === 'tamanho-maximo-excedido' && bodyCalled === false;
    record({ id: G + '-1', title: '6: Content-Length > limite rejeita ANTES de carregar o corpo (proteção de memória)', status: ok ? 'PASS' : 'FAIL', detail: `erro=${err} bodyChamado=${bodyCalled}` });
  }

  // P-2: corpo efetivo maior que o limite (sem Content-Length) -> rejeita após checar.
  {
    const big = Buffer.alloc(4096, 0x41);
    const req = fakeRequest({ headers: { 'content-type': 'application/pdf' }, body: big });
    let err = null;
    try { await downloadViaPageRequest(req, 'https://x/y.pdf', { maxBytes: 1024 }); } catch (e) { err = e.message; }
    const ok = err === 'tamanho-maximo-excedido';
    record({ id: G + '-2', title: '6: corpo maior que o limite (sem Content-Length) -> rejeita por tamanho', status: ok ? 'PASS' : 'FAIL', detail: `erro=${err}` });
  }

  // P-3: magic bytes %PDF validados; corpo não-PDF rejeitado; HTML rejeitado; 401/403/404 rejeitados.
  {
    const notPdf = fakeRequest({ headers: { 'content-type': 'application/pdf' }, body: Buffer.from('<!DOCTYPE html><html>') });
    let e1 = null; try { await downloadViaPageRequest(notPdf, 'https://x/y.pdf'); } catch (e) { e1 = e.message; }
    const htmlCt = fakeRequest({ headers: { 'content-type': 'text/html' }, body: Buffer.from('%PDF-fake') });
    let e2 = null; try { await downloadViaPageRequest(htmlCt, 'https://x/y.pdf'); } catch (e) { e2 = e.message; }
    const forbidden = fakeRequest({ status: 403, headers: {} });
    let e3 = null; try { await downloadViaPageRequest(forbidden, 'https://x/y.pdf'); } catch (e) { e3 = e.message; }
    const ok = e1 === 'nao-e-pdf' && e2 === 'html-em-vez-de-pdf' && /403/.test(e3);
    record({ id: G + '-3', title: '6: %PDF magic, HTML no lugar de PDF e 401/403/404 rejeitados', status: ok ? 'PASS' : 'FAIL', detail: `naoPdf=${e1} html=${e2} 403=${e3}` });
  }

  // P-4: statusFor — total desconhecido NUNCA integral.
  {
    const s = statusFor({ ok: true, bytes: 100, analyze: { totalPagesArquivo: null }, pages: [{ pageIndex: 1, text: 'texto', chars: 5 }, { pageIndex: 2, text: 'mais', chars: 4 }] });
    const ok = s === 'partial';
    record({ id: G + '-4', title: '6: total de páginas DESCONHECIDO -> partial (nunca integral)', status: ok ? 'PASS' : 'FAIL', detail: `status=${s}` });
  }

  // P-5: statusFor — página sem texto ou com erro -> partial; integral só com total conhecido + todas com texto.
  {
    const noText = statusFor({ ok: true, bytes: 100, analyze: { totalPagesArquivo: 2 }, pages: [{ pageIndex: 1, text: 'texto', chars: 5 }, { pageIndex: 2, text: '', chars: 0 }] });
    const withErr = statusFor({ ok: true, bytes: 100, analyze: { totalPagesArquivo: 2 }, pages: [{ pageIndex: 1, text: 'texto', chars: 5 }, { pageIndex: 2, text: '', chars: 0, error: 'falha-extrair-pagina' }] });
    const full = statusFor({ ok: true, bytes: 100, analyze: { totalPagesArquivo: 2 }, pages: [{ pageIndex: 1, text: 'texto', chars: 5 }, { pageIndex: 2, text: 'texto2', chars: 6 }] });
    const dlFail = statusFor({ ok: false, bytes: 0, analyze: null, pages: [] });
    const noTextExtracted = statusFor({ ok: true, bytes: 100, analyze: { totalPagesArquivo: 2 }, pages: [{ pageIndex: 1, text: '', chars: 0 }, { pageIndex: 2, text: '', chars: 0 }] });
    const ok = noText === 'partial' && withErr === 'partial' && full === 'integral' && dlFail === 'inaccessible' && noTextExtracted === 'partial';
    record({ id: G + '-5', title: '6: página sem texto/erro -> partial; baixado sem texto -> parcial; integral só com total conhecido e todas com texto', status: ok ? 'PASS' : 'FAIL', detail: `semTexto=${noText} erro=${withErr} completo=${full} falhaDownload=${dlFail} semTextoExtraido=${noTextExtracted}` });
  }

  // P-6: documento do PDF contém link relativo ao PDF original (funciona pós-ZIP).
  {
    const md = renderPdfDocument({ entry: { id: 'PDF_01', text: 'Slides', url: 'u', pdfFile: 'PDF_01.pdf', bytes: 10, sha256: 'aa', totalPagesArquivo: 1, pagesExtracted: 1, printedPagination: { detected: [1], reliable: 'partial' }, pages: [{ pageIndex: 1, text: 'x' }], status: 'integral' }, course: { code: 'M1' }, week: { name: 'Semana 1' }, meta: {} });
    const ok = md.includes('PDF original (relativo)') && md.includes('[Abrir o arquivo PDF](PDF_01.pdf)');
    record({ id: G + '-6', title: '6: doc do PDF tem link relativo ao arquivo original (funciona após extrair ZIP)', status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : 'linkAusente=true' });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO PDF (SEÇÃO 6) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
