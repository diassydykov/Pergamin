import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { deflateRawSync } from 'node:zlib';

const ROOT = "E:/pergamin";
const PROFILE = "E:/hermes/cache/scratch/pergamin-mvp-e2e-profile";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 8432;
const DEBUG_PORT = 9335;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".png": "image/png",
};

await rm(PROFILE, { recursive: true, force: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, `http://127.0.0.1:${PORT}`).pathname,
    );
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = normalize(join(ROOT, rel));
    if (!file.toLowerCase().startsWith(normalize(ROOT).toLowerCase()))
      throw new Error("bad path");
    await stat(file);
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-component-update",
    "--disable-default-apps",
    "--window-size=1400,1000",
    `http://127.0.0.1:${PORT}/?mode=editor&e2e=1`,
  ],
  { stdio: "ignore" },
);

async function waitForJson(url, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timeout waiting for ${url}`);
}
let ws;
try {
  const pages = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = pages.find((p) => p.url.includes(`127.0.0.1:${PORT}`));
  assert.ok(page, "Pergamin tab not found");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
    if (m.method === "Runtime.exceptionThrown")
      consoleErrors.push(m.params.exceptionDetails?.text || "exception");
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error")
      consoleErrors.push(m.params.entry.text);
  });
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  async function js(expression) {
    const r = await cdp("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  const end = Date.now() + 15000;
  let ready = false;
  while (Date.now() < end) {
    ready = await js(
      `Boolean(window.__pg__?.currentBookId() && window.__pgMvp__ && window.__pgStudio__ && window.__pgAtelier__)`,
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(ready, "app did not initialize");

  if (process.env.PERGAMIN_CAPTURE_UI === "1") {
    await js(
      `(async()=>{await __pg__.updateBook(__pg__.currentBookId(),{content:'<h2>Глава первая</h2><p>На полях старой рукописи оставались следы чернил и тихий шелест истории.</p><h3>Зимняя дорога</h3><p>За окном медленно темнело.</p>'});document.getElementById('studio-toggle').click();})()`,
    );
    await new Promise((r) => setTimeout(r, 250));
    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    await mkdir(join(ROOT, "test-results"), { recursive: true });
    await writeFile(
      join(ROOT, "test-results", "ui-main.png"),
      Buffer.from(shot.data, "base64"),
    );
  }

  let liveGeneration = null;
  if (process.env.PERGAMIN_LIVE_AI === "1") {
    assert.ok(
      process.env.PERGAMIN_POLLINATIONS_KEY,
      "PERGAMIN_POLLINATIONS_KEY is required for the live generation smoke test",
    );
    await js(
      `sessionStorage.setItem('pg.pollinations.key',${JSON.stringify(process.env.PERGAMIN_POLLINATIONS_KEY || "")})`,
    );
    liveGeneration = await js(
      `(async()=>{const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),110000);try{const blob=await __pgAiFetchIllustration('A quiet monochrome engraving of an old library, no text',${Date.now()},ctrl.signal);return {type:blob.type,size:blob.size}}finally{clearTimeout(timer)}})()`,
    );
    assert.match(liveGeneration.type, /^image\//);
    assert.ok(
      liveGeneration.size > 1000,
      `generated image is unexpectedly small: ${JSON.stringify(liveGeneration)}`,
    );
  }

  const anchors = await js(
    `['search-toggle','search-panel','writing-stats','backup-library','restore-library','word-goal'].every(id=>document.getElementById(id))`,
  );
  assert.equal(anchors, true, "MVP controls missing");
  const generationSetup = await js(
    `(async()=>{const button=document.getElementById('ai-gen'),settings=document.getElementById('generation-settings'),dialog=document.getElementById('generation-dialog');settings.click();const loaded=await Promise.all(['Literata','Lora','Vollkorn'].map(name=>document.fonts.load('16px '+name,'Книга')));const state={disabled:button.disabled,title:button.title,dialog:dialog.open,redirect:document.getElementById('generation-redirect').value,fonts:loaded.every(items=>items.length>0)};document.getElementById('cancel-generation').click();return state})()`,
  );
  assert.equal(
    generationSetup.disabled,
    true,
    "generation must stay disabled until OAuth completes",
  );
  assert.match(generationSetup.title, /Подключить генерацию/);
  assert.equal(generationSetup.dialog, true);
  assert.match(generationSetup.redirect, /127\.0\.0\.1:8432/);
  assert.equal(
    generationSetup.fonts,
    true,
    "local editorial fonts did not load",
  );
  const pkce = await js(
    `__pgAiOAuth.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')`,
  );
  assert.equal(pkce, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 800));
  const mobile = await js(
    `(()=>{const box=id=>{const e=document.getElementById(id);return {client:e.clientWidth,scroll:e.scrollWidth,left:Math.round(e.getBoundingClientRect().left),right:Math.round(e.getBoundingClientRect().right)}};return {body:{client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth},viewport:box('page-viewport'),page:box('page'),ms:box('ms'),two:document.querySelector('.book').classList.contains('twp'),studioVisible:getComputedStyle(document.getElementById('studio-toggle')).display!=='none',imageVisible:getComputedStyle(document.getElementById('image-upload')).display!=='none',bookMenuVisible:getComputedStyle(document.querySelector('.book-actions')).display!=='none'}})()`,
  );
  assert.equal(mobile.two, false, "mobile must use a single page");
  assert.ok(
    mobile.page.right <= mobile.viewport.right + 1 &&
      mobile.body.scroll <= mobile.body.client + 1,
    `mobile book overflows: ${JSON.stringify(mobile)}`,
  );
  assert.equal(mobile.studioVisible, true);
  assert.equal(mobile.imageVisible, true);
  assert.equal(mobile.bookMenuVisible, true);
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 800));

  const stats = await js(
    `(()=>{const id=__pg__.currentBookId();__pg__.updateBook(id,{content:'<p>Раз два три четыре</p>'});return __pgMvp__.textStats('<p>Раз два три четыре</p>')})()`,
  );
  assert.deepEqual(
    {
      words: stats.words,
      chars: stats.chars,
      readingMinutes: stats.readingMinutes,
    },
    { words: 4, chars: 18, readingMinutes: 1 },
  );
  assert.equal(
    await js(`__pgMvp__.textStats('<p>Раз</p><p>два</p>').words`),
    2,
    "block boundaries must separate words",
  );
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    await js(`document.getElementById('stat-words').textContent`),
    "4",
  );

  const search = await js(
    `(()=>{document.getElementById('search-toggle').click();const i=document.getElementById('search-input');i.value='три';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.search-result')?.click();return {count:document.querySelectorAll('.search-result').length,selected:getSelection().toString()}})()`,
  );
  assert.deepEqual(search, { count: 1, selected: "три" });

  const backup = await js(
    `(()=>{const b=__pgMvp__.createBackup();return {app:b.app,version:b.version,count:b.books.length,content:b.books[0].content}})()`,
  );
  assert.equal(backup.app, "pergamin");
  assert.equal(backup.version, 1);
  assert.ok(backup.count >= 1);
  assert.match(backup.content, /Раз два/);

  const unicodeSearch = await js(
    `(()=>{const id=__pg__.currentBookId();__pg__.updateBook(id,{content:'<p>İstanbul до цели</p>'});document.getElementById('search-input').value='цели';document.getElementById('search-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.search-result')?.click();return {item:__pgMvp__.searchBook('цели')[0],selected:getSelection().toString()};})()`,
  );
  assert.equal(unicodeSearch.selected, "цели");

  await assert.rejects(
    () =>
      js(
        `__pgMvp__.restoreBackup({app:'pergamin',version:999,books:[{id:'bad-version',title:'Нет',content:'<p>x</p>'}]})`,
      ),
    /unsupported|exception|Ошибка|Error/i,
  );
  const dirtyRestore = await js(
    `(async()=>{const id=__pg__.currentBookId();const ms=document.getElementById('ms');ms.innerHTML='<p>Несохранённый старый текст</p>';ms.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'x'}));await __pgMvp__.restoreBackup({app:'pergamin',version:1,books:[{id,title:'Восстановлено',content:'<p>Контент из резервной копии</p>'}]});await new Promise(r=>setTimeout(r,100));return {content:__pg__.getBook(id).content,dom:ms.innerHTML};})()`,
  );
  assert.match(dirtyRestore.content, /Контент из резервной копии/);
  assert.match(dirtyRestore.dom, /Контент из резервной копии/);
  const restored = await js(
    `(async()=>{const id='e2e-import';const n=await __pgMvp__.restoreBackup({app:'pergamin',version:1,books:[{id,title:'Импорт',content:'<p onclick="window.bad=1" style="background:url(https://evil.invalid/a)">Текст</p><script>window.bad=2</script><img src="https://evil.invalid/x.png" srcset="https://evil.invalid/y.png 2x"><svg><a xlink:href="https://evil.invalid/z">x</a></svg>',illusHistory:[null,{what:123,prompt:null}]}]});const b=__pg__.getBook(id);return {n,content:b.content,history:b.illusHistory,bad:window.bad||0,active:__pg__.currentBookId()};})()`,
  );
  assert.equal(restored.n, 1);
  assert.equal(restored.active, "e2e-import");
  assert.equal(restored.bad, 0);
  assert.doesNotMatch(
    restored.content,
    /script|onclick|srcset|url\(|svg|xlink|https:\/\/evil/i,
  );
  assert.deepEqual(
    restored.history.map((h) => typeof h.what + ":" + typeof h.prompt),
    ["string:string", "string:string"],
  );

  const goal = await js(
    `(()=>{const g=document.getElementById('word-goal');g.value='10';g.dispatchEvent(new Event('change',{bubbles:true}));return {goal:__pg__.getBook(__pg__.currentBookId()).wordGoal,max:Number(document.getElementById('goal-progress').max)}})()`,
  );
  assert.deepEqual(goal, { goal: 10, max: 10 });

  const securedEditing = await js(
    `(async()=>{const sealed=await __pgMvp__.encryptBackup(__pgMvp__.createBackup(),'secret-pass'),opened=await __pgMvp__.decryptBackup(sealed,'secret-pass');const id=__pg__.currentBookId(),ms=document.getElementById('ms');await __pg__.updateBook(id,{content:'<p>abc</p>'});document.getElementById('track-toggle').click();const text=ms.querySelector('p').firstChild,r=document.createRange();r.setStart(text,1);r.setEnd(text,3);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);ms.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'deleteContentForward'}));const deleted=ms.querySelectorAll('del[data-pg-change]').length;document.getElementById('track-reject').click();const rejected=ms.textContent.trim();document.getElementById('track-toggle').click();return{encrypted:sealed.app,roundtrip:opened.app,deleted,rejected,track:document.getElementById('track-toggle').getAttribute('aria-pressed')}})()`,
  );
  assert.deepEqual(securedEditing, {
    encrypted: "pergamin-encrypted",
    roundtrip: "pergamin",
    deleted: 1,
    rejected: "abc",
    track: "false",
  });

  const restoreFailure = await js(
    `(async()=>{const proto=IDBDatabase.prototype,orig=proto.transaction,id=__pg__.currentBookId();let failures=2;proto.transaction=function(name,mode){if(name==='books'&&mode==='readwrite'&&failures-->0)throw new Error('forced-save-failure');return orig.apply(this,arguments)};try{await __pg__.updateBook(id,{title:'Ожидает сохранения'});let rejected=false;try{await __pgMvp__.restoreBackup({app:'pergamin',version:1,books:[{id,title:'Не должна примениться',content:'<p>backup</p>'}]})}catch(e){rejected=true}return {rejected,title:__pg__.getBook(id).title}}finally{proto.transaction=orig}})()`,
  );
  assert.equal(
    restoreFailure.rejected,
    true,
    "restore must abort when preliminary flush fails",
  );
  consoleErrors.length = 0;

  const turnVisual = await js(`(async()=>{
    await __pg__.updateBook(__pg__.currentBookId(),{title:'Бумага и чернила',content:Array.from({length:35},(_,i)=>'<p>Страница '+i+' '+('Бумага и чернила. '.repeat(14))+'</p>').join('')});document.getElementById('toast').hidden=true;
    document.getElementById('search-panel').hidden=true;getSelection().removeAllRanges();
    await new Promise(r=>setTimeout(r,250));__pgWorkspace__.turn(-100,false);
    document.getElementById('pg-next').click();await new Promise(r=>setTimeout(r,230));
    const leaf=document.querySelector('.pg-turn-leaf'),flyer=document.getElementById('pg-flyer'),a=leaf?.getAnimations()[0];
    return {running:a?.playState,transform:leaf&&getComputedStyle(leaf).transform,opacity:getComputedStyle(flyer).opacity,z:+getComputedStyle(flyer).zIndex,
      fronts:leaf?.querySelectorAll('.pg-turn-face').length,copies:leaf?.querySelectorAll('.manuscript').length,
      leafWidth:leaf?.getBoundingClientRect().width,liveEditable:document.getElementById('ms').contentEditable,
      ids:flyer.querySelectorAll('[id]').length,count:document.getElementById('pg-count').textContent};})()`);
  assert.equal(turnVisual.running,'running');assert.equal(turnVisual.opacity,'1');
  assert.ok(turnVisual.transform.startsWith('matrix3d') && turnVisual.z>=20);
  assert.equal(turnVisual.fronts,2);assert.equal(turnVisual.copies,2);assert.equal(turnVisual.ids,0);assert.equal(turnVisual.liveEditable,'true');
  const turnShot=await cdp('Page.captureScreenshot',{format:'png'});
  await mkdir(join(ROOT,'test-results'),{recursive:true});await writeFile(join(ROOT,'test-results','page-turn.png'),Buffer.from(turnShot.data,'base64'));
  await new Promise(r=>setTimeout(r,950));
  assert.equal(await js(`document.querySelectorAll('#pg-flyer .pg-turn-leaf').length`),0);
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await js(`(()=>{__pgWorkspace__.turn(1);return document.getElementById('pg-flyer').classList.contains('turning')})()`),false);
  await cdp('Emulation.setEmulatedMedia',{features:[]});
  const reverseTurn=await js(`(async()=>{__pgWorkspace__.turn(-1);await new Promise(r=>setTimeout(r,180));const leaf=document.querySelector('.pg-turn-leaf');return {origin:getComputedStyle(leaf).transformOrigin,animation:leaf.getAnimations()[0].playState,count:document.getElementById('pg-count').textContent}})()`);
  assert.equal(reverseTurn.animation,'running');
  await new Promise(r=>setTimeout(r,950));
  const singleTurn=await js(`(async()=>{const s=document.getElementById('pages');s.value='1';s.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,150));__pgWorkspace__.turn(1);await new Promise(r=>setTimeout(r,180));return {leaf:parseFloat(document.querySelector('.pg-turn-leaf').style.width),page:document.getElementById('page').clientWidth}})()`);
  assert.equal(singleTurn.leaf,singleTurn.page);
  await js(`(()=>{const s=document.getElementById('pages');s.value='2';s.dispatchEvent(new Event('change'))})()`);
  await new Promise(r=>setTimeout(r,950));

  const paging = await js(
    `(async()=>{const id=__pg__.currentBookId();__pg__.updateBook(id,{content:Array.from({length:120},(_,i)=>'<p>Абзац '+i+' '+('длинный текст '.repeat(12))+'</p>').join('')});await new Promise(r=>setTimeout(r,300));const next=document.getElementById('pg-next'),sc=document.getElementById('ms-scroll'),ms=document.getElementById('ms');for(let i=0;i<100&&!next.disabled;i++){next.click();await new Promise(r=>setTimeout(r,8));}return {left:sc.scrollLeft,max:ms.scrollWidth-sc.clientWidth,top:sc.scrollTop,disabled:next.disabled,count:document.getElementById('pg-count').textContent};})()`,
  );
  assert.equal(paging.disabled, true);
  assert.ok(
    Math.abs(paging.left - paging.max) <= 2 && paging.top === 0,
    `tail unreachable: ${JSON.stringify(paging)}`,
  );

  const typingFlow = await js(
    `(async()=>{const id=__pg__.currentBookId(),ms=document.getElementById('ms'),sc=document.getElementById('ms-scroll'),book=document.querySelector('.book');await __pg__.updateBook(id,{content:'<p>Строка</p>'});await new Promise(r=>setTimeout(r,950));ms.focus();const p=ms.querySelector('p'),r=document.createRange();r.selectNodeContents(p);r.collapse(false);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);const before=book.getBoundingClientRect().height;let turns=0;const ob=new MutationObserver(()=>{if(document.getElementById('pg-flyer').classList.contains('turning'))turns++});ob.observe(document.getElementById('pg-flyer'),{attributes:true,attributeFilter:['class']});for(let i=0;i<80;i++){ms.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertParagraph'}));document.execCommand('insertParagraph',false);ms.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertParagraph'}));await new Promise(r=>setTimeout(r,40));}await new Promise(r=>setTimeout(r,950));ob.disconnect();return{turns,left:sc.scrollLeft,top:sc.scrollTop,count:document.getElementById('pg-count').textContent,bookBefore:before,bookAfter:book.getBoundingClientRect().height,bodyScroll:document.documentElement.scrollHeight,bodyClient:document.documentElement.clientHeight}})()`,
  );
  assert.ok(
    typingFlow.left > 0 &&
      typingFlow.top === 0 &&
      typingFlow.bodyScroll <= typingFlow.bodyClient + 1 &&
      Math.abs(typingFlow.bookAfter - typingFlow.bookBefore) <= 1,
    `typing must flip pages without stretching the book: ${JSON.stringify(typingFlow)}`,
  );
  assert.ok(typingFlow.turns>0,'typing across a spread must visibly animate');

  const freeFigure = await js(
    `(async()=>{const id=__pg__.currentBookId(),ms=document.getElementById('ms'),sc=document.getElementById('ms-scroll');sc.scrollTop=0;await __pg__.updateBook(id,{content:'<p>Текст перед иллюстрацией</p><p>Текст после иллюстрации</p>'});__pg__.insertFigureAtSelection(id,{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',caption:'Тест',prompt:'Тест'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const f=ms.querySelector('figure.illus'),r=f.getBoundingClientRect(),down={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:7,pointerType:'mouse'};f.dispatchEvent(new PointerEvent('pointerdown',down));window.dispatchEvent(new PointerEvent('pointermove',{...down,clientX:down.clientX+72,clientY:down.clientY+48}));window.dispatchEvent(new PointerEvent('pointerup',{...down,clientX:down.clientX+72,clientY:down.clientY+48}));const moved={layout:f.dataset.layout,left:parseFloat(f.style.left),top:parseFloat(f.style.top),width:parseFloat(f.style.width),position:f.style.position,handles:document.querySelectorAll('#fig-resize [data-resize]').length};const east=document.querySelector('#fig-resize [data-resize="e"]'),before=f.getBoundingClientRect().width;east.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:f.getBoundingClientRect().right,clientY:f.getBoundingClientRect().top+20,pointerId:8,pointerType:'mouse'}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:f.getBoundingClientRect().right+36,clientY:f.getBoundingClientRect().top+20,pointerId:8,pointerType:'mouse'}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:8,pointerType:'mouse'}));await new Promise(r=>setTimeout(r,650));return {...moved,before,after:f.getBoundingClientRect().width,saved:__pg__.getBook(id).content};})()`,
  );
  assert.equal(freeFigure.layout, "free");
  assert.equal(freeFigure.position, "absolute");
  assert.equal(freeFigure.handles, 8);
  assert.ok(
    freeFigure.left > 0 && freeFigure.top > 0,
    `free placement failed: ${JSON.stringify(freeFigure)}`,
  );
  assert.ok(
    freeFigure.after > freeFigure.before,
    `side resize failed: ${JSON.stringify(freeFigure)}`,
  );
  assert.match(freeFigure.saved, /data-layout="free"/);
  assert.match(freeFigure.saved, /position:\s*absolute/);

  const imageEditing = await js(
    `(async()=>{const f=document.querySelector('figure.illus');f.focus();document.querySelector('#fig-tools [data-fig="rotate-right"]').click();await new Promise(r=>setTimeout(r,80));document.querySelector('#fig-tools [data-fig="front"]').click();document.querySelector('#fig-tools [data-fig="crop"]').click();document.getElementById('crop-left').value='10';document.getElementById('crop-right').value='10';document.getElementById('crop-alt').value='Отредактированная иллюстрация';document.getElementById('crop-form').dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,180));return{src:f.querySelector('img').src.slice(0,24),alt:f.querySelector('img').alt,z:f.style.zIndex,cropOpen:document.getElementById('crop-dialog').open}})()`,
  );
  assert.match(imageEditing.src, /^data:image\/jpeg/);
  assert.equal(imageEditing.alt, "Отредактированная иллюстрация");
  assert.ok(Number(imageEditing.z) >= 5);
  assert.equal(imageEditing.cropOpen, false);

  const studioFeatures = await js(
    `(async()=>{const id=__pg__.currentBookId();await __pg__.updateBook(id,{content:'<h2>Первая глава</h2><p>Текст для заметки и проверки.</p><h3>Сцена вторая</h3><p>Продолжение.</p>'});const ms=document.getElementById('ms'),text=[...ms.querySelectorAll('p')][0].firstChild,r=document.createRange();r.setStart(text,0);r.setEnd(text,17);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);document.getElementById('add-note').click();document.getElementById('note-text').value='Уточнить формулировку';document.getElementById('note-form').dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}));document.getElementById('spell-language').value='kk';document.getElementById('spell-language').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('studio-toggle').click();const outline=document.querySelectorAll('#studio-outline .outline-item').length;document.getElementById('focus-toggle').click();const focusOn=document.body.classList.contains('focus-mode');document.getElementById('focus-toggle').click();await __pgStudio__.createSnapshot('manual',true);const versions=await __pgStudio__.snapshotsFor(id),snap=versions[0];await __pg__.updateBook(id,{content:'<p>Поздняя версия</p>'});const oldConfirm=window.confirm;window.confirm=()=>true;await __pgStudio__.restoreSnapshot(snap.id);window.confirm=oldConfirm;const epub=await __pgStudio__.exportEpubBlob(__pg__.getBook(id)),docx=await __pgStudio__.exportDocxBlob(__pg__.getBook(id)),magic=async blob=>Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0,4)).join(',');return{outline,notes:__pg__.getBook(id).notes.length,language:__pg__.getBook(id).spellLanguage,lang:ms.lang,focusOn,restored:ms.textContent.includes('Первая глава'),versions:(await __pgStudio__.snapshotsFor(id)).length,epubSize:epub.size,docxSize:docx.size,epubMagic:await magic(epub),docxMagic:await magic(docx)}})()`,
  );
  assert.equal(studioFeatures.outline, 2);
  assert.equal(studioFeatures.notes, 1);
  assert.equal(studioFeatures.language, "kk");
  assert.equal(studioFeatures.lang, "kk");
  assert.equal(studioFeatures.focusOn, true);
  assert.equal(studioFeatures.restored, true);
  assert.ok(studioFeatures.versions >= 2);
  assert.ok(studioFeatures.epubSize > 1000);
  assert.ok(studioFeatures.docxSize > 1000);
  assert.equal(studioFeatures.epubMagic, "80,75,3,4");
  assert.equal(studioFeatures.docxMagic, "80,75,3,4");

  const exportStructure = await js(
    `(async()=>{const parse=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),dec=new TextDecoder(),files={};let at=0;while(at+30<=bytes.length&&view.getUint32(at,true)===0x04034b50){const size=view.getUint32(at+18,true),nameLen=view.getUint16(at+26,true),extraLen=view.getUint16(at+28,true),name=dec.decode(bytes.slice(at+30,at+30+nameLen)),start=at+30+nameLen+extraLen;files[name]=dec.decode(bytes.slice(start,start+size));at=start+size}return files},book={...__pg__.getBook(__pg__.currentBookId()),byline:'Автор Тест'},epub=await parse(await __pgStudio__.exportEpubBlob(book)),docx=await parse(await __pgStudio__.exportDocxBlob(book)),xmlError=s=>new DOMParser().parseFromString(s,'application/xml').querySelector('parsererror')?.textContent||'';return{epubNames:Object.keys(epub),docxNames:Object.keys(docx),mimetype:epub.mimetype,epubXml:[epub['META-INF/container.xml'],epub['OEBPS/content.xhtml'],epub['OEBPS/nav.xhtml'],epub['OEBPS/content.opf']].map(xmlError),docxXml:[docx['[Content_Types].xml'],docx['_rels/.rels'],docx['docProps/core.xml'],docx['word/document.xml'],docx['word/styles.xml'],docx['word/_rels/document.xml.rels']].map(xmlError),stylesRel:docx['word/_rels/document.xml.rels'].includes('relationships/styles'),docxCreator:docx['docProps/core.xml'].includes('Автор Тест'),epubCreator:epub['OEBPS/content.opf'].includes('<dc:creator>Автор Тест</dc:creator>'),toc:epub['OEBPS/nav.xhtml'].includes('content.xhtml#toc-')}})()`,
  );
  assert.equal(exportStructure.mimetype, "application/epub+zip");
  assert.ok(exportStructure.epubNames.includes("OEBPS/content.opf"));
  assert.ok(exportStructure.docxNames.includes("word/document.xml"));
  assert.deepEqual(exportStructure.epubXml, ["", "", "", ""]);
  assert.deepEqual(exportStructure.docxXml, ["", "", "", "", "", ""]);
  assert.equal(exportStructure.stylesRel, true);
  assert.equal(exportStructure.docxCreator, true);
  assert.equal(exportStructure.epubCreator, true);
  assert.equal(exportStructure.toc, true);

  const workspaceFeatures=await js(`(async()=>{
    const a=__pgAtelier__,id=__pg__.currentBookId();
    await __pg__.updateBook(id,{content:'<p>Пролог</p><h2>Первая</h2><p>Альфа</p><h3>Сцена</h3><p>Бета</p><h2>Вторая</h2><p>Гамма</p>',layout:{width:'book',leading:1.45,dropcap:false}});
    await a.moveChapter(1,-1);const order=a.chapterGroups().map(g=>g.heading.textContent),content=__pg__.getBook(id).content;
    await a.saveCard({kind:'character',name:'Лея',summary:'Исследовательница',links:'Первая глава',date:''});
    const added=await a.addChapter('Третья');const h=document.querySelector('[data-chapter-id="'+added+'"]');h.dataset.chapterStatus='revision';document.getElementById('ms').dispatchEvent(new InputEvent('input',{bubbles:true}));await __pgMvp__.flush();
    a.setReading(true);const readonly=document.getElementById('ms').contentEditable==='false';a.setReading(false);
    const search=a.librarySearch('Альфа').some(b=>b.id===id),diff=a.diffParagraphs('<p>Первый</p><p>Старый</p>','<p>Первый</p><p>Новый</p>');
    const source=__pg__.getBook(id),root=await navigator.storage.getDirectory();await a.writeProject(root,source,true);
    const dir=await root.getDirectoryHandle('book-'+id),file=await (await dir.getFileHandle('book.pgbook')).getFile(),saved=JSON.parse(await file.text());
    const markdown=await (await (await dir.getFileHandle('manuscript.md')).getFile()).text();const html=await (await (await dir.getFileHandle('reading.html')).getFile()).text();
    const copies=await dir.getDirectoryHandle('snapshots');let snapshots=0;for await(const e of copies.values())snapshots++;
    const imported=await a.importManuscript(new File([JSON.stringify(saved)],'Копия.pgbook'));
    const restored=__pg__.getBook(imported);
    return {order,content,added,readonly,search,diff,savedCards:saved.book.worldCards.length,snapshots,markdown,html:html.includes('Гамма'),distinct:imported!==id,layout:restored.layout,status:document.querySelector('[data-chapter-id="'+added+'"]')?.dataset.chapterStatus,cards:restored.worldCards.length};})()`);
  assert.deepEqual(workspaceFeatures.order,['Вторая','Первая']);
  assert.match(workspaceFeatures.content,/<h2>Вторая<\/h2><p>Гамма<\/p><h2>Первая<\/h2><p>Альфа<\/p><h3>Сцена<\/h3><p>Бета<\/p>/);
  assert.ok(workspaceFeatures.readonly&&workspaceFeatures.search&&workspaceFeatures.distinct&&workspaceFeatures.html);
  assert.equal(workspaceFeatures.cards,1);assert.equal(workspaceFeatures.savedCards,1);assert.ok(workspaceFeatures.snapshots>=1);
  assert.equal(workspaceFeatures.status,'revision');assert.deepEqual(workspaceFeatures.layout,{width:'book',leading:1.45,dropcap:false});
  assert.deepEqual(workspaceFeatures.diff,{additions:['Новый'],removals:['Старый']});assert.match(workspaceFeatures.markdown,/# Вторая/);
  const docxRoundtrip=await js(`(async()=>{const blob=await __pgStudio__.exportDocxBlob(__pg__.getBook(__pg__.currentBookId()));await __pgAtelier__.importManuscript(new File([blob],'Обратный импорт.docx'));return document.getElementById('ms').innerHTML})()`);
  assert.match(docxRoundtrip,/<h2>Вторая<\/h2>/);assert.match(docxRoundtrip,/Гамма/);

  // Word normally compresses document.xml. Exercise that path independently
  // of our own exporter (which creates an uncompressed ZIP).
  const xml=Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Сжатая глава</w:t></w:r></w:p><w:p><w:r><w:t>Обычный текст</w:t></w:r></w:p></w:body></w:document>');
  const packed=deflateRawSync(xml),name=Buffer.from('word/document.xml'),local=Buffer.alloc(30),central=Buffer.alloc(46),eocd=Buffer.alloc(22);
  let crc=0xffffffff;for(const byte of xml){crc^=byte;for(let b=0;b<8;b++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);
  eocd.writeUInt32LE(0x06054b50);eocd.writeUInt16LE(1,8);eocd.writeUInt16LE(1,10);eocd.writeUInt32LE(central.length+name.length,12);eocd.writeUInt32LE(local.length+name.length+packed.length,16);
  const compressed=Buffer.concat([local,name,packed,central,name,eocd]).toString('base64');
  assert.match(await js(`__pgAtelier__.docxHtml(Uint8Array.from(atob('${compressed}'),c=>c.charCodeAt(0)))`),/<h2>Сжатая глава<\/h2><p>Обычный текст<\/p>/);
  const safeImport=await js(`(async()=>{await __pgAtelier__.importManuscript(new File(['# Импорт\\n\\n<script>evil()</script>\\nТекст'],'Тест.md'));return document.getElementById('ms').innerHTML})()`);
  assert.match(safeImport,/<h2>Импорт<\/h2>/);assert.match(safeImport,/&lt;script&gt;/);assert.doesNotMatch(safeImport,/<script>/);

  const deletion = await js(
    `(async()=>{const proto=IDBDatabase.prototype,orig=proto.transaction,before=__pg__.currentBookId();let fail=true;proto.transaction=function(name,mode){if(fail&&name==='books'&&mode==='readwrite'){fail=false;throw new Error('forced-delete-precondition')}return orig.apply(this,arguments)};try{await __pg__.updateBook(before,{title:'Ошибка перед удалением'})}finally{proto.transaction=orig}await __pgMvp__.deleteBook(before);const flushed=await __pgMvp__.flush();const inserted=__pg__.insertFigureAtSelection(before,{dataUrl:'data:image/png;base64,iVBORw0KGgo=',caption:'x',prompt:'x'});return {active:__pg__.currentBookId(),count:document.getElementById('books').options.length,inserted,flushed};})()`,
  );
  assert.ok(deletion.active);
  assert.ok(deletion.count >= 1);
  assert.equal(deletion.inserted, false);
  assert.equal(
    deletion.flushed,
    true,
    "deleted failed save must not poison future flushes",
  );
  const trashRestore=await js(`(async()=>{const rows=__pgWorkspace__.listBooks(true),row=rows.at(-1);await __pgWorkspace__.restoreBook(row.id);return {active:__pg__.currentBookId(),id:row.id,title:__pg__.getBook(row.id).title,deleted:__pg__.getBook(row.id).deletedAt}})()`);
  assert.equal(trashRestore.active,trashRestore.id);assert.equal(trashRestore.deleted,0);
  const coverExport=await js(`(async()=>{
    const id=__pg__.currentBookId(),coverImage=await __pgAtelier__.coverData({...__pg__.getBook(id),title:'Зимняя дорога',byline:'Автор',subtitle:'История возвращения'});
    await __pg__.updateBook(id,{coverImage});const blob=await __pgStudio__.exportEpubBlob(__pg__.getBook(id)),bytes=new Uint8Array(await blob.arrayBuffer()),v=new DataView(bytes.buffer),dec=new TextDecoder(),files={};let at=0;
    while(at+30<=bytes.length&&v.getUint32(at,true)===0x04034b50){const size=v.getUint32(at+18,true),nl=v.getUint16(at+26,true),xl=v.getUint16(at+28,true),name=dec.decode(bytes.slice(at+30,at+30+nl)),start=at+30+nl+xl;files[name]=dec.decode(bytes.slice(start,start+size));at=start+size;}
    let printHtml='';const oldOpen=window.open;window.open=url=>{fetch(url).then(r=>r.text()).then(t=>printHtml=t);return {opener:null};};
    try{__pgStudio__.openPrint(__pg__.getBook(id),{size:'A5',margin:18,fontSize:12,title:true,numbers:true,toc:true,chapters:true,cover:true});await new Promise(r=>setTimeout(r,150));}finally{window.open=oldOpen;}
    const img=new Image();img.src=coverImage;await img.decode();__pgAtelier__.open(true,'world');
    return {width:img.naturalWidth,height:img.naturalHeight,opf:files['OEBPS/content.opf'].includes('properties="cover-image"'),spine:files['OEBPS/content.opf'].includes('<itemref idref="cover"/>'),coverXml:!new DOMParser().parseFromString(files['OEBPS/cover.xhtml'],'application/xml').querySelector('parsererror'),printToc:printHtml.includes('class="print-toc"'),printCover:printHtml.includes('class="cover-page"'),chapters:printHtml.includes('h2{break-before:page}')};})()`);
  assert.deepEqual(coverExport,{width:1200,height:1800,opf:true,spine:true,coverXml:true,printToc:true,printCover:true,chapters:true});
  const docxFormatting=await js(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd7cb';ctx.fillRect(0,0,200,100);
    const source={...__pg__.getBook(__pg__.currentBookId()),content:'<p>Текст <strong>жирный</strong> и <em>курсивный</em>.</p><figure><img src="'+canvas.toDataURL('image/png')+'" alt="Горизонтальная иллюстрация"></figure>'};
    const blob=await __pgStudio__.exportDocxBlob(source),bytes=new Uint8Array(await blob.arrayBuffer()),v=new DataView(bytes.buffer),dec=new TextDecoder();let at=0,xml='';
    while(at+30<=bytes.length&&v.getUint32(at,true)===0x04034b50){const size=v.getUint32(at+18,true),nl=v.getUint16(at+26,true),xl=v.getUint16(at+28,true),name=dec.decode(bytes.slice(at+30,at+30+nl)),start=at+30+nl+xl;if(name==='word/document.xml')xml=dec.decode(bytes.slice(start,start+size));at=start+size;}
    const doc=new DOMParser().parseFromString(xml,'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',extent=doc.getElementsByTagNameNS(wp,'extent')[0];
    return {bold:doc.getElementsByTagNameNS(ns,'b').length,italic:doc.getElementsByTagNameNS(ns,'i').length,cx:+extent.getAttribute('cx'),cy:+extent.getAttribute('cy'),valid:!doc.querySelector('parsererror')};})()`);
  assert.deepEqual(docxFormatting,{bold:1,italic:1,cx:4572000,cy:2286000,valid:true});
  await js(`(async()=>{await __pg__.updateBook(__pg__.currentBookId(),{title:'Зимняя дорога',content:'<h2>Глава первая</h2><p>На полях старой рукописи оставались следы чернил. За окном медленно темнело, и дорога уходила к северному перевалу.</p><h3>Возвращение</h3><p>Лея подняла воротник и прислушалась к ветру.</p>'});await __pgAtelier__.saveCard({kind:'character',name:'Лея',summary:'Исследовательница старых рукописей. Возвращается в родной город после долгого путешествия.',links:'Глава первая · Возвращение',date:''});__pgAtelier__.open(true,'world');document.getElementById('toast').hidden=true;await new Promise(r=>setTimeout(r,950));})()`);
  const workspaceShot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(ROOT,'test-results','workspace.png'),Buffer.from(workspaceShot.data,'base64'));
  assert.deepEqual(
    consoleErrors,
    [],
    `browser errors: ${consoleErrors.join("; ")}`,
  );
  await js(`navigator.serviceWorker.ready`);
  await cdp('Network.enable');
  await cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await cdp('Page.reload');await new Promise(r=>setTimeout(r,900));
  const offline=await js(`({online:navigator.onLine,ready:Boolean(window.__pgAtelier__),title:window.__pg__?.getBook(window.__pg__?.currentBookId())?.title,hasText:document.getElementById('ms')?.textContent.includes('Лея'),generation:document.getElementById('ai-gen')?.disabled})`);
  assert.deepEqual(offline,{online:false,ready:true,title:'Зимняя дорога',hasText:true,generation:true});
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  console.log(
    JSON.stringify(
      {
        ok: true,
        liveGeneration,
        stats,
        search,
        backup: { ...backup, content: "<omitted>" },
        restored,
        goal,
        paging,
        turnVisual,
        typingFlow,
        workspaceFeatures,
        coverExport,
        offline,
        freeFigure: { ...freeFigure, saved: "<omitted>" },
        deletion,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    ws?.close();
  } catch {}
  try {
    chrome.kill("SIGTERM");
  } catch {}
  await Promise.race([
    new Promise((r) => chrome.once("exit", r)),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  await new Promise((r) => server.close(r));
  for (let i = 0; i < 8; i++) {
    try {
      await rm(PROFILE, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 150,
      });
      break;
    } catch (err) {
      if (i === 7) throw err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
