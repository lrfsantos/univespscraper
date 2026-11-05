const fs = require('fs');
const path = require('path');

// Monta o documento de estudo (Markdown) organizado por semanas.
// Reúne: introdução, resumos de videoaulas, leituras (livros BV + PDFs),
// aprofundando, quiz e síntese.

function cleanText(t) {
  if (!t) return '';
  return t
    .replace(/\b(smart_display|menu_book|auto_awesome|personage_foto|material-symbols-outlined|fas fa-|fa-)\b/gi, '')
    .replace(/Condi[çc][õo]es de conclus[aã]o\s*\n?/gi, '')
    .replace(/Marcar como feito\s*\n?/gi, '')
    .replace(/P[aá]gina anterior[\s\S]*?arrow_forward\s*\n?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildVideoBlock(videoUrl, kind) {
  const v = videoUrl;
  let out = `\n**${kind}:** `;
  if (v.summary) {
    out += `**${v.title || ''}**\n- Link: ${v.url || videoUrl}\n\n${v.summary}\n`;
  } else {
    out += `${v.title || videoUrl}\n- Link: ${videoUrl}\n`;
  }
  return out;
}

function buildReadingBlock(reading, weekData) {
  const lines = [];
  const rtitle = reading.title
    .replace(/^[A-Z]{2,}\d{3}.*?:\s*/, '')
    .replace(/^S\d+\s*-\s*/, '')
    .replace(/\|\s*UNIVESP\s*$/, '')
    .trim();
  lines.push(`\n### ${rtitle}\n`);

  if (reading.text && reading.text.trim().length > 100) {
    lines.push(`\n<details><summary>📖 Texto do livro/leitura recomendada</summary>\n\n${cleanText(reading.text)}\n\n</details>\n`);
  } else if (reading.pdfs && reading.pdfs.length) {
    lines.push(`\n**Leituras em PDF:**\n`);
    for (const p of reading.pdfs) {
      lines.push(`- **${p.title || p.url}**\n  - URL: ${p.url}\n`);
      if (p.text && p.text.length > 200) {
        lines.push(`\n<details><summary>📄 Texto extraído do PDF</summary>\n\n${cleanText(p.text)}\n\n</details>\n`);
      }
    }
    lines.push('\n');
  } else {
    lines.push(`*Leitura em plataforma externa (Biblioteca Virtual): ${reading.url} — requer login na BV.*\n`);
  }
  return lines.join('');
}

function buildReport({ course, weeks }) {
  const parts = [
    `# ${course.title}\n\n`,
    `> Documento de estudo gerado por **univespscraper**. Contém objetivos, resumos acadêmicos das videoaulas, leituras recomendadas e sínteses semanais.\n`,
  ];

  const weekOrder = Object.keys(weeks).sort((a, b) => {
    if (a === 'Geral') return 1;
    if (b === 'Geral') return -1;
    return Number(a) - Number(b);
  });

  for (const wk of weekOrder) {
    const w = weeks[wk];
    if (wk === 'Geral') continue;
    parts.push(`\n\n---\n\n# SEMANA ${wk}\n`);

    if (w.inicio) parts.push(`\n## 1. Introdução da semana\n\n${cleanText(w.inicio.text)}\n`);
    if (w.videoaulas) {
      parts.push(`\n## 2. Videoaulas\n`);
      for (const v of w.videoaulas.videos || []) parts.push(buildVideoBlock(v.url || v, 'Videoaula'));
      if (w.videoaulas.text) parts.push(`\n${cleanText(w.videoaulas.text)}\n`);
    }
    if (w.readings && w.readings.length) {
      parts.push(`\n## 3. Material-base (leitura obrigatória)\n`);
      for (const r of w.readings) parts.push(buildReadingBlock(r, w));
    }
    if (w.aprofundando) {
      parts.push(`\n## 4. Aprofundando o tema\n\n${cleanText(w.aprofundando.text)}\n`);
      for (const v of w.aprofundando.videos || []) {
        if (/youtu/.test(v.url || v)) parts.push(buildVideoBlock(v.url || v, 'Vídeo de apoio'));
      }
    }
    if (w.quiz) parts.push(`\n## 5. Atividade Avaliativa\n\n${cleanText(w.quiz.text)}\n`);
    if (w.sintese) parts.push(`\n## 6. Em síntese\n\n${cleanText(w.sintese.text)}\n`);
  }

  return parts.join('');
}

function saveReport(course, weeks, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const md = buildReport({ course, weeks });
  const safeName = course.title.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '_');
  const file = path.join(outDir, `${safeName}-estudo.md`);
  fs.writeFileSync(file, md, 'utf8');
  return { file, size: md.length };
}

module.exports = { buildReport, saveReport, cleanText };
