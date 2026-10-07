/* Local-only reader formats. No imported CSS, script, SVG, or remote resources. */
export const MAX_FILE = 32 * 1024 * 1024;
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const genres = {classic:'Художественная',fantasy:'Фантастика и мистика',children:'Детям',history:'Историческая проза',poetry:'Поэзия',holmes:'Шерлок Холмс',foreign:'Зарубежная классика',personal:'Мои книги'};
export const statuses = {none:'Без полки',want:'Хочу прочитать',reading:'Читаю',read:'Прочитано'};
export function safeImage(value) {return typeof value==='string' && value.length<12*1024*1024 && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value) ? value : '';}
export function sanitize(html) {
 const doc = new DOMParser().parseFromString(String(html), 'text/html');
 doc.querySelectorAll('script,style,iframe,object,embed,svg,math,form,input,button,video,audio,link,meta,base,template').forEach(n=>n.remove());
 const allowed=new Set(['P','DIV','SECTION','H1','H2','H3','H4','BLOCKQUOTE','UL','OL','LI','EM','STRONG','I','B','BR','HR','IMG','SUP','SUB','SPAN','PRE']);
 for(const el of [...doc.body.querySelectorAll('*')].reverse()){
  if(!allowed.has(el.tagName)){el.replaceWith(...el.childNodes);continue;}
  const src=el.tagName==='IMG'?safeImage(el.getAttribute('src')):'';
  const verse=el.classList.contains('verse');
  for(const a of [...el.attributes])el.removeAttribute(a.name);
  if(el.tagName==='IMG'){if(src){el.src=src;el.alt='Иллюстрация';}else el.remove();}
  if(verse)el.className='verse';
 }
 return doc.body.innerHTML;
}
export function xml(text){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Повреждённый XML в книге.');return doc;}
const nodes=(doc,name)=>[...doc.getElementsByTagNameNS('*',name)];
const first=(doc,name)=>nodes(doc,name)[0];
const val=(doc,name)=>first(doc,name)?.textContent.trim()||'';
function path(base,relative){
 if(/^[a-z]+:|^\/|^\\/i.test(relative))throw Error('Внешний путь в EPUB не поддерживается.');
 const out=base.split('/').slice(0,-1);
 for(const bit of decodeURIComponent(relative.split('#')[0]).split('/')){if(bit==='..'){if(!out.length)throw Error('Небезопасный путь EPUB.');out.pop();}else if(bit&&bit!=='.')out.push(bit);}
 return out.join('/');
}
export async function unzip(buffer){
 const v=new DataView(buffer),bytes=new Uint8Array(buffer),entries=new Map(); let end=-1,total=0;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Не удалось прочитать ZIP-контейнер EPUB.');
 const count=v.getUint16(end+10,true);if(count>2000)throw Error('Слишком много файлов в EPUB.');
 let pos=v.getUint32(end+16,true);
 for(let i=0;i<count;i++){
  if(pos+46>bytes.length||v.getUint32(pos,true)!==0x02014b50)throw Error('Повреждённый каталог EPUB.');
  const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),compressed=v.getUint32(pos+20,true),size=v.getUint32(pos+24,true),n=v.getUint16(pos+28,true),x=v.getUint16(pos+30,true),c=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
  const name=new TextDecoder().decode(bytes.slice(pos+46,pos+46+n));pos+=46+n+x+c;total+=size;
  if(flags&1)throw Error('Зашифрованные EPUB не поддерживаются.');
  if(total>64*1024*1024||size>16*1024*1024)throw Error('Распакованный EPUB слишком большой.');
  if(name.includes('..')||name.startsWith('/')||name.includes('\\')||entries.has(name))throw Error('Небезопасный каталог EPUB.');
  if(offset+30>bytes.length||v.getUint32(offset,true)!==0x04034b50)throw Error('Повреждённый файл EPUB.');
  const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);
  if(start+compressed>bytes.length)throw Error('Обрезанный файл EPUB.');
  entries.set(name,async()=>{
   const raw=bytes.slice(start,start+compressed);let data;
   if(method===0)data=raw;
   else if(method===8){
    const reader=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let length=0;
    while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>size||length>16*1024*1024){await reader.cancel();throw Error('Превышен размер распаковки EPUB.');}chunks.push(r.value);}
    data=new Uint8Array(length);let cursor=0;for(const chunk of chunks){data.set(chunk,cursor);cursor+=chunk.length;}
   }else throw Error('Этот способ сжатия EPUB не поддерживается.');
   if(data.length!==size)throw Error('Неверный размер файла EPUB.');return data;
  });
 }
 if(entries.has('META-INF/encryption.xml'))throw Error('EPUB содержит DRM или зашифрованные ресурсы. Нужен файл без шифрования.');
 return entries;
}
export const dataUrl = blob => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Не удалось прочитать файл.'));r.readAsDataURL(blob);});
async function epub(buffer){
 const zip=await unzip(buffer),text=async p=>{if(!zip.has(p))throw Error('В EPUB отсутствует '+p);return new TextDecoder().decode(await zip.get(p)());};
 const container=xml(await text('META-INF/container.xml')),opfPath=first(container,'rootfile')?.getAttribute('full-path');
 if(!opfPath)throw Error('EPUB не содержит описания книги.');
 const opf=xml(await text(opfPath)),items=new Map(nodes(opf,'item').map(n=>[n.getAttribute('id'),n]));
 const assets=new Map();
 async function image(p,type){if(!assets.has(p)){if(!zip.has(p))return '';assets.set(p,await dataUrl(new Blob([await zip.get(p)()],{type})));}return assets.get(p);}
 const chapters=[];
 for(const ref of nodes(opf,'itemref')){
  if(ref.getAttribute('linear')==='no')continue;
  const item=items.get(ref.getAttribute('idref'));if(!item)throw Error('Повреждено оглавление EPUB.');
  if(!/html/.test(item.getAttribute('media-type')||''))continue;
  const name=path(opfPath,item.getAttribute('href')),doc=new DOMParser().parseFromString(await text(name),'text/html');
  for(const img of doc.querySelectorAll('img')){
   try {const p=path(name,img.getAttribute('src')||''),it=[...items.values()].find(n=>path(opfPath,n.getAttribute('href'))===p);img.setAttribute('src',it?await image(p,it.getAttribute('media-type')):'');}catch{img.remove();}
  }
  const html=sanitize(doc.body.innerHTML);if(doc.body.textContent.trim()||html.includes('<img'))chapters.push({title:doc.querySelector('h1,h2,h3')?.textContent.trim()||`Раздел ${chapters.length+1}`,html});
 }
 const coverItem=[...items.values()].find(n=>(n.getAttribute('properties')||'').split(' ').includes('cover-image'));
 const cover=coverItem?safeImage(await image(path(opfPath,coverItem.getAttribute('href')),coverItem.getAttribute('media-type'))):'';
 return {title:val(opf,'title'),author:val(opf,'creator'),language:val(opf,'language')||'ru',chapters,cover};
}
function fb2(text){
 const doc=xml(text),info=first(doc,'title-info');if(!info)throw Error('В FB2 нет описания книги.');
 const binaries=new Map(nodes(doc,'binary').map(n=>[n.getAttribute('id'),safeImage(`data:${n.getAttribute('content-type')};base64,${n.textContent.replace(/\s/g,'')}`)]));
 const render=n=>{
  if(n.nodeType===3)return esc(n.textContent);
  const tag=n.localName;if(!tag)return '';
  if(tag==='image'){const id=[...n.attributes].find(a=>a.localName==='href')?.value.slice(1),src=binaries.get(id);return src?`<p><img src="${src}" alt="Иллюстрация"></p>`:'';}
  const map={p:'p',title:'h2',subtitle:'h3',emphasis:'em',strong:'strong',cite:'blockquote',poem:'div',stanza:'p',v:'span','empty-line':'br',section:'section',epigraph:'blockquote',text:'span'};
  const t=map[tag]||'div',body=[...n.childNodes].map(render).join('');return `<${t}${tag==='stanza'?' class="verse"':''}>${body}${tag==='v'?'\n':''}</${t}>`;
 };
 const chapters=[];
 for(const body of nodes(doc,'body')){
  if(body.getAttribute('name')==='notes')continue;
  const sections=[...body.children].filter(n=>n.localName==='section');
  // Keep preambles as well as chapter sections.
  let pre=[];for(const n of body.children){if(n.localName==='section'){if(pre.length){chapters.push({title:'Вступление',html:sanitize(pre.join(''))});pre=[];}chapters.push({title:val(n,'title')||`Глава ${chapters.length+1}`,html:sanitize(render(n))});}else pre.push(render(n));}
  if(pre.length)chapters.push({title:sections.length?'Послесловие':'Текст',html:sanitize(pre.join(''))});
 }
 const coverNode=first(first(info,'coverpage')||info,'image'),coverId=coverNode?[...coverNode.attributes].find(a=>a.localName==='href')?.value.slice(1):'';
 const author=nodes(info,'author').map(a=>[val(a,'first-name'),val(a,'middle-name'),val(a,'last-name')].filter(Boolean).join(' ')).join(', ');
 return {title:val(info,'book-title'),author,language:val(info,'lang')||'ru',chapters,cover:binaries.get(coverId)||''};
}
export async function importFile(file,encoding='utf-8'){
 if(!file.size||file.size>MAX_FILE)throw Error('Размер книги должен быть от 1 байта до 32 МБ.');
 const buffer=await file.arrayBuffer(),ext=file.name.split('.').pop().toLowerCase();let book;
 if(ext==='epub')book=await epub(buffer);
 else if(ext==='fb2')book=fb2(new TextDecoder(encoding).decode(buffer));
 else if(ext==='txt'){
  const bytes=new Uint8Array(buffer),enc=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':encoding;
  const text=new TextDecoder(enc).decode(bytes).replace(/\r/g,'');
  book={chapters:[{title:'Текст',html:text.split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${esc(p).replaceAll('\n','<br>')}</p>`).join('')}]};
 }else throw Error('Выберите EPUB без DRM, FB2 или TXT. PDF пока открывайте в отдельном просмотрщике.');
 if(!book.chapters?.length)throw Error('В книге не найден текст.');
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
 return {...book,id:'local-'+digest,title:book.title||file.name.replace(/\.[^.]+$/,''),author:book.author||'Автор не указан',genre:'personal',origin:'import',originalName:file.name,original:await dataUrl(file),rights:'Личный импорт. Права на распространение определяет владелец произведения.'};
}
export function normalizeBook(raw){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.chapters)||!raw.chapters.length||raw.chapters.length>2000)throw Error('Некорректная книга в копии.');
 const text=(s,n=200)=>String(s??'').slice(0,n);
 const chapters=raw.chapters.map((c,i)=>({title:text(c.title||`Глава ${i+1}`),html:sanitize(c.html||''),source:/^https:\/\//.test(c.source)?text(c.source,2000):''}));
 if(chapters.reduce((n,c)=>n+c.html.length,0)>64*1024*1024)throw Error('Текст книги слишком большой.');
 const pos=p=>({chapter:Math.max(0,Math.min(chapters.length-1,Math.floor(Number(p?.chapter)||0))),block:Math.max(0,Math.floor(Number(p?.block)||0)),offset:Math.max(0,Math.floor(Number(p?.offset)||0))});
 const original=typeof raw.original==='string'&&/^data:[^,]*;base64,[a-z0-9+/=\s]+$/i.test(raw.original)&&raw.original.length<MAX_FILE*1.4?raw.original:'';
 return {id:/^[\w-]{1,100}$/.test(raw.id)?raw.id:crypto.randomUUID(),title:text(raw.title||'Без названия'),author:text(raw.author||'Автор не указан'),sortAuthor:text(raw.sortAuthor||raw.author),genre:Object.hasOwn(genres,raw.genre)?raw.genre:'personal',language:text(raw.language||'ru',12),description:text(raw.description,2000),cover:safeImage(raw.cover),chapters,origin:raw.origin==='catalog'?'catalog':'import',source:/^https:\/\//.test(raw.source)?text(raw.source,2000):'',rights:text(raw.rights,3000),licenseUrl:/^https:\/\//.test(raw.licenseUrl)?text(raw.licenseUrl,1000):'',original,originalName:text(raw.originalName),status:Object.hasOwn(statuses,raw.status)?raw.status:'none',favorite:!!raw.favorite,progress:Math.max(0,Math.min(1,Number(raw.progress)||0)),position:pos(raw.position),lastRead:Number(raw.lastRead)||0,addedAt:Number(raw.addedAt)||Date.now(),bookmarks:(raw.bookmarks||[]).slice(0,500).map(b=>({...pos(b),id:text(b.id)||crypto.randomUUID(),label:text(b.label)})),notes:(raw.notes||[]).slice(0,1000).map(n=>({...pos(n),id:text(n.id)||crypto.randomUUID(),quote:text(n.quote,4000),text:text(n.text,4000)}))};
}
