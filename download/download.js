"use strict";

// Логер
const LOG = (() => { const t='[VIEW]'; return {
  info:(...a)=>console.info(t,...a), debug:(...a)=>console.debug(t,...a),
  warn:(...a)=>console.warn(t,...a), error:(...a)=>console.error(t,...a),
};})();

// Типи/утиліти
const TARGET_EXTENSIONS = ["jpg","jpeg","png","gif","bmp","tif","tiff","webp","svg","txt","log","md","js"];
const lower = (s)=> typeof s==="string" ? s.toLowerCase() : "";
const ext = (name)=>{ const n=(name||""); const i=n.lastIndexOf("."); return (i>=0 && i<n.length-1) ? lower(n.slice(i+1)) : ""; };
const isImageCt = (ct)=> lower(ct).startsWith("image/");
const isTarget = (att)=> isImageCt(att?.contentType||"") || ["text/plain","application/x-javascript"].includes(lower(att?.contentType||"")) || TARGET_EXTENSIONS.includes(ext(att?.name||""));

// Стан
let ctx = { tabId:null, messageId:null, attachmentPartNames:[] };
let attachments = [];
let objectUrls = new Set();
let urlByPart = new Map(); // partName -> objectURL
let listEl = null;
let activeIndex = -1;

// Контекст
async function loadContext(){
  const { viewerContext } = await messenger.storage.local.get("viewerContext");
  if (viewerContext && typeof viewerContext === "object") {
    ctx = {
      tabId: viewerContext.tabId ?? null,
      messageId: viewerContext.messageId ?? null,
      attachmentPartNames: Array.isArray(viewerContext.attachmentPartNames) ? viewerContext.attachmentPartNames : []
    };
  }
  document.getElementById("contextInfo").textContent =
    ctx.messageId ? `Message ID: ${ctx.messageId}` : "No message selected";
}

// Вкладення
async function loadAttachments(){
  if (!ctx.messageId){ attachments = []; return; }
  attachments = await messenger.messages.listAttachments(ctx.messageId);
  if (ctx.attachmentPartNames?.length) {
    const order = new Map(ctx.attachmentPartNames.map((p,i)=>[p,i]));
    attachments.sort((a,b)=> (order.get(a.partName)??1e9) - (order.get(b.partName)??1e9));
  }
}

// Рендер лівої колонки
function renderList(){
  const list = document.getElementById("attList");
  listEl = list;
  const empty = document.getElementById("empty");
  list.innerHTML = "";
  if (!attachments.length){
    empty.hidden = false;
    document.getElementById("btnSaveAll").disabled = true;
    return;
  }
  empty.hidden = true;

  attachments.forEach((att, i) => {
    const li = document.createElement("li");
    li.className = "item";
    li.dataset.index = String(i);

    const th = document.createElement("div");
    th.className = "thumb";
    th.textContent = "—";

    const meta = document.createElement("div");
    meta.className = "meta";

    const name = document.createElement("div");
    name.className = "name";
    name.title = att.name || "(unnamed)";
    name.textContent = att.name || "(unnamed)";

    const type = document.createElement("div");
    type.className = "type";
    const sizeStr = att.size ? ` • ${Intl.NumberFormat().format(att.size)} bytes` : "";
    type.textContent = `${att.contentType || "unknown"}${sizeStr}`;

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const btnSave = document.createElement("button");
    btnSave.textContent = "Download";
    btnSave.title = "Download this attachment";
    btnSave.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await downloadAttachment(att);
    });

    actions.append(btnSave);
    meta.append(name, type);
    li.append(th, meta, actions);
    list.appendChild(li);

    li.addEventListener("click", async ()=>{
      await selectIndex(i);
    });

    if (isImageCt(att.contentType)) {
      th.textContent = "";
      th.style.background = "#0b0f16";
      const url = urlByPart.get(att.partName);
      if (url) {
        const timg = document.createElement("img");
        timg.src = url; timg.alt = "";
        th.appendChild(timg);
      }
    }
  });

  document.getElementById("btnSaveAll").disabled = false;
}

// Виділення активного
function markActive(){
  if (!listEl) return;
  for (const li of listEl.children){
    li.classList.toggle("active", Number(li.dataset.index) === activeIndex);
  }
}

// Показ великого прев’ю праворуч
async function showLarge(att){
  const viewer = document.getElementById("viewer");
  viewer.innerHTML = "";
  if (!att){ 
    const em = document.createElement("div"); em.className="empty"; em.textContent="Select an image to preview.";
    viewer.appendChild(em); return;
  }

  if (!ctx.messageId || !att.partName){
    const em = document.createElement("div"); em.className="empty"; em.textContent="Preview unavailable.";
    viewer.appendChild(em); return;
  }

  let url = urlByPart.get(att.partName);
  if (!url && isImageCt(att.contentType)) {
    try{
      const file = await messenger.messages.getAttachmentFile(ctx.messageId, att.partName);
      if (file instanceof File){
        url = URL.createObjectURL(file);
        urlByPart.set(att.partName, url);
        objectUrls.add(url);
      }
    }catch(e){ LOG.error("getAttachmentFile failed:", e); }
  }

  if (isImageCt(att.contentType) && url){
    const img = document.createElement("img");
    img.src = url; img.alt = att.name || "";
    img.loading = "lazy"; img.decoding = "async";
    viewer.appendChild(img);
  } else {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No inline preview. Use Download to save the file.";
    viewer.appendChild(p);
  }
}

// Вибір елемента за індексом
async function selectIndex(i){
  activeIndex = i;
  markActive();
  await showLarge(attachments[i]);
}

// Завантаження тумб одразу для всіх (із лімітом)
async function loadAllThumbs(){
  const jobs = attachments.map((att, idx) => async () => {
    try{
      if (!isImageCt(att.contentType)) return;
      if (!ctx.messageId || !att.partName) return;
      if (urlByPart.has(att.partName)) return;

      const file = await messenger.messages.getAttachmentFile(ctx.messageId, att.partName);
      if (file instanceof File) {
        const url = URL.createObjectURL(file);
        urlByPart.set(att.partName, url);
        objectUrls.add(url);
      }

      const url = urlByPart.get(att.partName);
      if (url){
        const li = listEl?.querySelector(`.item[data-index="${idx}"]`);
        const th = li?.querySelector(".thumb");
        if (th && !th.querySelector("img")) {
          th.innerHTML = "";
          const timg = document.createElement("img");
          timg.src = url; timg.alt = "";
          th.appendChild(timg);
        }
      }
    }catch(e){
      LOG.error("Thumb load failed:", e);
    }
  });

  const CONC = 6;
  let i = 0;
  await Promise.all(new Array(Math.min(CONC, jobs.length)).fill(0).map(async () => {
    while (i < jobs.length) {
      const j = i++;
      await jobs[j]();
    }
  }));
}

// Завантажити одне
async function downloadAttachment(att){
  try{
    const partName = att.partName;
    if (!ctx.messageId || !partName) return;
    const file = await messenger.messages.getAttachmentFile(ctx.messageId, partName);
    const url = URL.createObjectURL(file);
    objectUrls.add(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = att.name || "attachment";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }catch(e){
    LOG.error("downloadAttachment failed:", e);
    alert("Failed to download attachment.");
  }
}

// Завантажити всі
async function downloadAll(){
  for (const att of attachments) await downloadAttachment(att);
}

// Очистка
function cleanup(){
  objectUrls.forEach(u => { try{ URL.revokeObjectURL(u); }catch{} });
  objectUrls.clear();
}

// Знаходимо кандидат-вкладку пошти: пріоритет messageDisplay, далі mailTab.
// Не покладаємося на active=true, бо наш popup фокусується і "гасить" активність.
async function findMailCandidateTab() {
  const all = await messenger.tabs.query({});
  const extBase = messenger.runtime.getURL("");

  const isOur = (t) => t.url && t.url.startsWith(extBase);
  const isMailLike = (t) => (t.mailTab === true) || (t.type === "mail") || (t.type === "messageDisplay");

  // 1) Візьмемо найсвіжішу (за порядком у масиві) вкладку messageDisplay, що не наша і не popup
  let cand = [...all].reverse().find(t => !isOur(t) && t.windowType !== "popup" && t.type === "messageDisplay");
  if (cand) return cand;

  // 2) Візьмемо найсвіжішу mailTab (3-панельний режим)
  cand = [...all].reverse().find(t => !isOur(t) && t.windowType !== "popup" && (t.mailTab === true || t.type === "mail"));
  return cand || null;
}

// Отримуємо messageId з вкладки правильним API
async function getMessageIdFromTab(tab) {
  if (!tab) return null;
  try {
    if (tab.type === "messageDisplay") {
      const { displayedMessage } = await messenger.messageDisplay.getDisplayedMessage(tab.id);
      return displayedMessage?.id || null;
    }
    // mailTab (3-панель)
    if (tab.mailTab === true || tab.type === "mail") {
      const sel = await messenger.mailTabs.getSelectedMessages(tab.id);
      // sel.messages — масив/колекція; візьмемо перший
      const ids = sel?.messages?.map?.(m => m.id) || [];
      return ids.length ? ids[0] : null;
    }
  } catch (e) {
    LOG.warn("getMessageIdFromTab failed:", e);
  }
  return null;
}

// Оновлення з поточної (найактуальнішої) поштової вкладки
async function refreshFromAnyMailTab() {
  try {
    const tab = await findMailCandidateTab();
    const newMsgId = await getMessageIdFromTab(tab);
    if (newMsgId) {
      ctx.tabId = tab.id;
      ctx.messageId = newMsgId;
      await messenger.storage.local.set({ viewerContext: ctx });
    }

    // Скидаємо кеш URLів
    for (const u of urlByPart.values()) { try { URL.revokeObjectURL(u); } catch {} }
    urlByPart.clear();
    cleanup();

    // Перезбираємо
    await loadAttachments();
    renderList();
    await loadAllThumbs();

    const firstImg = attachments.findIndex(a => (a?.contentType || "").toLowerCase().startsWith("image/"));
    await selectIndex(firstImg >= 0 ? firstImg : (attachments.length ? 0 : -1));
  } catch (e) {
    LOG.error("refreshFromAnyMailTab failed:", e);
    // fallback
    await loadAttachments();
    renderList();
    await loadAllThumbs();
    const firstImg = attachments.findIndex(a => (a?.contentType || "").toLowerCase().startsWith("image/"));
    await selectIndex(firstImg >= 0 ? firstImg : (attachments.length ? 0 : -1));
  }
}



// Кнопки
function bindUi(){
  document.getElementById("btnRefresh").addEventListener("click", async ()=>{
    await refreshFromAnyMailTab();
  });

  document.getElementById("btnSaveAll").addEventListener("click", async ()=>{
    await downloadAll();
  });

  window.addEventListener("beforeunload", cleanup);
}



// Розмір 80% через windows.update з повтором
async function ensureSizeEightyPercent(){
  try{
    const aw = screen.availWidth || screen.width;
    const ah = screen.availHeight || screen.height;
    const w = Math.max(900, Math.floor(aw * 0.8));
    const h = Math.max(700, Math.floor(ah * 0.8));
    const x = Math.max(0, Math.floor((aw - w) / 2));
    const y = Math.max(0, Math.floor((ah - h) / 2));

    for (let k=0;k<3;k++){
      const win = await messenger.windows.getCurrent({});
      await messenger.windows.update(win.id, { state: "normal", left: x, top: y, width: w, height: h });
      await new Promise(r=>setTimeout(r, 80));
    }
  }catch(e){
    // Якщо заборонено — ігноруємо
  }
}

// Ініт
(async function init(){
  try{
    bindUi();
    setTimeout(ensureSizeEightyPercent, 60);

    await loadContext();
    await loadAttachments();
    renderList();
    await loadAllThumbs();                       // усі тумби одразу
    const firstImg = attachments.findIndex(a => isImageCt(a?.contentType||""));
    await selectIndex(firstImg >= 0 ? firstImg : 0);  // праворуч — велике активне
  }catch(e){
    LOG.error("init failed:", e);
    document.getElementById("contextInfo").textContent = "Initialization failed.";
    const v = document.getElementById("viewer");
    v.innerHTML = ""; const em = document.createElement("div"); em.className="empty"; em.textContent="Failed to load.";
    v.appendChild(em);
  }
})();
