// Validação estrita dos resumos JSON produzidos pelas suítes de teste.
'use strict';

function count(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\\d+$/.test(value.trim())) {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n >= 0) return n;
  }
  return null;
}

function parseSuiteSummary(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'resumo-ausente-ou-invalido' };
  }
  const summary = payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
    ? payload.summary
    : payload;
  const total = count(summary.total);
  if (total == null) return { valid: false, error: 'total-ausente-ou-invalido' };

  const hasPassed = Object.prototype.hasOwnProperty.call(summary, 'passed');
  const hasFailed = Object.prototype.hasOwnProperty.call(summary, 'failed');
  const passedValue = hasPassed ? count(summary.passed) : null;
  const failedValue = hasFailed ? count(summary.failed) : null;
  if (hasPassed && passedValue == null) return { valid: false, error: 'passed-invalido', total };
  if (hasFailed && failedValue == null) return { valid: false, error: 'failed-invalido', total };
  if (!hasPassed && !hasFailed) return { valid: false, error: 'passed-e-failed-ausentes', total };

  const passed = hasPassed ? passedValue : total - failedValue;
  const failed = hasFailed ? failedValue : total - passedValue;
  if (passed < 0 || failed < 0 || passed + failed !== total) {
    return { valid: false, error: 'contagens-inconsistentes', total, passed, failed };
  }
  return { valid: true, total, passed, failed };
}

module.exports = { parseSuiteSummary };
