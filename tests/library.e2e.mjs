import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {genres}=await import('../library-import.js');
const CASES=Object.keys(genres).length;
import {deflateRawSync} from 'node:zlib';
const ROOT=resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
let playwright;
try{playwright=require('playwright');}catch(error){
 if(error.code!=='MODULE_NOT_FOUND')throw error;
 // Desktop-bundled fallback; ordinary contributors use npm install.
 playwright=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}
const {chromium}=playwright;
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(ROOT,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(ROOT+ '\\'))throw Error('path');const data=await readFile(file);res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'}[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
function zip(files){const parts=[],central=[];let pos=0;for(const [name,text]of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(text),compressed=deflateRawSync(data),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(8,8);head.writeUInt32LE(compressed.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,6);dir.writeUInt16LE(8,10);dir.writeUInt32LE(compressed.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(pos,42);parts.push(head,n,compressed);central.push(dir,n);pos+=30+n.length+compressed.length;}const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(pos,16);return Buffer.concat([...parts,cd,end]);}
const epub=zip({'META-INF/container.xml':'<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>','OPS/book.opf':'<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Тест EPUB</dc:title><dc:creator>Тестовый автор</dc:creator></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="two"/><itemref idref="one"/></spine></package>','OPS/one.xhtml':'<html><body><h2>Вторая глава</h2><p>Конец книги.</p></body></html>','OPS/two.xhtml':'<html><body><h2>Первая глава</h2><script>window.importPwned=true</script><p onclick="alert(1)">Начало '+('Длинная строка для проверки перелистывания. '.repeat(500))+'</p><img src="https://example.com/tracker.jpg"></body></html>'});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`,browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
await mkdir(resolve(ROOT,'test-results'),{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true}),page=await context.newPage(),errors=[],remote=[];
 const catalogCount=(JSON.parse(await readFile(join(ROOT,'catalog/starter.json'),'utf8')).books).length;
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(r.url().includes('example.com'))remote.push(r.url());});
 const ready=()=>page.waitForFunction(()=>window.__pgLibrary__?.ready),state=()=>page.evaluate(()=>__pgLibrary__.state()),shot=name=>page.screenshot({path:resolve(ROOT,`test-results/${name}.png`),fullPage:name==='library-home'||name==='library-section'});
 await page.goto(url);await page.waitForLoadState('networkidle');await ready();assert.equal(await page.locator('.lib-case').count(),CASES);assert.ok(await page.evaluate(()=>__pgLibrary__.books().length>=20));await shot('library-home');
 await page.locator('#lib-search').fill('Пушкин');assert.ok(await page.locator('.lib-volume').count()>5);await page.locator('#lib-sort').selectOption('title');
 const titles=await page.locator('.volume-tip strong').allTextContents();assert.deepEqual(titles,[...titles].sort((a,b)=>a.localeCompare(b,'ru')));
 await page.locator('#lib-view').click();assert.equal(await page.locator('.lib-list-book').count(),titles.length);await page.locator('#lib-view').click();await page.locator('#lib-sort').selectOption('author');await page.locator('#lib-back').click();
 await page.locator('[data-category="classic"]').focus();await page.keyboard.press('Enter');await page.waitForTimeout(180);assert.equal(await page.locator('.case-flight').count(),1);await shot('library-camera');await page.waitForTimeout(650);
 await page.locator('.lib-volume').first().hover();assert.ok(await page.locator('.lib-volume').first().locator('.volume-tip').isVisible());await shot('library-section');
 await page.locator('.lib-volume').first().click();await page.locator('#detail-status').selectOption('want');await page.locator('#detail-favorite').click();await page.locator('#lib-dialog-close').click();await page.locator('[data-shelf="want"]').click();assert.equal(await page.locator('.lib-volume').count(),1);
 await page.locator('.lib-volume').click();const title=await page.locator('.lib-detail h2').innerText();await page.locator('#lib-dialog [data-read]').click();await page.waitForTimeout(250);assert.equal(await page.locator('#reader-title').innerText(),title);assert.ok((await state()).pages>1);assert.ok(await page.locator('#reader-text').evaluate(e=>e.scrollHeight<=e.clientHeight+2));
 await page.locator('#reader-next').click();await page.waitForTimeout(180);assert.equal(await page.locator('.reader-leaf').count(),1);await shot('library-turn');await page.waitForTimeout(850);assert.equal((await state()).spread,1);
 await page.locator('#reader-bookmark').click();await page.waitForTimeout(100);
 await page.evaluate(()=>{const pos=__pgLibrary__.state().position,el=document.querySelector(`#reader-text [data-block="${pos.block}"]`),walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n,offset=pos.offset;while(n=walk.nextNode()){if(offset<n.length){const r=document.createRange();r.setStart(n,offset);r.setEnd(n,Math.min(n.length,offset+50));const s=getSelection();s.removeAllRanges();s.addRange(r);break;}offset-=n.length;}});
 await page.locator('#reader-notes').click();await page.locator('#reader-note-text').fill('Проверенная заметка');await page.locator('#reader-note-save').click();await page.waitForTimeout(150);assert.equal(await page.locator('.lib-note-row').count(),2);assert.equal(await page.evaluate(()=>CSS.highlights.get('pergamin-quotes').size),1);await page.locator('#lib-dialog-close').click();
 await page.locator('#reader-settings').click();await page.locator('#reader-font').selectOption('Lora');await page.locator('#reader-size').fill('24');await page.locator('#lib-dialog-close').click();await page.waitForTimeout(250);assert.ok((await state()).spread>0);await shot('library-reader');
 await page.locator('#reader-back').click();await page.waitForTimeout(100);assert.ok(await page.locator('.lib-resume').isVisible());const saved=await page.evaluate(()=>__pgLibrary__.books().find(b=>b.lastRead).position);
 await page.reload();await ready();await page.locator('.lib-resume').click();await page.waitForTimeout(150);assert.deepEqual((await state()).position,saved);
 await page.locator('#reader-back').click();await page.locator('#lib-import').click();
 await page.locator('#lib-file').setInputFiles({name:'test.epub',mimeType:'application/epub+zip',buffer:epub});await page.waitForFunction(()=>__pgLibrary__.books().some(b=>b.title==='Тест EPUB'));
 const imported=await page.evaluate(()=>__pgLibrary__.books().find(b=>b.title==='Тест EPUB'));assert.equal(imported.chapters[0].title,'Первая глава');assert.doesNotMatch(imported.chapters[0].html,/<script|onclick|example.com/);
 await page.locator('#lib-file').setInputFiles({name:'duplicate.epub',mimeType:'application/epub+zip',buffer:epub});await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>__pgLibrary__.books().filter(b=>b.title==='Тест EPUB').length),1);
 const fb2='<FictionBook><description><title-info><book-title>Тест FB2</book-title><author><first-name>Лев</first-name><last-name>Тестов</last-name></author></title-info></description><body><section><title><p>Глава FB2</p></title><p>Текст книги.</p></section></body></FictionBook>';
 await page.locator('#lib-file').setInputFiles({name:'test.fb2',mimeType:'text/xml',buffer:Buffer.from(fb2)});await page.waitForFunction(()=>__pgLibrary__.books().some(b=>b.title==='Тест FB2'));
 await page.locator('#lib-file').setInputFiles({name:'Чистый текст.txt',mimeType:'text/plain',buffer:Buffer.from('Привет, библиотека!\n\nВторой абзац.')});await page.waitForFunction(()=>__pgLibrary__.books().some(b=>b.title==='Чистый текст'));
 await page.locator('#lib-file').setInputFiles({name:'bad.epub',mimeType:'application/epub+zip',buffer:Buffer.from('invalid zip')});await page.waitForTimeout(150);assert.match(await page.locator('#lib-import-report').innerText(),/ZIP/);
 await page.locator('#lib-dialog-close').click();await page.evaluate(id=>__pgLibrary__.read(id),imported.id);await page.locator('#reader-outline').click();await page.locator('[data-chapter="1"]').click();await page.locator('#reader-finish').click();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>__pgLibrary__.books().find(b=>b.title==='Тест EPUB').status),'read');
 await page.locator('#reader-back').click();await page.locator('[data-shelf="read"]').click();assert.equal(await page.locator('.lib-volume').count(),1);
 await page.locator('#lib-tools').click();const downloaded=page.waitForEvent('download');await page.locator('#lib-backup').click();const file=await downloaded,backup=JSON.parse(await readFile(await file.path(),'utf8'));assert.equal(backup.books.length,catalogCount+3);
 const clean=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),mobile=await clean.newPage();await mobile.goto(url);await mobile.waitForFunction(()=>window.__pgLibrary__?.ready);await mobile.screenshot({path:resolve(ROOT,'test-results/library-mobile.png'),fullPage:true});assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await mobile.locator('[data-category="children"]').click();assert.equal(await mobile.locator('.case-flight').count(),0);await mobile.locator('#lib-back').click();
 await mobile.locator('#lib-tools').click();await mobile.locator('#lib-restore-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await mobile.waitForFunction(()=>__pgLibrary__.books().some(b=>b.title==='Тест EPUB'));await mobile.locator('#lib-dialog-close').click();
 assert.ok(await mobile.evaluate(()=>__pgLibrary__.books().some(b=>b.origin==='catalog'&&b.notes.length===1&&b.bookmarks.length===1)));
 await mobile.evaluate(id=>__pgLibrary__.read(id),imported.id);await mobile.waitForTimeout(150);assert.equal(await mobile.evaluate(()=>__pgLibrary__.state().per),1);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mobile.screenshot({path:resolve(ROOT,'test-results/library-mobile-reader.png')});
 const restored=await mobile.evaluate(()=>__pgLibrary__.books().find(b=>b.title==='Тест EPUB'));assert.equal(restored.status,'read');assert.equal(restored.original,imported.original);
 await mobile.locator('#reader-back').click();await mobile.locator('#lib-editor').click();await mobile.waitForFunction(()=>document.body.dataset.appMode==='editor');assert.ok(await mobile.locator('#ms').isVisible());await mobile.locator('#open-reader-library').click();assert.ok(await mobile.locator('#library-home').isVisible());
 await page.locator('#lib-dialog-close').click();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);await page.waitForTimeout(300);await context.setOffline(true);await page.reload();await ready();assert.equal(await page.locator('.lib-case').count(),CASES);await page.locator('.lib-resume').click();await page.waitForFunction(()=>__pgLibrary__.state()?.pages>0);await page.waitForTimeout(150);assert.ok(await page.locator('#reader-text').innerText());
 assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);await clean.close();await context.close();console.log('LIBRARY E2E PASSED');
}finally{await browser.close();await new Promise(r=>server.close(r));}
