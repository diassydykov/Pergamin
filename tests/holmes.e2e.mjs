import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const ROOT=resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
let playwright;
try{playwright=require('playwright');}catch(error){
 if(error.code!=='MODULE_NOT_FOUND')throw error;
 playwright=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}
const {chromium}=playwright;
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(ROOT,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(ROOT+'\\'))throw Error('path');const data=await readFile(file);res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'}[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`,browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];
 const ready=()=>page.waitForFunction(()=>window.__pgLibrary__?.ready);
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url);await ready();
 // The holmes shelf exists on the home screen and carries the collection.
 const shelf=page.locator('[data-category="holmes"]');
 assert.equal(await shelf.count(),1,'holmes shelf missing');
 const holmesCount=await page.evaluate(()=>__pgLibrary__.books().filter(b=>b.genre==='holmes').length);
 assert.equal(holmesCount,9,'holmes shelf should have 9 canonical books, got '+holmesCount);
 // Search the novel from the home screen.
 await page.locator('#lib-search').fill('Собака Баскервилей');
 const count=await page.locator('.lib-volume').count();
 assert.ok(count>=1,'search found '+count+' books');
 // Open it in the reader.
 await page.locator('.lib-volume').first().click();
 const title=await page.locator('.lib-detail h2').innerText();
 await page.locator('#lib-dialog [data-read]').click();
 await page.waitForTimeout(250);
 assert.equal(await page.locator('#reader-title').innerText(),title);
 assert.ok((await page.evaluate(()=>__pgLibrary__.state())).pages>1);
 // Turn a page and record progress (read from the persisted book, not live state).
 await page.locator('#reader-next').click();
 await page.waitForTimeout(400);
 const savedPos=await page.evaluate(t=>__pgLibrary__.books().find(b=>b.title===t).position,title);
 assert.ok(savedPos,'progress not saved after turning a page');
 // Reload: no duplicates, progress retained.
 await page.reload();await ready();
 const books=await page.evaluate(()=>__pgLibrary__.books());
 const holmes=books.filter(b=>b.genre==='holmes');
 assert.equal(holmes.length,new Set(holmes.map(b=>b.id)).size,'duplicate holmes books after reload');
 assert.equal(books.length,new Set(books.map(b=>b.id)).size,'duplicate books after reload');
 const reopened=books.find(b=>b.title===title);
 assert.ok(reopened.position,'progress lost after reload');
 assert.equal(reopened.position.chapter,savedPos.chapter);
 assert.deepEqual(errors,[]);
 // Stale-catalog retirement: seed OLD Holmes catalog books (ids no longer in the
 // starter) plus one personal book, reload, and assert the stale ones are
 // deleted while the personal book and the 9 new canonical books survive.
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  const r=indexedDB.open('pergamin-library',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('books',{keyPath:'id'});
  r.onsuccess=()=>{const tx=r.result.transaction('books','readwrite'),s=tx.objectStore('books');
   const stale={id:'ws-1040503',title:'Берилловая диадема',author:'Артур Конан Дойл',sortAuthor:'Дойл',genre:'holmes',language:'ru',origin:'catalog',source:'https://ru.wikisource.org/w/index.php?oldid=5651788',rights:'CC BY-SA 4.0',chapters:[{title:'t',html:'<p>old bad text with Хольмс</p>'}]};
   const personal={id:'local-aaa111',title:'Моя личная книга',author:'Меня',sortAuthor:'Меня',genre:'personal',language:'ru',origin:'import',source:'',rights:'personal',chapters:[{title:'t',html:'<p>my book</p>'}]};
   s.put(stale);s.put(personal);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);};
  r.onerror=()=>reject(r.error);
 }));
 await page.reload();await ready();
 const after=await page.evaluate(()=>__pgLibrary__.books());
 const oldGone=after.filter(b=>b.id==='ws-1040503');
 const newIds=new Set(after.map(b=>b.id));
 assert.equal(oldGone.length,0,'stale old Holmes catalog book was not retired');
 assert.ok(after.some(b=>b.id==='local-aaa111'),'personal book must survive catalog retirement');
 assert.equal(after.filter(b=>b.genre==='holmes').length,9,'should have exactly the 9 new canonical holmes books');
 assert.ok(!after.some(b=>/Хольмс/.test((b.chapters?.[0]?.html||''))),'no book may still contain the Хольмс spelling');
 assert.deepEqual(errors,[]);
 console.log('HOLMES READER VERIFIED');
}finally{await browser.close();await new Promise(r=>server.close(r));}
