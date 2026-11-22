// Frente 1 — seguir a página intermediária mod/url do AVA até a aba/documento
// de destino. Recebe app/win (Playwright) por parâmetro para permitir testes
// simulados sem AVA. Nunca navega diretamente para uma URL: clica no link real.
const { avaliarDestinoNavegacao, AVA_URL_VIEW_RE } = require('./url-capture');

async function seguirDestinoUrl(app, win, courseUrl) {
  const before = typeof win.url === 'function' ? win.url() : '';
  const baseline = new Set(app.windows());
  const popupPromise = win.waitForEvent('popup', { timeout: 2500 }).catch(() => null);
  const clicou = await win.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find((x) =>
      /Clique em .+ para abrir o recurso/i.test(String(x.innerText || '')) &&
      !/courseindex/i.test(String(x.className || '')));
    if (!a) return false;
    a.scrollIntoView();
    a.click();
    return true;
  }).catch(() => false);
  if (!clicou) return null;
  const popup = await popupPromise;
  if (popup) return popup;
  await win.waitForTimeout(700);
  const janelas = app.windows();
  const abertos = janelas.filter((w) => !baseline.has(w));
  const candidatos = abertos.length ? abertos : [win]; // navegação na mesma janela
  const info = [];
  for (const w of candidatos) {
    let u = '';
    try { u = typeof w.url === 'function' ? w.url() : ''; } catch {}
    info.push({ w, u: String(u || '') });
  }
  const decisao = avaliarDestinoNavegacao({
    origemUrl: courseUrl,
    janelaUrl: typeof win.url === 'function' ? win.url() : '',
    janelas: info.map((x) => ({ url: x.u })),
  });
  if (decisao.acao === 'usar-janela') return info[decisao.indice].w;
  if (decisao.acao === 'usar-atual' && typeof win.url === 'function' && win.url() !== before) return win;
  return null;
}

module.exports = { seguirDestinoUrl };
