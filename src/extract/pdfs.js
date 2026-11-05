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
// preserva os bytes originais. Retorna { ok, bytes, buffer }.
async function downloadViaElectronNet(url) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const chunks = [];
    req.on('response', (resp) => {
      if (resp.statusCode !== 200) { reject(new Error('HTTP ' + resp.statusCode)); return; }
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => resolve({ ok: true, bytes: Buffer.concat(chunks).length, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Baixa o PDF via HttpClient (Node puro) — usa cookie jar em memória.
async function downloadViaHttpClient(client, url) {
  const r = await client.fetch(url);
  if (r.status !== 200 || !r.body.length) throw new Error('PDF HTTP ' + r.status);
  return { ok: true, bytes: r.body.length, buffer: r.body };
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
// Parâmetros: { url, filePath (destino p/ preservar original), client (opcional),
//              useElectronNet (bool) }
async function extractPdf({ url, filePath, client, useElectronNet = true }) {
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
    if (useElectronNet) {
      const dl = await downloadViaElectronNet(url);
      buffer = dl.buffer;
      result.bytes = dl.bytes;
    } else if (client) {
      const dl = await downloadViaHttpClient(client, url);
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

module.exports = { extractPdf, analyzePdf, detectPrintedPagination, statusFor };
