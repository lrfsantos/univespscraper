# Relatório de Qualidade de Extração (EXTRACTION_QA)

> Gerado automaticamente pelos escritores e validações reais. Fixtures sintéticas;
> nenhum material protegido é reproduzido.

Data: 2026-11-14T01:01:20.633Z
Total de verificações: 13 | Aprovadas: 13 | Reprovadas: 0

## QA-FID-1 — Página: conteúdo, headings, listas e recursos incorporados preservados (não resumido)
- Status: **PASS**
- Métricas observadas: `fidPage=true`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-FID-2 — PDF: separação por página + distinção página do arquivo × impressa × não identificada
- Status: **PASS**
- Métricas observadas: `fidPdf=true`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-FID-3 — Vídeo: transcrição integral com timestamps e ordem dos segmentos preservados
- Status: **PASS**
- Métricas observadas: `fidVid=true ts=00:01`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-FID-4 — Livro: conteúdo acadêmico + capítulo e intervalo de páginas declarados preservados
- Status: **PASS**
- Métricas observadas: `fidRead=true`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-FID-5 — Não suportado: registrado com motivo e orientação de acesso manual (sem fingir extração)
- Status: **PASS**
- Métricas observadas: `fidUnk=true`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-HON-1 — PDF parcial (página sem texto) declara partial, nunca integral
- Status: **PASS**
- Métricas observadas: `partialDeclarado=true`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-HON-2 — Vídeo sem transcrição: registrado como tal, sem inventar transcrição
- Status: **PASS**
- Métricas observadas: `honesto=true`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-SAMPLE-1 — Documentos de exemplo existem e foram commitados (produzidos pelos escritores reais)
- Status: **PASS**
- Métricas observadas: `SAMPLE_PAGE.md, SAMPLE_PDF.md, SAMPLE_READING.md, SAMPLE_VIDEO.md, SAMPLE_UNSUPPORTED.md, INDEX.md, SOURCES.md, EXTRACTION_REPORT.md`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-SAMPLE-2 — Conteúdo dos exemplos (produzidos pelos EXTRATORES reais): fidelidade, separação por página, timestamps, metadados e status honesto
- Status: **PASS**
- Métricas observadas: `{"pageOk":true,"pdfOk":true,"videoOk":true,"readingOk":true,"unkOk":true,"indexOk":true,"reportOk":true}`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-SAMPLE-3 — Consistência de identidade: página e vídeo da mesma fixture usam o MESMO id (aaa111/bbb222 corrigido)
- Status: **PASS**
- Métricas observadas: `pageId=VIDEO01abcd videoId=VIDEO01abcd`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-NEG-1 — Negativo: parágrafo omitido do HTML é DETECTADO na conversão estrutural
- Status: **PASS**
- Métricas observadas: `presente=true ausente=true`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado

## QA-CONS-1 — Consistência: geração de amostras termina sem erro
- Status: **true**
- Métricas observadas: `exit=0`
- Verificações aprovadas: —
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: reprovado

## QA-CONS-2 — Consistência: regeneração não diverge dos arquivos commitados
- Status: **PASS**
- Métricas observadas: `arquivos=20 divergentes=nenhum`
- Verificações aprovadas: todas
- Verificações reprovadas: nenhuma
- Limitações: validação determinística sobre fixtures sintéticas; a confirmação com dados reais do AVA/VitalSource depende do proprietário.
- Decisão: aprovado
