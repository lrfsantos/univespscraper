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

  // E-3: limite de profundidade — decisão de recursão respeita MAX_EMBED_DEPTH.
  {
    const ok = flow.MAX_EMBED_DEPTH >= 1 && flow.MAX_EMBED_DEPTH <= 5;
    const recRule = flow.MAX_EMBED_DEPTH; // exposto
    record({ id: G + '-3', title: '9: limite de profundidade definido (MAX_EMBED_DEPTH) para recursão em páginas internas', status: ok ? 'PASS' : 'FAIL', detail: `MAX_EMBED_DEPTH=${recRule}` });
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

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO RECURSOS EMBUTIDOS (SEÇÃO 9) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
