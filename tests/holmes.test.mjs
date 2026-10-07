import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {genres} from '../library-import.js';

// The Holmes shelf is the full canonical canon in 9 books: 4 novels + 5
// collections, each collection a complete book (all its stories in canonical
// order). Sourced from the clean 2016 AST "Vesy Sherlock Holms" edition
// (Shengdel/Volzina/Dekhtereva) — modern orthography, no "Holms", no ruble errors.
const COLLECTIONS = {
 ADV: ['Скандал в Богемии','Союз рыжих','Установление личности','Тайна Боскомской долины','Пять апельсиновых зернышек','Человек с рассечённой губой','Голубой карбункул','Пёстрая лента','Палец инженера','Знатный холостяк','Берилловая диадема','Медные буки'],
 MEM: ['Серебряный','Картонная коробка','Жёлтое лицо','Приключения клерка','Глория Скотт','Обряд дома Месгрейвов','Рейгетские сквайры','Горбун','Постоянный пациент','Случай с переводчиком','Морской договор','Последнее дело Холмса'],
 RET: ['Пустой дом','Подрядчик из Норвуда','Пляшущие человечки','Одинокая велосипедистка','Случай в интернате','Чёрный Пётр','Конец Чарльза Огастеса Милвертона','Шесть Наполеонов','Три студента','Пенсне в золотой оправе','Пропавший регбист','Убийство в Эбби-Грейндж','Второе пятно'],
 LHB: ['Усадьба под буками','Алое кольцо','Чертежи Брюса-Партингтона','Шерлок Холмс при смерти','Исчезновение леди Фрэнсис Карфэкс','Дьяволова нога','Его прощальный поклон'],
 ARC: ['Камень Мазарини','Загадка Торского моста','Человек на четвереньках','Вампир в Суссексе','Три Гарридеба','Знатный клиент','Происшествие на вилле «Три конька»','Бледный солдат','Львиная грива','Москательщик на покое','Жилица под вуалью','Загадка поместья Шоскомб'],
};

test('holmes catalog: 9 canonical books, complete texts, clean orthography',async()=>{
 const holmes=JSON.parse(await readFile(new URL('../catalog/holmes.json',import.meta.url),'utf8'));
 const starter=JSON.parse(await readFile(new URL('../catalog/starter.json',import.meta.url),'utf8'));
 const books=holmes.books;
 assert.equal(books.length,9,'expected 9 holmes books (4 novels + 5 collections)');
 assert.equal(new Set(books.map(b=>b.id)).size,books.length,'duplicate ids');
 assert.equal(new Set(books.map(b=>b.canonicalWork)).size,books.length,'duplicate canonicalWork');
 assert.equal(new Set(books.map(b=>b.sha256)).size,books.length,'duplicate sha256');
 for(const b of books){
  const html=b.chapters.map(c=>c.html).join('');
  const text=html.replace(/<[^>]+>/g,'');
  assert.ok(b.title&&b.author==='Артур Конан Дойл'&&b.sortAuthor==='Дойл');
  assert.equal(b.genre,'holmes');assert.ok(Object.hasOwn(genres,b.genre));
  assert.match(b.source,/^https:\/\//);
  assert.ok(html.length>10000,'work too short: '+b.title);
  assert.equal(createHash('sha256').update(html).digest('hex'),b.sha256);
  assert.doesNotMatch(html,/<script|<iframe|onclick=/);
  // The defects the user reported must be gone: no obsolete "Holms" spelling,
  // and no ruble-denominated income (a Londoner earns pounds, not rubles).
  assert.doesNotMatch(text,/Хольмс/,'obsolete "Хольмс" spelling in '+b.title);
  assert.doesNotMatch(text,/\bрубл[аиея]/i,'ruble currency in '+b.title);
  assert.ok(b.chapters.length>=1);
 }
 // The five collections carry exactly their canonical stories, in order.
 for(const [code,stories] of Object.entries(COLLECTIONS)){
  const book=books.find(b=>b.canonicalWork===code);
  assert.ok(book,'missing collection '+code);
  assert.deepEqual(book.chapters.map(c=>c.title),stories,'wrong story set/order in '+code);
 }
 // "Записки о Шерлоке Холмсе" must be a complete book with all 12 stories.
 const mem=books.find(b=>b.canonicalWork==='MEM');
 assert.ok(mem&&mem.chapters.length===12,'Записки must have 12 stories');
 assert.ok(mem.chapters.some(c=>c.title.includes('Картонная коробка')),'Cardboard Box belongs in Memoirs');
 assert.ok(mem.chapters.some(c=>c.title.includes('Глория Скотт')),'Gloria Scott belongs in Memoirs');
 // Starter contains every holmes book exactly once and no stale holmes id twice.
 const inStarter=starter.books.filter(b=>b.genre==='holmes');
 assert.equal(inStarter.length,books.length,'starter holmes count mismatch');
 const byCode=new Map(books.map(b=>[b.canonicalWork,b]));
 for(const s of inStarter)assert.equal(s.id,byCode.get(s.canonicalWork).id);
});
