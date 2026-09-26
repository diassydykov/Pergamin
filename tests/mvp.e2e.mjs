import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, rm, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = 'E:/pergamin';
const PROFILE = 'E:/hermes/cache/scratch/pergamin-mvp-e2e-profile';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8432;
const DEBUG_PORT = 9335;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.png':'image/png'};

await rm(PROFILE, {recursive:true, force:true});
const server = createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${PORT}`).pathname);
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = normalize(join(ROOT, rel));
    if (!file.toLowerCase().startsWith(normalize(ROOT).toLowerCase())) throw new Error('bad path');
    await stat(file); const data = await readFile(file);
    res.writeHead(200, {'content-type':types[extname(file)] || 'application/octet-stream','cache-control':'no-store'}); res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run','--disable-background-networking','--disable-sync','--disable-component-update',
  '--disable-default-apps','--window-size=1400,1000', `http://127.0.0.1:${PORT}/?e2e=1`
], {stdio:'ignore'});

async function waitForJson(url, timeout=20000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){ try{ const r=await fetch(url); if(r.ok)return r.json(); }catch{} await new Promise(r=>setTimeout(r,150)); }
  throw new Error(`timeout waiting for ${url}`);
}
let ws;
try {
  const pages = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = pages.find(p => p.url.includes(`127.0.0.1:${PORT}`));
  assert.ok(page, 'Pergamin tab not found');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ ws.addEventListener('open',resolve,{once:true}); ws.addEventListener('error',reject,{once:true}); });
  let seq=0; const pending=new Map(); const consoleErrors=[];
  ws.addEventListener('message',ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){ const {resolve,reject}=pending.get(m.id); pending.delete(m.id); m.error?reject(new Error(m.error.message)):resolve(m.result); } if(m.method==='Runtime.exceptionThrown')consoleErrors.push(m.params.exceptionDetails?.text||'exception'); if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')consoleErrors.push(m.params.entry.text); });
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{ const id=++seq; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); });
  await cdp('Runtime.enable'); await cdp('Log.enable');
  async function js(expression){ const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails)throw new Error(r.exceptionDetails.text); return r.result.value; }
  const end=Date.now()+15000; let ready=false;
  while(Date.now()<end){ ready=await js(`Boolean(window.__pg__?.currentBookId() && window.__pgMvp__)`); if(ready)break; await new Promise(r=>setTimeout(r,150)); }
  assert.ok(ready,'app did not initialize');

  const anchors=await js(`['search-toggle','search-panel','writing-stats','backup-library','restore-library','word-goal'].every(id=>document.getElementById(id))`);
  assert.equal(anchors,true,'MVP controls missing');

  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp('Page.reload',{ignoreCache:true}); await new Promise(r=>setTimeout(r,800));
  const mobile=await js(`(()=>{const box=id=>{const e=document.getElementById(id);return {client:e.clientWidth,scroll:e.scrollWidth,left:Math.round(e.getBoundingClientRect().left),right:Math.round(e.getBoundingClientRect().right)}};return {body:{client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth},viewport:box('page-viewport'),page:box('page'),ms:box('ms'),two:document.querySelector('.book').classList.contains('twp')}})()`);
  assert.equal(mobile.two,false,'mobile must use a single page');
  assert.ok(mobile.page.right<=mobile.viewport.right+1 && mobile.ms.scroll<=mobile.ms.client+1,`mobile book overflows: ${JSON.stringify(mobile)}`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.reload',{ignoreCache:true}); await new Promise(r=>setTimeout(r,800));

  const stats=await js(`(()=>{const id=__pg__.currentBookId();__pg__.updateBook(id,{content:'<p>Раз два три четыре</p>'});return __pgMvp__.textStats('<p>Раз два три четыре</p>')})()`);
  assert.deepEqual({words:stats.words,chars:stats.chars,readingMinutes:stats.readingMinutes},{words:4,chars:18,readingMinutes:1});
  assert.equal(await js(`__pgMvp__.textStats('<p>Раз</p><p>два</p>').words`),2,'block boundaries must separate words');
  await new Promise(r=>setTimeout(r,200));
  assert.equal(await js(`document.getElementById('stat-words').textContent`),'4');

  const search=await js(`(()=>{document.getElementById('search-toggle').click();const i=document.getElementById('search-input');i.value='три';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.search-result')?.click();return {count:document.querySelectorAll('.search-result').length,selected:getSelection().toString()}})()`);
  assert.deepEqual(search,{count:1,selected:'три'});

  const backup=await js(`(()=>{const b=__pgMvp__.createBackup();return {app:b.app,version:b.version,count:b.books.length,content:b.books[0].content}})()`);
  assert.equal(backup.app,'pergamin'); assert.equal(backup.version,1); assert.ok(backup.count>=1); assert.match(backup.content,/Раз два/);

  const unicodeSearch=await js(`(()=>{const id=__pg__.currentBookId();__pg__.updateBook(id,{content:'<p>İstanbul до цели</p>'});document.getElementById('search-input').value='цели';document.getElementById('search-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.search-result')?.click();return {item:__pgMvp__.searchBook('цели')[0],selected:getSelection().toString()};})()`);
  assert.equal(unicodeSearch.selected,'цели');

  await assert.rejects(()=>js(`__pgMvp__.restoreBackup({app:'pergamin',version:999,books:[{id:'bad-version',title:'Нет',content:'<p>x</p>'}]})`),/unsupported|exception|Ошибка|Error/i);
  const dirtyRestore=await js(`(async()=>{const id=__pg__.currentBookId();const ms=document.getElementById('ms');ms.innerHTML='<p>Несохранённый старый текст</p>';ms.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'x'}));await __pgMvp__.restoreBackup({app:'pergamin',version:1,books:[{id,title:'Восстановлено',content:'<p>Контент из резервной копии</p>'}]});await new Promise(r=>setTimeout(r,100));return {content:__pg__.getBook(id).content,dom:ms.innerHTML};})()`);
  assert.match(dirtyRestore.content,/Контент из резервной копии/); assert.match(dirtyRestore.dom,/Контент из резервной копии/);
  const restored=await js(`(async()=>{const id='e2e-import';const n=await __pgMvp__.restoreBackup({app:'pergamin',version:1,books:[{id,title:'Импорт',content:'<p onclick="window.bad=1" style="background:url(https://evil.invalid/a)">Текст</p><script>window.bad=2</script><img src="https://evil.invalid/x.png" srcset="https://evil.invalid/y.png 2x"><svg><a xlink:href="https://evil.invalid/z">x</a></svg>',illusHistory:[null,{what:123,prompt:null}]}]});const b=__pg__.getBook(id);return {n,content:b.content,history:b.illusHistory,bad:window.bad||0,active:__pg__.currentBookId()};})()`);
  assert.equal(restored.n,1); assert.equal(restored.active,'e2e-import'); assert.equal(restored.bad,0); assert.doesNotMatch(restored.content,/script|onclick|srcset|url\(|svg|xlink|https:\/\/evil/i); assert.deepEqual(restored.history.map(h=>typeof h.what+':'+typeof h.prompt),['string:string','string:string']);

  const goal=await js(`(()=>{const g=document.getElementById('word-goal');g.value='10';g.dispatchEvent(new Event('change',{bubbles:true}));return {goal:__pg__.getBook(__pg__.currentBookId()).wordGoal,max:Number(document.getElementById('goal-progress').max)}})()`);
  assert.deepEqual(goal,{goal:10,max:10});

  const restoreFailure=await js(`(async()=>{const proto=IDBDatabase.prototype,orig=proto.transaction,id=__pg__.currentBookId();let failures=2;proto.transaction=function(name,mode){if(name==='books'&&mode==='readwrite'&&failures-->0)throw new Error('forced-save-failure');return orig.apply(this,arguments)};try{await __pg__.updateBook(id,{title:'Ожидает сохранения'});let rejected=false;try{await __pgMvp__.restoreBackup({app:'pergamin',version:1,books:[{id,title:'Не должна примениться',content:'<p>backup</p>'}]})}catch(e){rejected=true}return {rejected,title:__pg__.getBook(id).title}}finally{proto.transaction=orig}})()`);
  assert.equal(restoreFailure.rejected,true,'restore must abort when preliminary flush fails');
  consoleErrors.length=0;

  const paging=await js(`(async()=>{const id=__pg__.currentBookId();__pg__.updateBook(id,{content:Array.from({length:120},(_,i)=>'<p>Абзац '+i+' '+('длинный текст '.repeat(12))+'</p>').join('')});await new Promise(r=>setTimeout(r,300));const next=document.getElementById('pg-next'),sc=document.getElementById('page-scroll');for(let i=0;i<100&&!next.disabled;i++){next.click();await new Promise(r=>setTimeout(r,8));}return {top:sc.scrollTop,max:sc.scrollHeight-sc.clientHeight,disabled:next.disabled,count:document.getElementById('pg-count').textContent};})()`);
  assert.equal(paging.disabled,true); assert.ok(Math.abs(paging.top-paging.max)<=2,`tail unreachable: ${JSON.stringify(paging)}`);

  const deletion=await js(`(async()=>{const proto=IDBDatabase.prototype,orig=proto.transaction,before=__pg__.currentBookId();let fail=true;proto.transaction=function(name,mode){if(fail&&name==='books'&&mode==='readwrite'){fail=false;throw new Error('forced-delete-precondition')}return orig.apply(this,arguments)};try{await __pg__.updateBook(before,{title:'Ошибка перед удалением'})}finally{proto.transaction=orig}await __pgMvp__.deleteBook(before);const flushed=await __pgMvp__.flush();const inserted=__pg__.insertFigureAtSelection(before,{dataUrl:'data:image/png;base64,iVBORw0KGgo=',caption:'x',prompt:'x'});return {active:__pg__.currentBookId(),count:document.getElementById('books').options.length,inserted,flushed};})()`);
  assert.ok(deletion.active); assert.ok(deletion.count>=1); assert.equal(deletion.inserted,false); assert.equal(deletion.flushed,true,'deleted failed save must not poison future flushes');
  assert.deepEqual(consoleErrors,[],`browser errors: ${consoleErrors.join('; ')}`);
  console.log(JSON.stringify({ok:true,stats,search,backup:{...backup,content:'<omitted>'},restored,goal,paging,deletion},null,2));
} finally {
  try{ws?.close();}catch{}
  try{chrome.kill('SIGTERM');}catch{}
  await Promise.race([new Promise(r=>chrome.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);
  await new Promise(r=>server.close(r));
  for(let i=0;i<8;i++){ try{await rm(PROFILE,{recursive:true,force:true,maxRetries:3,retryDelay:150});break;}catch(err){if(i===7)throw err;await new Promise(r=>setTimeout(r,300));} }
}
