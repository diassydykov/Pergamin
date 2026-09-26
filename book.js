(() => {
'use strict';
const $ = id => document.getElementById(id);
const ms = $('ms'), books = new Map(), events = new Map(), ranges = new Map();
const viewportEl = $('page-scroll');
let db, active = '', timer, toastTimer, dirty = false, revision = 0;
const font = "'Cormorant Garamond', Georgia, serif";
function toast(msg) { $('toast').textContent = String(msg); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4200); }
function emit(evt, value) { for (const cb of events.get(evt) || []) { try { cb(value); } catch (error) { console.error(error); } } }
function persist(book) {
 const rev = ++revision; $('saved').textContent = 'Сохраняем…';
 const tx = db.transaction('books', 'readwrite'); tx.objectStore('books').put(book);
 tx.oncomplete = () => { if (rev === revision && !dirty) $('saved').textContent = '✓ Сохранено'; };
 tx.onabort = tx.onerror = () => { $('saved').textContent = 'Не сохранено'; toast('Не удалось сохранить книгу. Проверьте свободное место на устройстве.'); };
}
function applyStyle(book) {
 ms.style.fontFamily = book.font; ms.style.fontSize = book.fsize + 'px';
 ms.style.setProperty('--heading-font', book.headingFont); ms.style.setProperty('--heading-style', book.headingStyle);
 const [main, edge] = book.paper.split('|'); $('page').style.setProperty('--paper', main); $('page').style.setProperty('--edge', edge);
 for (const [id, value] of Object.entries({font:book.font, fsize:book.fsize, paper:book.paper, 'heading-style':book.headingStyle})) $(id).value = value;
 $('book-title').querySelector('.rt-l').textContent = book.title; $('book-title').querySelector('.rt-r').textContent = book.title; document.title = book.title + ' — Пергамин';
}
function refreshLibrary() {
 $('books').replaceChildren(...Array.from(books.values(), b => { const option = new Option(b.title, b.id); option.selected = b.id === active; return option; }));
}
function updateBook(id, patch) {
 const old = books.get(id); if (!old) return;
 // Flush local typing before merging external AI metadata.
 if (id === active && dirty) { old.content = contentHTML(); dirty = false; clearTimeout(timer); }
 const book = {...old, ...patch, id:old.id, updatedAt:Date.now()};
 book.illusHistory = book.illusHistory.slice(-10);
 books.set(id, book);
 if (id === active) { if ('content' in patch && ms.innerHTML !== book.content) { ms.innerHTML = book.content; ranges.delete(id); } applyStyle(book); }
 if ('title' in patch) refreshLibrary();
 persist(book);
}
function flush() { clearTimeout(timer); if (dirty && active) updateBook(active, {content:contentHTML()}); }
// One-time migration of every figure on open: strip the old figcaption (keep its
// text as data-excerpt so "regenerate" still has a prompt), crop the watermark,
// and give Word-like float wrap. No-ops once a figure is already up to date.
function cleanLegacyFigures(bookId){
 try {
  const figs = Array.from(ms.querySelectorAll('figure.illus'));
  if (!figs.length) return;
  (async () => {
   let changedAny = false;
   for (const fig of figs) {
    const img = fig.querySelector('img'); if (!img) continue;
    // 0) Self-heal: UI-only classes (sel/moving) that an earlier build baked into
    // the saved markup — strip them and persist the clean content.
    if (fig.classList.contains('sel') || fig.classList.contains('moving')) { fig.classList.remove('sel','moving'); changedAny = true; }
    // 1) Remove the caption under the illustration (user doesn't want it).
    const cap = fig.querySelector('figcaption');
    if (cap) {
     if (!fig.dataset.excerpt) fig.dataset.excerpt = cap.textContent.trim();
     cap.remove(); changedAny = true;
    }
    // 2) Crop the watermark strip (only images added before cropping existed).
    if (!fig.dataset.cropped && img.src.startsWith('data:image/')) {
     try {
      const res = await fetch(img.src); const blob = await res.blob();
      const du = await cropWatermark(blob);
      img.src = du; fig.dataset.cropped = '1'; changedAny = true;
     } catch (e) { console.warn('crop legacy figure', e); }
    }
    // 3) Give old figures Word-like float wrap.
    if (!fig.dataset.wraps) { fig.dataset.wraps = 'left'; fig.style.cssText = 'float:left;width:55%;margin:0 14px 8px 0'; changedAny = true; }
   }
   if (changedAny && bookId === active) { dirty = true; flush(); }
  })();
 } catch (e) { console.warn('cleanLegacyFigures', e); }
}
function changed() { dirty = true; $('saved').textContent = 'Изменения…'; clearTimeout(timer); timer = setTimeout(flush, 500); }
// HTML to persist: clone the content and strip transient UI-only classes
// (selected/moving) so they never leak into the saved book markup.
function contentHTML(){
 const c = ms.cloneNode(true);
 c.querySelectorAll('figure.illus').forEach(f => f.classList.remove('sel','moving'));
 return c.innerHTML;
}
function openBook(id) {
 if (!books.has(id)) return; flush(); active = id; try { localStorage.setItem('pg.lastBook', id); } catch (e) {} ms.innerHTML = books.get(id).content;
 // strip UI-only state classes that may have been persisted in the saved markup
 ms.querySelectorAll('figure.illus.sel, figure.illus.moving').forEach(f => f.classList.remove('sel', 'moving'));
 ranges.clear(); window.getSelection()?.removeAllRanges(); applyStyle(books.get(id)); $('books').value = id; $('heading').value = 'p';
 cleanLegacyFigures(id);
 emit('bookopen', id);
}
function makeBook(title, style = '', content = '') {
 const now = Date.now();
 return {id:crypto.randomUUID ? crypto.randomUUID() : now + '-' + Math.random().toString(36).slice(2),title,byline:'',content,font,fsize:22,headingFont:font,headingStyle:'normal',paper:'#f2e4c4|#d6bd8b',illusStyle:style,illusHistory:[],createdAt:now,updatedAt:now};
}
function selectionRange() {
 const sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
 const r = sel.getRangeAt(0); return ms.contains(r.commonAncestorContainer) ? r : null;
}
function restoreSelection() {
 ms.focus(); const range = ranges.get(active); if (range && ms.contains(range.commonAncestorContainer)) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
}
function command(name, value) {
 if (name === '__tab') { restoreSelection(); // Chromium bug: multi-NBSP insertText mangles to mixed spaces, use pre span
   document.execCommand('insertHTML', false, '<span style="white-space:pre">    </span>'); changed(); return; }
 restoreSelection(); document.execCommand(name, false, value); changed();
}
function insertFigureAtSelection(bookId, {dataUrl, caption, prompt}) {
 const book = books.get(bookId); if (!book) return;
 if (!/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(dataUrl)) { toast('Не удалось вставить изображение: нужен dataURL изображения.'); return; }
 const figure = document.createElement('figure'); figure.className = 'illus'; figure.contentEditable = 'false';
 figure.dataset.prompt = String(prompt || ''); figure.dataset.excerpt = String(caption || '');
 figure.dataset.wraps = 'left'; figure.dataset.cropped = '1';
 figure.style.cssText = 'float:left;width:55%;margin:0 14px 8px 0';
 const img = document.createElement('img'); img.src = dataUrl; img.alt = String(caption || 'Иллюстрация');
 figure.append(img);
 let content;
 if (bookId === active) {
  restoreSelection(); const r = ranges.get(bookId) || selectionRange();
  if (r && ms.contains(r.commonAncestorContainer)) {
   // Keep the illustrated excerpt: insert after the selection, splitting its block if necessary.
   r.collapse(false);
   let block = r.endContainer.nodeType === Node.ELEMENT_NODE ? r.endContainer : r.endContainer.parentElement;
   while (block && block.parentNode !== ms && block !== ms) block = block.parentElement;
   if (block && block !== ms && !block.matches('figure')) {
    const tailRange = document.createRange(); tailRange.selectNodeContents(block); tailRange.setStart(r.endContainer, r.endOffset);
    const tail = block.cloneNode(false); tail.removeAttribute('id'); tail.append(tailRange.extractContents()); block.after(figure);
    if (tail.textContent || tail.querySelector('img,br')) figure.after(tail);
   } else r.insertNode(figure);
  } else ms.append(figure);
  const next = document.createElement('p'); next.innerHTML = '<br>'; if (!figure.nextSibling) figure.after(next);
  ranges.delete(bookId); content = contentHTML();
 } else { const host = document.createElement('div'); host.innerHTML = book.content; host.append(figure); content = host.innerHTML; }
 updateBook(bookId, {content, illusHistory:[...book.illusHistory, {what:String(caption || ''), dataUrl, ts:Date.now()}].slice(-10)});
}
window.__pg__ = {
 currentBookId:() => active,
 getBook:id => { const b = books.get(id); return b ? structuredClone(b) : null; },
 updateBook,
 getSelectionText:() => { const r = selectionRange() || ranges.get(active); return r ? r.toString().trim() : ''; },
 insertFigureAtSelection,
 isOnline:() => navigator.onLine,
 toast,
 on:(evt, cb) => { if (!events.has(evt)) events.set(evt, new Set()); events.get(evt).add(cb); }
};
function connectivity() { const online = navigator.onLine; $('ai-gen').disabled = !online || !active; $('ai-gen').title = online ? 'Иллюстрация к выделенному тексту' : 'нет интернета'; $('connection').textContent = online ? 'Локальная библиотека' : 'Офлайн · можно писать'; emit(online ? 'online' : 'offline'); }
$('ai-gen').onclick = () => toast('ИИ-модуль загружается…');
// The module owns its click handler once its script has loaded successfully.
const aiScript = document.querySelector('script[src="ai.js"]'); aiScript.addEventListener('load', () => { $('ai-gen').onclick = null; });
window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
// ── Figures: Word-like — float/wrap around text, drag to anywhere, corner resize, toolbar (⤢ ↺ ⟲ ✕) ──
const figTools = $('fig-tools'), figResize = $('fig-resize'), figHint = $('fig-hint');
let figSel = null, figDrag = null, figMove = null;
const FIG_DEF_W = '55%';
function clearFigSel(){ if(figSel) figSel.classList.remove('sel'); figSel=null; figTools.classList.remove('show'); figResize.classList.remove('show'); figHint.classList.remove('show'); }
function figColumnPx(){ const cs=getComputedStyle(ms); const n=Math.max(1,parseInt(cs.columnCount)||1); const gap=parseFloat(cs.columnGap)||0; return Math.max(60,(ms.clientWidth-gap*(n-1))/n); }
function positionFigUI(){
 if(!figSel || !ms.contains(figSel)) { clearFigSel(); return; }
 const r = figSel.getBoundingClientRect();
 figResize.style.left = (r.right - 9) + 'px'; figResize.style.top = (r.bottom - 9) + 'px';
 const tw = 170;
 figTools.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width/2 - tw/2)) + 'px';
 figTools.style.top = (r.top - 52 >= 58 ? r.top - 52 : r.top + 8) + 'px';
 figHint.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.left)) + 'px'; figHint.style.top = (r.bottom + 7) + 'px';
}
function selectFigure(fig){ clearFigSel(); figSel=fig; fig.classList.add('sel'); positionFigUI(); figTools.classList.add('show'); figResize.classList.add('show'); figHint.classList.add('show'); }
function removeFigure(fig){ const next=fig.nextElementSibling; fig.remove(); if(!next){ const p=document.createElement('p'); p.innerHTML='<br>'; ms.append(p);} changed(); clearFigSel(); }
// Word-style wrap mode: data-wraps = none (block) | left | right (text flows around)
function applyFigWrap(fig, mode){
 fig.dataset.wraps = mode;
 const w = fig.style.width || FIG_DEF_W;
 if(mode === 'left'){ fig.style.float='left'; fig.style.width=w; fig.style.margin='0 14px 8px 0'; }
 else if(mode === 'right'){ fig.style.float='right'; fig.style.width=w; fig.style.margin='0 0 8px 14px'; }
 else { fig.style.float='none'; fig.style.width='100%'; fig.style.margin='0'; }
 ms.style.clear = (mode === 'left' || mode === 'right') ? 'both' : '';
 applyFigNudge(fig);
 positionFigUI();
}
// Apply the accumulated keyboard-nudge offset (dataset.nudgeX/Y, px; nx>0 = image
// to the right, ny>0 = image moves down) as transform:translate. Transform is used
// (not margins) so ALL four arrows move the image correctly no matter which edge a
// float is pinned to — a float's margins only shift the image away from its edge,
// which would silently clamp one horizontal direction. The offset persists with the
// book via the dataset.
function applyFigNudge(fig){
 const nx = parseInt(fig.dataset.nudgeX,10)||0, ny = parseInt(fig.dataset.nudgeY,10)||0;
 fig.style.transform = (nx || ny) ? `translate(${nx}px, ${ny}px)` : '';
}
// caret position under (x,y) INSIDE the text; used to drop the figure exactly where the user wants
function textRangeAtPoint(x, y){
 let range = null;
 if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
 else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); range.collapse(true); } }
 if (range && ms.contains(range.startContainer)) {
  let el = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  while (el && el.parentNode !== ms) el = el.parentElement;
  if (el && el !== ms && !el.matches('figure.illus')) return {range, block: el};
 }
 return null;
}
// Move the figure to the text point (x,y) — drops it inline where the text flows.
function dropFigure(fig, clientX, clientY){
 // fresh drop clears any keyboard-nudge offset
 fig.dataset.nudgeX = 0; fig.dataset.nudgeY = 0; fig.style.transform = '';
 const at = textRangeAtPoint(clientX, clientY);
 if (at) {
  const {range, block} = at;
  if (block.firstElementChild !== fig) {
   const anchor = document.createElement('span');
   try { range.insertNode(anchor); } catch (err) { block.insertBefore(anchor, block.firstChild); }
   block.insertBefore(fig, anchor); anchor.remove();
  }
 } else {
  // No text under the cursor — place before/after the nearest block by Y
  const msR = ms.getBoundingClientRect();
  let best = null, bestD = 1e9;
  for (const b of Array.from(ms.children)) {
   if (b === fig || b.matches('figure.illus')) continue;
   const r = b.getBoundingClientRect(); const d = Math.abs(r.top + 30 - clientY);
   if (d < bestD) { bestD = d; best = b; }
  }
  if (best) { const br = best.getBoundingClientRect(); if (clientY < br.top + br.height/2) best.before(fig); else best.after(fig); }
  else ms.append(fig);
 }
 if(!fig.nextElementSibling){ const p=document.createElement('p'); p.innerHTML='<br>'; fig.after(p); }
 changed(); positionFigUI();
}
ms.addEventListener('pointerdown', e => {
 const fig = e.target.closest('figure.illus');
 if(!fig){ clearFigSel(); return; }
 e.preventDefault();
 if(figSel !== fig) selectFigure(fig);
 figMove = { fig, startX: e.clientX, startY: e.clientY, started:false };
});
window.addEventListener('pointermove', e => {
 if(figDrag){ e.preventDefault(); const dPct=(e.clientX-figDrag.startX)/figDrag.blockPx*100; figDrag.fig.style.width = Math.round(Math.max(18, Math.min(100, figDrag.startW + dPct))) + '%'; positionFigUI(); return; }
 if(figMove){
  if(!figMove.started && Math.hypot(e.clientX-figMove.startX, e.clientY-figMove.startY) > 6){ figMove.started=true; document.body.classList.add('dragging-fig'); figMove.fig.classList.add('moving'); }
  if(figMove.started) e.preventDefault();
 }
});
window.addEventListener('pointerup', e => {
 if(figDrag){ figDrag=null; document.body.classList.remove('resizing-fig'); changed(); }
 if(figMove){
  const m=figMove; figMove=null; document.body.classList.remove('dragging-fig'); m.fig.classList.remove('moving');
  if(m.started) dropFigure(m.fig, e.clientX, e.clientY);
 }
});
window.addEventListener('pointercancel', () => { if(figDrag) figDrag=null; if(figMove) figMove=null; document.body.classList.remove('resizing-fig','dragging-fig'); document.querySelectorAll('figure.illus.moving').forEach(f=>f.classList.remove('moving')); });
figResize.addEventListener('pointerdown', e => {
 e.preventDefault(); e.stopPropagation();
 if(!figSel) return;
 const r = figSel.getBoundingClientRect(), blockPx = figColumnPx();
 const curPct = figSel.style.width ? parseFloat(figSel.style.width) : (r.width/blockPx*100);
 figDrag = { fig:figSel, startW: curPct, startX: e.clientX, blockPx };
 document.body.classList.add('resizing-fig');
});
figTools.addEventListener('click', e => {
 const b = e.target.closest('[data-fig]'); if(!b || !figSel) return;
 const act = b.dataset.fig;
 if(act==='delete'){ removeFigure(figSel); }
 else if(act==='reset'){ figSel.style.width=FIG_DEF_W; applyFigWrap(figSel, figSel.dataset.wraps || 'left'); changed(); positionFigUI(); }
 else if(act==='left' || act==='right' || act==='none'){ applyFigWrap(figSel, act); changed(); positionFigUI(); }
 else if(act==='regen'){ regenFigure(figSel); }
});
viewportEl.addEventListener('scroll', positionFigUI);
window.addEventListener('resize', positionFigUI);
window.addEventListener('blur', clearFigSel);
document.addEventListener('selectionchange', () => { const r=selectionRange(); if(!r) clearFigSel(); });
document.addEventListener('selectionchange', () => { const r = selectionRange(); if (r && active) { ranges.set(active, r.cloneRange()); emit('selection', r.toString().trim()); } rulerSync(); });

// ── Regenerate a figure (random seed → genuinely new illustration) ──
let regenBusy = false;
function regenFigure(fig){
 if (regenBusy) { toast('Генерация уже идёт'); return; }
 if (!navigator.onLine) { toast('Нет интернета — генерация недоступна'); return; }
 const capEl = fig.querySelector('figcaption');
 const excerptText = (capEl && capEl.textContent.trim()) || fig.dataset.excerpt || '';
 const prompt = fig.dataset.prompt || excerptText;
 if (!prompt) { toast('Нет данных для повторной генерации'); return; }
 if (!window.__pgAiFetchIllustration) { toast('ИИ-модуль ещё не готов, попробуйте ещё раз'); return; }
 regenBusy = true;
 const prevSrc = fig.querySelector('img') ? fig.querySelector('img').getAttribute('src') : '';
 fig.style.opacity = '.55';
 const seed = 1 + Math.floor(Math.random() * 2e9);
 const ctrl = new AbortController();
 const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 90000);
 window.__pgAiFetchIllustration(prompt, seed, ctrl.signal)
 .then(blob => { if (!blob || !blob.type || blob.type.indexOf('image/') !== 0) throw new Error('Ответ не изображение'); return cropWatermark(blob); })
 .then(dataUrl => {
  const img = fig.querySelector('img'); if (img) img.src = dataUrl;
  fig.dataset.dataUrl = dataUrl;
  fig.style.opacity = '';
  changed();
  toast('Готово — новая иллюстрация');
 })
 .catch(err => {
  if (prevSrc) { const img = fig.querySelector('img'); if (img) img.src = prevSrc; }
  fig.style.opacity = '';
  toast(err && err.name === 'AbortError' ? 'Таймаут генерации (90 с)' : 'Ошибка: ' + String(err && err.message || 'генерация').slice(0, 80));
 })
 .then(() => { clearTimeout(timer); regenBusy = false; });
}
function blobToDataUrlP(blob){
 return new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error('Не удалось прочитать изображение'));
  fr.readAsDataURL(blob);
 });
}
// Crop the top/bottom strips where Pollinations puts its watermark (bottom-right logo + bottom-left label)
function cropWatermark(blob){
 return new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
   try {
    const W = img.naturalWidth, H = img.naturalHeight;
    const crop = Math.round(H * 0.07);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = Math.max(64, H - crop * 2);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, crop, W, H - crop * 2, 0, 0, W, H - crop * 2);
    canvas.toBlob(b => { URL.revokeObjectURL(url); if (b) blobToDataUrlP(b).then(resolve).catch(reject); else reject(new Error('Не удалось обработать изображение')); }, 'image/jpeg', 0.92);
   } catch (err) { URL.revokeObjectURL(url); reject(err); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
  img.src = url;
 });
}
// ── Ruler: Word-style, OUTSIDE the book. Horizontal (top): paragraph indents (draggable). Vertical (left): caret-line indicator. ──
const ruler = $('ruler-h'), frameEl = document.querySelector('.page-frame'), bookWrap = document.querySelector('.book');
const rhL = $('rh-left'), rhF = $('rh-first'), rhR = $('rh-right'), rulerRead = $('ruler-read'), rulerToggle = $('ruler-toggle'), rvCursor = $('rv-cursor');
function currentBlock() {
 const r = selectionRange() || ranges.get(active);
 if (!r || !ms.contains(r.startContainer)) return null;
 let el = r.startContainer.nodeType === Node.ELEMENT_NODE ? r.startContainer : r.startContainer.parentElement;
 while (el && el.parentNode !== ms) el = el.parentElement;
 return (el && el !== ms) ? el : null;
}
function rulerGeom() {
 const msR = ms.getBoundingClientRect(), rulerR = ruler.getBoundingClientRect();
 const left = msR.left - rulerR.left;
 if (!bookWrap.classList.contains('twp')) return {origin: left, width: msR.width};
 const gap = parseFloat(getComputedStyle(ms).columnGap) || 64;
 const colW = (msR.width - gap) / 2;
 const b = currentBlock(), bR = b ? b.getBoundingClientRect() : null;
 const inRight = bR ? bR.left >= msR.left + colW + gap / 2 : false;
 return {origin: left + (inRight ? colW + gap : 0), width: colW};
}
function blockIndents(b) {
 const cs = getComputedStyle(b);
 return {l: parseFloat(cs.paddingLeft) || 0, f: parseFloat(cs.textIndent) || 0, r: parseFloat(cs.paddingRight) || 0};
}
function rulerSync() {
 if (frameEl.classList.contains('ruler-off')) return;
 const b = currentBlock();
 if (!b) { rhL.style.display = rhF.style.display = rhR.style.display = 'none'; rulerRead.textContent = ''; rvCursor.style.opacity = '0'; return; }
 rhL.style.display = rhF.style.display = rhR.style.display = 'block';
 const g = rulerGeom(), ind = blockIndents(b);
 rhL.style.left = (g.origin + ind.l) + 'px';
 rhF.style.left = (g.origin + ind.l + ind.f) + 'px';
 rhR.style.left = (g.origin + g.width - ind.r) + 'px';
 rulerRead.textContent = Math.round(ind.l) + ' · ' + Math.round(ind.f) + ' · ' + Math.round(ind.r);
 const r = selectionRange();
 if (r && ms.contains(r.startContainer)) {
  const cr = document.createRange();
  cr.setStart(r.startContainer, r.startOffset); cr.collapse(true);
  const rects = cr.getClientRects();
  const line = rects.length ? rects[0] : null;
  if (line) {
   const vR = rvCursor.parentElement.getBoundingClientRect();
   const scr = 0;
   const y = Math.max(7, Math.min(vR.height - 7, line.top + line.height / 2 - vR.top + scr));
   rvCursor.style.top = y + 'px'; rvCursor.style.opacity = '1';
   return;
  }
 }
 rvCursor.style.opacity = '0';
}
function setRuler(on) {
 frameEl.classList.toggle('ruler-off', !on);
 rulerToggle.setAttribute('aria-pressed', String(on));
 try { localStorage.setItem('pg.ruler', on ? '1' : '0'); } catch (e) {}
 if (on) rulerSync();
}
rulerToggle.addEventListener('click', () => setRuler(frameEl.classList.contains('ruler-off')));
let rulerDrag = null;
for (const [kind, el] of [['l', rhL], ['f', rhF], ['r', rhR]]) {
 el.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  const b = currentBlock(); if (!b) return;
  rulerDrag = {kind, b, g: rulerGeom(), startInd: blockIndents(b), startX: e.clientX, moved: false};
  document.body.classList.add('dragging-ruler');
 });
 el.addEventListener('dblclick', () => {
  const b = currentBlock(); if (!b) return;
  if (kind === 'l') b.style.paddingLeft = '0px';
  else if (kind === 'f') b.style.textIndent = '0px';
  else b.style.paddingRight = '0px';
  changed(); rulerSync();
 });
}
window.addEventListener('pointermove', e => {
 if (!rulerDrag || !e.isPrimary) return;
 const {b, g, kind} = rulerDrag, dx = e.clientX - rulerDrag.startX, s = rulerDrag.startInd;
 let l = s.l, f = s.f, r = s.r;
 if (kind === 'l') l = Math.max(0, Math.min(g.width - 40, s.l + dx));
 else if (kind === 'f') f = Math.max(0, Math.min(g.width - s.l - 10, s.f + dx));
 else r = Math.max(0, Math.min(g.width - s.l - s.f - 10, s.r - dx));
 b.style.paddingLeft = Math.round(l) + 'px';
 b.style.textIndent = Math.round(f) + 'px';
 b.style.paddingRight = Math.round(r) + 'px';
 rulerDrag.moved = true;
 rulerSync();
});
window.addEventListener('pointerup', () => {
 if (!rulerDrag) return;
 if (rulerDrag.moved) changed();
 rulerDrag = null; document.body.classList.remove('dragging-ruler');
});
window.addEventListener('pointercancel', () => {
 if (!rulerDrag) return;
 rulerDrag = null; document.body.classList.remove('dragging-ruler');
});
window.addEventListener('resize', rulerSync);
let rulerOn = true; try { rulerOn = localStorage.getItem('pg.ruler') !== '0'; } catch (e) {}
setRuler(rulerOn);
// ── Pagination: viewport-windowed pages, arrows in the bottom corners ──
const pgPrev = $('pg-prev'), pgNext = $('pg-next'), pgCount = $('pg-count');
let pgN = 1, pgI = 0;
function pgMetrics() {
 const vh = viewportEl.clientHeight;
 const total = viewportEl.scrollHeight;
 // distinct reachable scroll positions (last fragment that can't be reached is not a page)
 const n = Math.max(1, Math.floor((total - vh) / vh) + 1);
 const i = Math.min(n - 1, Math.max(0, Math.round(viewportEl.scrollTop / vh)));
 return {vh, n, i};
}
function pgPaint() {
 const {n, i} = pgMetrics();
 pgN = n; pgI = i;
 pgCount.textContent = i + 1 + ' / ' + n;
 pgPrev.disabled = i <= 0;
 pgNext.disabled = i >= n - 1;
}
let pgAnimT = null, pgLastTurn = 0;
function pgGo(i) {
 const {vh, n} = pgMetrics();
 viewportEl.scrollTop = Math.max(0, Math.min(n - 1, i)) * vh;
}
function pgTurn(dir, animate = true) {
 const {n, i} = pgMetrics();
 const target = Math.max(0, Math.min(n - 1, i + dir));
 if (target === i) { pgPaint(); return; }
 if (animate && bookEl) {
  bookEl.classList.remove('turn-next', 'turn-prev'); void bookEl.offsetWidth;
  bookEl.classList.add(dir > 0 ? 'turn-next' : 'turn-prev');
  clearTimeout(pgAnimT); pgAnimT = setTimeout(() => bookEl.classList.remove('turn-next', 'turn-prev'), 500);
 }
 pgLastTurn = Date.now();
 pgGo(target);
}
pgPrev.addEventListener('click', () => pgTurn(-1));
pgNext.addEventListener('click', () => pgTurn(1));
// Wheel = one page turn (no free fall): coalesce a gesture into a single turn.
let pgWheelT = null;
viewportEl.addEventListener('wheel', e => {
 e.preventDefault();
 clearTimeout(pgWheelT);
 pgWheelT = setTimeout(() => { if (Date.now() - pgLastTurn >= 240) pgTurn(e.deltaY > 0 ? 1 : -1); }, 140);
}, {passive: false});
document.addEventListener('keydown', e => {
 if (e.key === 'PageDown') { e.preventDefault(); pgTurn(1); }
 else if (e.key === 'PageUp') { e.preventDefault(); pgTurn(-1); }
 // Word-like: while a figure is selected, ALL arrow keys nudge it by pixels
 // (text reflows around the new position, like in Word). Shift = big step.
 else if (figSel && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
  // Word-like: nudge the selected image by pixels; Shift = big step.
  e.preventDefault(); e.stopPropagation();
  const step = e.shiftKey ? 20 : 4;
  const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
  const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
  figSel.dataset.nudgeX = (parseInt(figSel.dataset.nudgeX, 10) || 0) + dx;
  figSel.dataset.nudgeY = (parseInt(figSel.dataset.nudgeY, 10) || 0) + dy;
  applyFigNudge(figSel);
  changed(); positionFigUI();
 }
});
// Touch: horizontal swipe = one page turn
let pgTouch = null;
viewportEl.addEventListener('touchstart', e => { const t = e.touches[0]; pgTouch = {x: t.clientX, y: t.clientY}; }, {passive: true});
viewportEl.addEventListener('touchend', e => {
 if (!pgTouch) return; const t = e.changedTouches[0];
 const dx = t.clientX - pgTouch.x, dy = t.clientY - pgTouch.y; pgTouch = null;
 if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) pgTurn(dx < 0 ? 1 : -1);
}, {passive: true});
let pgScrollT = null;
viewportEl.addEventListener('scroll', () => { clearTimeout(pgScrollT); pgScrollT = setTimeout(pgPaint, 90); });
window.addEventListener('resize', pgPaint);
// Poll: the scroll event is the fast path (real user wheel); this interval is the
// safety net so the counter/arrows always match the current position even when
// rAF is throttled (backgrounded tab) or scroll events are coalesced.
let pgLast = -1, pgLastH = -1;
setInterval(() => {
 const t = viewportEl.scrollTop, h = viewportEl.scrollHeight;
 if (t !== pgLast || h !== pgLastH) { pgLast = t; pgLastH = h; pgPaint(); }
}, 120);
// keep the counter fresh as content changes (typing, book switch, figure insert)
new MutationObserver(() => pgPaint()).observe(ms, {childList:true, subtree:true, characterData:true});
new ResizeObserver(() => pgPaint()).observe(viewportEl);
// caret follows pages: when the caret moves, center its line in the viewport
function pgFollowCaret() {
 const r = selectionRange();
 if (!r || !ms.contains(r.startContainer)) return;
 const cr = document.createRange(); cr.setStart(r.startContainer, r.startOffset); cr.collapse(true);
 const rects = cr.getClientRects();
 if (!rects.length) return;
 const line = rects[0];
 const vr = viewportEl.getBoundingClientRect();
 const mid = line.top + line.height / 2;
 if (mid < vr.top + 60 || mid > vr.bottom - 60) {
  viewportEl.scrollTo({top: viewportEl.scrollTop + (mid - (vr.top + vr.height / 2))});
 }
}
document.addEventListener('selectionchange', pgFollowCaret);
pgPaint();
ms.addEventListener('input', changed);
ms.addEventListener('keydown', e => {
 if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); command('__tab'); }
 if (e.ctrlKey || e.metaKey) {
  const k = e.key.toLowerCase();
  const map = { b:'bold', i:'italic', u:'underline', l:'justifyLeft', e:'justifyCenter', r:'justifyRight', j:'justifyFull' };
  if (map[k]) { e.preventDefault(); command(map[k]); }
  else if (k === 's') { e.preventDefault(); flush(); toast('Сохранено'); }
 }
});
ms.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); changed(); });
ms.addEventListener('drop', e => e.preventDefault());
$('books').addEventListener('change', e => openBook(e.target.value));
for (const el of document.querySelectorAll('[data-command]')) { el.addEventListener('mousedown', e => e.preventDefault()); el.addEventListener('click', () => command(el.dataset.command)); }
$('heading').addEventListener('change', e => command('formatBlock', e.target.value));
$('font').addEventListener('change', e => updateBook(active, {font:e.target.value}));
$('fsize').addEventListener('change', e => { const size = Math.max(15, Math.min(30, Number(e.target.value) || 22)); updateBook(active, {fsize:size}); });
$('paper').addEventListener('change', e => updateBook(active, {paper:e.target.value}));
const pagesSel = $('pages');
const bookEl = document.querySelector('.book');
function applyPages(mode) { bookEl.classList.toggle('twp', mode === '2'); pagesSel.value = mode; }
pagesSel.addEventListener('change', () => { applyPages(pagesSel.value); try { localStorage.setItem('pg.pages', pagesSel.value); } catch (e) {} });
$('heading-style').addEventListener('change', e => updateBook(active, {headingStyle:e.target.value}));
$('new-book').addEventListener('click', () => { flush(); $('new-form').reset(); $('new-dialog').showModal(); $('new-title').focus(); });
$('cancel-new').addEventListener('click', () => $('new-dialog').close());
$('new-form').addEventListener('submit', e => { e.preventDefault(); const title = $('new-title').value.trim(); if (!title) { $('new-title').focus(); return; } flush(); const book = makeBook(title, $('new-style').value.trim()); books.set(book.id, book); persist(book); refreshLibrary(); openBook(book.id); $('new-dialog').close(); ms.focus(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); }); window.addEventListener('pagehide', flush); window.addEventListener('beforeunload', flush);
async function init() {
 try {
  ms.contentEditable = 'false'; $('new-book').disabled = true;
  db = await new Promise((resolve, reject) => { const req = indexedDB.open('pergamin', 1); req.onupgradeneeded = () => req.result.createObjectStore('books', {keyPath:'id'}); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const saved = await new Promise((resolve, reject) => { const req = db.transaction('books').objectStore('books').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  saved.forEach(b => books.set(b.id, b));
  if (!books.size) { const b = makeBook('Хранитель северного ветра', 'акварель, холодные сине-серые тона, лёгкая дымка, в духе классической фэнтези-иллюстрации', '<h2>Глава 1</h2><p>Ветер пришёл с севера задолго до рассвета. Он скользнул по крышам спящей деревни, коснулся замёрзшего колодца и остановился у окна старого хранителя.</p><p>Мира проснулась от тихого звона. На подоконнике лежал серебряный лист — в этих краях деревья сбрасывали только золотые. Она осторожно взяла его в ладони и услышала далёкий шум моря.</p><p>За перевалом кто-то зажёг огонь. Там, где много лет не было ни дорог, ни людей, начиналась её история.</p>'); books.set(b.id,b); persist(b); }
  refreshLibrary(); let lastId = ''; try { lastId = localStorage.getItem('pg.lastBook') || ''; } catch (e) {} if (!books.has(lastId)) { let best = ''; let bestScore = [-1, -1]; for (const b of books.values()) { const score = [(b.content || '').length, b.updatedAt || b.createdAt || 0]; if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) { bestScore = score; best = b.id; } } lastId = best; } openBook(lastId); ms.contentEditable = 'true'; $('new-book').disabled = false; $('saved').textContent = '✓ Сохранено'; connectivity();
  let mode = '2'; try { mode = localStorage.getItem('pg.pages') || '2'; } catch (e) {} applyPages(mode);
 } catch (err) { console.error(err); $('saved').textContent = 'Хранилище недоступно'; toast('Не удалось открыть библиотеку. Разрешите локальное хранение и перезагрузите страницу.'); }
 if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(error => { console.warn(error); toast('Офлайн-режим пока не подготовлен. Откройте приложение через локальный сервер.'); });
}
init();
})();
