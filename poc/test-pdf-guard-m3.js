// Frente 2 — validação da resposta PDF antes de gravar qualquer conteúdo.
// Sem AVA e sem credenciais: fixtures locais de resposta.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { validarRespostaPdf, extractPdf } = require('../src/extract/pdfs');

const OUT = path.join(__dirname, '..', 'audit-temp', 'PDFGUARD_RESULTS.json');
const results = [];
const record = (e) => { results.push(e); console.log(`[${e.status}] ${e.id}: ${e.title}`); };
const ok = (c) => (c ? 'PASS' : 'FAIL');
const PDF = Buffer.from('%PDF-1.4\n%fixture\n');
const HTML = Buffer.from('<!doctype html><title>404</title><p>Página não encontrada</p>');

record({ id: 'G1', title: 'status 404 bloqueia', status: ok(validarRespostaPdf({ status: 404, contentType: 'text/html', buffer: PDF }).motivo === 'HTTP 404') });
record({ id: 'G2', title: 'status 500 bloqueia', status: ok(validarRespostaPdf({ status: 500, contentType: 'application/pdf', buffer: PDF }).ok === false) });
record({ id: 'G3', title: 'content-type text/html bloqueia mesmo com status 200', status: ok(validarRespostaPdf({ status: 200, contentType: 'text/html; charset=utf-8', buffer: PDF }).motivo === 'content-type-nao-pdf') });
record({ id: 'G4', title: 'assinatura invalida bloqueia', status: ok(validarRespostaPdf({ status: 200, contentType: 'application/pdf', buffer: HTML }).motivo === 'nao-e-pdf') });
record({ id: 'G5', title: 'buffer vazio bloqueia', status: ok(validarRespostaPdf({ status: 200, buffer: Buffer.alloc(0) }).ok === false) });
record({ id: 'G6', title: 'PDF valido com application/pdf aceito', status: ok(validarRespostaPdf({ status: 200, contentType: 'application/pdf', buffer: PDF }).ok === true) });
record({ id: 'G7', title: 'PDF valido com octet-stream aceito', status: ok(validarRespostaPdf({ status: 200, contentType: 'application/octet-stream', buffer: PDF }).ok === true) });
record({ id: 'G8', title: 'PDF valido SEM content-type aceito como fallback documentado', status: ok(validarRespostaPdf({ status: 200, contentType: '', buffer: PDF }).ok === true) });
record({ id: 'G12', title: 'text/plain com nome .pdf rejeitado (MIME puro)', status: ok(validarRespostaPdf({ status: 200, contentType: 'text/plain; name=arquivo.pdf', buffer: PDF }).ok === false) });
record({ id: 'G13', title: 'application/notpdf rejeitado', status: ok(validarRespostaPdf({ status: 200, contentType: 'application/notpdf', buffer: PDF }).ok === false) });
record({ id: 'G14', title: 'application/pdfx rejeitado', status: ok(validarRespostaPdf({ status: 200, contentType: 'application/pdfx', buffer: PDF }).ok === false) });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfguard-'));
  const arquivo = path.join(tmp, 'nao-deve-existir.pdf');

  const cliente404 = { fetch: async () => ({ status: 404, body: HTML, headers: { 'content-type': 'text/html' } }) };
  const r404 = await extractPdf({ url: 'https://example.invalid/manual.pdf', filePath: arquivo, client: cliente404, useElectronNet: false });
  record({ id: 'G9', title: 'extrator: HTTP 404 nao grava arquivo e registra status/motivo', status: ok(r404.status === 'inaccessible' && /404/.test(r404.error || '') && r404.httpStatus === 404 && !fs.existsSync(arquivo)) });

  const clienteHtml = { fetch: async () => ({ status: 200, body: HTML, headers: { 'content-type': 'text/html' } }) };
  const rHtml = await extractPdf({ url: 'https://example.invalid/manual.pdf', filePath: arquivo, client: clienteHtml, useElectronNet: false });
  record({ id: 'G10', title: 'extrator: HTML 200 nao vira conteudo PDF', status: ok(rHtml.status === 'inaccessible' && rHtml.error === 'content-type-nao-pdf' && !fs.existsSync(arquivo)) });

  const clientePdf = { fetch: async () => ({ status: 200, body: PDF, headers: { 'content-type': 'application/pdf' } }) };
  const rPdf = await extractPdf({ url: 'https://example.invalid/valido.pdf', filePath: arquivo, client: clientePdf, useElectronNet: false });
  record({ id: 'G11', title: 'extrator: PDF valido e preservado em disco', status: ok(rPdf.status !== 'inaccessible' && fs.existsSync(arquivo) && rPdf.sha256 && rPdf.httpStatus === 200) });

  const fails = results.filter((r) => r.status !== 'PASS').length;
  fs.writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), summary: { total: results.length, passed: results.length - fails, failed: fails }, results }, null, 2));
  console.log(`\ntotal: ${results.length} | PASS: ${results.length - fails} | FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})();
