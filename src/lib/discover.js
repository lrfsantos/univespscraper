const { chromium } = require('playwright');

// Descobre cursos ativos e estrutura de semanas usando um navegador real
// (as páginas do AVA carregam a lista de cursos via JavaScript).

const CUSTOMPAGE = 'https://ava.univesp.br/admin/tool/custompage/view.php?id=3';

// Cria um contexto de navegador com os cookies da sessão (em memória)
async function createContext(cookies) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  if (cookies && cookies.length) await context.addCookies(cookies);
  return { browser, context };
}

// Descobre os cursos ativos (renderizando a página "Meus cursos")
async function discoverCourses({ cookies }) {
  const { browser, context } = await createContext(cookies);
  try {
    const page = await context.newPage();
    await page.goto(CUSTOMPAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const links = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="course/view.php"]').forEach((a) => {
        const href = a.href;
        const text = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text || seen.has(href)) return;
        seen.add(href);
        const id = (href.match(/id=(\d+)/) || [])[1];
        out.push({ url: href, id, title: text });
      });
      return out;
    });
    return { courses: links };
  } finally {
    await browser.close();
  }
}

// Lê a estrutura de semanas de um curso (renderizando a página do curso)
async function discoverWeeks({ cookies, course }) {
  const { browser, context } = await createContext(cookies);
  try {
    const page = await context.newPage();
    await page.goto(course.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const data = await page.evaluate(() => {
      const links = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/mod/"], a[href*="/course/section.php"]').forEach((a) => {
        const t = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
        const h = a.href;
        if (!t || seen.has(h)) return;
        seen.add(h);
        links.push({ t, h });
      });
      return links;
    });

    const weeks = {};
    let current = 'Geral';
    for (const l of data) {
      if (/^Semana\s+\d+/i.test(l.t)) {
        const n = parseInt((l.t.match(/\d+/) || [])[0]);
        current = n;
        if (!weeks[n]) weeks[n] = [];
        continue;
      }
      if (l.t === 'Geral' || l.t === 'Revisão') { current = l.t; continue; }
      if (typeof current === 'number' && /^S\d+\s*-/i.test(l.t)) {
        weeks[current].push({ title: l.t, url: l.h });
      } else if (current === 'Geral') {
        if (!weeks['Geral']) weeks['Geral'] = [];
        weeks['Geral'].push({ title: l.t, url: l.h });
      }
    }
    return { weeks };
  } finally {
    await browser.close();
  }
}

module.exports = { discoverCourses, discoverWeeks };
