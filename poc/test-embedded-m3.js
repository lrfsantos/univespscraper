const fs = require('fs');
const path = require('path');
const flow = require('../electron/flow');
const { classifyResource } = require('../electron/discovery');

// Testes da SEÇÃO 9 (P1) — descoberta de RECURSOS EMBUTIDOS no fluxo real (função
// de produção discoverEmbeddedResources + identidade/dedup): deduplicação por URL e
// por IDENTIDADE de vídeo (watch/embed/shorts/youtu.be são o MESMO vídeo), prevenção
// de ciclos com `seen` compartilhado, limite de profundidade, origem (sourcePage) e
// iframe DESCONHECIDO nunca vira vídeo/página HTML automática.

const OUT = path.join(__dirname, '..', 'audit-temp', 'EMBEDDED_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

(async () => {
  const G = 'E';

  // E-1: dedup por IDENTIDADE de vídeo — watch?v=, /embed/, youtu.be e /shorts/ são o MESMO vídeo.
  {
    const found = flow.discoverEmbeddedResources({
      links: [
        { text: 'A', url: 'https://www.youtube.com/watch?v=AAA11111111' },
        { text: 'B', url: 'https://youtu.be/AAA11111111' },
      ],
      iframes: ['https://www.youtube.com/embed/AAA11111111', 'https://www.youtube.com/shorts/AAA11111111'],
      sourceUrl: 'https://ava.univesp.br/mod/page/view.php?id=9',
      seen: new Set(),
    });
    const ok = found.length === 1 && found[0].classification.kind === 'video';
    record({ id: G + '-1', title: '9: mesma videoaula em watch/embed/youtu.be/shorts extraída UMA vez (identidade de vídeo)', status: ok ? 'PASS' : 'FAIL', detail: `recursos=${found.length} keys=${found.map((r) => flow.resourceIdentityKey(r.url)).join(',')}` });
  }

  // E-2: ciclos prevenidos — URL já presente no `seen` compartilhado não reentra.
  {
    const seen = new Set(['url:https://ava.univesp.br/mod/page/view.php?id=77']);
    const found = flow.discoverEmbeddedResources({
      links: [{ text: 'Sub', url: 'https://ava.univesp.br/mod/page/view.php?id=77' }],
      iframes: ['https://www.youtube.com/embed/NNN7777777'],
      sourceUrl: 'https://ava.univesp.br/mod/page/view.php?id=9',
      seen,
    });
    const ok = found.length === 1 && found[0].classification.kind === 'video' && !found.some((r) => r.url.includes('id=77'));
    record({ id: G + '-2', title: '9: ciclo evitado — página já vista no `seen` compartilhado não reentra na descoberta', status: ok ? 'PASS' : 'FAIL', detail: `recursos=${found.length}` });
  }

  // E-3: a decisão de recursão usa o depth recebido, e não reinicia em zero.
  {
    const root = flow.canTraverseEmbeddedDepth(0);
    const max = flow.canTraverseEmbeddedDepth(flow.MAX_EMBED_DEPTH);
    const beyond = flow.canTraverseEmbeddedDepth(flow.MAX_EMBED_DEPTH + 1);
    const discovered = flow.discoverEmbeddedResources({
      links: [{ text: 'Sub', url: 'https://ava.univesp.br/mod/page/view.php?id=78' }],
      iframes: [],
      sourceUrl: 'parent',
      depth: 2,
      seen: new Set(),
    });
    const ok = root && max && !beyond && discovered[0] && discovered[0].depth === 2;
    record({ id: G + '-3', title: '9: profundidade é propagada e bloqueia níveis acima de MAX_EMBED_DEPTH', status: ok ? 'PASS' : 'FAIL', detail: `max=${flow.MAX_EMBED_DEPTH} root=${root} maxAllowed=${max} beyond=${beyond} recordedDepth=${discovered[0] && discovered[0].depth}` });
  }

  // E-4: iframe DESCONHECIDO não vira vídeo nem página HTML extraída (fica de fora).
  {
    const clsUnknown = classifyResource({ url: 'https://cdn.exemplo.com/embeded/app.js', type: 'iframe' });
    const clsVideo = classifyResource({ url: 'https://player.vimeo.com/video/123', type: 'iframe' });
    const found = flow.discoverEmbeddedResources({
      links: [],
      iframes: ['https://cdn.exemplo.com/embeded/app.js'],
      sourceUrl: 'https://ava.univesp.br/mod/page/view.php?id=9',
      seen: new Set(),
    });
    // Tipo: documento incorporado (não vídeo) para iframe arbitrário; NÃO é vídeo.
    // Descoberta: iframe arbitrário sem evidência de módulo acadêmico do AVA é
    // EXCLUÍDO dos recursos embutidos (não vira página HTML integral automática).
    const ok = clsUnknown.kind !== 'video' && clsUnknown.subKind === 'iframe' &&
      clsVideo.kind === 'video' && found.length === 0;
    record({ id: G + '-4', title: '9: iframe arbitrário NÃO vira vídeo nem página extraída; só vídeo/PDF/livro/módulo AVA com evidência', status: ok ? 'PASS' : 'FAIL', detail: `iframeArbitrario=${clsUnknown.kind}/${clsUnknown.subKind} vimeo=${clsVideo.kind} descobertos=${found.length}` });
  }

  // E-5: múltiplos iframes/links distintos — sem duplicar nem perder recursos legítimos.
  {
    const found = flow.discoverEmbeddedResources({
      links: [
        { text: 'Slides', url: 'https://assets.univesp.br/ADM270/s1_slides.pdf' },
        { text: 'Vídeo A', url: 'https://www.youtube.com/watch?v=AAA11111111' },
      ],
      iframes: [
        'https://www.youtube.com/embed/BBB22222222',
        'https://assets.univesp.br/ADM270/s1_material.pdf',
        'https://ava.univesp.br/mod/lti/launch.php?id=102',
      ],
      sourceUrl: 'https://ava.univesp.br/mod/page/view.php?id=9',
      seen: new Set(),
    });
    const kinds = found.map((r) => r.classification.kind);
    const ok = found.length === 5 && kinds.filter((k) => k === 'video').length === 2 && kinds.filter((k) => k === 'pdf').length === 2 && kinds.filter((k) => k === 'book').length === 1;
    record({ id: G + '-5', title: '9: múltiplos recursos distintos (2 vídeos + 2 PDFs + 1 livro) sem duplicar nem perder', status: ok ? 'PASS' : 'FAIL', detail: `kinds=${kinds.join(',')}` });
  }

  // E-6: página interna mantém origem (sourcePage) e não vira "página HTML integral" à toa.
  {
    const found = flow.discoverEmbeddedResources({
      links: [{ text: 'Sub', url: 'https://ava.univesp.br/mod/page/view.php?id=77' }],
      iframes: [],
      sourceUrl: 'https://ava.univesp.br/mod/page/view.php?id=9',
      seen: new Set(),
    });
    const ok = found.length === 1 && found[0].classification.kind === 'page' && found[0].sourcePage === 'https://ava.univesp.br/mod/page/view.php?id=9';
    record({ id: G + '-6', title: '9: página interna (mod/page) preservada com origem sourcePage', status: ok ? 'PASS' : 'FAIL', detail: `kind=${found[0] && found[0].classification.kind} source=${found[0] && found[0].sourcePage}` });
  }

  // E-7: dedup global — `seen` compartilhado entre duas chamadas (mesma página vista 2x) não duplica.
  {
    const seen = new Set();
    const a = flow.discoverEmbeddedResources({ links: [{ text: 'V', url: 'https://www.youtube.com/watch?v=AAA11111111' }], iframes: [], sourceUrl: 'p1', seen });
    const b = flow.discoverEmbeddedResources({ links: [{ text: 'V2', url: 'https://youtu.be/AAA11111111' }], iframes: [], sourceUrl: 'p2', seen });
    const ok = a.length === 1 && b.length === 0 && seen.size === 1;
    record({ id: G + '-7', title: '9: `seen` compartilhado entre páginas evita re-extração global do mesmo recurso', status: ok ? 'PASS' : 'FAIL', detail: `pagina1=${a.length} pagina2=${b.length} seen=${seen.size}` });
  }

  // E-8: URLs de vídeo diferentes compartilham o mesmo basename "watch".
  // IDs gerados em chamadas diferentes precisam continuar únicos, pois os arquivos
  // são gravados na mesma pasta semanal e não podem sobrescrever transcrições.
  {
    const seen = new Set();
    const a = flow.discoverEmbeddedResources({
      links: [{ text: 'Vídeo A', url: 'https://www.youtube.com/watch?v=AAA11111111' }],
      iframes: [], sourceUrl: 'page-a', seen,
    });
    const b = flow.discoverEmbeddedResources({
      links: [{ text: 'Vídeo B', url: 'https://www.youtube.com/watch?v=BBB22222222' }],
      iframes: [], sourceUrl: 'page-b', seen,
    });
    const idA = a[0] && a[0].id;
    const idB = b[0] && b[0].id;
    const safe = (id) => !!id && !id.includes('/') && !id.includes('\\\\') && !/[<>:"*?|]/.test(id);
    const ok = a.length === 1 && b.length === 1 && idA !== idB && safe(idA) && safe(idB);
    record({ id: G + '-8', title: '9: recursos com basename repetido geram nomes únicos e seguros (sem sobrescrever arquivos)', status: ok ? 'PASS' : 'FAIL', detail: `idA=${idA} idB=${idB}` });
  }

  // E-9: o escopo do produto também vale para páginas incorporadas.
  {
    const found = flow.discoverEmbeddedResources({
      links: [
        { text: 'Fórum temático', url: 'https://ava.univesp.br/mod/page/view.php?id=901' },
        { text: 'Live com facilitador', url: 'https://ava.univesp.br/mod/page/view.php?id=902' },
        { text: 'Material complementar', url: 'https://ava.univesp.br/mod/page/view.php?id=903' },
      ],
      iframes: [],
      sourceUrl: 'https://ava.univesp.br/mod/page/view.php?id=900',
      seen: new Set(),
    });
    const ok = found.length === 1 && found[0].url.endsWith('id=903');
    record({ id: G + '-9', title: '9: páginas incorporadas respeitam o escopo e excluem fóruns/lives', status: ok ? 'PASS' : 'FAIL', detail: `capturados=${found.map((r) => r.url).join(',')}` });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO RECURSOS EMBUTIDOS (SEÇÃO 9) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
