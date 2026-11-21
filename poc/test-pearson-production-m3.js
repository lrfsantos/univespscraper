const fs = require('fs');
const path = require('path');
const books = require('../src/extract/books');

// Testes de PRODUÇÃO §9: orquestrador REAL extractPearsonViaDriver (o mesmo do
// tryPearsonAutomation) com drivers falsos determinísticos — fronteira alcançada,
// sequência completa, limites -> partial, confirmação de página (§5), XHR
// protegido (§4, motivos), fallback único (§3), ambiguidade (§6).

const OUT = path.join(__dirname, '..', 'audit-temp', 'PEARSON_PRODUCTION_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}
const ok = (c) => (c ? 'PASS' : 'FAIL');
const TXT = (n) => `Pagina ${n}: empreendedorismo e gestão sustentável exigem planejamento cuidadoso do ciclo de inovação nas organizações contemporâneas, com foco no empreendedor social e local.`;

// Driver Beta falso: sumário (ids), páginas por índice, navegação com estado.
function betaDriver({ toc, entryPages, failNavFrom, repeatFrom, blankFrom, unconfirmedFrom }) {
  let currentIdx = null;
  let requested = null;
  return {
    selectReader: async (name) => (name === 'beta' ? 'id:pdf-novo' : false),
    waitFor: async () => {},
    handleDialog: async () => 'pagina-atual',
    readToc: async () => toc.map((label, i) => ({ id: 'summary-item-' + i, text: label, aria: label, active: false })),
    clickTocEntry: async (reader, n) => { currentIdx = entryPages[n] != null ? n : null; requested = null; return true; },
    readCurrentPage: async () => (currentIdx != null ? { page: entryPages[currentIdx], source: 'input' } : null),
    navigateToPage: async (p) => { if (failNavFrom != null && p >= failNavFrom) return false; requested = p; return true; },
    readNavState: async () => {
      if (unconfirmedFrom != null && requested >= unconfirmedFrom) return { input: requested + 1, shown: requested + 1 };
      return requested != null ? { input: requested, shown: requested } : null;
    },
    readPageAlts: async () => {
      if (requested == null) return [];
      if (repeatFrom != null && requested >= repeatFrom) return [TXT(repeatFrom - 1)];
      if (blankFrom != null && requested >= blankFrom) return [''];
      return [TXT(requested)];
    },
  };
}

// Driver Clássico falso: páginas via fetchPaginationPage (§4).
function classicDriver({ toc, entryPages, failFrom, failReason }) {
  return {
    selectReader: async (name) => (name === 'classic' ? 'id:pdf' : false),
    waitFor: async () => {},
    handleDialog: async () => 'pagina-atual',
    readToc: async () => toc.map((label, i) => ({ dataPagina: entryPages[i], label })),
    clickTocEntry: async () => true,
    readCurrentPage: async () => null,
    navigateToPage: async () => false,
    readNavState: async () => null,
    readPageAlts: async () => [],
    fetchPaginationPage: async (p) => {
      if (failFrom != null && p >= failFrom) return { ok: false, reason: failReason };
      const hit = toc.some((_, i) => i === 0 || true) && p >= entryPages[0] && (entryPages[1] == null || p < entryPages[1]);
      if (!hit) return { ok: false, reason: 'resposta-sem-divbookmark' };
      return { ok: true, text: TXT(p), hasImageUrl: true };
    },
  };
}

(async () => {
  // P1 — Beta integral: fronteira do próximo item ALCANÇADA, sequência completa.
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(betaDriver({
      toc,
      entryPages: { 0: 3, 1: 8 },
    }), { chapter: 'Unidade 1: Fundamentos' }, { maxPages: 20, format: 'pdf', readerUrl: 'https://x/y?code=abc' });
    const good = r.ok === true && r.status === 'integral' && r.stoppedBy === 'fim-do-capitulo'
      && r.validation.endOk === true && r.validation.sequenceOk === true
      && r.pagesExtracted === 5 && r.pageStart === 3 && r.pageEnd === 8
      && (r.text || '').includes('Pagina 3:') && (r.text || '').includes('Pagina 7:');
    record({ id: 'P1', title: 'Beta integral: fronteira alcançada + sequência completa', status: ok(good), detail: `status=${r.status} stoppedBy=${r.stoppedBy} pages=${r.pagesExtracted} endOk=${r.validation.endOk}` });
  }

  // P2 — Beta: limite de páginas -> partial, texto útil preservado.
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 40 } }), { chapter: 1 }, { maxPages: 4, format: 'pdf' });
    const good = r.ok === false && r.status === 'partial' && r.stoppedBy === 'limite-de-paginas'
      && r.pagesExtracted === 4 && (r.text || '').length > 0 && r.validation.endOk === false;
    record({ id: 'P2', title: 'Beta limite de paginas -> partial com texto preservado', status: ok(good), detail: `status=${r.status} stoppedBy=${r.stoppedBy} chars=${r.chars}` });
  }

  // P3 — Beta §5: página não confirmada pelo ESTADO do leitor -> partial.
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 40 }, unconfirmedFrom: 5 }), { chapter: 1 }, { maxPages: 20, format: 'pdf' });
    const good = r.ok === false && r.status === 'partial' && r.stoppedBy === 'pagina-nao-confirmada'
      && r.attempts.some((a) => a.startsWith('pagina-nao-confirmada-solicitada=5'));
    record({ id: 'P3', title: 'Beta pagina nao confirmada pelo estado -> partial', status: ok(good), detail: `stoppedBy=${r.stoppedBy}` });
  }

  // P4 — Beta §5: conteúdo repetido (assinatura idêntica à página anterior).
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 40 }, repeatFrom: 6 }), { chapter: 1 }, { maxPages: 20, format: 'pdf' });
    const good = r.ok === false && r.status === 'partial' && r.stoppedBy === 'conteudo-repetido'
      && r.attempts.some((a) => a === 'conteudo-repetido-pagina=6') && r.pagesExtracted === 3;
    record({ id: 'P4', title: 'Beta conteudo repetido interrompe', status: ok(good), detail: `stoppedBy=${r.stoppedBy} pages=${r.pagesExtracted}` });
  }

  // P5 — Beta: página vazia no meio -> partial (nunca integral).
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 40 }, blankFrom: 5 }), { chapter: 1 }, { maxPages: 20, format: 'pdf' });
    const good = r.ok === false && r.status === 'partial' && r.pagesWithoutText >= 1
      && !r.attempts.some((a) => a.startsWith('pagina-nao-confirmada'))
      && !r.attempts.some((a) => a.startsWith('navegacao-falhou'));
    record({ id: 'P5', title: 'Beta pagina vazia -> partial', status: ok(good), detail: `status=${r.status} sem-texto=${r.pagesWithoutText}` });
  }

  // P6 — Clássico integral: páginas via XHR, fronteira alcançada.
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(classicDriver({ toc, entryPages: { 0: 3, 1: 8 } }), { chapter: 'Unidade 1: Fundamentos' }, { maxPages: 20, format: 'pdf' });
    const good = r.ok === true && r.status === 'integral' && r.stoppedBy === 'fim-do-capitulo'
      && r.reader === 'classic' && r.pagesExtracted === 5
      && r.attempts.some((a) => a.startsWith('camada='));
    record({ id: 'P6', title: 'Classico integral via paginacao', status: ok(good), detail: `status=${r.status} pages=${r.pagesExtracted}` });
  }

  // P7 — Clássico §4: falha de paginação por página registrada, partial com texto.
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(classicDriver({ toc, entryPages: { 0: 3, 1: 40 }, failFrom: 5, failReason: 'http-500' }), { chapter: 1 }, { maxPages: 20, format: 'pdf' });
    const good = r.ok === false && r.status === 'partial' && r.stoppedBy === 'falha-de-paginacao'
      && r.attempts.some((a) => a.includes('paginacao-falhou-pagina=5') && a.includes('http-500'))
      && (r.text || '').includes('Pagina 4:');
    record({ id: 'P7', title: 'Classico falha de paginacao -> partial com texto', status: ok(good), detail: `stoppedBy=${r.stoppedBy} attempts=${r.attempts.filter((a) => a.includes('paginacao-falhou')).join(' | ')}` });
  }

  // P8 — Clássico §4: sessão expirada nunca deixa pendente (resolve imediato).
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const t0 = Date.now();
    const r = await books.extractPearsonViaDriver(classicDriver({ toc, entryPages: { 0: 3, 1: 40 }, failFrom: 3, failReason: 'sessao-expirada' }), { chapter: 1, preferred: 'classic' }, { maxPages: 20, format: 'pdf', preferred: 'classic' });
    const good = r.ok === false && (Date.now() - t0) < 2000
      && r.attempts.some((a) => a.includes('sessao-expirada'))
      && r.attempts.some((a) => a.startsWith('paginacao-falhou-pagina=3'));
    record({ id: 'P8', title: 'Classico sessao expirada resolve sem pendencia', status: ok(good), detail: `stoppedBy=${r.stoppedBy} ms=${Date.now() - t0}` });
  }

  // P9 — §3: seleção inicial falhou -> tenta o OUTRO leitor (não é fallback).
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const d = classicDriver({ toc, entryPages: { 0: 3, 1: 8 } });
    d.selectReader = async (name) => (name === 'beta' ? false : 'id:pdf');
    const r = await books.extractPearsonViaDriver(d, { chapter: 1 }, { preferred: 'beta', format: 'pdf' });
    const good = r.ok === true && r.status === 'integral' && r.reader === 'classic'
      && r.attempts.some((a) => a === 'selecao-inicial-falhou-tentar=classic')
      && !r.attempts.some((a) => a.startsWith('fallback-unico='));
    record({ id: 'P9', title: 'Selecao inicial falhou -> outro leitor (nao e fallback)', status: ok(good), detail: `reader=${r.reader} attempts=${r.attempts.filter((a) => a.startsWith('selecao')).join(' | ')}` });
  }

  // P10 — §3: Beta sem sumário -> fallback ÚNICO para Clássico.
  {
    const d = betaDriver({ toc: [], entryPages: {} });
    const cd = classicDriver({ toc: ['Unidade 1: Fundamentos', 'Unidade 2: Prática'], entryPages: { 0: 3, 1: 8 } });
    const hybrid = {
      selectReader: async (n) => (n === 'beta' ? 'id:pdf-novo' : 'id:pdf'),
      waitFor: async () => {}, handleDialog: async () => 'pagina-atual',
      readToc: async (isBeta) => (isBeta ? await d.readToc() : await cd.readToc()),
      clickTocEntry: async (n) => cd.clickTocEntry(n),
      readCurrentPage: async () => cd.readCurrentPage(),
      navigateToPage: async (p) => cd.navigateToPage(p),
      readNavState: async () => cd.readNavState(),
      readPageAlts: async () => cd.readPageAlts(),
      fetchPaginationPage: (p) => cd.fetchPaginationPage(p),
    };
    const r = await books.extractPearsonViaDriver(hybrid, { chapter: 1 }, { preferred: 'beta', format: 'pdf' });
    const good = r.ok === true && r.reader === 'classic'
      && r.attempts.some((a) => a.startsWith('fallback-unico=classic') && a.includes('toc-falhou'));
    record({ id: 'P10', title: 'Fallback unico Beta->Classico apos sumario vazio', status: ok(good), detail: `reader=${r.reader}` });
  }

  // P11 — §3: ambos os leitores falham -> causa real, chapterLocated false.
  {
    const d = betaDriver({ toc: [], entryPages: {} });
    d.selectReader = async () => 'id:falso';
    const r = await books.extractPearsonViaDriver(d, { chapter: 1 }, { preferred: 'beta', format: 'pdf' });
    const good = r.ok === false && r.failureType === 'pearson-falhou-toc'
      && r.chapterLocated === false && r.attempts.some((a) => a === 'pearson-sem-extracao-causa=toc');
    record({ id: 'P11', title: 'Ambos leitores falham -> causa real registrada', status: ok(good), detail: `failureType=${r.failureType}` });
  }

  // P12 — §6: TOC com título duplicado -> ambíguo, nunca a primeira silenciosa.
  {
    const toc12 = ['Unidade 2: Prática', 'Unidade 2: Prática'];
    const d = betaDriver({ toc: toc12, entryPages: {} });
    d.selectReader = async () => 'id:falso';
    d.readToc = async (isBeta) => toc12.map((label, i) => (isBeta
      ? { id: 'summary-item-' + i, text: label, aria: label, active: false }
      : { dataPagina: 5 + i, label }));
    const r = await books.extractPearsonViaDriver(d, { chapter: 2 }, { preferred: 'beta', format: 'pdf' });
    const good = r.ok === false && r.failureType === 'pearson-falhou-locate'
      && r.locAmbiguous === true && r.tocEntries === 2;
    record({ id: 'P12', title: 'TOC duplicado -> ambiguo, sem escolha arbitraria', status: ok(good), detail: `failureType=${r.failureType} ambiguo=${r.locAmbiguous}` });
  }

  // P13 — Beta: navegação falha -> 'falha-de-navegacao' (não 'limite-de-paginas').
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 40 }, failNavFrom: 4 }), { chapter: 1 }, { maxPages: 20, format: 'pdf' });
    const good = r.ok === false && r.status === 'partial' && r.stoppedBy === 'falha-de-navegacao'
      && r.attempts.some((a) => a === 'navegacao-falhou-pagina=4');
    record({ id: 'P13', title: 'Beta navegacao falhou -> stoppedBy correto', status: ok(good), detail: `stoppedBy=${r.stoppedBy}` });
  }

  // P14 — §2: intervalo do AVA delimita a janela (nunca o capítulo inteiro).
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 40 } }), { chapter: 1, hasPageRange: true, pageRange: { start: 5, end: 8 } }, { maxPages: 20, format: 'pdf' });
    const good = r.status === 'integral' && r.pageStart === 5 && r.pageEnd === 9 && r.pagesExtracted === 4
      && (r.text || '').includes('Pagina 5:') && (r.text || '').includes('Pagina 8:') && !(r.text || '').includes('Pagina 4:')
      && r.attempts.some((a) => a === 'janela-intervalo-ava=5..8');
    record({ id: 'P14', title: 'pageRange do AVA delimita a janela de extracao', status: ok(good), detail: `status=${r.status} janela=${r.pageStart}..${r.pageEnd - 1} pages=${r.pagesExtracted}` });
  }

  // P15 — §5: input programático SOZINHO não confirma (sem #ExibicaoAtual e
  // sem mudança de conteúdo → página não confirmada).
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const d = betaDriver({ toc, entryPages: { 0: 3, 1: 40 } });
    d.readNavState = async () => ({ input: d._req != null ? d._req : null, shown: null });
    const origNav = d.navigateToPage;
    d.navigateToPage = async (p) => { d._req = p; return origNav(p); };
    d.readPageAlts = async () => [TXT(3)]; // conteúdo TRAVADO: leitor não navegou
    const r = await books.extractPearsonViaDriver(d, { chapter: 1 }, { maxPages: 20, format: 'pdf' });
    const good = r.status === 'partial' && r.stoppedBy === 'pagina-nao-confirmada'
      && r.attempts.some((a) => a.startsWith('pagina-nao-confirmada-solicitada=4'));
    record({ id: 'P15', title: 'Input programatico sozinho nao confirma navegacao', status: ok(good), detail: `stoppedBy=${r.stoppedBy} pages=${r.pagesExtracted}` });
  }

  // P16 — §6-B: fronteira "Referências" (item sem numeração) é AMBÍGUA →
  // texto preservado, mas nunca integral.
  {
    const toc = ['Capítulo 1: X', 'Referências'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 10 } }), { chapter: 1 }, { maxPages: 20, format: 'pdf' });
    const good = r.status === 'partial' && r.stoppedBy === 'fim-do-capitulo'
      && r.validation.boundaryAmbiguous === true
      && r.validation.warnings.some((w) => w === 'fronteira-ambigua-item-sem-numeracao')
      && (r.text || '').includes('Pagina 3:');
    record({ id: 'P16', title: 'Fronteira sem numeracao (Referencias) -> partial fail-closed', status: ok(good), detail: `status=${r.status} stoppedBy=${r.stoppedBy} ambigua=${r.validation.boundaryAmbiguous}` });
  }

  // P17 — §6-A: chapterKind 'unidade' do AVA NÃO casa "Capítulo N".
  {
    const toc = ['Capítulo 2: Errado', 'Unidade 2: Correto', 'Unidade 3: Z'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 1: 5, 2: 9 } }), { chapter: 2, chapterKind: 'unidade' }, { maxPages: 20, format: 'pdf' });
    const good = r.status === 'integral' && r.attempts.some((a) => a === 'localizar=unidade-numerica')
      && (r.text || '').includes('Pagina 5:') && (r.text || '').includes('Pagina 8:');
    record({ id: 'P17', title: 'chapterKind unidade nao casa Capitulo N (§6-A)', status: ok(good), detail: `status=${r.status} loc=${(r.attempts.find((a) => a.startsWith('localizar=')) || '')}` });
  }

  // P18 — §6-A: sem chapterKind declarado, comportamento anterior preservado
  // (Capítulo N tem prioridade sobre Unidade N).
  {
    const toc = ['Capítulo 2: Errado', 'Unidade 2: Correto', 'Unidade 3: Z'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 7 } }), { chapter: 2 }, { maxPages: 20, format: 'pdf' });
    const good = r.status === 'integral' && r.attempts.some((a) => a === 'localizar=capitulo-numerico')
      && (r.text || '').includes('Pagina 3:') && (r.text || '').includes('Pagina 6:');
    record({ id: 'P18', title: 'Sem chapterKind, Capitulo N tem prioridade (compat.)', status: ok(good), detail: `status=${r.status}` });
  }

  // P19 — §2: intervalo SEM capítulo (Clássico): fronteira pela paginação real.
  {
    const toc = ['Seção A', 'Seção B'];
    const r = await books.extractPearsonViaDriver(classicDriver({ toc, entryPages: { 0: 5, 1: 12 } }), { hasPageRange: true, pageRange: { start: 5, end: 8 } }, { maxPages: 20, format: 'pdf' });
    const good = r.status === 'integral' && r.pageStart === 5 && r.pageEnd === 9 && r.pagesExtracted === 4
      && r.attempts.some((a) => a.startsWith('localizar=paginas-data-pagina'));
    record({ id: 'P19', title: 'Intervalo sem capitulo -> extrai exatamente o intervalo', status: ok(good), detail: `status=${r.status} janela=${r.pageStart}..${r.pageEnd - 1}` });
  }

  // P20 — §5: #ExibicaoAtual DESATUALIZADO (mostra página anterior) não é
  // confirmado nem pelo input nem pelo conteúdo — fail-closed.
  {
    const toc = ['Unidade 1: Fundamentos', 'Unidade 2: Prática'];
    const d = betaDriver({ toc, entryPages: { 0: 3, 1: 40 } });
    let lastReq = null;
    const origNav = d.navigateToPage;
    d.navigateToPage = async (p) => { lastReq = p; return origNav(p); };
    d.readNavState = async () => ({ input: lastReq, shown: lastReq != null && lastReq > 3 ? lastReq - 1 : null }); // shown defasado
    d.readPageAlts = async () => (lastReq != null ? [TXT(lastReq)] : []); // conteúdo REAL atualizou
    const r = await books.extractPearsonViaDriver(d, { chapter: 1 }, { maxPages: 20, format: 'pdf' });
    const good = r.status === 'partial' && r.stoppedBy === 'pagina-nao-confirmada'
      && r.attempts.some((a) => a.startsWith('pagina-nao-confirmada-solicitada=4'));
    record({ id: 'P20', title: 'Estado desatualizado (shown antigo) -> partial mesmo com conteudo novo', status: ok(good), detail: `stoppedBy=${r.stoppedBy} pages=${r.pagesExtracted}` });
  }

  // P21 — §3: fallback fecha janelas abertas pela tentativa anterior (adaptador).
  {
    const d = betaDriver({ toc: [], entryPages: {} });
    const cd = classicDriver({ toc: ['Unidade 1: Fundamentos', 'Unidade 2: Prática'], entryPages: { 0: 3, 1: 8 } });
    let closedCount = 0;
    const hybrid = {
      selectReader: async (n) => (n === 'beta' ? 'id:pdf-novo' : 'id:pdf'),
      waitFor: async () => {}, handleDialog: async () => 'pagina-atual',
      readToc: async (isBeta) => (isBeta ? await d.readToc() : await cd.readToc()),
      clickTocEntry: async (n) => cd.clickTocEntry(n),
      readCurrentPage: async () => cd.readCurrentPage(),
      navigateToPage: async (p) => cd.navigateToPage(p),
      readNavState: async () => cd.readNavState(),
      readPageAlts: async () => cd.readPageAlts(),
      fetchPaginationPage: (p) => cd.fetchPaginationPage(p),
      closeNewWindows: async () => { closedCount++; return 1; },
    };
    const r = await books.extractPearsonViaDriver(hybrid, { chapter: 1 }, { preferred: 'beta', format: 'pdf' });
    const good = r.status === 'integral' && closedCount === 1
      && r.attempts.some((a) => a === 'janelas-fechadas-antes-fallback=1')
      && r.attempts.some((a) => a.startsWith('fallback-unico=classic'));
    record({ id: 'P21', title: 'Fallback fecha janelas da tentativa anterior antes de trocar de leitor', status: ok(good), detail: `closed=${closedCount} reader=${r.reader}` });
  }

  // P22 — §6-A: kind declarado 'capitulo' mas o sumário só tem Unidade 2 ->
  // NÃO encontra (conservador; nunca converte Unidade em Capítulo).
  {
    const toc = ['Unidade 2: Correto'];
    const d = betaDriver({ toc, entryPages: {} });
    d.selectReader = async () => 'id:falso';
    const r = await books.extractPearsonViaDriver(d, { chapter: 2, chapterKind: 'capitulo' }, { preferred: 'beta', format: 'pdf' });
    const good = r.ok === false
      && r.attempts.some((a) => a.startsWith('localizar=capitulo-nao-localizado-no-sumario'));
    record({ id: 'P22', title: 'Kind capitulo nao encontra Unidade no sumario (conservador)', status: ok(good), detail: `failureType=${r.failureType} attempts=${r.attempts.filter((a) => a.startsWith('localizar')).join(' | ')}` });
  }

  // P23 — §6-B: numeração multinível (1.1, 1.1.1, 1.2) NÃO encerra o Capítulo 1;
  // "Referências" (sem numeração) como fronteira -> partial, nunca integral.
  {
    const toc = ['Capítulo 1: X', '1.1 Introdução', '1.1.1 Objetivos', '1.2 Planejamento', 'Referências', 'Unidade 2: Y'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 4: 30 } }), { chapter: 1 }, { maxPages: 40, format: 'pdf' });
    const good = r.status === 'partial' && r.stoppedBy === 'fim-do-capitulo'
      && r.validation.boundaryAmbiguous === true && r.pagesExtracted === 27
      && !(r.text || '').includes('Pagina 30:');
    record({ id: 'P23', title: 'Multinivel nao encerra capitulo; Referencias -> partial', status: ok(good), detail: `status=${r.status} pages=${r.pagesExtracted} ambigua=${r.validation.boundaryAmbiguous}` });
  }

  // P24 — §6-B: títulos livres DENTRO do capítulo ("Introdução", "Desenvolvimento",
  // "Conclusão") NUNCA encerram o capítulo silenciosamente -> partial.
  {
    const toc = ['Capítulo 1: X', 'Introdução', 'Desenvolvimento', 'Conclusão', 'Capítulo 2: Y'];
    const r = await books.extractPearsonViaDriver(betaDriver({ toc, entryPages: { 0: 3, 1: 5 } }), { chapter: 1 }, { maxPages: 40, format: 'pdf' });
    const good = r.status === 'partial' && r.validation.boundaryAmbiguous === true
      && r.pagesExtracted === 2 && (r.text || '').includes('Pagina 3:') && (r.text || '').includes('Pagina 4:');
    record({ id: 'P24', title: 'Titulos livres no capitulo -> fronteira ambigua (partial)', status: ok(good), detail: `status=${r.status} pages=${r.pagesExtracted}` });
  }

  const fails = results.filter((r) => r.status !== 'PASS').length;
  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
  console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
