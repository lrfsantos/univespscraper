const fs = require('fs');
const path = require('path');
const books = require('../src/extract/books');

// Testes de PRODUÇÃO §9: orquestrador REAL extractVitalsourceViaDriver com
// drivers falsos determinísticos — fatos reais §7 (pageRef +1 por página
// impressa, TOC "Acesse {título}, página P", "Ir para Página" + Enter) e os
// MESMOS critérios fail-closed de integral do Pearson (§2).

const OUT = path.join(__dirname, '..', 'audit-temp', 'VITALSOURCE_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}
const ok = (c) => (c ? 'PASS' : 'FAIL');
const TXT = (n) => `Pagina impressa ${n}: fundamentos da administração contemporânea exigem planejamento estratégico consistente, liderança responsável e gestão sustentável das organizações.`;

// Driver falso: pageRef = página impressa + OFFSET (constante por livro, §7).
// pages: mapa página impressa -> texto. defects: { divergeAt, stallAt, repeatAt, blankAt, failAt }
function vsDriver({ toc, pages, offset, defects = {} }) {
  const gotoRef = (p) => (defects.divergeAt != null && p >= defects.divergeAt ? p + offset + 7 : p + offset);
  let curRef = null;
  return {
    waitContent: async () => ({ pageRef: offset + 1, text: TXT(1) }),
    expandToc: async () => true,
    readToc: async () => (toc === null ? null : toc.map(([label, printed]) => ({ label, printedPage: printed }))),
    gotoPage: async (p) => {
      if (defects.failAt != null && p >= defects.failAt) return { ok: false, reason: 'conteudo-nao-carregou' };
      curRef = gotoRef(p);
      return { ok: true, pageRef: curRef };
    },
    readState: async () => {
      if (curRef == null) return null;
      const printed = curRef - offset;
      if (defects.blankAt != null && printed >= defects.blankAt) return { pageRef: curRef, text: '' };
      if (defects.repeatAt != null && printed >= defects.repeatAt) return { pageRef: curRef, text: TXT(defects.repeatAt - 1) };
      return { pageRef: curRef, text: TXT(printed) };
    },
  };
}

(async () => {
  // V1 — integral: fronteira alcançada, pageRef avança e confere página+offset.
  {
    const r = await books.extractVitalsourceViaDriver(
      vsDriver({ toc: [['Unidade 1: Fundamentos', 10], ['Unidade 2: Prática', 20]], pages: {}, offset: 1 }),
      { chapter: 'Unidade 1: Fundamentos' }, { maxPages: 20 }
    );
    const good = r.ok === true && r.status === 'integral' && r.stoppedBy === 'fim-do-capitulo'
      && r.pageRefOffset === 1 && r.pagesExtracted === 10 && r.pageStart === 10 && r.pageEnd === 20
      && r.validation.endOk === true && r.validation.sequenceOk === true && (r.text || '').includes('pageRef 11');
    record({ id: 'V1', title: 'VitalSource integral (offset pageRef = 1)', status: ok(good), detail: `status=${r.status} pages=${r.pagesExtracted} offset=${r.pageRefOffset} stoppedBy=${r.stoppedBy}` });
  }

  // V2 — §7: sem #pdf-ax-text -> inaccessible (não inventa conteúdo).
  {
    const d = vsDriver({ toc: [], pages: {}, offset: 1 });
    d.waitContent = async () => null;
    const r = await books.extractVitalsourceViaDriver(d, { chapter: 1 }, { waitTimeoutMs: 10 });
    const good = r.status === 'inaccessible' && r.error === 'camada-ax-text-indisponivel' && r.chars === 0;
    record({ id: 'V2', title: 'Sem camada #pdf-ax-text -> inaccessible', status: ok(good), detail: `status=${r.status} error=${r.error}` });
  }

  // V3 — §7: sumário indisponível (mesmo após expandToc) -> inaccessible.
  {
    const d = vsDriver({ toc: null, pages: {}, offset: 1 });
    const r = await books.extractVitalsourceViaDriver(d, { chapter: 1 }, {});
    const good = r.status === 'inaccessible' && r.error === 'sumario-indisponivel' && r.chapterLocated !== true;
    record({ id: 'V3', title: 'Sumario indisponivel -> inaccessible', status: ok(good), detail: `status=${r.status} error=${r.error}` });
  }

  // V4 — §6: capítulo não localizado no sumário -> not_found, nada extraído.
  {
    const r = await books.extractVitalsourceViaDriver(
      vsDriver({ toc: [['Unidade 1: Fundamentos', 10]], pages: {}, offset: 1 }),
      { chapter: 7 }, {}
    );
    const good = r.status === 'not_found' && r.error === 'capitulo-nao-localizado' && r.chars === 0;
    record({ id: 'V4', title: 'Capitulo nao localizado -> not_found', status: ok(good), detail: `status=${r.status} error=${r.error}` });
  }

  // V5 — §7: pageRef diverge de página+offset -> interrompe (partial).
  {
    const r = await books.extractVitalsourceViaDriver(
      vsDriver({ toc: [['Unidade 1: Fundamentos', 10], ['Unidade 2: Prática', 20]], pages: {}, offset: 1, defects: { divergeAt: 14 } }),
      { chapter: 1 }, { maxPages: 20 }
    );
    const good = r.status === 'partial' && r.stoppedBy === 'pageref-diverge'
      && r.attempts.some((a) => a.startsWith('pageref-diverge-pagina=14'));
    record({ id: 'V5', title: 'pageRef diverge -> partial', status: ok(good), detail: `stoppedBy=${r.stoppedBy}` });
  }

  // V6 — §7: pageRef não avança -> interrompe (partial).
  {
    const d = vsDriver({ toc: [['Unidade 1: Fundamentos', 10], ['Unidade 2: Prática', 20]], pages: {}, offset: 1 });
    let first = true;
    const origGoto = d.gotoPage;
    d.gotoPage = async (p) => {
      const g = await origGoto(p);
      if (!first && g.ok) g.pageRef = null; // segunda navegação não muda o ref
      first = false;
      return { ...g, pageRef: first ? g.pageRef : g.pageRef };
    };
    // Simplificação: força o mesmo pageRef a partir da 2ª página.
    let lastRef = null;
    d.gotoPage = async (p) => {
      const g = await origGoto(p);
      if (lastRef != null) return { ok: true, pageRef: lastRef };
      lastRef = g.pageRef;
      return g;
    };
    const r = await books.extractVitalsourceViaDriver(d, { chapter: 1 }, { maxPages: 20 });
    const good = r.status === 'partial' && r.stoppedBy === 'pageref-nao-avancou';
    record({ id: 'V6', title: 'pageRef nao avanca -> partial', status: ok(good), detail: `stoppedBy=${r.stoppedBy}` });
  }

  // V7 — §5/§7: conteúdo repetido (pageRef idêntico ao anterior) -> interrompe.
  {
    const r = await books.extractVitalsourceViaDriver(
      vsDriver({ toc: [['Unidade 1: Fundamentos', 10], ['Unidade 2: Prática', 20]], pages: {}, offset: 1, defects: { repeatAt: 13 } }),
      { chapter: 1 }, { maxPages: 20 }
    );
    const good = r.status === 'partial' && r.stoppedBy === 'conteudo-repetido'
      && r.attempts.some((a) => a === 'conteudo-repetido-pagina=13');
    record({ id: 'V7', title: 'Conteudo repetido -> partial', status: ok(good), detail: `stoppedBy=${r.stoppedBy} pages=${r.pagesExtracted}` });
  }

  // V8 — página vazia -> partial (nunca integral).
  {
    const r = await books.extractVitalsourceViaDriver(
      vsDriver({ toc: [['Unidade 1: Fundamentos', 10], ['Unidade 2: Prática', 20]], pages: {}, offset: 1, defects: { blankAt: 12 } }),
      { chapter: 1 }, { maxPages: 20 }
    );
    const good = r.status === 'partial' && r.stoppedBy === 'pagina-vazia' && r.pagesWithoutText === 1;
    record({ id: 'V8', title: 'Pagina vazia -> partial', status: ok(good), detail: `stoppedBy=${r.stoppedBy}` });
  }

  // V9 — limite de páginas -> partial com texto preservado.
  {
    const r = await books.extractVitalsourceViaDriver(
      vsDriver({ toc: [['Unidade 1: Fundamentos', 10], ['Unidade 2: Prática', 40]], pages: {}, offset: 1 }),
      { chapter: 1 }, { maxPages: 3 }
    );
    const good = r.status === 'partial' && r.stoppedBy === 'limite-de-paginas'
      && r.pagesExtracted === 3 && (r.text || '').length > 0;
    record({ id: 'V9', title: 'Limite de paginas -> partial com texto', status: ok(good), detail: `stoppedBy=${r.stoppedBy} chars=${r.chars}` });
  }

  // V10 — §6: capítulo sem próximo item distinto (fronteira ambígua) -> partial.
  {
    const r = await books.extractVitalsourceViaDriver(
      vsDriver({ toc: [['Unidade 1: Fundamentos', 10]], pages: {}, offset: 1 }),
      { chapter: 1 }, { maxPages: 20 }
    );
    const good = r.status === 'partial' && r.stoppedBy === 'sem-fronteira'
      && r.validation.endOk === false;
    record({ id: 'V10', title: 'Fronteira ambigua (sem proximo item) -> partial', status: ok(good), detail: `stoppedBy=${r.stoppedBy}` });
  }

  // V11 — §4/§7: falha de navegação "Ir para Página" -> interrompe com motivo.
  {
    const r = await books.extractVitalsourceViaDriver(
      vsDriver({ toc: [['Unidade 1: Fundamentos', 10], ['Unidade 2: Prática', 20]], pages: {}, offset: 1, defects: { failAt: 13 } }),
      { chapter: 1 }, { maxPages: 20 }
    );
    const good = r.status === 'partial' && r.stoppedBy === 'falha-de-navegacao'
      && r.attempts.some((a) => a.includes('navegacao-falhou-pagina=13'));
    record({ id: 'V11', title: 'Falha de navegacao -> partial com motivo', status: ok(good), detail: `stoppedBy=${r.stoppedBy}` });
  }

  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
  const fails = results.filter((r) => r.status !== 'PASS').length;
  console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
