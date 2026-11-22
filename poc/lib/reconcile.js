// Reconciliação fail-closed: 5 grupos mutuamente exclusivos que somam o total.
// Regras validadas pelo auditor (Pipeline 9):
// - integral só com extração validada; - partial mantém conteúdo extraído,
// mesmo com falha registrada; - chars=0 com falha explícita = failed;
// - chars=0 sem motivo = unclassified (pendência de investigação, nunca
// usado para fechar conta); - no_text só com ausência CONFIRMADA de texto.
function mapStatus(rec) {
  const status = String((rec && rec.status) || '').toLowerCase();
  const chars = Number(rec && rec.chars) || 0;
  const detail = String((rec && rec.detail) || '').trim();
  const explicit = status === 'inaccessible' || /falha=|reader-|clique-nao-abriu|timeout|nao-abriu|sem-metodo|erro/i.test(detail);
  if (rec && rec.noTextConfirmed) return { status: 'no_text', reason: detail || 'sem-texto-confirmado' };
  if (status === 'integral' && chars > 0) return { status: 'integral', reason: null };
  if (chars > 0) return { status: 'partial', reason: detail || 'incompleto' };
  if (explicit) return { status: 'failed', reason: detail || 'falha-explicita' };
  return { status: 'unclassified', reason: 'sem-evidencia-suficiente' };
}

// Contagem exclusiva: cada registro entra em exatamente 1 grupo.
function countGroups(records) {
  const groups = { integral: 0, partial: 0, no_text: 0, failed: 0, unclassified: 0 };
  const list = (records || []).map((r) => Object.assign({}, r, mapStatus(r)));
  for (const r of list) groups[r.status] += 1;
  const total = list.length;
  const sum = groups.integral + groups.partial + groups.no_text + groups.failed + groups.unclassified;
  if (sum !== total) throw new Error('contagem-divergente ' + sum + ' != ' + total);
  return Object.assign({ total }, groups);
}

// Parser das linhas "## Detalhes" do QUALITY.md (execuções históricas).
// Formato: `- S7 Titulo: status (N chars) — detalhe`
function parseQualityDetails(mdText) {
  const out = [];
  const lines = String(mdText || '').split(/\r?\n/);
  let inDetails = false;
  for (const line of lines) {
    if (/^## Detalhes/.test(line)) { inDetails = true; continue; }
    if (inDetails && /^## /.test(line)) break;
    if (!inDetails) continue;
    const m = line.match(/^- S(\d+) (.*): (\w+) \((\d+) chars\)(?:\s+[—-]\s+(.*))?$/);
    if (m) out.push({ week: Number(m[1]), title: m[2].trim(), status: m[3], chars: Number(m[4]), detail: (m[5] || '').trim() || null });
  }
  return out;
}

// CSV com escaping mínimo (aspas dobradas).
function toCsv(rows, header) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [header.join(';')].concat((rows || []).map((r) => header.map((h) => esc(r[h])).join(';'))).join('\n');
}

module.exports = { mapStatus, countGroups, parseQualityDetails, toCsv };
