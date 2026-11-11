const fs = require('fs');
const path = require('path');
const { htmlToMarkdown } = require('../src/extract/html');
const { statusFor } = require('../src/extract/pages');

// Testes da SEÇÃO 4 (P1 HTML estrutural real): a fixture sintética roda pelo
// CONVERSOR DE PRODUÇÃO (htmlToMarkdown) — não por um caminho paralelo — e o
// status só é 'integral' com evidência estrutural real, nunca por 20+ chars+escopo.

const OUT = path.join(__dirname, '..', 'audit-temp', 'HTML_RESULTS.json');
const results = [];
function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.id}: ${entry.title}`);
  if (entry.detail) console.log('    ', entry.detail);
}

const FIXTURE = [
  '<html><head><title>Conteudo de exemplo</title><style>.ui{display:none}</style></head>',
  '<body>',
  '  <nav>Menu Navegacao (nao extrair)</nav>',
  '  <div role="main" class="ava-scope">',
  '    <h1>Titulo Principal</h1>',
  '    <h2>Subtitulo Nivel 2</h2>',
  '    <p>Primeiro paragrafo com <strong>negrito</strong>, <em>italico</em> e <code>codigo_inline</code>.</p>',
  '    <p>Segundo paragrafo com <a href="https://ava.univesp.br/mod/page/view.php?id=99">link interno</a> e <a href="https://exemplo.com/x">link externo</a>.</p>',
    '    <ul>',
    '      <li>Item não ordenado A</li>',
    '      <li>Item não ordenado B',
    '        <ul><li>Subitem B1</li><li>Subitem B2</li></ul>',
    '      </li>',
    '    </ul>',
  '    <ol><li>Primeiro ordenado</li><li>Segundo ordenado</li></ol>',
  '    <blockquote>Cita em destaque.</blockquote>',
  '    <table><tr><th>Col A</th><th>Col B</th></tr><tr><td>1</td><td>2</td></tr></table>',
  '    <pre><code>const x = 1;\nconsole.log(x);</code></pre>',
  '    <p>Linha com<br>quebra de linha e <img src="https://ava.univesp.br/imgs/logo.png" alt="logo da disciplina">.</p>',
  '  </div>',
  '  <footer>Rodape (nao extrair)</footer>',
  '  <script>alert("x")</script>',
  '</body></html>',
].join('\n');

(async () => {
  const G = 'H';

  // H-1: conversão estrutural preserva headings/parágrafos.
  {
    const md = htmlToMarkdown(FIXTURE);
    const ok = md.includes('# Titulo Principal') && md.includes('## Subtitulo Nivel 2') &&
      md.includes('Primeiro paragrafo com **negrito**, *italico* e `codigo_inline`') &&
      md.includes('Segundo paragrafo com [link interno](https://ava.univesp.br/mod/page/view.php?id=99)');
    record({ id: G + '-1', title: '4: headings e parágrafos convertidos estruturalmente (H1/H2/negrito/itálico/código/links)', status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : md.split('\n').slice(0, 8).join(' | ') });
  }

  // H-2: listas ordenadas/não ordenadas/aninhadas.
  {
    const md = htmlToMarkdown(FIXTURE);
    const ok = md.includes('- Item não ordenado A') && md.includes('  - Subitem B1') &&
      md.includes('1. Primeiro ordenado') && md.includes('2. Segundo ordenado');
    record({ id: G + '-2', title: '4: listas ordenadas, não ordenadas e ANINHADAS (indentação)', status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : md.split('\n').filter((l) => /Item|ordenado|Subitem/.test(l)).join(' | ') });
  }

  // H-3: blockquote, tabela, código em bloco, quebra de linha, alt de imagem.
  {
    const md = htmlToMarkdown(FIXTURE);
    const ok = md.includes('> Cita em destaque.') &&
      md.includes('| Col A | Col B |') && md.includes('| 1 | 2 |') &&
      md.includes('```') && md.includes('const x = 1;') &&
      md.includes('quebra de linha') && md.includes('![logo da disciplina](https://ava.univesp.br/imgs/logo.png)');
    record({ id: G + '-3', title: '4: blockquote, tabela, code block, br e alt de imagem preservados', status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : md.split('\n').slice(0, 20).join(' | ') });
  }

  // H-4: elementos de interface EXCLUÍDOS (nav/rodapé/script/style/button).
  {
    const md = htmlToMarkdown(FIXTURE);
    const ok = !md.includes('Menu Navegacao') && !md.includes('Rodape') && !md.includes('alert("x")') && !md.includes('display:none');
    record({ id: G + '-4', title: '4: UI excluída da conversão (nav/footer/script/style)', status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : 'contem-ui=true' });
  }

  // H-5: status 'integral' exige evidência estrutural; 20+ chars + escopo sem estrutura = partial.
  {
    const structured = statusFor({ title: 'X', text: '# Titulo\n\nTexto longo suficiente do conteudo.', hasScope: true, httpStatus: 200, loadWarnings: [] });
    const remnant = statusFor({ title: 'X', text: 'apenas um fragmento de interface', hasScope: true, httpStatus: 200, loadWarnings: [] });
    const singleLine = statusFor({ title: 'X', text: 'texto sem estrutura nenhuma aqui', hasScope: true, httpStatus: 200, loadWarnings: [] });
    const loading = statusFor({ title: 'X', text: '# Titulo\n\nCarregando... aguarde.', hasScope: true, httpStatus: 200, loadWarnings: [] });
    const ok = structured === 'integral' && remnant === 'partial' && singleLine === 'partial' && loading === 'partial';
    record({ id: G + '-5', title: '4: integral só com estrutura real; fragmento sem estrutura e "carregando" = partial', status: ok ? 'PASS' : 'FAIL', detail: `estrutural=${structured} fragmento=${remnant} umaLinha=${singleLine} carregando=${loading}` });
  }

  // H-6: página sem escopo nem título nem texto -> not_found; escopo sem texto -> partial com aviso.
  {
    const none = statusFor({ title: '', text: '', hasScope: false, httpStatus: 200 });
    const emptyScope = statusFor({ title: 'T', text: '', hasScope: true, httpStatus: 200, loadWarnings: ['escopo encontrado sem conteúdo textual estrutural extraído'] });
    const ok = none === 'not_found' && emptyScope === 'partial';
    record({ id: G + '-6', title: '4: vazio -> not_found; escopo sem texto (aviso explícito) -> partial', status: ok ? 'PASS' : 'FAIL', detail: `vazio=${none} escopoSemTexto=${emptyScope}` });
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), results, summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } }, null, 2));
  console.log('\n=== RESUMO HTML ESTRUTURAL (SEÇÃO 4) ===');
  console.log('total:', results.length, '| PASS:', results.length - failed.length, '| FAIL:', failed.length);
  if (failed.length) { for (const f of failed) console.log('  -', f.id, f.title, '|', f.detail); process.exitCode = 1; }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
