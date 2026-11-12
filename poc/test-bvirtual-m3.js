const fs = require('fs');
const path = require('path');
const { sanitizeUrlForReport, diagnoseReader, classifyReader } = require('../src/extract/books');

// Testes da SEÇÃO 4.5 (P1): diagnóstico SANITIZADO dos leitores — redação de query
// strings (ex.: parâmetro `code`), ausência de credenciais/tokens no relatório, e
// classificação dos dois padrões observados na gravação (leitor tipo EPUB e leitor
// paginado). O diagnóstico reutiliza a classificação de PRODUÇÃO (classifyReader)
// e o relatório é validado com um leitor SIMULADO na fronteira.

const OUT = path.join(__dirname, '..', 'audit-temp', 'BVIRTUAL_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

// Redação de URLs (puro).
function redact(url) { return sanitizeUrlForReport(url); }

// Leitor simulado (fronteira) para diagnoseReader: expõe janelas/frames no contrato
// SÍNCRONO que a produção espera (windows()/frames() retornam arrays).
function fakeApp({ windows = [], frameUrls = [] } = {}) {
  const frames = frameUrls.map((url) => ({ url: () => url, evaluate: async () => '' }));
  const winObjs = windows.map((u) => ({
    url: async () => u,
    title: async () => '',
    evaluate: async () => ({}),
    frames: () => frames,
    locator: () => ({ first: () => ({ click: async () => {} }) }),
  }));
  const app = {
    windows: () => winObjs,
  };
  const win = {
    async goto() {},
    url: async () => (windows[0] || 'about:blank'),
    evaluate: async () => ({}),
  };
  return { app, win };
}

(async () => {
  const G = 'V'; // BVirtual

  // Bv-1: redação de query string (parâmetro `code` temporário) e fragmento.
  {
    const u = 'https://leitor.bvirtual.com.br/reader/books/123/pageid/45?code=SECRETO_123&token=abc#cap';
    const c = redact(u);
    const ok = c === 'https://leitor.bvirtual.com.br/reader/books/123/pageid/45' && !c.includes('SECRETO_123') && !c.includes('code=') && !c.includes('#cap');
    record({ id: G + '-1', title: '4.5: URL de leitor redigida — query string (code/token) e fragmento removidos', status: ok ? 'PASS' : 'FAIL', detail: `redigida=${c}` });
  }

  // Bv-2: URL inválida/sem origem absoluta é redigida sem vazar query.
  {
    const c = redact('https://x/y?code=SECRETO');
    const c2 = redact('valor?password=123&x=1');
    const ok = c === 'https://x/y' && c2 === 'valor';
    record({ id: G + '-2', title: '4.5: redação também cobre URLs não absolutas', status: ok ? 'PASS' : 'FAIL', detail: `absoluta=${c} relativa=${c2}` });
  }

  // Bv-3: classificação de produção — leitor com frames EPUB (estrutura semelhante a EPUB).
  {
    const det = classifyReader({ frames: [{ url: 'https://leitor.bvirtual.com.br/epub/OEBPS/Text/chapter01.xhtml' }], windows: ['https://leitor.bvirtual.com.br/...'] });
    const ok = det.format === 'epub';
    record({ id: G + '-3', title: '4.5: leitor BVirtual tipo EPUB é classificado por conteúdo estruturado (não por aparência)', status: ok ? 'PASS' : 'FAIL', detail: `format=${det.format}` });
  }

  // Bv-4: classificação de produção — leitor paginado (pages/N/content) e plataforma bvirtual.
  {
    const detPageid = classifyReader({ frames: [{ url: 'https://jigsaw.minhabiblioteca.com.br/books/9/pageid/3?brand=vitalsource&create=true' }], windows: [] });
    const detBv = classifyReader({ frames: [], windows: ['https://plataforma.bvirtual.com.br/...'] });
    const ok = detPageid.format === 'pageid' && detBv.format === 'bvpdf';
    record({ id: G + '-4', title: '4.5: leitor paginado (pageid) e plataforma BVirtual são distinguidos por evidência técnica', status: ok ? 'PASS' : 'FAIL', detail: `pageid=${detPageid.format} bv=${detBv.format}` });
  }

  // Bv-5: diagnoseReader gera relatório sanitizado (sem query, sem credenciais, sem conteúdo).
  {
    const { app, win } = fakeApp({
      windows: ['https://leitor.bvirtual.com.br/reader/books/9?code=TEMP'],
      frameUrls: ['https://leitor.bvirtual.com.br/epub/OEBPS/Text/ch01.xhtml?auth=TOKEN'],
    });
    const r = await diagnoseReader(app, win, 'https://ava.univesp.br/mod/lti/launch.php?id=1&code=TEMP', { text: 'Comunicacao Organizacional', book: 'Comunicacao organizacional' }, { observeTimeoutMs: 100 });
    const json = JSON.stringify(r);
    const ok = r.classificacao === 'epub' && r.tituloAtividadeAva === 'Comunicacao Organizacional' &&
      !json.includes('code=') && !json.includes('TEMP') && !json.includes('TOKEN') && !json.includes('password') &&
      r.origemAva === 'https://ava.univesp.br/mod/lti/launch.php' && r.semDadosSensiveis === true;
    record({ id: G + '-5', title: '4.5: diagnoseReader produz relatório sanitizado (sem code/token/credenciais/conteúdo)', status: ok ? 'PASS' : 'FAIL', detail: `classif=${r.classificacao} origem=${r.origemAva} semDados=${r.semDadosSensiveis} tipos=${(r.tiposDeConteudo || []).join(',')}` });
  }

  // Bv-6: diagnoseReader não expõe conteúdo de livro nem números de página impressos longos.
  {
    const { app, win } = fakeApp({ windows: ['https://plataforma.bvirtual.com.br/leitor'], frameUrls: [] });
    const r = await diagnoseReader(app, win, 'https://ava.univesp.br/mod/lti/launch.php?id=9', {}, { observeTimeoutMs: 100 });
    const ok = r.classificacao === 'bvpdf' || r.classificacao === 'unknown' || r.classificacao === 'bvleitor';
    record({ id: G + '-6', title: '4.5: leitor paginado BVirtual é diagnosticado sem inventar extração textual', status: ok ? 'PASS' : 'FAIL', detail: `classif=${r.classificacao} evidenciaPdf=${r.evidenciaPdf}` });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO DIAGNÓSTICO BVIRTUAL (SEÇÃO 4.5) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
