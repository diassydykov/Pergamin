import {esc,genres,statuses,importFile,normalizeBook,sanitize,dataUrl} from './library-import.js';

const $=id=>document.getElementById(id);
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
let db,books=[],category='all',shelf='all',query='',sort='author',list=false,current=null,chapter=0,spread=0,per=2,stride=1,pages=1,busy=false,turnAnimation=null;
let settings={font:'Literata',size:20,leading:1.75,paper:'ivory'},writeQueue=Promise.resolve(),resizeTimer;
const root=document.createElement('div');root.id='library-app';root.innerHTML=`
 <header class="lib-header"><button class="lib-brand" id="lib-home" aria-label="Пергамин — библиотека"><span class="lib-seal">П</span><span>Пергамин<small>КНИГИ, К КОТОРЫМ ВОЗВРАЩАЮТСЯ</small></span></button><div class="lib-header-actions"><button id="lib-import">＋ Добавить книгу</button><button id="lib-tools">Моя библиотека</button><button id="lib-editor">Мастерская ↗</button></div></header>
 <main id="library-home" class="lib-main"><section class="lib-intro"><div><p class="lib-kicker">ТИШИНА. БУМАГА. ХОРОШАЯ ИСТОРИЯ.</p><h1>Ваша библиотека</h1><p class="lib-subtitle">Выберите стеллаж. Найдите книгу. Останьтесь на главу.</p></div><label class="lib-search"><span>Поиск по названию и автору</span><input id="lib-search" type="search" placeholder="Какую историю ищете?" autocomplete="off"></label></section>
 <nav id="lib-shelves" class="lib-shelves" aria-label="Личные полки"></nav><section id="lib-continue" aria-label="Продолжить чтение"></section>
 <section id="lib-room" class="lib-room" aria-label="Стеллажи по разделам"></section>
 <section id="lib-section" hidden><header class="lib-section-head"><div><button id="lib-back">← Все стеллажи</button><h2 id="lib-section-title"></h2><p id="lib-count"></p></div><div class="lib-section-controls"><label>Порядок<select id="lib-sort"><option value="author">Автор: А–Я</option><option value="title">Название: А–Я</option><option value="recent">Недавно добавленные</option></select></label><button id="lib-view" aria-pressed="false">Список</button></div></header><div id="lib-results"></div></section>
 <footer class="lib-footer"><span id="lib-total"></span><span>Тексты и место чтения сохраняются на этом устройстве.</span><button id="lib-sources">Об изданиях и источниках</button></footer></main>
 <section id="library-reader" hidden aria-label="Читатель"><header class="reader-toolbar"><button id="reader-back">← Библиотека</button><div class="reader-heading"><strong id="reader-title"></strong><span id="reader-author"></span></div><div class="reader-tools"><button id="reader-outline">Оглавление</button><button id="reader-bookmark" aria-label="Добавить закладку">Закладка ＋</button><button id="reader-notes">Заметки</button><button id="reader-settings">Аа</button></div></header><div class="reader-stage" id="reader-stage"><div id="reader-book"><div class="reader-running" id="reader-running"></div><div id="reader-scroll"><article id="reader-text" tabindex="0" aria-label="Текст книги"></article></div><div id="reader-flip" aria-hidden="true"></div></div></div><footer class="reader-footer"><button id="reader-prev" aria-label="Предыдущий разворот">←</button><div><span id="reader-page" role="status" aria-live="polite"></span><progress id="reader-progress" max="1" value="0" aria-label="Прогресс чтения"></progress></div><button id="reader-next" aria-label="Следующий разворот">→</button><button id="reader-finish" hidden>Отметить прочитанной ✓</button></footer><p class="reader-hint">← → перелистывание · выделите фрагмент, чтобы сохранить цитату в заметках</p></section>
 <div id="lib-toast" role="status" aria-live="polite"></div><dialog id="lib-dialog"><button id="lib-dialog-close" class="lib-dialog-close" aria-label="Закрыть">×</button><div id="lib-dialog-body"></div></dialog><input id="lib-file" type="file" accept=".epub,.fb2,.txt" multiple hidden><input id="lib-restore-file" type="file" accept=".json" hidden>`;
document.body.append(root);
let toastTimer;
function toast(message){$('lib-toast').textContent=message;$('lib-toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('lib-toast').classList.remove('show'),5500);}
function fail(error){console.error(error);toast(error.message||'Не удалось выполнить действие. Данные не удалены.');}
function task(fn){return async(...args)=>{try{return await fn(...args);}catch(error){fail(error);}};}
function transact(mode,callback){return new Promise((resolve,reject)=>{const tx=db.transaction('books',mode),store=tx.objectStore('books');let value;try{value=callback(store);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||Error('Ошибка хранения библиотеки.'));tx.onabort=()=>reject(tx.error||Error('Не удалось сохранить библиотеку.'));});}
function save(book){
 const copy=structuredClone(book);writeQueue=writeQueue.catch(()=>{}).then(()=>transact('readwrite',store=>store.put(copy)));
 return writeQueue.catch(e=>{toast('Не удалось сохранить: проверьте свободное место. Сделайте копию библиотеки.');throw e;});
}
async function allBooks(){return new Promise((resolve,reject)=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function ordered(items){return [...items].sort((a,b)=>sort==='recent'?b.addedAt-a.addedAt:(sort==='title'?a.title.localeCompare(b.title,'ru'):a.sortAuthor.localeCompare(b.sortAuthor,'ru')||a.title.localeCompare(b.title,'ru')));}
function matches(b){return (category==='all'||b.genre===category)&&(shelf==='all'||shelf==='favorite'&&b.favorite||b.status===shelf)&&(!query||`${b.title} ${b.author}`.toLocaleLowerCase('ru').includes(query));}
const palette=['#666e60','#756353','#6c6870','#7a625d','#596a70','#83745e'];
function color(b){return palette[[...b.id].reduce((n,c)=>n+c.charCodeAt(0),0)%palette.length];}
function cover(b,mini=false){return `<span class="lib-cover${mini?' mini':''}" style="--cover:${color(b)}">${b.cover?`<img src="${b.cover}" alt="">`:`<span class="cover-author">${esc(b.author)}</span><span class="cover-rule">✦</span><strong>${esc(b.title)}</strong><span class="cover-edition">ПЕРГАМИН</span>`}</span>`;}
function bookButton(b,index){return `<button class="lib-volume" data-book="${b.id}" aria-label="${esc(b.title+' — '+b.author)}" style="--cover:${color(b)};--book-height:${178+(index%4)*12}px"><span class="volume-spine"><span>${esc(b.title)}</span><small>${esc(b.sortAuthor)}</small></span><span class="volume-tip"><strong>${esc(b.title)}</strong><span>${esc(b.author)}</span><small>${statuses[b.status]}${b.progress?' · '+Math.round(b.progress*100)+'%':''}</small></span></button>`;}
function render(){
 const labels={all:'Все книги',want:'Хочу прочитать',reading:'Читаю',read:'Прочитано',favorite:'Избранное'};
 $('lib-shelves').innerHTML=Object.entries(labels).map(([id,label])=>`<button data-shelf="${id}" aria-pressed="${shelf===id}">${label}<span>${books.filter(b=>id==='all'||id==='favorite'&&b.favorite||b.status===id).length}</span></button>`).join('');
 const recent=books.filter(b=>b.lastRead&&b.status!=='read').sort((a,b)=>b.lastRead-a.lastRead)[0];
 $('lib-continue').innerHTML=recent?`<button class="lib-resume" data-read="${recent.id}">${cover(recent,true)}<span><small>ПРОДОЛЖИТЬ ЧТЕНИЕ</small><strong>${esc(recent.title)}</strong><span>${esc(recent.author)} · ${Math.round(recent.progress*100)}%</span></span><span class="resume-arrow">Читать →</span></button>`:'';
 const browsing=category==='all'&&shelf==='all'&&!query;
 $('lib-room').hidden=!browsing;$('lib-section').hidden=browsing;
 if(browsing)$('lib-room').innerHTML=Object.entries(genres).map(([id,label],i)=>{const members=ordered(books.filter(b=>b.genre===id));return `<button class="lib-case" data-category="${id}" aria-label="${label}, ${members.length} книг"><span class="case-label"><span>${String(i+1).padStart(2,'0')}</span><strong>${label}</strong><small>${members.length} ${members.length===1?'книга':'книг'} ↗</small></span><span class="case-cabinet">${[0,1].map(row=>`<span class="case-row">${members.slice(row*6,row*6+6).map((b,j)=>`<span class="case-spine" style="--cover:${color(b)};--height:${87+(j%3)*10}%">${esc(b.title)}</span>`).join('')}${!members.length&&row===0?'<span class="case-empty">Ваши любимые книги<br>могут быть здесь</span>':''}</span>`).join('')}</span></button>`;}).join('');
 else {
  const result=ordered(books.filter(matches));
  $('lib-section-title').textContent=query?`Поиск: «${$('lib-search').value}»`:category!=='all'?genres[category]:labels[shelf];
  $('lib-count').textContent=result.length+' книг · названия и авторы — при наведении или фокусе';
  $('lib-results').className=list?'lib-list':'lib-bookwall';
  $('lib-results').innerHTML=result.length?(list?result.map(b=>`<button class="lib-list-book" data-book="${b.id}">${cover(b,true)}<span><strong>${esc(b.title)}</strong><span>${esc(b.author)}</span></span><small>${statuses[b.status]}${b.progress?' · '+Math.round(b.progress*100)+'%':''}</small></button>`).join(''):result.map(bookButton).join('')):'<div class="lib-empty"><h3>Пока тихо и свободно</h3><p>Добавьте свою книгу или выберите для неё личную полку в карточке.</p><button data-action="import">＋ Добавить книгу</button></div>';
 }
 $('lib-total').textContent=books.length+' книг · '+books.filter(b=>b.origin==='catalog').length+' в стартовой коллекции';
}
async function zoomTo(id,button){
 if(busy)return;const rect=button.getBoundingClientRect(),ghost=button.cloneNode(true);busy=true;
 category=id;render();
 if(!reduced()){
  ghost.classList.add('case-flight');Object.assign(ghost.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',margin:'0',zIndex:100,pointerEvents:'none'});ghost.setAttribute('aria-hidden','true');document.body.append(ghost);
  const target=$('lib-results').getBoundingClientRect();const a=ghost.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${target.left-rect.left}px,${target.top-rect.top}px) scale(${target.width/rect.width},1.35)`,opacity:0}],{duration:720,easing:'cubic-bezier(.22,.7,.2,1)'});
  try{await a.finished;}catch{}ghost.remove();
 }
 busy=false;$('lib-back').focus({preventScroll:true});
}
function modal(html){$('lib-dialog-body').innerHTML=html;if(!$('lib-dialog').open)$('lib-dialog').showModal();}
function detail(id){const b=books.find(b=>b.id===id);if(!b)return;
 modal(`<div class="lib-detail">${cover(b)}<div><p class="lib-kicker">${genres[b.genre]}</p><h2>${esc(b.title)}</h2><p class="lib-detail-author">${esc(b.author)}</p><p>${esc(b.description||'Книга из вашей личной коллекции.')}</p><p>${b.chapters.length} разделов · ${esc(b.language.toUpperCase())} · ${Math.max(1,Math.ceil(b.chapters.reduce((n,c)=>n+c.html.replace(/<[^>]+>/g,'').split(/\s+/).length,0)/180))} мин чтения</p><button class="lib-primary" data-read="${b.id}">${b.lastRead?'Продолжить':'Начать читать'} →</button></div></div><div class="lib-detail-actions"><label>Личная полка<select id="detail-status">${Object.entries(statuses).map(([id,s])=>`<option value="${id}" ${b.status===id?'selected':''}>${s}</option>`).join('')}</select></label><label>Раздел<select id="detail-genre">${Object.entries(genres).map(([id,s])=>`<option value="${id}" ${b.genre===id?'selected':''}>${s}</option>`).join('')}</select></label><button id="detail-favorite" aria-pressed="${b.favorite}">${b.favorite?'★ В избранном':'☆ В избранное'}</button></div><details class="lib-rights"><summary>Источник и права на текст</summary><p>${esc(b.rights)}</p>${b.source?`<a href="${esc(b.source)}" target="_blank" rel="noopener noreferrer">Оригинал в Викитеке ↗</a>`:''}${b.licenseUrl?` · <a href="${esc(b.licenseUrl)}" target="_blank" rel="noopener noreferrer">Условия лицензии ↗</a>`:''}</details><div class="lib-detail-actions"><button id="detail-workshop">Копия в мастерскую</button>${b.original?'<button id="detail-original">Скачать оригинал</button>':''}${b.origin!=='catalog'?'<button id="detail-delete">Удалить из библиотеки</button>':''}</div>`);
 $('detail-status').onchange=task(async e=>{b.status=e.target.value;await save(b);render();});
 $('detail-genre').onchange=task(async e=>{b.genre=e.target.value;await save(b);render();});
 $('detail-favorite').onclick=task(async()=>{b.favorite=!b.favorite;await save(b);render();detail(id);});
 $('detail-workshop').onclick=task(async()=>{if(!window.__pgWorkspace__||!window.__pg__?.currentBookId())throw Error('Редактор ещё загружается.');await window.__pgWorkspace__.createBook(b.title,b.chapters.map(c=>`<h2>${esc(c.title)}</h2>${c.html}`).join(''),{byline:b.author});$('lib-dialog').close();await editor();});
 if($('detail-original'))$('detail-original').onclick=()=>download(b.original,b.originalName||'book.epub');
 if($('detail-delete'))$('detail-delete').onclick=task(async()=>{if(!confirm('Удалить эту книгу вместе с её прогрессом и заметками? Сначала можно сделать копию в «Моя библиотека».'))return;await writeQueue;await transact('readwrite',s=>s.delete(b.id));books=books.filter(x=>x.id!==id);$('lib-dialog').close();render();toast('Книга удалена с устройства. Восстановление возможно из вашей копии.');});
}
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
async function backup(){await writeQueue;const blob=new Blob([JSON.stringify({format:'pergamin-library',version:1,createdAt:new Date().toISOString(),settings,books})],{type:'application/json'}),url=URL.createObjectURL(blob);download(url,`pergamin-reader-${new Date().toISOString().slice(0,10)}.json`);setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Копия включает книги, оригиналы, полки, прогресс и заметки.');}
async function restore(file){
 if(file.size>200*1024*1024)throw Error('Копия больше 200 МБ.');
 const raw=JSON.parse(await file.text());if(raw.format!=='pergamin-library'||raw.version!==1||!Array.isArray(raw.books)||raw.books.length>2000)throw Error('Это не копия читательской библиотеки Пергамина.');
 const incoming=raw.books.map(normalizeBook),known=new Map(books.map(b=>[b.id,b])),fresh=[],adopted=[];
 for(const b of incoming){const old=known.get(b.id);if(!old){fresh.push(b);known.set(b.id,b);}else if(old.origin==='catalog'&&!old.lastRead&&old.status==='none'&&!old.favorite&&!old.notes.length&&!old.bookmarks.length){adopted.push(b);known.set(b.id,b);}}
 await writeQueue;await transact('readwrite',s=>{fresh.forEach(b=>s.add(b));adopted.forEach(b=>s.put(b));});books=[...known.values()];
 if(!localStorage.getItem('pergamin-reader-settings')&&raw.settings){settings=validSettings(raw.settings);localStorage.setItem('pergamin-reader-settings',JSON.stringify(settings));}
 render();toast(`Добавлено ${fresh.length}; восстановлено ${adopted.length} нетронутых книг коллекции. Ваши существующие отметки сохранены.`);return fresh.length+adopted.length;
}
function toolsDialog(){modal(`<h2>Моя библиотека</h2><p>Книги хранятся в профиле этого браузера. Очистка данных сайта удалит локальную библиотеку. Регулярно сохраняйте копию в другое место.</p><div class="lib-dialog-stack"><button id="lib-backup">Скачать полную копию</button><button id="lib-restore">Добавить книги из копии</button><button id="lib-persist">Защитить локальное хранение</button></div><p class="lib-muted">При восстановлении совпадающие книги не перезаписываются. Для переноса прогресса откройте копию в чистом профиле. Копия не зашифрована — храните её в доверенном месте.</p>`);$('lib-backup').onclick=task(backup);$('lib-restore').onclick=()=>$('lib-restore-file').click();$('lib-persist').onclick=task(async()=>toast(await navigator.storage?.persist?.()?'Браузер разрешил постоянное хранение. Копии всё равно нужны.':'Браузер не предоставил постоянное хранение. Сохраните копию.'));}
function importDialog(){modal(`<h2>Пригласите книгу на полку</h2><p>EPUB без DRM, FB2 или TXT · до 32 МБ. Файлы не отправляются на сервер. Оригинал сохраняется вместе с книгой.</p><label>Кодировка TXT / FB2<select id="lib-encoding"><option value="utf-8">UTF-8 (обычно)</option><option value="windows-1251">Windows-1251 (старые книги)</option></select></label><p><button id="lib-choose" class="lib-primary">Выбрать файлы</button></p><p class="lib-muted">Добавляйте только книги, которыми вправе пользоваться. PDF и защищённые DRM-файлы пока не поддерживаются.</p><div id="lib-import-report" role="status"></div>`);$('lib-choose').onclick=()=>$('lib-file').click();}
async function addFiles(files,encoding='utf-8'){
 const report=[];for(const file of files){try{const raw=await importFile(file,encoding);if(books.some(b=>b.id===raw.id)){report.push(`${file.name}: уже есть в библиотеке`);continue;}const b=normalizeBook(raw);await save(b);books.push(b);report.push(`${b.title}: добавлена`);}catch(e){report.push(`${file.name}: ${e.message}`);}}
 render();if($('lib-import-report'))$('lib-import-report').textContent=report.join('\n');else toast(report.join(' · '));return report;
}
async function editor(){if(window.__pgMvp__&&!(await window.__pgMvp__.flush()))throw Error('Не удалось сохранить рукопись.');await closeReader();$('lib-dialog').close();document.body.dataset.appMode='editor';window.__pgWorkspace__?.layoutChanged();}
async function home(){if(document.body.dataset.appMode==='editor'&&window.__pgMvp__&&!(await window.__pgMvp__.flush()))throw Error('Сначала сохраните рукопись.');await closeReader();document.body.dataset.appMode='library';$('library-home').hidden=false;$('library-reader').hidden=true;render();}

// Reader: immutable sanitized chapters, semantic text locators, independent of editor pagination.
function blocks(){return [...$('reader-text').querySelectorAll('[data-block]')];}
function textRange(element,offset=0){const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let n,last;while(n=walk.nextNode()){last=n;if(offset<n.length){const r=document.createRange();r.setStart(n,offset);r.setEnd(n,Math.min(offset+1,n.length));return r;}offset-=n.length;}const r=document.createRange();if(last){r.setStart(last,last.length);r.collapse(true);}else r.selectNode(element);return r;}
function locator(){
 const viewport=$('reader-scroll').getBoundingClientRect(),items=blocks();
 for(let i=0;i<items.length;i++){
  const el=items[i],range=document.createRange();range.selectNodeContents(el);
  if(![...range.getClientRects()].some(r=>r.right>viewport.left+1&&r.left<viewport.right-1&&r.bottom>viewport.top))continue;
  let lo=0,hi=el.textContent.length;
  while(lo<hi){const mid=(lo+hi)>>1,r=textRange(el,mid).getBoundingClientRect();if(r.right<=viewport.left+1)lo=mid+1;else hi=mid;}
  return {chapter,block:i,offset:lo};
 }
 return {chapter,block:Math.max(0,items.length-1),offset:0};
}
function gotoPosition(position){const items=blocks(),el=items[Math.min(position?.block||0,items.length-1)];if(!el)return;const range=textRange(el,position?.offset||0),r=range.getBoundingClientRect(),vp=$('reader-scroll').getBoundingClientRect();spread=Math.max(0,Math.min(pages-1,Math.floor((r.left-vp.left+$('reader-scroll').scrollLeft+1)/stride)));$('reader-scroll').scrollLeft=spread*stride;}
function layout(position){
 const viewport=$('reader-scroll'),article=$('reader-text');if(!viewport.clientWidth)return;
 per=viewport.clientWidth>=850?2:1;const gap=per===2?64:36,width=(viewport.clientWidth-gap*(per-1))/per;stride=per*(width+gap);
 article.style.columnWidth=width+'px';article.style.columnGap=gap+'px';article.style.height=viewport.clientHeight+'px';article.style.width=viewport.clientWidth+'px';
 $('reader-book').classList.toggle('two-pages',per===2);viewport.scrollLeft=0;
 pages=Math.max(1,Math.ceil((article.scrollWidth+gap-2)/stride));
 if(position)gotoPosition(position);else{spread=Math.min(spread,pages-1);viewport.scrollLeft=spread*stride;}
 paintReader();
}
function applySettings(){const el=$('library-reader');el.dataset.paper=settings.paper;el.style.setProperty('--reader-font',`'${settings.font}', Georgia, serif`);el.style.setProperty('--reader-size',settings.size+'px');el.style.setProperty('--reader-leading',settings.leading);}
function highlightNotes(){
 if(!CSS.highlights||typeof Highlight==='undefined')return;
 const ranges=[],items=blocks();
 for(const note of current?.notes||[]){if(note.chapter!==chapter||!note.quote)continue;const el=items[note.block];if(!el)continue;const offset=el.textContent.indexOf(note.quote,note.offset);if(offset<0)continue;const begin=textRange(el,offset),end=textRange(el,offset+note.quote.length-1),range=document.createRange();range.setStart(begin.startContainer,begin.startOffset);range.setEnd(end.endContainer,end.endOffset);ranges.push(range);}
 CSS.highlights.set('pergamin-quotes',new Highlight(...ranges));
}
function loadChapter(index,position){chapter=Math.max(0,Math.min(current.chapters.length-1,index));spread=0;$('reader-text').innerHTML=sanitize(current.chapters[chapter].html);let elements=[...$('reader-text').querySelectorAll('p,h1,h2,h3,h4,li,pre,blockquote')].filter(el=>!el.querySelector('p,h1,h2,h3,h4,li,pre,blockquote'));if(!elements.length)elements=[...$('reader-text').children];elements.forEach((el,i)=>el.dataset.block=i);$('reader-running').textContent=current.chapters[chapter].title;layout(position);highlightNotes();}
function paintReader(){
 if(!current)return;const lengths=current.chapters.map(c=>c.html.replace(/<[^>]*>/g,'').length),total=lengths.reduce((a,b)=>a+b,0)||1;
 const progress=current.status==='read'?1:(lengths.slice(0,chapter).reduce((a,b)=>a+b,0)+lengths[chapter]*(spread/pages))/total;
 current.progress=Math.max(0,Math.min(1,progress));$('reader-progress').value=current.status==='read'?1:progress;
 $('reader-page').textContent=`${chapter+1} / ${current.chapters.length} разделов · разворот ${spread+1} / ${pages} · ${Math.round(progress*100)}%`;
 $('reader-prev').disabled=chapter===0&&spread===0;$('reader-next').disabled=chapter===current.chapters.length-1&&spread===pages-1;
 $('reader-finish').hidden=!$('reader-next').disabled;
}
async function remember(){if(!current)return;current.position=locator();current.lastRead=Date.now();await save(current);}
async function read(id){
 const b=books.find(b=>b.id===id);if(!b)return;if(current)await remember();
 clearTimeout(toastTimer);$('lib-toast').classList.remove('show');
 $('lib-dialog').close();document.body.dataset.appMode='library';$('library-home').hidden=true;$('library-reader').hidden=false;current=b;current.lastRead=Date.now();if(b.status!=='read')b.status='reading';
 $('reader-title').textContent=b.title;$('reader-author').textContent=b.author;$('reader-text').lang=b.language;applySettings();await document.fonts.load(`${settings.size}px "${settings.font}"`);loadChapter(b.position.chapter,b.position);await Promise.all([...$('reader-text').querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));layout(b.position);await remember();$('reader-back').focus({preventScroll:true});
}
function cancelTurn(){turnAnimation?.cancel();turnAnimation=null;$('reader-flip').replaceChildren();busy=false;}
async function turn(direction){
 if(!current||busy||$('lib-dialog').open)return;if(direction>0&&$('reader-next').disabled||direction<0&&$('reader-prev').disabled)return;
 busy=true;const old=$('reader-scroll').cloneNode(true),oldScroll=$('reader-scroll').scrollLeft;
 if(direction>0){if(spread<pages-1)spread++;else loadChapter(chapter+1);}else if(spread>0)spread--;else {loadChapter(chapter-1);spread=pages-1;}
 $('reader-scroll').scrollLeft=spread*stride;paintReader();current.position=locator();
 if(!reduced()){
  const flyer=$('reader-flip'),leaf=document.createElement('div');leaf.className='reader-leaf '+(direction>0?'forward':'backward');
  const front=document.createElement('div');front.className='reader-leaf-front';
  old.removeAttribute('id');old.className='reader-clone';old.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));old.style.width=$('reader-scroll').clientWidth+'px';old.style.height=$('reader-scroll').clientHeight+'px';
  const stationary=document.createElement('div');stationary.className='reader-stationary '+(direction>0?'left':'right');
  const fixed=old.cloneNode(true);stationary.append(fixed);flyer.append(stationary);fixed.scrollLeft=oldScroll;
  front.append(old);const back=document.createElement('div');back.className='reader-leaf-back';
  const destination=$('reader-scroll').cloneNode(true),destinationScroll=$('reader-scroll').scrollLeft;
  destination.removeAttribute('id');destination.className='reader-clone reader-destination';destination.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));destination.style.width=$('reader-scroll').clientWidth+'px';destination.style.height=$('reader-scroll').clientHeight+'px';
  back.append(destination);leaf.append(front,back);flyer.append(leaf);old.scrollLeft=oldScroll;destination.scrollLeft=destinationScroll;
  turnAnimation=leaf.animate([{transform:'rotateY(0deg)'},{transform:`rotateY(${direction>0?-180:180}deg)`}],{duration:850,easing:'cubic-bezier(.35,.05,.25,1)',fill:'forwards'});
  try{await turnAnimation.finished;}catch{}flyer.replaceChildren();turnAnimation=null;
 }
 busy=false;await remember();
}
async function closeReader(){cancelTurn();if(current){await remember();current=null;}$('library-reader').hidden=true;$('library-home').hidden=false;}
function settingsDialog(){modal(`<h2>Удобно вашим глазам</h2><div class="lib-dialog-stack"><label>Шрифт<select id="reader-font">${['Literata','Lora','EB Garamond','Cormorant Garamond','Vollkorn','Georgia'].map(f=>`<option ${settings.font===f?'selected':''}>${f}</option>`).join('')}</select></label><label>Размер текста<input id="reader-size" type="range" min="16" max="32" value="${settings.size}"><output id="reader-size-label">${settings.size}</output></label><label>Межстрочный интервал<select id="reader-leading">${[1.5,1.75,2].map(v=>`<option value="${v}" ${settings.leading===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Бумага<select id="reader-paper">${Object.entries({ivory:'Слоновая кость',white:'Светлая',night:'Ночная'}).map(([id,s])=>`<option value="${id}" ${settings.paper===id?'selected':''}>${s}</option>`).join('')}</select></label></div>`);
 const pos=locator();let revision=0;
 for(const id of ['reader-font','reader-size','reader-leading','reader-paper'])$(id).oninput=task(async()=>{const token=++revision;settings={font:$('reader-font').value,size:Number($('reader-size').value),leading:Number($('reader-leading').value),paper:$('reader-paper').value};$('reader-size-label').textContent=settings.size;localStorage.setItem('pergamin-reader-settings',JSON.stringify(settings));applySettings();await document.fonts.load(`${settings.size}px "${settings.font}"`);if(token!==revision||!current)return;layout(pos);await remember();});
}
function outlineDialog(){modal(`<h2>Оглавление</h2><label>Найти в книге<input id="reader-find" type="search" placeholder="Слово или фраза"></label><div id="reader-find-results"></div><div class="lib-dialog-stack">${current.chapters.map((c,i)=>`<button data-chapter="${i}" ${i===chapter?'aria-current="true"':''}>${i+1}. ${esc(c.title)}</button>`).join('')}</div>`);$('reader-find').oninput=()=>{const q=$('reader-find').value.trim().toLowerCase();if(q.length<2){$('reader-find-results').innerHTML='';return;}const results=[];current.chapters.forEach((c,i)=>{const doc=new DOMParser().parseFromString(c.html,'text/html'),els=[...doc.querySelectorAll('p,h1,h2,h3,h4,li,pre,blockquote')].filter(e=>!e.querySelector('p,h1,h2,h3,h4,li,pre,blockquote'));els.forEach((e,j)=>{const text=e.textContent,offset=text.toLowerCase().indexOf(q);if(offset>=0&&results.length<80)results.push(`<button data-location="${i},${j},${offset}">${esc(c.title)} — ${esc(text.slice(Math.max(0,offset-30),offset+100))}</button>`);});});$('reader-find-results').innerHTML=`<p>${results.length}${results.length===80?'+':''} совпадений</p><div class="lib-dialog-stack">${results.join('')}</div>`;};}
async function bookmark(){const pos=locator();if(current.bookmarks.some(b=>b.chapter===pos.chapter&&b.block===pos.block&&b.offset===pos.offset)){toast('Закладка уже есть на этом месте.');return;}current.bookmarks.push({...pos,id:crypto.randomUUID(),label:blocks()[pos.block]?.textContent.slice(pos.offset,pos.offset+85)||current.chapters[chapter].title});await save(current);toast('Закладка сохранена. Она доступна в «Заметках».');}
function notesDialog(){
 const selection=getSelection(),quote=selection&&$('reader-text').contains(selection.anchorNode)?selection.toString().trim().slice(0,4000):'',anchor=selection?.anchorNode?.parentElement?.closest('[data-block]');
 const pos=quote&&anchor?{chapter,block:Number(anchor.dataset.block),offset:Math.max(0,anchor.textContent.indexOf(quote))}:locator();
 modal(`<h2>Закладки и заметки</h2><h3>Сохранить мысль</h3>${quote?`<blockquote>${esc(quote)}</blockquote>`:'<p class="lib-muted">Выделите текст перед открытием этой панели, чтобы добавить цитату.</p>'}<label>Заметка<textarea id="reader-note-text" maxlength="4000" rows="3" placeholder="Что хочется запомнить?"></textarea></label><button id="reader-note-save">${quote?'Сохранить цитату и заметку':'Сохранить заметку к этому месту'}</button><h3>Закладки</h3><div class="lib-dialog-stack">${current.bookmarks.map(b=>`<div class="lib-note-row"><button data-location="${b.chapter},${b.block},${b.offset}">${esc(b.label)}</button><button data-remove-bookmark="${b.id}" aria-label="Удалить закладку">×</button></div>`).join('')||'<p>Пока нет закладок.</p>'}</div><h3>Заметки</h3><div class="lib-dialog-stack">${current.notes.map(n=>`<div class="lib-note-row"><button data-location="${n.chapter},${n.block},${n.offset}">${n.quote?`<q>${esc(n.quote)}</q><br>`:''}${esc(n.text||'Цитата')}</button><button data-remove-note="${n.id}" aria-label="Удалить заметку">×</button></div>`).join('')||'<p>Пока нет заметок.</p>'}</div>`);
 $('reader-note-save').onclick=task(async()=>{const text=$('reader-note-text').value.trim();if(!text&&!quote){toast('Напишите заметку или выделите цитату.');return;}current.notes.push({...pos,id:crypto.randomUUID(),quote,text});await save(current);highlightNotes();getSelection()?.removeAllRanges();notesDialog();toast('Заметка сохранена.');});
}
root.addEventListener('click',task(async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.category)await zoomTo(b.dataset.category,b);
 if(b.dataset.shelf){shelf=b.dataset.shelf;category='all';render();}
 if(b.dataset.book)detail(b.dataset.book);
 if(b.dataset.read)await read(b.dataset.read);
 if(b.dataset.action==='import')importDialog();
 if(b.dataset.chapter!==undefined){loadChapter(Number(b.dataset.chapter));$('lib-dialog').close();await remember();}
 if(b.dataset.location){const [chapter,block,offset]=b.dataset.location.split(',').map(Number);loadChapter(chapter,{block,offset});$('lib-dialog').close();await remember();}
 if(b.dataset.removeBookmark){current.bookmarks=current.bookmarks.filter(n=>n.id!==b.dataset.removeBookmark);await save(current);notesDialog();}
 if(b.dataset.removeNote){current.notes=current.notes.filter(n=>n.id!==b.dataset.removeNote);await save(current);highlightNotes();notesDialog();}
}));
$('lib-home').onclick=task(async()=>{category='all';shelf='all';query='';$('lib-search').value='';await home();});
$('lib-back').onclick=()=>{category='all';shelf='all';query='';$('lib-search').value='';render();$('lib-room button')?.focus({preventScroll:true});};
$('lib-search').oninput=()=>{query=$('lib-search').value.trim().toLocaleLowerCase('ru');render();};
$('lib-sort').onchange=e=>{sort=e.target.value;render();};$('lib-view').onclick=()=>{list=!list;$('lib-view').setAttribute('aria-pressed',String(list));$('lib-view').textContent=list?'Корешки':'Список';render();};
$('lib-import').onclick=importDialog;$('lib-tools').onclick=toolsDialog;$('lib-editor').onclick=task(editor);$('lib-dialog-close').onclick=()=>$('lib-dialog').close();
$('lib-file').onchange=task(async e=>{const files=[...e.target.files];e.target.value='';await addFiles(files,$('lib-encoding')?.value||'utf-8');});
$('lib-restore-file').onchange=task(async e=>{const file=e.target.files[0];e.target.value='';if(file)await restore(file);});
$('lib-sources').onclick=()=>modal('<h2>Открытые книги, понятные источники</h2><p>Стартовая коллекция — оригинальные произведения Пушкина, Гоголя, Лермонтова, Толстого и Чехова из Викитеки. Это полные литературные тексты без современного справочного аппарата и иллюстраций. Историческая проза — художественные произведения, а не учебники истории.</p><p>Источник, конкретная версия и условия использования указаны в карточке каждой книги. Подготовка текстов Викитеки — CC BY-SA 4.0; авторские оригиналы находятся в общественном достоянии в странах со сроком жизнь автора + 70 лет. При распространении в других юрисдикциях проверьте местные требования.</p><p>Детский раздел содержит литературные сказки, в которых могут встречаться тревожные события. Выбирайте произведения вместе с ребёнком. Это не автоматическая возрастная классификация.</p><p>Личные импорты никому не публикуются. Синхронизации с облаком в этой версии нет.</p>');
$('reader-back').onclick=task(home);$('reader-prev').onclick=task(()=>turn(-1));$('reader-next').onclick=task(()=>turn(1));$('reader-bookmark').onclick=task(bookmark);$('reader-outline').onclick=outlineDialog;$('reader-notes').onclick=notesDialog;$('reader-settings').onclick=settingsDialog;
$('reader-finish').onclick=task(async()=>{current.status='read';current.progress=1;await save(current);toast('Книга на полке «Прочитано».');paintReader();});
// Capture only our navigation shortcuts; hidden editor shortcuts must not mutate manuscripts.
document.addEventListener('keydown',e=>{
 if(document.body.dataset.appMode!=='library')return;
 if((e.ctrlKey||e.metaKey)&&['f','k','s'].includes(e.key.toLowerCase())){e.stopImmediatePropagation();if(e.key.toLowerCase()==='f'){e.preventDefault();if(current)outlineDialog();else $('lib-search').focus();}return;}
 if(e.key==='F9'){e.stopImmediatePropagation();return;}
 if(current&&!$('lib-dialog').open&&!e.target.closest('input,textarea,select')){
  if(['ArrowRight','PageDown','ArrowLeft','PageUp',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();task(()=>turn(['ArrowLeft','PageUp'].includes(e.key)?-1:1))();}
  if(e.key==='Escape'){e.stopImmediatePropagation();task(home)();}
 }
},true);
let touchStart;
$('reader-stage').addEventListener('touchstart',e=>{touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
$('reader-stage').addEventListener('touchend',e=>{if(!touchStart||getSelection()?.toString())return;const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>70&&Math.abs(dy)<60)task(()=>turn(dx<0?1:-1))();},{passive:true});
window.addEventListener('resize',()=>{if(!current)return;const pos=current.position;cancelTurn();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(current){layout(pos);task(remember)();}},180);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&current)task(remember)();});
function validSettings(s={}){return {font:['Literata','Lora','EB Garamond','Cormorant Garamond','Vollkorn','Georgia'].includes(s.font)?s.font:'Literata',size:Math.max(16,Math.min(32,Number(s.size)||20)),leading:[1.5,1.75,2].includes(s.leading)?s.leading:1.75,paper:['ivory','white','night'].includes(s.paper)?s.paper:'ivory'};}
async function init(){
 document.body.dataset.appMode=new URLSearchParams(location.search).get('mode')==='editor'?'editor':'library';
 const entry=document.createElement('button');entry.id='open-reader-library';entry.textContent='← Библиотека';entry.onclick=task(home);document.querySelector('.toolbar-main .right').prepend(entry);
 db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pergamin-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('books',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>toast('Закройте другие вкладки Пергамина для обновления библиотеки.');});
 books=await allBooks();const response=await fetch('catalog/starter.json');if(!response.ok)throw Error('Не удалось загрузить стартовую коллекцию.');const starter=(await response.json()).books,known=new Set(books.map(b=>b.id)),starterIds=new Set(starter.map(b=>b.id)),fresh=starter.filter(b=>!known.has(b.id)).map(normalizeBook);
 // Retire stale catalog books the new collection replaced (e.g. the old
 // per-story Holmes set). Only catalog-origin books are ever auto-deleted, and
 // only when their id is absent from the current starter — user copies in
 // «Мои книги» and imported books are never touched.
 const stale=books.filter(b=>b.origin==='catalog'&&!starterIds.has(b.id));
 await transact('readwrite',s=>{stale.forEach(b=>s.delete(b.id));fresh.forEach(b=>s.add(b));});
 if(stale.length)books=books.filter(b=>!stale.some(x=>x.id===b.id));
 books.push(...fresh);
 try{settings=validSettings(JSON.parse(localStorage.getItem('pergamin-reader-settings')||'{}'));}catch{toast('Настройки чтения сброшены; книги сохранены.');}
 render();window.__pgLibrary__={ready:true,books:()=>structuredClone(books),read,home,turn,addFiles,restore,backup,flush:()=>writeQueue,state:()=>({chapter,spread,pages,per,busy,position:current?locator():null}),normalizeBook};
}
init().catch(error=>{fail(error);$('lib-room').innerHTML=`<div class="lib-empty"><h2>Библиотека не открылась</h2><p>${esc(error.message)}</p><button onclick="location.reload()">Повторить</button><p>Мастерская по-прежнему доступна сверху.</p></div>`;});
