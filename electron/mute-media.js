// Regra universal: NENHUM vídeo do YouTube (nem qualquer mídia) faz som nas
// janelas do aplicativo. Instalada no processo principal, cobre janelas já
// existentes e popups criados depois (browser-window-created).
// Não altera conteúdo, não bloqueia vídeo — apenas silencia áudio.

let installed = false;

function muteWindow(win) {
  try {
    if (!win || !win.webContents || win.webContents.isDestroyed()) return;
    // Nível de navegador: cobre qualquer mídia, inclusiveplayers que ignoram
    // o atributo DOM muted (ex.: YouTube com áudio via WebAudio).
    win.webContents.setAudioMuted(true);
    const inject = () => {
      try {
        win.webContents.executeJavaScript(`(() => {
          const mute = (el) => { try { el.muted = true; el.volume = 0; } catch (e) {} };
          HTMLMediaElement.prototype.play = new Proxy(HTMLMediaElement.prototype.play, {
            apply(target, self, args) { mute(self); return Reflect.apply(target, self, args); }
          });
          document.querySelectorAll('video,audio').forEach(mute);
          new MutationObserver((ms) => {
            for (const m of ms) for (const n of m.addedNodes) {
              if (!n || !n.querySelectorAll) continue;
              mute(n);
              n.querySelectorAll('video,audio').forEach(mute);
            }
          }).observe(document.documentElement || document, { childList: true, subtree: true });
        })()`, true).catch(() => {});
      } catch (e) { /* renderer ainda não pronto */ }
    };
    win.webContents.on('did-frame-finish-load', inject);
    if (!win.webContents.isLoading()) inject();
  } catch (e) { /* melhor esforço: janela em fechamento */ }
}

function installUniversalMute(app, existing = []) {
  if (installed) return { installed: false, reason: 'ja-instalado' };
  installed = true;
  for (const w of existing || []) muteWindow(w);
  if (app && typeof app.on === 'function') app.on('browser-window-created', (_event, win) => muteWindow(win));
  return { installed: true };
}

module.exports = { installUniversalMute, muteWindow };
