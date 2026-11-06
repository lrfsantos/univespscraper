// Critérios independentes de aprovação dos testes do Módulo 3 (Issue C).
//
// Conceitos separados (não confundir):
//   - recurso foi encontrado (allClassified)
//   - algum conteúdo foi extraído (accessibleExtracted)
//   - integridade da extração foi comprovada (expectedResourcesIntegral)
//   - recurso protegido/inacessível foi classificado corretamente
//     (bvirtualMarkedInaccessible)
//   - nenhum integral sem todas as validações obrigatórias
//     (noIntegralWithoutValidation)
//   - nenhum conteúdo de outro capítulo/página incluído indevidamente
//     (noUnexpectedContent)
//
// PASS somente quando TODOS os critérios forem verdadeiros. Uma extração
// `partial` NUNCA satisfaz expectedResourcesIntegral.

function evaluateCriteria(books) {
  const accessible = (books || []).filter((b) => !b.expectInaccessible);

  const crit = {};

  crit.allClassified = books.every((b) => ['integral', 'partial', 'inaccessible', 'not_found'].includes(b.status));

  crit.accessibleExtracted = accessible.some((b) => b.status === 'integral' || b.status === 'partial');

  // Todos os recursos acessíveis que deveriam ser integrais foram COMPROVADAMENTE integrais.
  crit.expectedResourcesIntegral = accessible.every((b) => b.status === 'integral');

  crit.bvirtualMarkedInaccessible = (() => {
    const bv = (books || []).find((b) => b.expectInaccessible);
    return !bv || bv.status === 'inaccessible';
  })();

  crit.noIntegralWithoutValidation = accessible.every((b) => {
    if (b.status !== 'integral') return true;
    const v = b.validation;
    return !!(v && v.hasText && v.noNonsense && v.startOk && v.midOk && v.endOk &&
      (!b.expected || !b.expected.chapter || v.chapterOk === true) &&
      (!v.ambiguousPages || v.ambiguousPages === 0) &&
      (!v.unexpectedContent || v.unexpectedContent.length === 0) &&
      (!v.repetitions || v.repetitions.length === 0) &&
      Array.isArray(v.warnings) && v.warnings.length === 0);
  });

  crit.noUnexpectedContent = (books || []).every((b) => !b.validation || !b.validation.unexpectedContent || b.validation.unexpectedContent.length === 0);

  return { crit, passed: Object.values(crit).every(Boolean) };
}

module.exports = { evaluateCriteria };
