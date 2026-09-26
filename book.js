(() => {
'use strict';
const $ = id => document.getElementById(id);
const ms = $('ms'), books = new Map(), events = new Map(), ranges = new Map();
const viewportEl = $('page-scroll');
let db, active = '', timer, toastTimer, dirty = false, savePending = 0, revision = 0;
const latestSaveRev = new Map(), failedSaves = new Set();
const font = "'Cormorant Garamond', Georgia, serif";
function toast(msg) { $('toast').textContent = String(msg); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4200); }
function emit(evt, value) { for (const cb of events.get(evt) || []) { try { cb(value); } catch (error) { console.error(error); } } }
function persist(book) {
 const rev = ++revision, id=book.id; latestSaveRev.set(id,rev); savePending++; $('saved').textContent = 'Сохраняем…';
 return new Promise(resolve => {
  let tx, settled=false;
  const finish=(ok,error)=>{
   if(settled)return; settled=true; savePending=Math.max(0,savePending-1);
   if(ok){ if(latestSaveRev.get(id)===rev)failedSaves.delete(id); }
   else if(latestSaveRev.get(id)===rev){ failedSaves.add(id); if(id===active)dirty=true; console.error(error); toast('Не удалось сохранить книгу. Проверьте свободное место на устройстве.'); }
   $('saved').textContent=(!dirty&&!savePending&&!failedSaves.size)?'✓ Сохранено':'Не сохранено'; resolve(ok);
  };
  try { tx = db.transaction('books', 'readwrite'); tx.objectStore('books').put(book); }
  catch (error) { finish(false,error); return; }
  tx.oncomplete = () => finish(true);
  tx.onabort = tx.onerror = () => finish(false,tx.error||new Error('Ошибка IndexedDB'));
 });
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
 const book = normalizeBook({...old, ...patch, id:old.id, updatedAt:Date.now()});
 books.set(id, book);
 if (id === active) { if ('content' in patch && ms.innerHTML !== book.content) { ms.innerHTML = book.content; ranges.delete(id); } applyStyle(book); updateWritingStats(); if (!$('search-panel').hidden) renderSearch(); }
 if ('title' in patch) refreshLibrary();
 return persist(book);
}
function flush() {
 clearTimeout(timer); const tasks=[], retryIds=new Set(failedSaves);
 if(dirty&&active){retryIds.delete(active);tasks.push(updateBook(active,{content:contentHTML()}));}
 for(const id of retryIds){const book=books.get(id);if(book)tasks.push(persist(book));}
 return tasks.length?Promise.all(tasks).then(results=>results.every(Boolean)):Promise.resolve(!failedSaves.size);
}
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
    if (!fig.dataset.figureId) { fig.dataset.figureId = crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2); changedAny = true; }
    if (fig.tabIndex !== 0) { fig.tabIndex = 0; changedAny = true; }
    if (!fig.getAttribute('aria-label')) { fig.setAttribute('aria-label','Иллюстрация книги. Enter — выбрать, стрелки — переместить.'); changedAny = true; }
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
function changed() { dirty = true; $('saved').textContent = 'Изменения…'; updateWritingStats(); if (!$('search-panel').hidden) renderSearch(); clearTimeout(timer); timer = setTimeout(flush, 500); }
// HTML to persist: clone the content and strip transient UI-only classes
// (selected/moving) so they never leak into the saved book markup.
function contentHTML(){
 const c = ms.cloneNode(true);
 c.querySelectorAll('figure.illus').forEach(f => f.classList.remove('sel','moving'));
 return c.innerHTML;
}
function sanitizeContent(html){
 const host = document.createElement('div'); host.innerHTML = String(html || '');
 const dangerous = 'script,style,iframe,object,embed,link,meta,form,input,button,textarea,select,svg,math,video,audio,source,picture,canvas,template';
 host.querySelectorAll(dangerous).forEach(el => el.remove());
 const allowedTags = new Set(['P','BR','DIV','H1','H2','H3','H4','STRONG','B','I','EM','U','S','SPAN','BLOCKQUOTE','UL','OL','LI','FIGURE','IMG','HR']);
 const allowedStyles = new Set(['float','width','max-width','margin','margin-top','margin-right','margin-bottom','margin-left','transform','opacity','padding-left','padding-right','text-indent','text-align','font-weight','font-style','text-decoration','white-space']);
 const safeCss = (name,value) => {
  const v=String(value||'').trim(); if(!v||/url\s*\(|expression\s*\(|@import|javascript:|var\s*\(/i.test(v))return '';
  if(name==='float')return /^(left|right|none)$/.test(v)?v:'';
  if(['width','max-width','padding-left','padding-right','text-indent'].includes(name))return /^-?\d+(?:\.\d+)?(?:px|%|em|rem)$/.test(v)?v:'';
  if(name.startsWith('margin'))return /^(?:-?\d+(?:\.\d+)?(?:px|%|em|rem)|0|auto)(?:\s+(?:-?\d+(?:\.\d+)?(?:px|%|em|rem)|0|auto)){0,3}$/.test(v)?v:'';
  if(name==='transform')return /^translate\(-?\d+(?:\.\d+)?px,\s*-?\d+(?:\.\d+)?px\)$/.test(v)?v:'';
  if(name==='opacity')return /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(v)?v:'';
  if(name==='text-align')return /^(left|right|center|justify|start|end)$/.test(v)?v:'';
  if(name==='font-weight')return /^(normal|bold|[1-9]00)$/.test(v)?v:'';
  if(name==='font-style')return /^(normal|italic)$/.test(v)?v:'';
  if(name==='text-decoration')return /^(none|underline|line-through)$/.test(v)?v:'';
  if(name==='white-space')return /^(normal|pre|pre-wrap)$/.test(v)?v:'';
  return '';
 };
 for (const el of Array.from(host.querySelectorAll('*'))) {
  if(!allowedTags.has(el.tagName)){ el.replaceWith(...el.childNodes); continue; }
  const safeStyle=[]; for(const name of allowedStyles){ const value=safeCss(name,el.style.getPropertyValue(name)); if(value)safeStyle.push(name+':'+value); }
  const keep=new Map();
  if(el.tagName==='FIGURE'){
   keep.set('class','illus'); keep.set('contenteditable','false'); keep.set('tabindex','0'); keep.set('aria-label','Иллюстрация книги. Enter — выбрать, стрелки — переместить.');
   for(const name of ['data-figure-id','data-prompt','data-excerpt','data-wraps','data-cropped','data-nudge-x','data-nudge-y'])if(el.hasAttribute(name))keep.set(name,el.getAttribute(name).slice(0,name==='data-prompt'?4000:500));
  } else if(el.tagName==='IMG'){
   const src=el.getAttribute('src')||''; if(/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(src))keep.set('src',src); keep.set('alt',String(el.getAttribute('alt')||'Иллюстрация').slice(0,500));
  }
  for(const attr of Array.from(el.attributes))el.removeAttribute(attr.name);
  for(const [name,value] of keep)el.setAttribute(name,value);
  if(safeStyle.length)el.setAttribute('style',safeStyle.join(';'));
 }
 return host.innerHTML;
}
function normalizeBook(raw){
 const now = Date.now(), b = raw && typeof raw === 'object' ? raw : {};
 return {
  id:String(b.id || (crypto.randomUUID ? crypto.randomUUID() : now + '-' + Math.random().toString(36).slice(2))),
  title:String(b.title || 'Без названия').slice(0,160), byline:String(b.byline || '').slice(0,160),
  content:String(b.content || ''), font:String(b.font || font), fsize:Math.max(15,Math.min(30,Number(b.fsize)||22)),
  headingFont:String(b.headingFont || font), headingStyle:b.headingStyle === 'italic' ? 'italic' : 'normal',
  paper:/^#[0-9a-f]{6}\|#[0-9a-f]{6}$/i.test(String(b.paper || '')) ? b.paper : '#f2e4c4|#d6bd8b',
  illusStyle:String(b.illusStyle || '').slice(0,2000), illusHistory:Array.isArray(b.illusHistory) ? b.illusHistory.slice(-10).map(h=>({id:String(h?.id||''),what:String(h?.what||'').slice(0,500),prompt:String(h?.prompt||'').slice(0,4000),ts:Number(h?.ts)||now})) : [],
  wordGoal:Math.max(0,Math.min(10000000,Number(b.wordGoal)||0)),
  createdAt:Number(b.createdAt)||now, updatedAt:Number(b.updatedAt)||now
 };
}
function textMap(root){
 const parts=[], spans=[]; let length=0;
 const blocks=new Set(['P','DIV','H1','H2','H3','H4','BLOCKQUOTE','LI','UL','OL','FIGURE','HR']);
 const space=()=>{ if(length && !/\s$/.test(parts[parts.length-1]||'')){parts.push(' ');length++;} };
 const walk=node=>{
  if(node.nodeType===Node.TEXT_NODE){const value=node.nodeValue||'';if(value){spans.push({node,start:length,end:length+value.length});parts.push(value);length+=value.length;}return;}
  if(node.nodeType!==Node.ELEMENT_NODE)return;
  if(node.tagName==='BR'){space();return;}
  const block=blocks.has(node.tagName); if(block)space(); for(const child of node.childNodes)walk(child); if(block)space();
 };
 for(const child of root.childNodes)walk(child);
 return {text:parts.join('').replace(/\u00a0/g,' '),spans};
}
function textStats(value){
 const host = document.createElement('div'); host.innerHTML = String(value || '');
 const text = textMap(host).text.replace(/\s+/g,' ').trim();
 const words = text ? (text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) || []).length : 0;
 return {words, chars:text.length, readingMinutes:words ? Math.max(1,Math.ceil(words/200)) : 0, text};
}
function updateWritingStats(){
 const stats = textStats(contentHTML());
 $('stat-words').textContent = stats.words.toLocaleString('ru-RU'); $('stat-chars').textContent = stats.chars.toLocaleString('ru-RU');
 $('stat-reading').textContent = stats.readingMinutes + ' мин чтения';
 const goal = Math.max(0, Number(books.get(active)?.wordGoal)||0); $('word-goal').value = goal || '';
 $('goal-progress').max = Math.max(1, goal); $('goal-progress').value = goal ? Math.min(goal, stats.words) : 0;
 $('goal-label').textContent = goal ? Math.min(100,Math.round(stats.words/goal*100)) + '% · ' + Math.max(0,goal-stats.words).toLocaleString('ru-RU') + ' осталось' : 'Цель не задана';
 return stats;
}
function foldText(value){
 const source=String(value||''), parts=[], map=[]; let offset=0;
 for(const char of source){const folded=char.toLocaleLowerCase('ru-RU');parts.push(folded);for(let i=0;i<folded.length;i++)map.push({start:offset,end:offset+char.length});offset+=char.length;}
 return {text:parts.join(''),map};
}
function searchBook(query, root = ms){
 const rawQuery=String(query || '').trim(); if (!rawQuery) return [];
 const text = textMap(root).text, folded=foldText(text), q=foldText(rawQuery).text, lower=folded.text, out = [];
 let from = 0, index;
 while ((index = lower.indexOf(q, from)) !== -1 && out.length < 500) {
  const originalStart=folded.map[index]?.start??0, originalEnd=folded.map[index+q.length-1]?.end??originalStart;
  const start = Math.max(0,originalStart-45), end = Math.min(text.length,originalEnd+65);
  out.push({index:originalStart, length:originalEnd-originalStart, snippet:(start ? '…' : '') + text.slice(start,end).replace(/\s+/g,' ') + (end < text.length ? '…' : '')});
  from = index + Math.max(1,q.length);
 }
 return out;
}
function rangeForTextOffset(offset, length){
 const {spans}=textMap(ms); let start=null, end=null;
 for(const span of spans){
  const size=(span.node.nodeValue||'').length;
  if(!start && offset<=span.end)start={node:span.node,offset:Math.max(0,Math.min(size,offset-span.start))};
  if(offset+length<=span.end){end={node:span.node,offset:Math.max(0,Math.min(size,offset+length-span.start))};break;}
 }
 if(!start)return null; if(!end)end={node:start.node,offset:Math.min((start.node.nodeValue||'').length,start.offset+length)};
 const r=document.createRange(); r.setStart(start.node,start.offset); r.setEnd(end.node,end.offset); return r;
}
function renderSearch(){
 const q=$('search-input').value, results=searchBook(q), host=$('search-results'); host.replaceChildren();
 $('search-summary').textContent = q.trim() ? (results.length ? 'Найдено: '+results.length : 'Совпадений нет') : 'Введите запрос';
 if (!q.trim() || !results.length) { const empty=document.createElement('div'); empty.className='search-empty'; empty.textContent=q.trim()?'Попробуйте другой запрос':'Поиск работает по всей открытой книге'; host.append(empty); return results; }
 results.slice(0,100).forEach((item,i)=>{ const b=document.createElement('button'); b.type='button'; b.className='search-result'; b.textContent=(i+1)+'. '+item.snippet; b.addEventListener('click',()=>{ const r=rangeForTextOffset(item.index,item.length); if(!r)return; const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r); ranges.set(active,r.cloneRange()); r.startContainer.parentElement?.scrollIntoView({block:'center'}); ms.focus(); host.querySelectorAll('.active').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }); host.append(b); });
 return results;
}
function setSearch(open){ $('search-panel').hidden=!open; $('search-toggle').setAttribute('aria-expanded',String(open)); if(open){ renderSearch(); requestAnimationFrame(()=>$('search-input').focus()); } }
function createBackup(){
 flush(); return {app:'pergamin',version:1,exportedAt:new Date().toISOString(),books:Array.from(books.values(),b=>structuredClone(b))};
}
async function restoreBackup(payload){
 if (!payload || payload.app !== 'pergamin' || payload.version !== 1 || !Array.isArray(payload.books) || !payload.books.length) throw new Error('Файл использует неподдерживаемый формат резервной копии Пергамина');
 if (payload.books.length > 1000) throw new Error('В резервной копии слишком много книг');
 const saved=await flush();
 if(!saved)throw new Error('Не удалось сохранить текущую книгу перед восстановлением');
 const restored=payload.books.map(raw=>{ const b=normalizeBook(raw); b.content=sanitizeContent(b.content); b.updatedAt=Date.now(); return b; });
 await new Promise((resolve,reject)=>{ const tx=db.transaction('books','readwrite'), store=tx.objectStore('books'); restored.forEach(b=>store.put(b)); tx.oncomplete=resolve; tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Ошибка записи')); });
 restored.forEach(b=>books.set(b.id,b)); refreshLibrary(); openBook(restored[0].id); return restored.length;
}
function safeFilename(name){ return String(name||'book').trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g,'_').replace(/[. ]+$/,'').slice(0,90)||'book'; }
function downloadFile(name, data, type){ const blob=data instanceof Blob?data:new Blob([data],{type}); const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500); }
function exportCurrentBook(){
 flush(); const b=books.get(active); if(!b)return; const clean=sanitizeContent(contentHTML());
 const title=b.title.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const doc='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+title+'</title><style>body{max-width:850px;margin:40px auto;padding:0 28px;color:#2f261d;background:#f5ead2;font:21px/1.65 Georgia,serif}h1{text-align:center;font-weight:400}img{max-width:100%;height:auto}figure{margin:28px auto;text-align:center;break-inside:avoid}@media print{body{background:#fff;margin:0}}</style></head><body><h1>'+title+'</h1>'+clean+'</body></html>';
 downloadFile(safeFilename(b.title)+'.html',doc,'text/html;charset=utf-8');
}
async function deleteBook(id){
 if(!books.has(id))return false;
 if(id===active){clearTimeout(timer);dirty=false;}else{const saved=await flush();if(!saved)throw new Error('Не удалось сохранить текущую книгу перед удалением');}
 const remaining=Array.from(books.keys()).filter(x=>x!==id); let replacement=null;
 if(!remaining.length){ replacement=makeBook('Новая книга'); remaining.push(replacement.id); }
 await new Promise((resolve,reject)=>{ const tx=db.transaction('books','readwrite'), store=tx.objectStore('books'); store.delete(id); if(replacement)store.put(replacement); tx.oncomplete=resolve; tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Ошибка удаления')); });
 failedSaves.delete(id);latestSaveRev.delete(id);books.delete(id); if(replacement)books.set(replacement.id,replacement); refreshLibrary(); openBook(remaining[0]); return true;
}
function openBook(id) {
 if (!books.has(id)) return; flush(); active = id; try { localStorage.setItem('pg.lastBook', id); } catch (e) {} ms.innerHTML = books.get(id).content;
 // strip UI-only state classes that may have been persisted in the saved markup
 ms.querySelectorAll('figure.illus.sel, figure.illus.moving').forEach(f => f.classList.remove('sel', 'moving'));
 ranges.clear(); window.getSelection()?.removeAllRanges(); applyStyle(books.get(id)); $('books').value = id; $('heading').value = 'p';
 cleanLegacyFigures(id); updateWritingStats(); if (!$('search-panel').hidden) renderSearch();
 emit('bookopen', id);
}
function makeBook(title, style = '', content = '') {
 const now = Date.now();
 return {id:crypto.randomUUID ? crypto.randomUUID() : now + '-' + Math.random().toString(36).slice(2),title,byline:'',content,font,fsize:22,headingFont:font,headingStyle:'normal',paper:'#f2e4c4|#d6bd8b',illusStyle:style,illusHistory:[],wordGoal:0,createdAt:now,updatedAt:now};
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
 const book = books.get(bookId); if (!book) return false;
 if (!/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(dataUrl)) { toast('Не удалось вставить изображение: нужен dataURL изображения.'); return false; }
 const figure = document.createElement('figure'); figure.className = 'illus'; figure.contentEditable = 'false'; figure.tabIndex = 0; figure.setAttribute('aria-label','Иллюстрация книги. Enter — выбрать, стрелки — переместить.');
 const figureId = crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2); figure.dataset.figureId = figureId;
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
 updateBook(bookId, {content, illusHistory:[...book.illusHistory, {id:figureId, what:String(caption || ''), prompt:String(prompt || ''), ts:Date.now()}].slice(-10)});
 return true;
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
window.__pgMvp__ = {textStats, searchBook, createBackup, restoreBackup, deleteBook, exportCurrentBook, flush};
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
function removeFigure(fig){ const next=fig.nextElementSibling, figureId=fig.dataset.figureId||''; fig.remove(); if(!next){ const p=document.createElement('p'); p.innerHTML='<br>'; ms.append(p);} const book=books.get(active); clearFigSel(); if(book) updateBook(active,{content:contentHTML(),illusHistory:book.illusHistory.filter(h=>!figureId||h.id!==figureId)}); }
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
ms.addEventListener('focusin', e => { const fig=e.target.closest?.('figure.illus'); if(fig) selectFigure(fig); });
ms.addEventListener('keydown', e => { const fig=e.target.closest?.('figure.illus'); if(fig && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); selectFigure(fig); } });
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
function updateCommandState(){ for(const el of document.querySelectorAll('[data-command]')){ const cmd=el.dataset.command; if(cmd==='__tab')continue; let on=false; try{on=document.queryCommandState(cmd);}catch(e){} el.setAttribute('aria-pressed',String(on)); } }
document.addEventListener('selectionchange', () => { const r=selectionRange(); if(!r) clearFigSel(); updateCommandState(); });
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
 const regenBookId=active;
 const prevSrc = fig.querySelector('img') ? fig.querySelector('img').getAttribute('src') : '';
 fig.style.opacity = '.55';
 const seed = 1 + Math.floor(Math.random() * 2e9);
 const ctrl = new AbortController();
 const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 90000);
 window.__pgAiFetchIllustration(prompt, seed, ctrl.signal)
 .then(blob => { if (!blob || !blob.type || blob.type.indexOf('image/') !== 0) throw new Error('Ответ не изображение'); return cropWatermark(blob); })
 .then(dataUrl => {
  if(active!==regenBookId||!books.has(regenBookId)||!fig.isConnected||!ms.contains(fig))throw new Error('Книга была переключена или удалена — результат не применён');
  const img = fig.querySelector('img'); if (!img)throw new Error('Иллюстрация больше недоступна'); img.src = dataUrl;
  fig.style.opacity = '';
  changed();
  toast('Готово — новая иллюстрация');
 })
 .catch(err => {
  if (prevSrc && fig.isConnected) { const img = fig.querySelector('img'); if (img) img.src = prevSrc; }
  if(fig.isConnected)fig.style.opacity = '';
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
 const vh = Math.max(1, viewportEl.clientHeight);
 const total = viewportEl.scrollHeight, maxScroll = Math.max(0, total - vh);
 // Include a final partial viewport: wheel/touch pagination must never make the tail unreachable.
 const n = Math.max(1, Math.ceil(maxScroll / vh) + 1);
 const i = maxScroll > 0 && viewportEl.scrollTop >= maxScroll - 2 ? n - 1 : Math.min(n - 1, Math.max(0, Math.floor(viewportEl.scrollTop / vh)));
 return {vh, n, i, maxScroll};
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
 const {vh, n, maxScroll} = pgMetrics();
 const target = Math.max(0, Math.min(n - 1, i));
 viewportEl.scrollTop = target === n - 1 ? maxScroll : target * vh;
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
 const target=e.target, tag=target?.tagName; const formField=tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||target?.closest?.('dialog');
 if (formField && !figSel) return;
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
  else if (k === 's') { e.preventDefault(); flush().then(ok=>toast(ok?'Сохранено':'Сохранить не удалось')); }
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
function applyPages(mode) { const effective = window.matchMedia('(max-width:700px)').matches ? '1' : mode; bookEl.classList.toggle('twp', effective === '2'); pagesSel.value = effective; pgPaint(); }
pagesSel.addEventListener('change', () => { const mode=pagesSel.value; applyPages(mode); try { localStorage.setItem('pg.pages', mode); } catch (e) {} });
window.matchMedia('(max-width:700px)').addEventListener?.('change',()=>{ let mode='2'; try{mode=localStorage.getItem('pg.pages')||'2';}catch(e){} applyPages(mode); });
$('heading-style').addEventListener('change', e => updateBook(active, {headingStyle:e.target.value}));
$('new-book').addEventListener('click', () => { flush(); $('new-form').reset(); $('new-dialog').showModal(); $('new-title').focus(); });
$('cancel-new').addEventListener('click', () => $('new-dialog').close());
$('new-form').addEventListener('submit', e => { e.preventDefault(); const title = $('new-title').value.trim(); if (!title) { $('new-title').focus(); return; } flush(); const book = makeBook(title, $('new-style').value.trim()); books.set(book.id, book); persist(book); refreshLibrary(); openBook(book.id); $('new-dialog').close(); ms.focus(); });
$('search-toggle').addEventListener('click',()=>setSearch($('search-panel').hidden));
$('search-close').addEventListener('click',()=>setSearch(false));
$('search-input').addEventListener('input',renderSearch);
$('search-input').addEventListener('keydown',e=>{ if(e.key==='Escape'){e.preventDefault();setSearch(false);} else if(e.key==='Enter'){e.preventDefault();$('search-results').querySelector('.search-result')?.click();} });
document.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();setSearch(true);} else if(e.key==='Escape'&&!$('search-panel').hidden)setSearch(false); });
$('word-goal').addEventListener('change',e=>{ if(!active)return; const goal=Math.max(0,Math.min(10000000,Number(e.target.value)||0)); updateBook(active,{wordGoal:goal}); updateWritingStats(); toast(goal?'Цель сохранена':'Цель отключена'); });
function closeBookActions(){ document.querySelector('.book-actions')?.removeAttribute('open'); }
$('rename-book').addEventListener('click',()=>{ const book=books.get(active); if(!book)return; const title=prompt('Новое название книги',book.title); if(title===null)return; const clean=title.trim(); if(!clean){toast('Название не может быть пустым');return;} updateBook(active,{title:clean.slice(0,160)}); closeBookActions(); toast('Книга переименована'); });
$('export-book').addEventListener('click',()=>{ exportCurrentBook(); closeBookActions(); toast('Экспорт книги подготовлен'); });
$('backup-library').addEventListener('click',()=>{ const backup=createBackup(); downloadFile('pergamin-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(backup,null,2),'application/json;charset=utf-8'); closeBookActions(); toast('Резервная копия библиотеки сохранена'); });
$('restore-library').addEventListener('click',()=>{ closeBookActions(); $('restore-file').value=''; $('restore-file').click(); });
$('restore-file').addEventListener('change',async e=>{ const file=e.target.files?.[0]; if(!file)return; if(file.size>100*1024*1024){toast('Файл слишком большой (максимум 100 МБ)');return;} try{ const payload=JSON.parse(await file.text()); if(!confirm('Добавить книги из резервной копии в текущую библиотеку? Книги с теми же идентификаторами будут обновлены.'))return; const count=await restoreBackup(payload); toast('Восстановлено книг: '+count); }catch(err){console.error(err);toast('Не удалось восстановить: '+String(err.message||err).slice(0,100));} });
$('delete-book').addEventListener('click',async()=>{ const book=books.get(active); if(!book)return; closeBookActions(); if(!confirm('Удалить книгу «'+book.title+'»? Отменить это действие можно только через резервную копию.'))return; try{await deleteBook(active);toast('Книга удалена');}catch(err){console.error(err);toast('Не удалось удалить книгу');} });
document.addEventListener('click',e=>{ const details=document.querySelector('.book-actions'); if(details?.open&&!details.contains(e.target))details.removeAttribute('open'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', e => { flush(); if (dirty || savePending || failedSaves.size) { e.preventDefault(); e.returnValue = ''; } });
async function init() {
 try {
  ms.contentEditable = 'false'; $('new-book').disabled = true;
  db = await new Promise((resolve, reject) => { const req = indexedDB.open('pergamin', 1); req.onupgradeneeded = () => req.result.createObjectStore('books', {keyPath:'id'}); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  db.onversionchange = () => { db.close(); toast('Приложение обновилось в другом окне. Перезагрузите страницу.'); };
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const saved = await new Promise((resolve, reject) => { const req = db.transaction('books').objectStore('books').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  saved.forEach(b => { const clean=normalizeBook(b); books.set(clean.id, clean); });
  if (!books.size) { const b = makeBook('Хранитель северного ветра', 'акварель, холодные сине-серые тона, лёгкая дымка, в духе классической фэнтези-иллюстрации', '<h2>Глава 1</h2><p>Ветер пришёл с севера задолго до рассвета. Он скользнул по крышам спящей деревни, коснулся замёрзшего колодца и остановился у окна старого хранителя.</p><p>Мира проснулась от тихого звона. На подоконнике лежал серебряный лист — в этих краях деревья сбрасывали только золотые. Она осторожно взяла его в ладони и услышала далёкий шум моря.</p><p>За перевалом кто-то зажёг огонь. Там, где много лет не было ни дорог, ни людей, начиналась её история.</p>'); books.set(b.id,b); persist(b); }
  refreshLibrary(); let lastId = ''; try { lastId = localStorage.getItem('pg.lastBook') || ''; } catch (e) {} if (!books.has(lastId)) { let best = ''; let bestScore = [-1, -1]; for (const b of books.values()) { const score = [(b.content || '').length, b.updatedAt || b.createdAt || 0]; if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) { bestScore = score; best = b.id; } } lastId = best; } openBook(lastId); ms.contentEditable = 'true'; $('new-book').disabled = false; $('saved').textContent = '✓ Сохранено'; connectivity();
  let mode = '2'; try { mode = localStorage.getItem('pg.pages') || '2'; } catch (e) {} applyPages(mode);
 } catch (err) { console.error(err); $('saved').textContent = 'Хранилище недоступно'; toast('Не удалось открыть библиотеку. Разрешите локальное хранение и перезагрузите страницу.'); }
 if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(error => { console.warn(error); toast('Офлайн-режим пока не подготовлен. Откройте приложение через локальный сервер.'); });
}
init();
})();
