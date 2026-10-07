import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzip,genres} from '../library-import.js';
test('starter catalog: complete nontrivial texts, all sections, pinned sources and attribution',async()=>{
 const {books}=JSON.parse(await readFile(new URL('../catalog/starter.json',import.meta.url),'utf8'));
 assert.ok(books.length>=20);assert.equal(new Set(books.map(b=>b.id)).size,books.length);
 for(const b of books){const html=b.chapters.map(c=>c.html).join('');assert.ok(b.title&&b.author&&(b.authorDeath<=1910||(b.authorDeath<=1950&&/wikisource/.test(b.source))||b.genre==='holmes'));assert.ok(Object.hasOwn(genres,b.genre));assert.match(b.source,/^https:\/\//);if(/wikisource/.test(b.source))assert.match(b.rights,/CC BY-SA 4\.0/);assert.ok(html.length>900);assert.equal(createHash('sha256').update(html).digest('hex'),b.sha256);assert.doesNotMatch(html,/<script|<iframe|onclick=|class="reference"|список редакций одного произведения/);}
 for(const g of ['classic','fantasy','children','history','poetry','holmes','foreign'])assert.ok(books.some(b=>b.genre===g));
});
test('malformed EPUB is rejected',async()=>{await assert.rejects(()=>unzip(new ArrayBuffer(25)),/ZIP/);});
test('starter catalog and reader shell available offline and from launcher',async()=>{
 const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8'),server=await readFile(new URL('../desktop-launcher/pergamin_launcher.py',import.meta.url),'utf8');
 for(const asset of ['library.js','library-import.js','library.css','catalog/starter.json'])assert.ok(sw.includes(asset));
 assert.ok(server.includes('("catalog", "starter.json")'));assert.ok(server.includes('"library.js"'));
});
