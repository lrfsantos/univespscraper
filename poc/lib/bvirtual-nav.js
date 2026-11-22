// Frente 4 — navegação bvirtual: detectar tela de escolha de formato e prompt
// do leitor Beta pelo CONTEÚDO, clicar condicionalmente e confirmar navegação.
// Nunca executa sequência fixa nem transforma tela/prompt em conteúdo.
const { classificarPagina } = require('./url-capture');
const ERRO_RE = /404\b|página não encontrada|page not found|acesso negado|forbidden|unauthorized|not authorized|login|erro ao carregar/i;
const TELA_ESCOLHA_RE = /escolha (o )?formato desejado|choose your desired format|ler em epub|read in epub/i;
const PROMPT_BETA_RE = /novo leitor pdf\s*beta|reader.*beta|try now.*beta|continue in current reader|continue no leitor atual/i;
const PAGEID_RE = /(?:[?&](?:PaginaPdf|Pageid)=|\/pageid\/|\/pdf\/)(\d+)/i;

function detectarTelaEscolhaFormato(texto) { return TELA_ESCOLHA_RE.test(String(texto || '')); }
function detectarPromptBeta(texto) { return PROMPT_BETA_RE.test(String(texto || '')); }
function extrairPageid(url) {
  const m = String(url || '').match(PAGEID_RE);
  return m ? Number(m[1]) : null;
}

function decidirAcao({ texto, urlAntes, urlDepois } = {}) {
  const t = String(texto || '');
  if (detectarPromptBeta(t)) return { acao: 'escolher-leitor-classico', clicar: 'classico' };
  if (detectarTelaEscolhaFormato(t)) return { acao: 'clicar-pdf', clicar: 'pdf' };
  return { acao: 'nenhuma', clicar: null, motivo: 'nenhuma-tela-condicional' };
}

// Confirmação: a URL deve mudar ou o texto do leitor deve deixar de conter
// a tela/prompt. Sem confirmação, falha honesta — nunca conteúdo extraído.
function avaliarNavegacao({ acao, urlAntes, urlDepois, textoDepois, leituraOk = true } = {}) {
  if (!acao || acao === 'nenhuma') return { confirmado: false, status: null, motivo: 'nenhuma-acao' };
  if (!leituraOk) return { confirmado: false, status: 'inaccessible', motivo: 'leitura-dom-falhou' };
  const classe = classificarPagina(urlDepois);
  if (classe === 'invalida' || ERRO_RE.test(String(textoDepois || ''))) {
    return { confirmado: false, status: 'inaccessible', motivo: 'pagina-de-erro-ou-autenticacao' };
  }
  if (classe === 'intermediaria' || classe === 'origem') {
    return { confirmado: false, status: 'inaccessible', motivo: 'destino-intermediario' };
  }
  const mudouUrl = !!urlDepois && urlDepois !== urlAntes;
  const saiuDaTela = !detectarTelaEscolhaFormato(textoDepois) && !detectarPromptBeta(textoDepois);
  if (!mudouUrl && !saiuDaTela) return { confirmado: false, status: 'inaccessible', motivo: 'navegacao-nao-confirmada' };
  return { confirmado: true, status: null, motivo: null };
}

// Executa no win do Playwright: lê o texto, decide e clica APENAS se a tela
// correspondente estiver presente. Retorna decisão + estado para o runner.
async function seguirBvirtual(win) {
  const urlAntes = typeof win.url === 'function' ? win.url() : '';
  let texto;
  try { texto = String(await win.evaluate(() => document.body.innerText)); }
  catch {
    return { acao: 'leitura-estado', clicar: null, urlAntes, urlDepois: urlAntes, confirmado: false, status: 'inaccessible', motivo: 'leitura-dom-falhou' };
  }
  const decisao = decidirAcao({ texto, urlAntes });
  if (decisao.acao === 'nenhuma') return Object.assign({ urlAntes, urlDepois: urlAntes, textoDepois: texto }, decisao, { confirmado: false, motivo: 'nenhuma-tela-condicional' });
  const clicou = await win.evaluate((alvo) => {
    const regex = alvo === 'pdf'
      ? /ler em pdf|read in pdf/i
      : /continue in current reader|continue no leitor atual|leitor classico|current reader/i;
    const el = [...document.querySelectorAll('a,button')].find((x) => regex.test(String(x.innerText || x.textContent || '')));
    if (!el) return false;
    el.click();
    return true;
  }, decisao.clicar).catch(() => false);
  if (!clicou) return Object.assign({ urlAntes, urlDepois: urlAntes, textoDepois: texto }, decisao, { confirmado: false, status: 'inaccessible', motivo: 'alvo-de-clique-ausente' });
  await win.waitForTimeout(700).catch(() => {});
  const urlDepois = typeof win.url === 'function' ? win.url() : '';
  let textoDepois = '';
  let leituraOk = true;
  try { textoDepois = String(await win.evaluate(() => document.body.innerText)); }
  catch { leituraOk = false; }
  return Object.assign({ urlAntes, urlDepois, textoDepois, pageid: extrairPageid(urlDepois) },
    decisao, avaliarNavegacao({ acao: decisao.acao, urlAntes, urlDepois, textoDepois, leituraOk }));
}

module.exports = {
  detectarTelaEscolhaFormato, detectarPromptBeta, extrairPageid,
  decidirAcao, avaliarNavegacao, seguirBvirtual,
  PAGEIDS_REFERENCIA: [22, 134, 199, 217, 107],
};
