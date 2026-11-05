const fs = require('fs');
const path = require('path');
const { createHttpClient } = require('./http');
const { PDFParse } = require('pdf-parse');

// Download e extração de texto de PDFs. Usa o cache em disco (somente o PDF
// e seu texto — não contém credenciais), ou em memória se desabilitado.

async function downloadPdf({ client, url, filePath, timeout = 120000 }) {
  const r = await client.fetch(url, { timeout });
  if (r.status !== 200 || !r.body.length) throw new Error('PDF HTTP ' + r.status);
  fs.writeFileSync(filePath, r.body);
  return r.body.length;
}

async function pdfText(filePath) {
  const buf = fs.readFileSync(filePath);
  try {
    const doc = new PDFParse({ data: buf });
    await doc.load();
    const res = await doc.getText();
    const text = res && typeof res === 'object' ? res.text || '' : res || '';
    await doc.destroy();
    return text;
  } catch (e) {
    return '';
  }
}

module.exports = { downloadPdf, pdfText };
