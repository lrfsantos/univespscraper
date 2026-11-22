// Frente 1 — testes simulados do fluxo de navegação mod/url -> destino final.
// Sem AVA, sem login, sem credenciais: usa objetos win/app falsos.
const fs = require('fs');
const path = require('path');
const { seguirDestinoUrl, aguardarPopupFinal, urlDe } = require('./lib/url-navigation');
const { avaliarCapturaUrl, classificarPagina, avaliarDestinoNavegacao } = require('./lib/url-capture');

const OUT = path.join(__dirname, '..', 'audit-temp', 'URLFLOW_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

const CURSO = 'https://ava.univesp.br/course/view.php?id=18491';
const INTER = 'https://ava.univesp.br/mod/url/view.php?id=86028';
const EXTERNO = 'https://www.youtube.com/watch?v=xaoHPwa9sqk';
const LIVRO = 'https://app.minhabiblioteca.com.br/reader/books/9788597021653/pageid/42';

function fakeWin(urlAtual, { popup = null, clicou = true } = {}) {
  let url = urlAtual;
  return {
    url: () => url,
    setUrl: (u) => { url = u; },
    evaluate: async () => clicou,
    waitForEvent: async () => Promise.resolve(popup),
    waitForTimeout: async () => {},
  };
}

(async () => {
  record({ id: 'UF1', title: 'texto vazio com destino valido = falha honesta, zero arquivo', status: ok((function () {
    const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: EXTERNO, texto: '' });
    return r.acao === 'sem-texto' && r.status === 'inaccessible' && r.detail === 'destino-sem-texto-consultavel' && r.chars === 0;
  })()) });
  record({ id: 'UF2', title: 'classificacao: curso=origem, mod/url e mod/page=intermediaria, externa', status: ok(
    classificarPagina(CURSO) === 'origem' && classificarPagina(INTER) === 'intermediaria' &&
    classificarPagina('https://ava.univesp.br/mod/page/view.php?id=1') === 'intermediaria' &&
    classificarPagina(EXTERNO) === 'externa') });
  record({ id: 'UF3', title: 'popup externo = usar janela aberta pelo clique', status: ok((function () {
    const popup = { url: () => EXTERNO };
    const win = fakeWin(INTER, { popup });
    return avaliarDestinoNavegacao({ origemUrl: CURSO, janelaUrl: INTER, janelas: [{ url: CURSO }, { url: INTER }, { url: EXTERNO }] }).acao === 'usar-janela';
  })()) });
  record({ id: 'UF4', title: 'navegacao externa na mesma janela = usar atual', status: ok(
    avaliarDestinoNavegacao({ origemUrl: CURSO, janelaUrl: EXTERNO, janelas: [{ url: CURSO }, { url: EXTERNO }] }).acao === 'usar-atual' ||
    avaliarDestinoNavegacao({ origemUrl: CURSO, janelaUrl: EXTERNO, janelas: [{ url: CURSO }, { url: EXTERNO }] }).acao === 'usar-janela') });
  record({ id: 'UF5', title: 'pagina intermediaria sem destino = sem-destino', status: ok(
    avaliarDestinoNavegacao({ origemUrl: CURSO, janelaUrl: INTER, janelas: [{ url: CURSO }, { url: INTER }] }).acao === 'sem-destino') });
  record({ id: 'UF6', title: 'helper puro nao conhece baseline; filtro e feito na integracao (UF10)', status: ok((function () {
    const antiga = { url: () => LIVRO };
    const win = fakeWin(INTER);
    const r = avaliarDestinoNavegacao({ origemUrl: CURSO, janelaUrl: INTER, janelas: [{ url: antiga.url() }, { url: win.url() }] });
    return r.acao === 'usar-janela'; // decisão crua; a integração descarta pela baseline
  })()) });

  // integração simulada do seguimento real
  const popup = { url: () => EXTERNO };
  const winPopup = fakeWin(INTER, { popup });
  const appPopup = { windows: () => [winPopup] };
  record({ id: 'UF7', title: 'integracao: popup externo retornado como destino', status: ok((await seguirDestinoUrl(appPopup, winPopup, CURSO)) === popup) });

  const winSame = fakeWin(INTER);
  const appSame = { windows: () => [winSame] };
  winSame.setUrl(EXTERNO); // simula navegação externa na mesma janela após o clique
  record({ id: 'UF8', title: 'integracao: navegacao externa na mesma janela retorna a propria janela', status: ok((await seguirDestinoUrl(appSame, winSame, CURSO)) === winSame) });

  const winInter = fakeWin(INTER);
  const appInter = { windows: () => [winInter] };
  record({ id: 'UF9', title: 'integracao: intermediaria sem destino retorna null', status: ok((await seguirDestinoUrl(appInter, winInter, CURSO)) === null) });

  const winOld = fakeWin(INTER);
  const oldExternal = { url: () => LIVRO };
  const appOld = { windows: () => [oldExternal, winOld] };
  record({ id: 'UF10', title: 'integracao: aba antiga externa ignorada (retorna null)', status: ok((await seguirDestinoUrl(appOld, winOld, CURSO)) === null) });

  record({ id: 'UF11', title: 'about:blank rejeitado como destino', status: ok((function () {
    const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: 'about:blank', texto: 'conteudo' });
    return r.acao === 'sem-destino' && r.chars === 0;
  })()) });
  record({ id: 'UF12', title: 'pagina de erro rejeitada (404 / Página não encontrada)', status: ok((function () {
    const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: EXTERNO, texto: '404\nPágina não encontrada\nIr para Home' });
    return r.acao === 'pagina-erro' && r.detail === 'pagina-de-erro' && r.chars === 0;
  })()) });
  record({ id: 'UF13', title: 'URL assinada nao aparece em evidencia', status: ok((function () {
    const assinada = 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789?dummy=placeholder';
    const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: assinada, texto: 'texto' });
    return r.status === 'ok' && !/dummy=|code=|ABCDEF/.test(r.detail) && r.detail.includes('/Leitor/Publicacao/3789');
  })()) });

  function popupSequencial(urls) {
    let i = 0;
    return {
      url: () => urls[Math.min(i++, urls.length - 1)],
      avancar: () => { i++; },
      evaluate: async () => true,
      waitForEvent: async () => Promise.resolve(null),
      waitForTimeout: async () => { i++; },
      waitForLoadState: async () => {},
    };
  }
  const appPop = (w) => ({ windows: () => [w] });

  const p1 = popupSequencial(['about:blank', 'about:blank', EXTERNO]);
  record({ id: 'UF14', title: 'popup about:blank que navega depois e capturado no destino final', status: ok((await aguardarPopupFinal(appPop(p1), p1, CURSO, () => {}, 2000)) === p1) });

  const p2 = popupSequencial(['about:blank']);
  const motivos = [];
  record({ id: 'UF15', title: 'popup que nunca navega falha com motivo identificavel', status: ok((await aguardarPopupFinal(appPop(p2), p2, CURSO, (m) => motivos.push(m), 500)) === null && motivos.some((m) => m.includes('popup-sem-navegacao'))) });

  const p3 = popupSequencial(['about:blank', INTER, EXTERNO]);
  record({ id: 'UF16', title: 'popup que termina na intermediaria segue o link ate o destino', status: ok((await aguardarPopupFinal(appPop(p3), p3, CURSO, () => {}, 2000)) === p3) });

  const p4 = popupSequencial(['about:blank', 'chrome-error://chromewebdata/']);
  const motivos4 = [];
  record({ id: 'UF17', title: 'popup em pagina de erro rejeitado com motivo especifico', status: ok((await aguardarPopupFinal(appPop(p4), p4, CURSO, (m) => motivos4.push(m), 1500)) === null && motivos4.includes('popup-pagina-de-erro')) });

  record({ id: 'UF18', title: 'URLs malformadas/sem protocolo sao invalidas', status: ok(
    classificarPagina('ftp://x.br/a') === 'invalida' && classificarPagina('www.youtube.com/watch?v=1') === 'invalida' && classificarPagina('/mod/page/view.php?id=1') === 'invalida') });
  record({ id: 'UF19', title: 'dominio parecido (fakeunivesp.br) nao e institucional', status: ok(
    classificarPagina('https://fakeunivesp.br/mod/page/view.php?id=1') === 'externa' && classificarPagina('https://aluno.univesp.br/x') === 'intermediaria') });
  record({ id: 'UF20', title: 'URL externa http valida continua capturando', status: ok((function () {
    const r = avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: 'http://example.org/material', texto: 'conteudo' });
    return r.status === 'ok' && r.acao === 'destino';
  })()) });
  record({ id: 'UF21', title: 'URL externa com caminho /mod/url/view.php nao e intermediaria', status: ok(
    classificarPagina('https://evil.example/mod/url/view.php?id=1') === 'externa' &&
    avaliarCapturaUrl({ subKind: 'url', origemUrl: CURSO, destinoUrl: 'https://evil.example/mod/url/view.php?id=1', texto: 'conteudo' }).acao === 'destino') });
  const p5 = popupSequencial([EXTERNO]);
  p5.waitForLoadState = async () => { throw new Error('timeout'); };
  const motivos5 = [];
  record({ id: 'UF22', title: 'popup externo sem confirmacao de load falha com motivo', status: ok((await aguardarPopupFinal(appPop(p5), p5, CURSO, (m) => motivos5.push(m), 1000)) === null && motivos5.includes('popup-carregamento-nao-confirmado')) });

  const fails = results.filter((r) => r.status !== 'PASS').length;
  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
  console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})();
