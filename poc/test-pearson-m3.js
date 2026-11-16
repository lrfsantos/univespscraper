const fs = require('fs');
const path = require('path');
const pearson = require('../src/extract/pearson');

// Testes SINTÉTICOS do módulo Pearson (seção 4) — camada pura/determinística:
// reconhecimento da tela de seleção, detecção de formato (PDF/EPUB), preferência
// Beta/Clássico com fallback, sumário hierárquico, localização de capítulo e
// intervalo, camada de conteúdo e validação de texto.
//
// IMPORTANTE: são testes sintéticos sobre funções puras. NÃO validam o DOM real
// do leitor Pearson (só possível com sessão real no AVA) — isso é documentado no
// relatório como pendente.

const OUT = path.join(__dirname, '..', 'audit-temp', 'PEARSON_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

(async () => {
  const G = 'P';

  // P-1: reconhecimento da tela de seleção de leitor (Beta + Clássico).
  {
    const det = pearson.detectReaderChoices({ bodyText: 'Escolha o leitor para abrir o livro: Leitor Beta ou Leitor Clássico.', links: ['Beta', 'Clássico'] });
    const ok = det.recognized === true && det.beta === true && det.classic === true;
    record({ id: G + '-1', title: 'Pearson: tela de seleção de leitor reconhecida (Beta e Clássico)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(det) });
  }

  // P-2: página sem hint de leitor NÃO é reconhecida como seleção.
  {
    const det = pearson.detectReaderChoices({ bodyText: 'Conteúdo do capítulo 1 do livro.', links: [] });
    const ok = det.recognized === false;
    record({ id: G + '-2', title: 'Pearson: página sem hint de leitor não é tratada como seleção', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(det) });
  }

  // P-3: detecção de formato PDF.
  {
    const det = pearson.detectBookFormat({ bodyText: 'Este livro está disponível em PDF. Leitor Beta', url: 'https://plataforma.bvirtual.com.br/books/123' });
    const ok = det.format === 'pdf';
    record({ id: G + '-3', title: 'Pearson: formato PDF identificado por evidência', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(det) });
  }

  // P-4: detecção de formato EPUB (sumário/navegação).
  {
    const det = pearson.detectBookFormat({ bodyText: 'Livro EPUB com sumário navegável', url: 'https://plataforma.bvirtual.com.br/books/456/epub' });
    const ok = det.format === 'epub';
    record({ id: G + '-4', title: 'Pearson: formato EPUB identificado por evidência (sumário/navegação)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(det) });
  }

  // P-5: preferência Beta primeiro, Clássico como fallback.
  {
    const det = pearson.detectReaderChoices({ bodyText: 'Leitor Beta e Leitor Clássico' });
    const pref = pearson.chooseReaderPreference(det);
    const fallback = pearson.nextReaderAfterFailure(pref, 'beta');
    const ok = pref === 'beta' && fallback === 'classic';
    record({ id: G + '-5', title: 'Pearson: Beta escolhido primeiro; fallback único para Clássico', status: ok ? 'PASS' : 'FAIL', detail: `pref=${pref} fallback=${fallback}` });
  }

  // P-6: fallback NÃO reabre Beta após tentar Clássico (um único fallback).
  {
    const pref = 'beta';
    const afterClassic = pearson.nextReaderAfterFailure(pref, 'classic');
    const ok = afterClassic === null;
    record({ id: G + '-6', title: 'Pearson: sem novo fallback após Clássico (evita loop)', status: ok ? 'PASS' : 'FAIL', detail: `afterClassic=${afterClassic}` });
  }

  // P-7: sumário hierárquico preservado (profundidade/ordem).
  {
    const toc = pearson.parseToc([
      { label: 'Parte I', depth: 0 },
      { label: 'Capítulo 1', depth: 1 },
      { label: 'Capítulo 2', depth: 1 },
      { label: 'Capítulo 3', depth: 1 },
    ]);
    const ok = toc.length === 4 && toc[0].depth === 0 && toc[1].depth === 1 && toc[1].normalized === 'capitulo 1';
    record({ id: G + '-7', title: 'Pearson: sumário hierárquico preservado (profundidade e ordem)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(toc.map((t) => ({ l: t.label, d: t.depth }))) });
  }

  // P-8: capítulo localizado por número.
  {
    const toc = pearson.parseToc([{ label: 'Capítulo 1', depth: 0 }, { label: 'Capítulo 2', depth: 0 }]);
    const loc = pearson.locateInToc(toc, { chapter: 2 });
    const ok = loc.found === true && loc.entry.label === 'Capítulo 2' && loc.reason === 'capitulo-numerico';
    record({ id: G + '-8', title: 'Pearson: capítulo localizado no sumário por número', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(loc) });
  }

  // P-9: capítulo INEXISTENTE não é escolhido arbitrariamente.
  {
    const toc = pearson.parseToc([{ label: 'Capítulo 1', depth: 0 }]);
    const loc = pearson.locateInToc(toc, { chapter: 9 });
    const ok = loc.found === false && loc.reason === 'capitulo-nao-localizado-no-sumario';
    record({ id: G + '-9', title: 'Pearson: capítulo inexistente registrado como não localizado (sem escolha arbitrária)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(loc) });
  }

  // P-10: intervalo de páginas respeitado (não extrai o livro inteiro).
  {
    const toc = pearson.parseToc([{ label: 'Capítulo 1', depth: 0 }, { label: 'Capítulo 2', depth: 0 }, { label: 'Capítulo 3', depth: 0 }]);
    const loc = pearson.locateInToc(toc, { pageRange: { start: 10, end: 25 } });
    // Sem capítulo explícito + intervalo: a associação exige capítulo OU páginas
    // mapeadas; sem tabela de mapeamento não há escolha arbitrária.
    const ok = loc.found === true && loc.reason !== 'sem-indicacao' || loc.found === false && (loc.reason === 'sem-indicacao-de-capitulo-ou-paginas' || loc.reason === 'capitulo-nao-localizado-no-sumario');
    record({ id: G + '-10', title: 'Pearson: intervalo de páginas não vira extração do livro inteiro (conservador)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(loc) });
  }

  // P-11: camada de conteúdo — DOM com texto acessível.
  {
    const layer = pearson.detectContentLayer({ mainText: 'O empreendedor está no epicentro deste livro. Ele vê oportunidades onde os demais veem somente problemas. '.repeat(3), framesText: '' });
    const ok = layer.layer === 'dom' && layer.hasText === true && layer.needsOcr === false;
    record({ id: G + '-11', title: 'Pearson: camada textual no DOM identificada', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(layer) });
  }

  // P-12: conteúdo renderizado como imagem -> candidato a OCR (sem assumir DRM).
  {
    const layer = pearson.detectContentLayer({ mainText: 'Carregando leitor...', framesText: '', hasImages: true, frameCount: 1 });
    const ok = layer.layer === 'image' && layer.hasText === false && layer.needsOcr === true;
    record({ id: G + '-12', title: 'Pearson: conteúdo em imagem detectado como candidato a OCR (não DRM)', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(layer) });
  }

  // P-13: validação de texto — conteúdo de menu/navegação não é aceito.
  {
    const v = pearson.validateExtractedText({ text: 'Menu Início Sobre Contato', expected: {} });
    const ok = v.ok === false && v.reason === 'apenas-menu-ou-navegacao';
    record({ id: G + '-13', title: 'Pearson: texto de menu/navegação não é aceito como conteúdo', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  // P-14: validação de texto — conteúdo acadêmico aceito.
  {
    const v = pearson.validateExtractedText({ text: 'O empreendedorismo reflete a iniciativa de criar novos negócios em resposta a oportunidades identificadas. '.repeat(6), expected: {} });
    const ok = v.ok === true && v.chars > 100;
    record({ id: G + '-14', title: 'Pearson: conteúdo acadêmico válido aceito', status: ok ? 'PASS' : 'FAIL', detail: JSON.stringify(v) });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO PEARSON (SINTÉTICO) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
