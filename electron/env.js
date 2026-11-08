// Construção do ambiente EXPLÍCITO para o processo Electron auxiliar (browser.js).
// NUNCA repassa process.env inteiro — apenas variáveis necessárias ao
// funcionamento do Electron/Windows. Evita vazar credenciais, tokens ou outras
// variáveis sensíveis do ambiente do estudante para a segunda instância.
function buildAuxEnv() {
  const allow = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'HOMEDRIVE', 'HOMEPATH', 'ELECTRON_RUN_AS_NODE'];
  const env = {};
  for (const k of allow) if (process.env[k] != null) env[k] = process.env[k];
  env.UNIVESP_AUX = '1';
  return env;
}

module.exports = { buildAuxEnv };
