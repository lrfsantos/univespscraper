// Módulo 2 — Extração de PDFs (Etapa 3).
// Opera sobre o app Electron (usa o módulo net do Electron p/ baixar o PDF
// preservando os bytes originais) OU um HttpClient com cookies em memória.
//
// Diferencia explicitamente:
//   - totalPagesArquivo: quantidade total de páginas do arquivo (getInfo().total)
//   - numeração impressa: numeração exibida no rodapé/página impressa (heurística;
//     NÃO é garantida, pode não existir no texto extraível)
//   - páginas extraídas: páginas das quais o texto foi efetivamente obtido
// Preserva o PDF original quando permitido e gera representação textual por página.

const fs = require('fs');
const path = require('path');

const { PDFParse } = require('pdf-parse');

// Baixa o PDF via net do Electron (processo principal) — contorna CORS e
// preserva os bytes originais. Limita tamanho e tempo (5.2): nunca carrega
// arquivo de tamanho ilimitado em memória.
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024; // 200 MB
const DEFAULT_TIMEOUT_MS = 120000;           // 120 s

async function downloadViaElectronNet(url, opts = {}) {
  const maxBytes = opts.maxBytes != null ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const chunks = [];
    let size = 0;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { req.abort(); } catch {}
      reject(new Error('timeout-download'));
    }, timeoutMs);
    req.on('response', (resp) => {
      if (resp.statusCode !== 200) { clearTimeout(timer); reject(new Error('HTTP ' + resp.statusCode)); return; }
      resp.on('data', (c) => {
        if (done) return;
        size += c.length;
        if (size > maxBytes) { done = true; clearTimeout(timer); try { req.abort(); } catch {} reject(new Error('tamanho-maximo-excedido')); return; }
        chunks.push(c);
      });
      resp.on('end', () => {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve({ ok: true, bytes: Buffer.concat(chunks).length, buffer: Buffer.concat(chunks) });
      });
    });
    req.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); } reject(e); });
    req.end();
  });
}

// Baixa o PDF via HttpClient (Node puro) — usa cookie jar em memória.
// Também respeita limites de tamanho e tempo.
async function downloadViaHttpClient(client, url, opts = {}) {
  const maxBytes = opts.maxBytes != null ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const r = await client.fetch(url);
  if (r.status !== 200 || !r.body.length) throw new Error('PDF HTTP ' + r.status);
  if (r.body.length > maxBytes) throw new Error('tamanho-maximo-excedido');
  return { ok: true, bytes: r.body.length, buffer: r.body };
}

// P0 2.2: baixa o PDF usando a SESSÃO AUTENTICADA do navegador auxiliar via
// APIRequestContext do Playwright (page.request / context.request), que compartilha
// o armazenamento de cookies com o contexto do navegador onde o estudante fez o
// login manual. Não copia cookies para logs/arquivos e não cria armazenamento
// permanente. Redirecionamento para login / 403/404 / resposta HTML no lugar do
// PDF são tratados; valida-se que o arquivo baixado realmente é PDF (magic bytes).
async function downloadViaPageRequest(request, url, opts = {}) {
  const maxBytes = opts.maxBytes != null ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const resp = await request.get(url, { timeout: timeoutMs, maxRedirects: 5 });
  const status = resp.status();
  if (status === 401 || status === 403 || status === 404) throw new Error('HTTP ' + status + ' (sessao-negada/inexistente)');
  if (!resp.ok()) throw new Error('HTTP ' + status);
  const ct = String((resp.headers()['content-type'] || '') + ' ' + (resp.headers()['Content-Type'] || '')).toLowerCase();
  if (/\btext\/html\b/.test(ct)) throw new Error('html-em-vez-de-pdf');
  const buffer = await resp.body();
  if (buffer.length > maxBytes) throw new Error('tamanho-maximo-excedido');
  const isPdf = buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  if (!isPdf) throw new Error('nao-e-pdf');
  return { ok: true, bytes: buffer.length, buffer };
}

// Extrai texto por página e metadados do PDF.
// Nesta versão do pdf-parse, getPageText recebe o objeto de página (não índice).
async function analyzePdf(buffer) {
  const pdf = new PDFParse({ data: buffer });
  const out = { pages: [], totalPagesArquivo: null, info: null, error: null };
  try {
    const doc = await pdf.load();
    const info = await pdf.getInfo();
    out.info = info.info || null;
    out.totalPagesArquivo = info.total != null ? info.total : null;

    const numPages = out.totalPagesArquivo || 0;
    for (let i = 1; i <= numPages; i++) {
      try {
        const page = await doc.getPage(i);
        const t = await pdf.getPageText(page, {}, numPages);
        const text = (t && (t.text || t)) || '';
        out.pages.push({ pageIndex: i, text, chars: text.length });
        try { page.cleanup(); } catch {}
      } catch {
        out.pages.push({ pageIndex: i, text: '', chars: 0, error: 'falha-extrair-pagina' });
      }
    }
  } catch (e) {
    out.error = e.message;
  } finally {
    try { await pdf.destroy(); } catch {}
  }
  return out;
}

// Detecta numeração impressa (heurística): procura, no início/fim do texto da
// página, um número isolado que pareça número de página. NÃO é garantia.
function detectPrintedPagination(pages) {
  const seen = [];
  for (const p of pages) {
    const t = (p.text || '').trim();
    // linhas isoladas com só um número (rodapé/cabeçalho)
    const m = t.match(/(?:^|\n)\s*(\d{1,3})\s*(?:\n|$)/);
    seen.push(m ? parseInt(m[1], 10) : null);
  }
  return { detected: seen, reliable: seen.every((n) => n === null) ? 'none' : 'partial' };
}

// Calcula status honesto do PDF.
function statusFor({ ok, bytes, analyze, pages }) {
  if (!ok) return 'inaccessible';
  if (analyze && analyze.error) return 'partial'; // baixado, mas análise falhou
  if (!bytes) return 'inaccessible';
  const extracted = (pages || []).filter((p) => p.text && p.text.trim().length > 0).length;
  const total = analyze ? analyze.totalPagesArquivo : 0;
  if (extracted === 0) return 'inaccessible';
  if (total && extracted < total) return 'partial';
  return 'integral'; // todas as páginas do arquivo tiveram texto extraído
}

// Função principal do Módulo 2.
// Parâmetros: { url, filePath (destino p/ preservar original), request (opcional,
//              APIRequestContext do Playwright — sessão autenticada), client
//              (opcional), useElectronNet (bool, fallback) }
async function extractPdf({ url, filePath, request, client, useElectronNet = true, maxBytes, timeoutMs }) {
  const result = {
    url,
    filePath: filePath || null,
    status: 'inaccessible',
    bytes: 0,
    totalPagesArquivo: null,
    printedPagination: { detected: [], reliable: 'none' },
    pagesExtracted: 0,
    pages: [], // { pageIndex, text, chars }
    info: null,
    error: null,
  };

  let buffer = null;
  try {
    if (request) {
      const dl = await downloadViaPageRequest(request, url, { maxBytes, timeoutMs });
      buffer = dl.buffer;
      result.bytes = dl.bytes;
    } else if (useElectronNet) {
      const dl = await downloadViaElectronNet(url, { maxBytes, timeoutMs });
      buffer = dl.buffer;
      result.bytes = dl.bytes;
    } else if (client) {
      const dl = await downloadViaHttpClient(client, url, { maxBytes });
      buffer = dl.buffer;
      result.bytes = dl.bytes;
    } else {
      throw new Error('sem-metodo-download');
    }

    // Preserva o PDF original
    if (filePath && buffer) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buffer);
      result.filePath = filePath;
    }

    const analyze = await analyzePdf(buffer);
    result.totalPagesArquivo = analyze.totalPagesArquivo;
    result.info = analyze.info;
    result.pages = analyze.pages;
    result.pagesExtracted = analyze.pages.filter((p) => p.text && p.text.trim().length > 0).length;
    result.printedPagination = detectPrintedPagination(analyze.pages);
    result.error = analyze.error;
    result.status = statusFor({ ok: true, bytes: result.bytes, analyze, pages: analyze.pages });
  } catch (e) {
    result.error = e.message;
    result.status = 'inaccessible';
  }
  return result;
}

module.exports = { extractPdf, analyzePdf, detectPrintedPagination, statusFor, downloadViaPageRequest };
