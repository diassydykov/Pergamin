/** Local writing tools. No accounts or manuscript uploads. */
(() => {
 'use strict';
 const $ = id => document.getElementById(id), ms = $('ms');
 const pg = window.__pg__, api = window.__pgWorkspace__, mvp = window.__pgMvp__;
 const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid = () => crypto.randomUUID(), book = () => pg.getBook(pg.currentBookId());
 const statuses = {plan:'План',draft:'Черновик',revision:'Редактура',ready:'Готово'};
 let tab = 'chapters', reading = false, directory = null, workspaceDb;
 let cardId = '', cardBookId = '', diskQueue = Promise.resolve();
 const saveTimers = new Map(), diskSnapshots = new Map(), sessions = new Map();
 const templates = {
  blank:{name:'Чистая рукопись',content:'<p><br></p>'},
  novel:{name:'Роман',content:'<h2>Часть первая</h2><h3>Сцена 1</h3><p><br></p><h2>Часть вторая</h2><p><br></p><h2>Часть третья</h2><p><br></p>'},
  story:{name:'Рассказ',content:'<h2>Начало</h2><p><br></p><h2>Поворот</h2><p><br></p><h2>Развязка</h2><p><br></p>'},
  memoir:{name:'Мемуары',content:'<h2>Предисловие</h2><p><br></p><h2>Ранние годы</h2><p><br></p><h2>Люди и события</h2><p><br></p><h2>Послесловие</h2><p><br></p>'}
 };
 const pane = document.createElement('aside'); pane.id='atelier-panel';pane.className='atelier-panel';pane.hidden=true;
 pane.setAttribute('aria-label','Мастерская автора');
 pane.innerHTML='<header><div><span class="eyebrow">МАСТЕРСКАЯ АВТОРА</span><h2>Материалы книги</h2></div><button id="atelier-close" aria-label="Закрыть мастерскую">×</button></header><nav class="atelier-tabs" aria-label="Разделы мастерской">'+Object.entries({chapters:'Главы',world:'Мир книги',library:'Библиотека',project:'На диске',layout:'Оформление',analysis:'Редактура',templates:'Шаблоны'}).map(([id,name])=>'<button data-atelier-tab="'+id+'">'+name+'</button>').join('')+'</nav><section id="atelier-content"></section>';
 document.body.append(pane);
 const button = document.createElement('button'); button.id='atelier-toggle';button.textContent='Мастерская';button.setAttribute('aria-expanded','false');button.onclick=()=>open(pane.hidden);
 document.querySelector('.toolbar .right').insertBefore(button,$('studio-toggle'));
 const readButton=document.createElement('button');readButton.id='reading-toggle';readButton.textContent='Читать';readButton.setAttribute('aria-pressed','false');readButton.onclick=()=>setReading(!reading);button.after(readButton);
 const importInput = document.createElement('input');importInput.id='manuscript-file';importInput.type='file';importInput.accept='.txt,.md,.markdown,.docx,.pgbook';importInput.hidden=true;document.body.append(importInput);
 const templateSelect=document.createElement('label');templateSelect.innerHTML='Шаблон<select id="new-template">'+Object.entries(templates).map(([id,t])=>'<option value="'+id+'">'+t.name+'</option>').join('')+'</select>';$('new-title').closest('label').after(templateSelect);
 const cardDialog=document.createElement('dialog');cardDialog.id='world-dialog';
 cardDialog.innerHTML='<form id="world-form"><span class="eyebrow">МИР КНИГИ</span><h1>Карточка материала</h1><label>Тип<select id="world-kind"><option value="character">Персонаж</option><option value="place">Место</option><option value="event">Событие</option><option value="world">Мир / правило</option></select></label><label>Название<input id="world-name" maxlength="160" required></label><label>Описание<textarea id="world-summary" rows="6" maxlength="4000"></textarea></label><label>Связи и упоминания<input id="world-links" maxlength="1000" placeholder="Имена персонажей, главы, места"></label><label>Дата / порядок в сюжете<input id="world-date" maxlength="80" placeholder="Например: День 3, утро"></label><div class="dialog-actions"><button id="world-cancel" type="button">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>';
 document.body.append(cardDialog);
 const commandDialog=document.createElement('dialog');commandDialog.id='command-dialog';
 commandDialog.innerHTML='<span class="eyebrow">КОМАНДЫ · CTRL + K</span><h1>Что открыть?</h1><input id="command-query" type="search" aria-label="Поиск команды" placeholder="Глава, импорт, печать…"><div id="command-results"></div><div class="dialog-actions"><button id="command-close">Закрыть</button></div>';document.body.append(commandDialog);
 const compareDialog=document.createElement('dialog');compareDialog.id='compare-dialog';compareDialog.className='compare-dialog';compareDialog.innerHTML='<span class="eyebrow">СРАВНЕНИЕ ВЕРСИЙ</span><h1>Изменения текста</h1><p id="compare-caption" class="dialog-copy"></p><div id="compare-content"></div><div class="dialog-actions"><button id="compare-close">Закрыть</button></div>';document.body.append(compareDialog);
 const printExtras=document.createElement('div');printExtras.innerHTML='<label class="check-row"><input id="print-toc" type="checkbox" checked> Оглавление</label><label class="check-row"><input id="print-chapters" type="checkbox" checked> Главы с нового листа</label><label class="check-row"><input id="print-cover" type="checkbox" checked> Обложка, если создана</label>';$('print-form').querySelector('.dialog-actions').before(printExtras);
 const error = e => {if(e?.name!=='AbortError'){console.error(e);pg.toast(e.message||'Не удалось выполнить действие');}};
 const run = fn => (...args)=>Promise.resolve().then(()=>fn(...args)).catch(error);
 const commit = async () => {ms.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText'}));if(!await mvp.flush())throw new Error('Изменения не сохранены');};
 const snapshot = async () => {if(window.__pgStudio__)await window.__pgStudio__.createSnapshot('manual',true);};
 function focusNode(node) { const r=document.createRange();r.selectNodeContents(node);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);ms.focus({preventScroll:true});api.reveal(false); }
 function open(on=true, section=tab) {pane.hidden=!on;$('atelier-toggle').setAttribute('aria-expanded',String(on));if(on){$('studio-panel').hidden=true;tab=section;render();}}
 $('atelier-close').onclick=()=>open(false);
 pane.querySelectorAll('[data-atelier-tab]').forEach(b=>b.onclick=()=>open(true,b.dataset.atelierTab));
 function setReading(on) {reading=Boolean(on);document.body.classList.toggle('reading-mode',reading);ms.contentEditable=String(!reading);ms.setAttribute('aria-readonly',String(reading));readButton.textContent=reading?'Писать':'Читать';readButton.setAttribute('aria-pressed',String(reading));requestAnimationFrame(()=>api.layoutChanged());}
 function chapterGroups() {
  const groups=[]; let group=null;
  for(const node of ms.children){if(/^H[12]$/.test(node.tagName)){group={heading:node,nodes:[]};groups.push(group);}if(group)group.nodes.push(node);}
  return groups;
 }
 async function addChapter(title='Новая глава') {
  setReading(false);await snapshot(); const h=document.createElement('h2');h.textContent=title;h.dataset.chapterId=uuid();h.dataset.chapterStatus='draft';const p=document.createElement('p');p.append(document.createElement('br'));ms.append(h,p);await commit();focusNode(p);render();return h.dataset.chapterId;
 }
 async function moveChapter(index,dir) {
  const groups=chapterGroups(),g=groups[index],other=groups[index+dir];if(!g||!other)return;
  await snapshot(); const fragment=document.createDocumentFragment();g.nodes.forEach(n=>fragment.append(n));
  if(dir<0)ms.insertBefore(fragment,other.heading);else ms.insertBefore(fragment,groups[index+2]?.heading||null);
  await commit();focusNode(g.heading);render();
 }
 function renderChapters(host) {
  host.innerHTML='<p class="atelier-copy">Перестановка переносит главу целиком: текст, сцены и иллюстрации. Перед изменением создаётся версия.</p><button id="chapter-add" class="studio-primary">＋ Добавить главу</button><div id="chapter-list"></div>';
  $('chapter-add').onclick=run(()=>addChapter());const groups=chapterGroups();
  if(!groups.length)$('chapter-list').innerHTML='<p class="atelier-copy">Пока нет глав. Заголовки «Глава» автоматически появляются здесь.</p>';
  groups.forEach((g,i)=>{
   const row=document.createElement('article');row.className='chapter-card';
   row.innerHTML='<button class="chapter-jump">'+esc(g.heading.textContent||'Без названия')+'</button><small>'+mvp.textStats(g.nodes.map(n=>n.outerHTML).join('')).words+' слов</small><div class="atelier-row"><select aria-label="Статус главы">'+Object.entries(statuses).map(([id,name])=>'<option value="'+id+'">'+name+'</option>').join('')+'</select><button data-action="rename" title="Переименовать главу">Имя</button><button data-action="up" aria-label="Поднять главу">↑</button><button data-action="down" aria-label="Опустить главу">↓</button></div>';
   row.querySelector('.chapter-jump').onclick=()=>focusNode(g.heading);
   const status=row.querySelector('select');status.value=g.heading.dataset.chapterStatus||'draft';status.onchange=run(async()=>{g.heading.dataset.chapterStatus=status.value;if(!g.heading.dataset.chapterId)g.heading.dataset.chapterId=uuid();await commit();});
   row.querySelector('[data-action="rename"]').onclick=run(async()=>{const title=prompt('Название главы',g.heading.textContent);if(!title?.trim())return;await snapshot();g.heading.textContent=title.trim().slice(0,160);await commit();render();});
   for(const [act,dir]of [['up',-1],['down',1]]){const b=row.querySelector('[data-action="'+act+'"]');b.disabled=!groups[i+dir];b.onclick=run(()=>moveChapter(i,dir));}
   for(const scene of g.nodes.filter(n=>n.tagName==='H3')){const s=document.createElement('button');s.className='scene-jump';s.textContent='↳ '+scene.textContent;s.onclick=()=>focusNode(scene);row.append(s);}
   $('chapter-list').append(row);
  });
 }
 function editCard(id='') {
  cardBookId=pg.currentBookId();cardId=id;const c=book()?.worldCards?.find(x=>x.id===id)||{};
  $('world-kind').value=c.kind||'character';for(const field of ['name','summary','links','date'])$('world-'+field).value=c[field]||'';
  cardDialog.showModal();$('world-name').focus();
 }
 async function saveCard(card,id=pg.currentBookId()) {
  const b=pg.getBook(id);if(!b)throw new Error('Книга больше не открыта');const value={...card,id:card.id||uuid()};
  const cards=[...(b.worldCards||[])],at=cards.findIndex(c=>c.id===value.id);if(at<0)cards.push(value);else cards[at]=value;
  if(!await pg.updateBook(id,{worldCards:cards}))throw new Error('Карточка не сохранена');return value.id;
 }
 $('world-cancel').onclick=()=>cardDialog.close();
 $('world-form').onsubmit=e=>{e.preventDefault();run(async()=>{await saveCard({id:cardId,kind:$('world-kind').value,...Object.fromEntries(['name','summary','links','date'].map(k=>[k,$('world-'+k).value.trim()]))},cardBookId);cardDialog.close();render();})()};
 function renderWorld(host) {
  host.innerHTML='<p class="atelier-copy">Персонажи, места, правила мира и события хранятся вместе с этой книгой. Поле даты подходит для собственной хронологии.</p><button id="world-add" class="studio-primary">＋ Новый материал</button><label>Отбор<select id="world-filter"><option value="all">Все материалы</option><option value="character">Персонажи</option><option value="place">Места</option><option value="event">События / хронология</option><option value="world">Мир / правила</option></select></label><div id="world-list"></div>';
  $('world-add').onclick=()=>editCard();const paint=()=>{
   const filter=$('world-filter').value;const cards=(book()?.worldCards||[]).filter(c=>filter==='all'||c.kind===filter);$('world-list').replaceChildren();
   if(!cards.length)$('world-list').innerHTML='<p class="atelier-copy">Материалов пока нет.</p>';
   cards.forEach(c=>{const row=document.createElement('article');row.className='world-card';row.innerHTML='<small>'+esc({character:'Персонаж',place:'Место',event:'Событие',world:'Правило мира'}[c.kind])+(c.date?' · '+esc(c.date):'')+'</small><h3>'+esc(c.name)+'</h3><p>'+esc(c.summary)+'</p><small>'+esc(c.links)+'</small><div class="atelier-row"><button data-edit>Изменить</button><button data-find>В тексте</button><button data-delete>Удалить</button></div>';
    row.querySelector('[data-edit]').onclick=()=>editCard(c.id);row.querySelector('[data-find]').onclick=()=>{$('search-toggle').click();$('search-input').value=c.name;$('search-input').dispatchEvent(new Event('input'));};
    row.querySelector('[data-delete]').onclick=run(async()=>{if(!confirm('Удалить карточку «'+c.name+'»?'))return;await snapshot();await pg.updateBook(book().id,{worldCards:book().worldCards.filter(x=>x.id!==c.id)});paint();});$('world-list').append(row);
   });
  };$('world-filter').onchange=paint;paint();
 }
 function librarySearch(query,trash=false) {
  const q=String(query).toLocaleLowerCase('ru');return api.listBooks(trash).filter(b=>(b.title+' '+mvp.textStats(b.content).text).toLocaleLowerCase('ru').includes(q));
 }
 function renderLibrary(host) {
  host.innerHTML='<label>Поиск по всем книгам<input id="library-query" type="search" placeholder="Название или текст…"></label><label class="check-row"><input id="library-trash" type="checkbox"> Корзина</label><button id="import-manuscript">Импорт TXT / Markdown / DOCX / проекта</button><div id="library-results"></div>';
  $('import-manuscript').onclick=()=>importInput.click();const paint=()=>{
   const trash=$('library-trash').checked,found=librarySearch($('library-query').value,trash);$('library-results').replaceChildren();
   if(!found.length)$('library-results').innerHTML='<p class="atelier-copy">'+(trash?'Корзина пуста.':'Совпадений нет.')+'</p>';
   found.forEach(b=>{const row=document.createElement('article');row.className='world-card';row.innerHTML='<h3>'+esc(b.title)+'</h3><small>'+mvp.textStats(b.content).words+' слов · '+new Date(b.deletedAt||b.updatedAt).toLocaleDateString('ru-RU')+'</small><p>'+esc(mvp.textStats(b.content).text.slice(0,140))+'</p><button>'+ (trash?'Восстановить':'Открыть')+'</button>';
    row.querySelector('button').onclick=run(async()=>{if(trash)await api.restoreBook(b.id);else api.openBook(b.id);paint();});$('library-results').append(row);
   });
  };$('library-query').oninput=paint;$('library-trash').onchange=paint;paint();
 }
 function markdownHtml(text) {
  const lines=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');const out=[];let paragraph=[];
  const flush=()=>{if(paragraph.length){out.push('<p>'+esc(paragraph.join('\n')).replace(/\n/g,'<br>')+'</p>');paragraph=[];}};
  for(const line of lines){const h=line.match(/^(#{1,6})\s+(.+)$/);if(h){flush();const level=h[1].length===1?2:3;out.push('<h'+level+'>'+esc(h[2])+'</h'+level+'>');}else if(!line.trim()){flush();}else paragraph.push(line);}flush();return out.join('')||'<p><br></p>';
 }
 function txtHtml(text){return String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n').map(s=>'<p>'+(esc(s)||'<br>')+'</p>').join('');}
 async function unzipDocx(bytes) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('DOCX повреждён');const count=v.getUint16(end+10,true);if(count>2000)throw new Error('Слишком сложный DOCX');let at=v.getUint32(end+16,true),result=null;
  for(let i=0;i<count;i++){
   if(at+46>bytes.length||v.getUint32(at,true)!==0x02014b50)throw new Error('DOCX повреждён');
   const flags=v.getUint16(at+8,true),method=v.getUint16(at+10,true),size=v.getUint32(at+20,true),raw=v.getUint32(at+24,true),nl=v.getUint16(at+28,true),xl=v.getUint16(at+30,true),cl=v.getUint16(at+32,true),offset=v.getUint32(at+42,true);
   const name=new TextDecoder().decode(bytes.slice(at+46,at+46+nl));at+=46+nl+xl+cl;
   if(name!=='word/document.xml')continue;
   if(flags&1)throw new Error('DOCX защищён паролем');if(raw>20*1024*1024||offset+30>bytes.length)throw new Error('DOCX слишком большой');
   const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);if(start+size>bytes.length)throw new Error('DOCX повреждён');
   const compressed=bytes.slice(start,start+size);let data;
   if(method===0)data=compressed;else if(method===8){const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();let chunks=[],length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>20*1024*1024){await reader.cancel();throw new Error('DOCX слишком большой');}chunks.push(value);}data=new Uint8Array(length);let pos=0;for(const c of chunks){data.set(c,pos);pos+=c.length;}}else throw new Error('Неподдерживаемое сжатие DOCX');
   if(data.length!==raw)throw new Error('DOCX повреждён');result=new TextDecoder().decode(data);
  }
  if(!result)throw new Error('В DOCX нет текста');return result;
 }
 async function docxHtml(bytes){
  const xml=await unzipDocx(bytes),doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw new Error('Некорректный DOCX');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';const out=[];
  for(const p of doc.getElementsByTagNameNS(ns,'p')){
   let text='';for(const n of p.getElementsByTagNameNS(ns,'*')){if(n.localName==='t')text+=n.textContent;else if(n.localName==='tab')text+='\t';else if(n.localName==='br')text+='\n';}
   const style=p.getElementsByTagNameNS(ns,'pStyle')[0]?.getAttributeNS(ns,'val')||'';const tag=/heading1|заголовок1/i.test(style)?'h2':/heading[23]|заголовок[23]/i.test(style)?'h3':'p';
   out.push('<'+tag+'>'+(esc(text).replace(/\n/g,'<br>')||'<br>')+'</'+tag+'>');
  }return out.join('');
 }
 async function importManuscript(file){
  if(!file)return;const ext=file.name.split('.').pop().toLowerCase(),limit=ext==='pgbook'?100:20;if(file.size>limit*1024*1024)throw new Error('Максимальный размер импорта — '+limit+' МБ');let content,title=file.name.replace(/\.[^.]+$/,''),patch={};
  if(ext==='pgbook'){const data=JSON.parse(await file.text());if(data.app!=='pergamin-project'||data.version!==1||!data.book||typeof data.book.content!=='string')throw new Error('Неверный формат проекта');patch={...data.book,id:uuid(),deletedAt:0};title=patch.title||title;content=patch.content;delete patch.content;}
  else if(ext==='docx')content=await docxHtml(new Uint8Array(await file.arrayBuffer()));
  else if(['md','markdown'].includes(ext))content=markdownHtml(await file.text());else if(ext==='txt')content=txtHtml(await file.text());else throw new Error('Выберите TXT, Markdown, DOCX или .pgbook');
  const id=await api.createBook(title,content,patch);pg.toast(ext==='docx'?'Текст и заголовки DOCX импортированы. Таблицы, рисунки и сложная вёрстка не переносятся.':'Рукопись добавлена отдельной книгой');render();return id;
 }
 importInput.onchange=run(async()=>{try{await importManuscript(importInput.files[0]);}finally{importInput.value='';}});
 function projectPayload(b){return {app:'pergamin-project',version:1,exportedAt:new Date().toISOString(),book:structuredClone(b)};}
 function plainMarkdown(b){const host=document.createElement('div');host.innerHTML=b.content;return [...host.children].map(n=>/^H[123]$/.test(n.tagName)?(n.tagName==='H3'?'## ':'# ')+n.textContent:n.tagName==='FIGURE'?'[Иллюстрация хранится в файле проекта]':n.innerText||n.textContent).join('\n\n');}
 function readingHtml(b){return '<!doctype html><html lang="'+esc(b.spellLanguage||'ru')+'"><meta charset="utf-8"><title>'+esc(b.title)+'</title><style>body{max-width:42em;margin:4em auto;padding:0 2em;background:#f7f4ed;color:#302e2a;font:20px/1.7 Georgia,serif}h1,h2,h3{text-align:center}img{max-width:100%;height:auto}figure{position:static!important;float:none!important;max-width:100%!important;margin:2em auto!important}del{display:none}ins{text-decoration:none}</style><h1>'+esc(b.title)+'</h1><p style="text-align:center">'+esc(b.byline)+'</p>'+api.sanitizeContent(b.content)+'</html>';}
 function download(name,data,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
 async function dbOpen(){return new Promise((resolve,reject)=>{const r=indexedDB.open('pergamin-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('settings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async function setting(key,value){if(!workspaceDb)return;return new Promise((resolve,reject)=>{const tx=workspaceDb.transaction('settings',value===undefined?'readonly':'readwrite'),store=tx.objectStore('settings');const req=value===undefined?store.get(key):store.put(value,key);tx.oncomplete=()=>resolve(req.result);tx.onabort=tx.onerror=()=>reject(tx.error);});}
 async function connectDirectory(){
  if(!window.showDirectoryPicker){pg.toast('Выбор папки доступен в Chrome/Edge. Можно скачать файл проекта.');return;}
  const handle=await showDirectoryPicker({id:'pergamin-projects',mode:'readwrite'});await setting('directory',handle);directory=handle;await saveProject(pg.currentBookId(),true);render();
 }
 async function writeFile(dir,name,data){const file=await dir.getFileHandle(name,{create:true}),writer=await file.createWritable();try{await writer.write(data);await writer.close();}catch(e){await writer.abort().catch(()=>{});throw e;}}
 async function writeProject(dir,b,takeSnapshot=false){
  const project=await dir.getDirectoryHandle('book-'+b.id.replace(/[^a-zA-Z0-9-]/g,'_').slice(0,80),{create:true});
  const json=JSON.stringify(projectPayload(b),null,2);
  await writeFile(project,'book.pgbook',json);await writeFile(project,'manuscript.md',plainMarkdown(b));await writeFile(project,'reading.html',readingHtml(b));
  if(takeSnapshot){const snapshots=await project.getDirectoryHandle('snapshots',{create:true});await writeFile(snapshots,new Date().toISOString().replace(/[:.]/g,'-')+'.pgbook',json);}
 }
 async function saveProject(id=pg.currentBookId(),manual=false){
  if(!directory){if(manual){if(!await mvp.flush())throw new Error('Книга не сохранена');download('pergamin-'+id+'.pgbook',JSON.stringify(projectPayload(pg.getBook(id)),null,2));pg.toast('Файл проекта скачан');}return;}
  const destination=directory;
  const task=async()=>{
   if(!await mvp.flush())throw new Error('Книга не сохранена. Запись на диск отложена');const b=pg.getBook(id);if(!b)return;
   if(destination.queryPermission&&await destination.queryPermission({mode:'readwrite'})!=='granted'){if(manual&&await destination.requestPermission({mode:'readwrite'})==='granted'){}else throw new Error('Разрешите доступ к папке кнопкой «Сохранить сейчас»');}
   const previous=diskSnapshots.get(id),fingerprint=JSON.stringify(b),now=Date.now();const take=manual||!previous||(now-previous.at>=15*60000&&previous.text!==fingerprint);
   await writeProject(destination,b,take);if(take)diskSnapshots.set(id,{at:now,text:fingerprint});
   if($('project-status'))$('project-status').textContent='На диске · '+new Date().toLocaleTimeString('ru-RU');if(manual)pg.toast('Проект и резервный снимок записаны в папку');
  };
  const pending=diskQueue.catch(()=>{}).then(task);diskQueue=pending;return pending;
 }
 function scheduleDisk(id){if(!directory)return;clearTimeout(saveTimers.get(id));saveTimers.set(id,setTimeout(()=>{saveTimers.delete(id);saveProject(id).catch(error);},1800));}
 function renderProject(host){host.innerHTML='<h3>Своя папка проекта</h3><p class="atelier-copy">'+(directory?'Подключена: '+esc(directory.name):'Папка пока не выбрана.')+'</p><p class="atelier-copy">Каждая книга получает отдельную папку: файл .pgbook с текстом, изображениями и материалами; Markdown и HTML для чтения. После изменений включается автоматическая запись. Каждые 15 минут изменений — отдельный резервный снимок, пока приложение открыто.</p><div class="atelier-row"><button id="project-connect">Выбрать папку</button><button id="project-save">Сохранить сейчас</button><button id="project-download">Скачать .pgbook</button></div><p id="project-status" class="atelier-copy">'+(directory?'Автозапись подключена':'Файл .pgbook можно открыть через импорт.')+'</p><p class="atelier-copy">Снимки остаются в папке snapshots. Их можно перенести на другой диск. Облачная синхронизация зависит от выбранной вами папки.</p><button id="project-disconnect" '+(!directory?'disabled':'')+'>Отключить автозапись</button>';
  $('project-connect').onclick=run(connectDirectory);$('project-save').onclick=run(()=>saveProject(pg.currentBookId(),true));$('project-download').onclick=run(async()=>{if(!await mvp.flush())throw new Error('Книга не сохранена');download('pergamin-'+pg.currentBookId()+'.pgbook',JSON.stringify(projectPayload(book()),null,2));});$('project-disconnect').onclick=run(async()=>{directory=null;saveTimers.forEach(clearTimeout);saveTimers.clear();await setting('directory',null);render();});
 }
 function renderLayout(host){host.innerHTML='<h3>Тихий книжный макет</h3><p class="atelier-copy">Настройки страницы сохраняются для этой книги. Ширина и поля влияют на количество страниц.</p><label>Ширина текста<select id="layout-width"><option value="wide">Широкая</option><option value="book">Книжная</option><option value="compact">Компактная</option></select></label><label>Межстрочный интервал<select id="layout-leading"><option value="1.45">Плотный · 1,45</option><option value="1.72">Классический · 1,72</option><option value="2">Свободный · 2</option></select></label><label class="check-row"><input id="layout-dropcap" type="checkbox"> Буквица в первом абзаце</label><p class="atelier-copy">Скорость перелистывания — 0,85 секунды. Системная настройка уменьшения движения отключает анимацию.</p><button id="layout-read">Открыть режим чтения</button>';
  const b=book();$('layout-width').value=b.layout?.width||'wide';$('layout-leading').value=String(b.layout?.leading||1.72);$('layout-dropcap').checked=b.layout?.dropcap!==false;
  const save=run(async()=>{await pg.updateBook(b.id,{layout:{width:$('layout-width').value,leading:+$('layout-leading').value,dropcap:$('layout-dropcap').checked}});applyLayout();});for(const id of ['layout-width','layout-leading','layout-dropcap'])$(id).onchange=save;$('layout-read').onclick=()=>{setReading(true);open(false);};
 }
 function applyLayout(){const l=book()?.layout||{};document.body.dataset.textWidth=l.width||'wide';document.body.classList.toggle('no-dropcap',l.dropcap===false);ms.style.lineHeight=String(l.leading||1.72);requestAnimationFrame(()=>api.layoutChanged());}
 async function coverData(b,style='ivory'){
  await document.fonts.ready;const c=document.createElement('canvas');c.width=1200;c.height=1800;const ctx=c.getContext('2d'),dark=style==='ink';
  ctx.fillStyle=dark?'#343330':'#eee9dd';ctx.fillRect(0,0,1200,1800);ctx.strokeStyle=dark?'#8b8375':'#8c8271';ctx.lineWidth=2;ctx.strokeRect(80,80,1040,1640);ctx.strokeRect(94,94,1012,1612);ctx.fillStyle=dark?'#eee9dd':'#343330';ctx.textAlign='center';
  const wrap=(text,size,max)=>{ctx.font=size+'px "Cormorant Garamond", Georgia, serif';const lines=[];let line='';for(const word of String(text||'').split(/\s+/)){if(ctx.measureText(line+' '+word).width>max&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;};
  ctx.font='24px Georgia';ctx.fillText('П Е Р Г А М И Н',600,250);
  let size=110,lines=wrap(b.title,size,880);while(size>40&&(lines.length>5||lines.some(l=>ctx.measureText(l).width>880))){size-=5;lines=wrap(b.title,size,880);}
  let y=740-lines.length*size*.35;for(const line of lines){ctx.fillText(line,600,y);y+=size*1.05;}
  ctx.beginPath();ctx.moveTo(440,y+45);ctx.lineTo(760,y+45);ctx.stroke();
  const subtitle=wrap(b.subtitle,38,860);subtitle.slice(0,4).forEach((line,i)=>ctx.fillText(line,600,y+125+i*48));
  const author=wrap(b.byline,44,860);author.slice(0,3).forEach((line,i)=>ctx.fillText(line,600,1510+i*54));
  return c.toDataURL('image/png');
 }
 function renderCover(host){
  const b=book(),section=document.createElement('section');section.className='cover-tools';section.innerHTML='<h3>Классическая обложка</h3><label>Автор<input id="cover-author" maxlength="160" value="'+esc(b.byline)+'"></label><label>Подзаголовок<input id="cover-subtitle" maxlength="240" value="'+esc(b.subtitle)+'"></label><label>Вариант<select id="cover-style"><option value="ivory">Слоновая кость</option><option value="ink">Тёмный переплёт</option></select></label><div class="atelier-row"><button id="cover-create">Создать и сохранить</button><button id="cover-download" '+(!b.coverImage?'disabled':'')+'>PNG</button></div><img id="cover-preview" alt="Обложка книги" '+(b.coverImage?'src="'+b.coverImage+'"':'hidden')+'><p class="atelier-copy">Обложка добавляется в EPUB и печать; хранится также в файле проекта.</p>';
  host.append(section);$('cover-create').onclick=run(async()=>{const values={...pg.getBook(b.id),byline:$('cover-author').value.trim(),subtitle:$('cover-subtitle').value.trim()},style=$('cover-style').value;const coverImage=await coverData(values,style);if(!await pg.updateBook(b.id,{byline:values.byline,subtitle:values.subtitle,coverImage}))throw new Error('Обложка не сохранена');render();});$('cover-download').onclick=()=>{const a=document.createElement('a');a.href=pg.getBook(b.id).coverImage;a.download='cover-'+b.id+'.png';a.click();};
 }
 function analyze(content){const stats=mvp.textStats(content),words=(stats.text.toLocaleLowerCase('ru').match(/[\p{L}]{4,}/gu)||[]),freq=new Map();for(const w of words)freq.set(w,(freq.get(w)||0)+1);const stop=new Set(['который','которая','которые','когда','только','через','чтобы','после','очень','этого','этой','себя','были','было','того','тогда','перед','there','that','with','this']);return {stats,repeated:[...freq].filter(([w,n])=>n>=3&&!stop.has(w)).sort((a,b)=>b[1]-a[1]).slice(0,20),long:(stats.text.match(/[^.!?]+[.!?]+/g)||[]).filter(s=>(s.match(/[\p{L}\p{N}]+/gu)||[]).length>35).slice(0,10)};}
 function renderAnalysis(host){const a=analyze(ms.innerHTML),s=sessions.get(pg.currentBookId());host.innerHTML='<h3>Читательский ритм</h3><p class="atelier-copy">'+a.stats.words+' слов · '+a.stats.readingMinutes+' мин чтения'+(s?' · за эту сессию '+Math.max(0,a.stats.words-s.words)+' новых слов':'')+'</p><p class="atelier-copy">Подсказки по повторениям и длинным предложениям требуют авторского решения. Это не грамматическая проверка.</p><h3>Частые слова</h3><div class="atelier-row">'+a.repeated.map(([w,n])=>'<button data-word="'+esc(w)+'">'+esc(w)+' · '+n+'</button>').join('')+'</div><h3>Предложения длиннее 35 слов</h3>'+a.long.map(s=>'<blockquote>'+esc(s.trim())+'</blockquote>').join('')+(!a.long.length?'<p class="atelier-copy">Не найдены.</p>':'');host.querySelectorAll('[data-word]').forEach(b=>b.onclick=()=>{$('search-panel').hidden=false;$('search-input').value=b.dataset.word;$('search-input').dispatchEvent(new Event('input'));});}
 function renderTemplates(host){host.innerHTML='<p class="atelier-copy">Шаблон создаёт отдельную книгу. Названия глав можно изменить в навигаторе.</p>'+Object.entries(templates).map(([id,t])=>'<button class="template-card" data-template="'+id+'">'+t.name+'</button>').join('');host.querySelectorAll('[data-template]').forEach(b=>b.onclick=run(async()=>{const title=prompt('Название новой книги',templates[b.dataset.template].name);if(!title?.trim())return;await api.createBook(title.trim(),templates[b.dataset.template].content);open(true,'chapters');}));}
 function render(){if(pane.hidden)return;pane.querySelectorAll('[data-atelier-tab]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.atelierTab===tab)));const host=$('atelier-content');({chapters:renderChapters,world:renderWorld,library:renderLibrary,project:renderProject,layout:renderLayout,analysis:renderAnalysis,templates:renderTemplates}[tab]||renderChapters)(host);if(tab==='layout')renderCover(host);}
 function commands(){return [
  ['Новая глава',()=>run(()=>addChapter())()],['Главы и сцены',()=>open(true,'chapters')],['Персонажи и мир книги',()=>open(true,'world')],['Поиск по библиотеке / корзина',()=>open(true,'library')],['Папка проекта / резервные снимки',()=>open(true,'project')],['Оформление страницы',()=>open(true,'layout')],['Повторения и длинные предложения',()=>open(true,'analysis')],['Шаблоны рукописей',()=>open(true,'templates')],['Импорт TXT / Markdown / DOCX',()=>importInput.click()],['Режим чтения / письма',()=>setReading(!reading)],['Фокусный режим · F9',()=>$('focus-toggle').click()],['Создать версию',()=>$('snapshot-now').click()],['Печать / PDF',()=>$('print-book').click()],['Экспорт EPUB',()=>$('export-epub').click()],['Экспорт DOCX',()=>$('export-docx').click()]
 ];}
 function renderCommands(){const q=$('command-query').value.toLocaleLowerCase('ru'),host=$('command-results');host.replaceChildren();for(const [name,fn]of commands().filter(([name])=>name.toLocaleLowerCase('ru').includes(q))){const b=document.createElement('button');b.textContent=name;b.onclick=()=>{commandDialog.close();fn();};host.append(b);}}
 function openCommands(){commandDialog.showModal();$('command-query').value='';renderCommands();$('command-query').focus();}
 $('command-query').oninput=renderCommands;$('command-query').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('command-results button')?.click();}};$('command-close').onclick=()=>commandDialog.close();
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommands();}if(reading&&!e.target.closest('dialog,input,textarea,select')){if(e.key==='ArrowRight'){e.preventDefault();api.turn(1);}if(e.key==='ArrowLeft'){e.preventDefault();api.turn(-1);}}if(e.key==='Escape'&&!pane.hidden)open(false);});
 $('new-form').addEventListener('submit',()=>{const selected=$('new-template').value;if(selected!=='blank')run(async()=>{const b=book();await pg.updateBook(b.id,{content:templates[selected].content});})()});
 // Paragraph-level comparison avoids the quadratic cost of a full word diff.
 function diffParagraphs(oldHtml,newHtml){const paragraphs=html=>{const host=document.createElement('div');host.innerHTML=html;return [...host.children].map(n=>n.textContent.trim()).filter(Boolean);};const before=paragraphs(oldHtml),after=paragraphs(newHtml),counts=new Map();before.forEach(t=>counts.set(t,(counts.get(t)||0)+1));const additions=[];for(const t of after){if(counts.get(t)>0)counts.set(t,counts.get(t)-1);else additions.push(t);}const removals=[];for(const t of before){if(counts.get(t)>0){removals.push(t);counts.set(t,counts.get(t)-1);}}return {additions,removals};}
 function compareVersion(row){const d=diffParagraphs(row.book.content,ms.innerHTML);$('compare-caption').textContent='Версия '+new Date(row.createdAt).toLocaleString('ru-RU')+' → текущий текст. Сравнение по абзацам; изменения оформления и порядка не подсвечиваются.';$('compare-content').innerHTML='<section><h3>Убрано / прежняя редакция</h3>'+d.removals.map(t=>'<p class="diff-removed">'+esc(t)+'</p>').join('')+'</section><section><h3>Добавлено / новая редакция</h3>'+d.additions.map(t=>'<p class="diff-added">'+esc(t)+'</p>').join('')+'</section>'+(!d.additions.length&&!d.removals.length?'<p>Текст абзацев совпадает.</p>':'');compareDialog.showModal();}
 $('compare-close').onclick=()=>compareDialog.close();
 pg.on('bookopen',id=>{setReading(reading);if(!sessions.has(id))sessions.set(id,{words:mvp.textStats(pg.getBook(id)?.content).words});applyLayout();render();});
 pg.on('bookchange',id=>scheduleDisk(id));
 pg.on('librarychange',()=>{if(tab==='library')render();});
 let paintTimer;ms.addEventListener('input',()=>{clearTimeout(paintTimer);paintTimer=setTimeout(()=>{if(['chapters','analysis'].includes(tab))render();},600);});
 dbOpen().then(async db=>{workspaceDb=db;directory=await setting('directory')||null;render();}).catch(error);
 window.__pgAtelier__={open,addChapter,moveChapter,chapterGroups,saveCard,librarySearch,importManuscript,markdownHtml,docxHtml,projectPayload,writeProject,setReading,analyze,diffParagraphs,compareVersion,coverData};
 if(book()){sessions.set(book().id,{words:mvp.textStats(book().content).words});applyLayout();}
})();
