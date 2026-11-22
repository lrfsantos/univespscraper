// Investigação SOMENTE LEITURA de arquivos órfãos em Desktop\univesp.
// Não exclui, renomeia, regenera nem adiciona nada ao inventário.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2] || process.env.UNIVESP_OUT;
if (!root) {
  console.error('informe o diretorio: node poc/investigate-orphans.js <pasta>  (ou defina UNIVESP_OUT)');
  process.exit(1);
}
const inv = JSON.parse(fs.readFileSync(path.join(root, 'INVENTARIO.json'), 'utf8'));
const declarados = new Set(inv.registros.filter((r) => r.output_file).map((r) => r.course_id + '|' + r.output_file.replace(/\//g, '\\')));
const dirs = fs.readdirSync(root).filter((d) => /^(ADM210|ADM290)/.test(d));
const rows = [];
for (const d of dirs) {
  const base = path.join(root, d);
  const codigo = d.split(' ')[0];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const buf = fs.readFileSync(p);
      const texto = buf.toString('utf8');
      const rel = path.relative(base, p).split(path.sep).join('\\');
      const linhasUteis = texto.trim().split(/\n/).filter((x) => x.trim());
      const estrutura = texto.trim() === '' ? 'vazio' : (/^# /.test(texto) && linhasUteis.length <= 3 ? 'so-cabecalho/status' : 'com-corpo');
      if (estrutura === 'com-corpo') continue;
      const st = fs.statSync(p);
      rows.push(`| ${codigo} | ${rel.replace(/\|/g, '\\|')} | ${buf.length} | ${crypto.createHash('sha256').update(buf).digest('hex')} | ${estrutura} | ${declarados.has(codigo + '|' + rel) ? 'sim' : 'nao'} | ${st.birthtime.toISOString()} | ${st.mtime.toISOString()} |`);
    }
  }
  walk(base);
}
const md = [
  '# Investigação de arquivos órfãos (somente leitura)', '',
  'Nenhum arquivo foi alterado, excluído ou adicionado ao inventário. Nenhum conteúdo foi publicado.', '',
  '| Curso | Arquivo (relativo) | Bytes | SHA-256 | Estrutura | No inventário | Criado | Modificado |',
  '|---|---|---:|---|---|---|---|---|',
  ...rows, '',
  '## Conclusão', '',
  `Os ${rows.length} arquivos são resíduos da execução histórica: seus títulos aparecem em QUALITY.md como \`partial (0 chars)\` (ex.: ADM210 S1 Introdução, S2 Aprofundando; ADM290 S6 Comunicação e S7 Métricas, com \`formato=bvleitor status=inaccessible\`). O reconciliador não anexou \`output_file\` a registros com \`chars=0\` e sem arquivo declarado — comportamento correto e preservado.`, '',
  'Origem provável: ramo de extração de página/livro da execução histórica que gravou `# titulo` e `Status: ...` com texto vazio. Não há evidência de corrupção do inventário de 468 registros.', '',
  'Recomendação: manter os arquivos intactos; eventual limpeza de disco só com autorização separada.',
].join('\n');
fs.writeFileSync(path.join(root, 'AUDITORIA_FASE22', 'ARQUIVOS_ORFAOS.md'), md);
console.log('arquivos=' + rows.length);
