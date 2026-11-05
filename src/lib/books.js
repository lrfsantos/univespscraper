const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

// Extração de capítulos/páginas recomendados dos livros da Biblioteca Virtual
// (Minha Biblioteca / bvirtual). Suporta dois formatos de leitor:
//   - pageid: navegação por páginas (ex.: Schaefer, Hisrich, Dornelas)
//   - epub: leitor com sumário clicável (ex.: Lakatos, Chiavenato)
// Os demais formatos (leitor próprio bvirtual, PDF em canvas) não expõem texto
// e caem na atribuição.

// ---- Helpers de navegação pageid ----
async function getCurrentPageNum(page) {
  const m = await page.evaluate(() => {
    const t = document.body.innerText;
    const mm = t.match(/P[áa]gina\s+(\d+)\s*\/\s*(\d+)/) || t.match(/P[áa]gina\s+(\d+)/);
    return mm ? mm[1] : null;
  });
  return m ? parseInt(m) : null;
}

async function extractVisiblePages(page) {
  const frames = page.frames();
  const contentFrames = frames.filter((f) => /\/pages\/\d+\/content/.test(f.url()));
  let all = '';
  const seen = new Set();
  for (const f of contentFrames) {
    const idm = f.url().match(/pages\/(\d+)\/content/);
    const id = idm && idm[1];
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    try {
      const text = await f.evaluate(() => document.body.innerText);
      all += (id ? `\n[PÁGINA ${id}]\n` : '') + text + '\n';
    } catch { /* ignore */ }
  }
  return all;
}

async function clickNext(page) {
  await page.locator('button[aria-label="Seguinte"]').first().click();
  await page.waitForTimeout(3500);
}

// Extrai intervalo de páginas (pageid) navegando pela tela
async function extractPageRange(context, launchUrl, startPage, endPage) {
  const page = await context.newPage();
  const out = [];
  try {
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(9000);
    // vai para a página inicial (input "Ir para Página")
    try {
      const input = page.locator('input[type="text"]').last();
      await input.fill(String(startPage));
      await input.press('Enter');
      await page.waitForTimeout(4000);
    } catch { /* se não houver input, continua na página atual */ }

    out.push({ page: startPage, text: await extractVisiblePages(page) });
    let cur = startPage;
    let guard = 0;
    while (cur < endPage && guard < 60) {
      guard++;
      await clickNext(page);
      const lbl = await getCurrentPageNum(page);
      cur = lbl || cur + 1;
      const text = await extractVisiblePages(page);
      if (out.length && out[out.length - 1].page === cur) continue;
      out.push({ page: cur, text });
    }
    return { ok: true, pages: out };
  } catch (e) {
    return { ok: false, reason: e.message, pages: out };
  } finally {
    await page.close();
  }
}

// Extrai capítulo inteiro (pageid) até o próximo capítulo
async function extractChapterFromPage(context, launchUrl, nextChapterPattern, maxPages = 40) {
  const page = await context.newPage();
  const out = [];
  try {
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(9000);
    out.push({ page: (await getCurrentPageNum(page)) || 1, text: await extractVisiblePages(page) });
    let cur = 1;
    let guard = 0;
    while (guard < maxPages) {
      guard++;
      await clickNext(page);
      const nxt = (await getCurrentPageNum(page)) || cur + 1;
      if (nxt === cur) { await page.waitForTimeout(1500); continue; }
      cur = nxt;
      const text = await extractVisiblePages(page);
      if (nextChapterPattern && nextChapterPattern.test(text)) { out.pop(); break; }
      out.push({ page: cur, text });
    }
    return { ok: true, pages: out };
  } catch (e) {
    return { ok: false, reason: e.message, pages: out };
  } finally {
    await page.close();
  }
}

// Extrai capítulo epub: primeiro tenta frame já carregado; senão navega no sumário
async function extractEpub(context, launchUrl, chapterRegex) {
  const page = await context.newPage();
  try {
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(12000);
    let epubFrame = page.frames().find((f) => f.url().includes('/epub/OEBPS/Text/'));
    if (epubFrame) {
      await epubFrame.waitForTimeout(2000);
      const text = await epubFrame.evaluate(() => document.body.innerText);
      const first = (text || '').trim().slice(0, 200).toLowerCase();
      const isFront = /capa|frontisp[ií]cio|p[aá]gina de rosto|cr[eé]ditos|sobre o autor|pref[aá]cio|sum[aá]rio/i.test(first);
      if (text && text.trim().length > 1500 && !isFront) {
        return { ok: true, text, url: epubFrame.url() };
      }
    }
    await page.locator('button:has-text("Expandir tudo")').first().click().catch(() => {});
    await page.waitForTimeout(3000);
    const clicked = await page.evaluate((re) => {
      const btns = [...document.querySelectorAll('button')];
      const target = btns.find((b) => re.test((b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim()));
      if (target) { target.click(); return true; }
      return false;
    }, chapterRegex);
    if (!clicked) return { ok: false, reason: 'capitulo-nao-encontrado' };
    await page.waitForTimeout(8000);
    epubFrame = page.frames().find((f) => f.url().includes('/epub/OEBPS/Text/'));
    if (!epubFrame) return { ok: false, reason: 'no-epub-frame' };
    await epubFrame.waitForTimeout(2000);
    const text = await epubFrame.evaluate(() => document.body.innerText);
    return { ok: true, text, url: epubFrame.url() };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    await page.close();
  }
}

// Detecta o formato do leitor
async function detectFormat(context, launchUrl) {
  const page = await context.newPage();
  try {
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(9000);
    const url = page.url();
    const frames = page.frames().map((f) => f.url());
    const hasPageContent = frames.some((f) => /\/pages\/\d+\/content/.test(f));
    const hasEpubText = frames.some((f) => /\/epub\/OEBPS\/Text\//.test(f));
    if (url.includes('leitor.bvirtual')) return { format: 'bvleitor', url };
    if (url.includes('plataforma.bvirtual') || url.includes('/Leitor/')) return { format: 'bvpdf', url };
    if (hasPageContent) return { format: 'pageid', url };
    if (hasEpubText || url.includes('epubcfi')) return { format: 'epub', url };
    return { format: 'unknown', url };
  } finally {
    await page.close();
  }
}

function parseRanges(text) {
  const ranges = [];
  const re = /p[aá]g(?:inas)?\s*(?:as\s*)?(\d{1,4})\s*(?:-|a\s)?\s*[-–]\s*(\d{1,4})|p\.?\s*(\d{1,4})\s*[-–]\s*(\d{1,4})/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] && m[2]) ranges.push([parseInt(m[1]), parseInt(m[2])]);
    else if (m[3] && m[4]) ranges.push([parseInt(m[3]), parseInt(m[4])]);
  }
  return ranges;
}

function parseChapter(text) {
  const m = text.match(/cap[ií]tulo\s+(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

function launchUrlFromView(viewUrl) {
  return viewUrl.replace('/mod/lti/view.php', '/mod/lti/launch.php') + '&triggerview=0';
}

// Extrai o texto recomendado de uma atividade de leitura LTI.
// Retorna { ok, text, source } ou { ok:false, reason } (atribuição).
async function extractReading({ cookies, reading }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    if (cookies && cookies.length) await context.addCookies(cookies);

    const lUrl = launchUrlFromView(reading.url);
    const det = await detectFormat(context, lUrl);

    if (det.format === 'pageid') {
      const ranges = parseRanges(reading.title);
      if (ranges.length) {
        const [start, end] = ranges[0];
        const res = await extractPageRange(context, lUrl, start, end);
        if (res.ok) {
          const text = res.pages.map((p) => p.text).join('\n\n');
          if (text.trim().length > 100) return { ok: true, text, source: 'pageid-range' };
        }
      }
      const ch = parseChapter(reading.title) || 0;
      const res = await extractChapterFromPage(context, lUrl, new RegExp(`Cap[ií]tulo\\s+${ch + 1}\\b`, 'i'));
      if (res.ok) {
        const text = res.pages.map((p) => p.text).join('\n\n');
        if (text.trim().length > 100) return { ok: true, text, source: 'pageid-chapter' };
      }
      return { ok: false, reason: 'sem-texto' };
    }

    if (det.format === 'epub') {
      const ch = parseChapter(reading.title);
      const re = ch ? new RegExp(`^Cap[ií]tulo ${ch}\\s`, 'i') : null;
      const res = re ? await extractEpub(context, lUrl, re) : null;
      if (res && res.ok) return { ok: true, text: res.text, source: 'epub' };
      return { ok: false, reason: res ? res.reason : 'sem-capitulo' };
    }

    return { ok: false, reason: 'formato-nao-suportado: ' + det.format };
  } finally {
    await browser.close();
  }
}

module.exports = { extractReading, parseRanges, parseChapter };
