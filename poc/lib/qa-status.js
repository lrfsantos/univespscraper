// Contrato estrito para resultados de QA. Somente PASS é aprovado;
// qualquer valor ausente ou fora do contrato vira FAIL e mantém a evidência original.
'use strict';

function normalizeQaResult(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('Resultado de QA deve ser um objeto.');
  }
  if (entry.status === 'PASS' || entry.status === 'FAIL') return { ...entry };
  const detail = String(entry.detail || '').trim();
  const invalidDetail = `status inválido recebido (${String(entry.status)}); permitido somente PASS ou FAIL`;
  return {
    ...entry,
    status: 'FAIL',
    reportedStatus: entry.status,
    statusValidationError: 'invalid-status',
    detail: detail ? `${detail}; ${invalidDetail}` : invalidDetail,
  };
}

function summarizeQaResults(results) {
  if (!Array.isArray(results)) throw new TypeError('Resultados de QA devem ser um array.');
  const total = results.length;
  const passed = results.filter((entry) => entry && entry.status === 'PASS').length;
  return { total, passed, failed: total - passed };
}

module.exports = { normalizeQaResult, summarizeQaResults };
