"use strict";

// Простий логер
(function () {
  const g = (typeof self !== "undefined") ? self :
            (typeof window !== "undefined") ? window : this;
  if (!g.createLogger) {
    g.createLogger = function (ns) {
      const tag = `[${ns}]`;
      return {
        info:  (...a) => console.info(tag, ...a),
        debug: (...a) => console.debug(tag, ...a),
        warn:  (...a) => console.warn(tag, ...a),
        error: (...a) => console.error(tag, ...a),
      };
    };
  }
})();
const LOG = createLogger("BG");

// Глобальні хендлери помилок
self.addEventListener("error", (ev) => LOG.error("Uncaught error:", ev.message, ev.error));
self.addEventListener("unhandledrejection", (ev) => LOG.error("Unhandled promise rejection:", ev.reason));

// Утиліти для перевірки вкладень
const TARGET_EXTENSIONS = ["jpg","jpeg","png","gif","bmp","tif","tiff","webp","svg","txt","log","md","js"];
function lower(s){ return (typeof s === "string") ? s.toLowerCase() : ""; }
function ext(name){ const n = (name||""); const i = n.lastIndexOf("."); return (i>=0 && i<n.length-1) ? lower(n.slice(i+1)) : ""; }
function isTargetAttachment(att){
  const ct = lower(att?.contentType||"");
  const e  = ext(att?.name||"");
  if (ct.startsWith("image/")) return true;
  if (ct === "text/plain" || ct === "application/x-javascript") return true;
  return TARGET_EXTENSIONS.includes(e);
}

// Увімк/вимк action біля теми листа
function setMessageAction(tabId, enable){
  try {
    if (typeof tabId !== "number") return;
    if (enable) messenger.messageDisplayAction.enable(tabId);
    else messenger.messageDisplayAction.disable(tabId);
  } catch(e){ LOG.error("messageDisplayAction toggle failed:", e); }
}

// Відкрити переглядач у popup/вкладці та передати контекст
async function openViewerWindow(ctx = {}){
  try{
    const url = messenger.runtime.getURL("download/download.html");
    await messenger.storage.local.set({ viewerContext: ctx });

    // Початковий розмір: збільшений (фактичне масштабування до 80% — у download.js)
    if (messenger?.windows?.create){
      await messenger.windows.create({ url, type: "popup", width: 1100, height: 800, allowScriptsToClose: true });
      return;
    }
    if (messenger?.tabs?.create){
      await messenger.tabs.create({ url, active: true });
      return;
    }
    LOG.warn("No windows/tabs API available.");
  }catch(e){ LOG.error("openViewerWindow failed:", e); }
}

// Визначити чи є корисні вкладення — та показати іконку дії
messenger.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
  try{
    const tabId = (tab && typeof tab.id === "number") ? tab.id : null;
    if (tabId == null) return;

    const atts = await messenger.messages.listAttachments(message.id);
    const enable = (atts || []).some(isTargetAttachment);
    setMessageAction(tabId, enable);
  }catch(e){ LOG.error("onMessageDisplayed failed:", e); }
});

// Клік по іконці дії — відкрити переглядач
messenger.messageDisplayAction.onClicked.addListener(async (tab) => {
  try{
    const tabId = (tab && typeof tab.id === "number") ? tab.id : null;
    const msg   = tabId != null ? await messenger.messageDisplay.getDisplayedMessage(tabId) : null;
    const atts  = msg?.id ? await messenger.messages.listAttachments(msg.id) : [];
    await openViewerWindow({
      tabId,
      messageId: msg?.id || null,
      attachmentPartNames: (atts||[]).map(a => a?.partName || "").filter(Boolean)
    });
  }catch(e){ LOG.error("onClicked failed:", e); }
});

// (Опціонально) глобальна іконка
if (messenger?.browserAction?.onClicked?.addListener){
  messenger.browserAction.onClicked.addListener(async (tab) => {
    try{
      const tabId = (tab && typeof tab.id === "number") ? tab.id : null;
      const msg   = tabId != null ? await messenger.messageDisplay.getDisplayedMessage(tabId) : null;
      const atts  = msg?.id ? await messenger.messages.listAttachments(msg.id) : [];
      await openViewerWindow({
        tabId,
        messageId: msg?.id || null,
        attachmentPartNames: (atts||[]).map(a => a?.partName || "").filter(Boolean)
      });
    }catch(e){ LOG.error("browserAction.onClicked failed:", e); }
  });
}

// ex_customui — не використовується (TB ≥ 120)
