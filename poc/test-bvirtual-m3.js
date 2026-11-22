// Frente 4 — navegação bvirtual condicional (sem AVA, sem credenciais).
const fs = require('fs');
const path = require('path');
const bv = require('./lib/bvirtual-nav');

const OUT = path.join(__dirname, '..', 'audit-temp', 'BVNAV_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');

const TELA_PT = 'Este Livro pode ser lido em dois formatos. Escolha o formato desejado: Ler em PDF Ler em EPUB';
const TELA_EN = 'This book can be read in two formats. Choose your desired format: Read in PDF Read in EPUB';
const BETA = 'Be the first to explore our new PDF reader! Try Now BETA. Continue in Current Reader';
const LEITOR = 'Reader - Theories of Administration - Page 17';

record({ id: 'B1', title: 'tela de escolha detectada por conteudo (PT e EN)', status: ok(
  bv.detectarTelaEscolhaFormato(TELA_PT) && bv.detectarTelaEscolhaFormato(TELA_EN)) });
record({ id: 'B2', title: 'prompt beta detectado por conteudo', status: ok(bv.detectarPromptBeta(BETA)) });
record({ id: 'B3', title: 'leitor normal nao dispara acao condicional', status: ok(
  bv.decidirAcao({ texto: LEITOR }).acao === 'nenhuma') });
record({ id: 'B4', title: 'acao condicional: PDF na tela de escolha, classico no prompt beta', status: ok(
  bv.decidirAcao({ texto: TELA_PT }).clicar === 'pdf' && bv.decidirAcao({ texto: BETA }).clicar === 'classico') });
record({ id: 'B5', title: 'pageids de referencia 22,134,199,217,107 extraidos', status: ok(
  [22, 134, 199, 217, 107].every((n) => bv.extrairPageid('https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789?PaginaPdf=' + n + '&PaginaEpub=4') === n) &&
  bv.extrairPageid('https://app.minhabiblioteca.com.br/reader/books/x/pageid/148') === 148) });
record({ id: 'B6', title: 'navegacao confirmada por mudanca de URL', status: ok(
  bv.avaliarNavegacao({ acao: 'clicar-pdf', urlAntes: 'https://a/format', urlDepois: 'https://a/reader/3789/pdf/22', textoDepois: LEITOR }).confirmado === true) });
record({ id: 'B7', title: 'sem mudanca e sem saida da tela = navegacao-nao-confirmada', status: ok((function () {
  const r = bv.avaliarNavegacao({ acao: 'clicar-pdf', urlAntes: 'https://a/format', urlDepois: 'https://a/format', textoDepois: TELA_PT });
  return r.confirmado === false && r.status === 'inaccessible' && r.motivo === 'navegacao-nao-confirmada';
})()) });

function fakeWin({ textoInicial, clicou = true, textoDepois = LEITOR, urlDepois = 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789/pdf/22?code=x', falharLeitura = false }) {
  let url = 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789?PaginaPdf=22';
  let texto = textoInicial;
  let mudou = false;
  return {
    url: () => url,
    evaluate: async (fn, arg) => {
      const s = String(fn);
      if (s.includes('document.body.innerText')) { if (falharLeitura) throw new Error('dom-indisponivel'); return texto; }
      if (s.includes('querySelectorAll')) {
        if (!clicou) return false;
        texto = textoDepois;
        url = urlDepois;
        mudou = true;
        return true;
      }
      return null;
    },
    waitForTimeout: async () => {},
    get mudou() { return mudou; },
  };
}

(async () => {
  const w1 = fakeWin({ textoInicial: TELA_PT });
  const r1 = await bv.seguirBvirtual(w1);
  record({ id: 'B8', title: 'integracao: tela de escolha -> clique PDF -> URL final com pageid', status: ok(
    r1.acao === 'clicar-pdf' && r1.confirmado === true && r1.pageid === 22 && w1.mudou) });

  const w2 = fakeWin({ textoInicial: BETA, urlDepois: 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789/pdf/22', textoDepois: LEITOR });
  const r2 = await bv.seguirBvirtual(w2);
  record({ id: 'B9', title: 'integracao: prompt beta -> leitor classico, sem sequencia fixa', status: ok(
    r2.acao === 'escolher-leitor-classico' && r2.confirmado === true && w2.mudou) });

  const w3 = fakeWin({ textoInicial: LEITOR });
  const r3 = await bv.seguirBvirtual(w3);
  record({ id: 'B10', title: 'integracao: nenhuma tela -> nenhum clique', status: ok(
    r3.acao === 'nenhuma' && r3.confirmado === false && !w3.mudou) });

  const w4 = fakeWin({ textoInicial: TELA_PT, clicou: false });
  const r4 = await bv.seguirBvirtual(w4);
  record({ id: 'B11', title: 'integracao: alvo de clique ausente = inaccessible', status: ok(
    r4.status === 'inaccessible' && r4.motivo === 'alvo-de-clique-ausente' && !w4.mudou) });

  const w5 = fakeWin({ textoInicial: TELA_PT, urlDepois: 'https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789?PaginaPdf=22', textoDepois: TELA_PT });
  const r5 = await bv.seguirBvirtual(w5);
  record({ id: 'B12', title: 'integracao: clique sem navegacao confirmada = inaccessible', status: ok(
    r5.status === 'inaccessible' && r5.motivo === 'navegacao-nao-confirmada') });

  record({ id: 'B13', title: 'cinco pageids preservados nos tres formatos de URL', status: ok(
    [22, 134, 199, 217, 107].every((n) =>
      bv.extrairPageid('https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789?PaginaPdf=' + n) === n &&
      bv.extrairPageid('https://app.minhabiblioteca.com.br/reader/books/x/pageid/' + n) === n &&
      bv.extrairPageid('https://plataforma.bvirtual.com.br/Leitor/Publicacao/3789/pdf/' + n) === n)) });

  const w6 = fakeWin({ textoInicial: TELA_PT, falharLeitura: true });
  const r6 = await bv.seguirBvirtual(w6);
  record({ id: 'B14', title: 'leitura do DOM falha = inconclusiva, nunca confirmacao', status: ok(
    r6.status === 'inaccessible' && r6.motivo === 'leitura-dom-falhou' && !w6.mudou) });

  const r7 = bv.avaliarNavegacao({ acao: 'clicar-pdf', urlAntes: 'https://a/format', urlDepois: 'about:blank', textoDepois: '404 Página não encontrada' });
  record({ id: 'B15', title: 'URL de erro/autenticacao nao confirma navegacao', status: ok(
    r7.confirmado === false && r7.motivo === 'pagina-de-erro-ou-autenticacao') });

  const books = require('../src/extract/books');
  record({ id: 'B16', title: 'leitor ja aberto: extractBook nao faz goto inicial nem relaunch', status: ok(
    books.deveFazerGotoInicial({ jaAberto: true }) === false &&
    books.deveFazerRelaunch({ jaAberto: true }) === false &&
    books.deveFazerGotoInicial({}) === true && books.deveFazerRelaunch({}) === true) });

  const fails = results.filter((r) => r.status !== 'PASS').length;
  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
  console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})();
