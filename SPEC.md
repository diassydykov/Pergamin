# PERGAMIN — SPEC (orchestrator-locked)
"Живая книга" — писательский редактор с ИИ-иллюстрациями. PWA, offline-first (кроме генерации).

## 1. Требования (не обсуждаются)
1. Все артефакты проекта живут локально (доставка на D:\pergamin; сборка в /home/sss/pergamin-build).
2. Работает как программа на ПК (Chrome/Edge, .bat-запуск) и на телефоне (PWA на домашний экран).
3. Генерация картинок доступна ТОЛЬКО при интернете. Офлайн — недоступна (кнопка неактивна + пояснение).
4. Все действия происходят ВНУТРИ книги/программы (никуда не уходить).
5. Стиль = живая классическая книга: жёлтые/пергаментные листы, корешок, буквица, орнаменты, нумерация страниц.
6. ИИ-генерация картинок работает в книге (выделил текст → рисунок вставлен в книгу).
7. Сверху панель инструментов, как в Word (шрифт, размер, bold/italic/underline, заголовки, выравнивание, тема бумаги, книга/библиотека, ИИ-кнопка).

## 2. Технический стек (фикс)
- Чистый HTML/CSS/JS, без фреймворков, без сборки. Один каталог = приложение.
- Offline-first: service worker кэширует shell + шрифты + иконки. Контент в IndexedDB.
- Шрифты: локальные woff2 в fonts/ (Cormorant Garamond, EB Garamond, один рукописный). Фолбэк — системный serif (Georgia/Palatino/Times) + cursive. Приложение обязано выглядеть книжно и без скачанных шрифтов.
- Генерация: pollinations.ai (без ключа), model=flux, с seed на книгу для консистентности. Только при navigator.onLine + успешном HEAD-check.
- Хранение картинок: B отдёт dataURL; A сохраняет dataURL в книгу (IndexedDB) → картинка видна офлайн.

## 3. Карта файлов и ВЛАДЕНИЕ (не трогать чужое!)
РукA (Codex) владет:
  index.html, book.css, book.js, manifest.webmanifest, sw.js,
  icons/icon-192.png, icons/icon-512.png, fonts/*, start.bat, README.md
РукB (Cursor) владет ТОЛЬКО:
  ai.js
  (ai.js подключается index.html строкой <script src="ai.js" defer> — эту строку РукA уже оставляет в index.html)

Запрещено любому: править файл другой руки. Интеграция — только через контракт (п.5, п.6).

## 4. Модель данных (ФИКС) — объект книги, значение в IndexedDB store "books", key=book.id
{
  id: string,
  title: string,
  byline: string,
  content: string,                 // HTML рукописи (innerHTML .manuscript)
  font: string,                    // css font-family текста
  fsize: number,                   // px (15..30)
  headingFont: string,             // css font-family заголовков
  headingStyle: string,            // 'normal' | 'italic'
  paper: string,                   // "main|edge" (два hex через |)
  illusStyle: string,              // '' = стиль ещё не зафиксирован; иначе текст стиля
  illusHistory: [ { id: string, what: string, prompt: string, ts: number } ],  // последние <=10; без dataURL-дубликатов
  createdAt: number, updatedAt: number
}
Новая книга: иллюстрации/стиль НЕ наследуются из других книг (изоляция).

## 5. Контракт window.__pg__ (ФИКС) — РукA ОБЯЗАН реализовать и выдать в window:
window.__pg__ = {
  currentBookId(): string,
  getBook(id): book|null,
  updateBook(id, patch): void,            // shallow-merge + persist + обновить updatedAt
  getSelectionText(): string,             // текущее выделение (trim)
  insertFigureAtSelection(bookId, {dataUrl, caption, prompt}): void,
      // вставляет <figure class="illus" data-figure-id="…"><img src=dataUrl></figure> без подписи
      // в позицию выделения (или в конец .manuscript); добавляет {id,what:caption,prompt,ts} в illusHistory (cap 10);
      // persist
  isOnline(): boolean,
  toast(msg): void,
  on(evt, cb): void   // evt: 'online' | 'offline' | 'bookopen' | 'selection'
}
Доп. DOM-якоря, которые РукA ОБЯЗАН создать и оставить:
  - <button id="ai-gen" class="ai" disabled>🤖 Иллюстрация</button> в панели (РукB сам вешает click)
  - <div id="ai-host"></div> (для индикатора загрузки / модалки промта)
  - <div id="ms" contenteditable> (рукопись), <div id="page">, <div class="book">
РукA НЕ реализует логику генерации — только хост-точки и контракт. До подключения ai.js ИИ-кнопка может показывать заглушку (через inline-stub в book.js), которую ai.js перекрывает.

## 6. Контракт промта ИИ (ФИКС) — РукB строит:
Строка промта = конкатенация:
  "Generate ONE book illustration for the excerpt below from the book '<title>'."
  + (book.illusStyle
       ? "\nBOOK STYLE (MANDATORY, keep consistent for the WHOLE book): " + book.illusStyle
       : "\nBOOK STYLE NOT SET YET: choose an expressive, distinctive illustration style and make it memorable (it will be fixed for the whole book).")
  + "\nCONTEXT: consider the WHOLE book so all illustrations stay consistent (same characters, places, palette)."
  + (book.illusHistory.length
       ? "\nAlready illustrated in this book: " + book.illusHistory.slice(-3).map(h=>h.what).join("; ") + ". Do not contradict them."
       : "\nThis is the FIRST illustration — it sets the visual tone of the book.")
  + "\nExcerpt: \"" + excerpt(<=500 chars, ellipsis) + "\""
  + "\nNo text/letters/watermark in the image. Square composition."
Поведение:
  - При клике #ai-gen: excerpt = window.__pg__.getSelectionText(). Пусто → toast("Сначала выделите текст"), выход.
  - Если !isOnline() → toast("Нет интернета — генерация недоступна"), выход. (Кнопка должна быть disabled офлайн — РукB слушает on('online'/'offline') и setAttribute.)
  - Загрузка: показ индикатора в #ai-host (например, "🖋 рисую…"), кнопка disabled.
  - URL: https://image.pollinations.ai/prompt/<encodeURIComponent(prompt)>?width=768&height=768&seed=<seed>&model=flux&nologo=true
      seed = числовой hash от book.id (стabilen на книгу; одинаковый seed + стиль = консистентность).
  - fetch(url, {cache:'no-store'}) → blob → dataURL (base64). Ошибка/таймаут(60с) → toast с ошибкой, снять индикатор.
  - Успех:
      caption = excerpt.slice(0,90)
      window.__pg__.insertFigureAtSelection(bookId, {dataUrl, caption, prompt})
      if (book.illusStyle === ''):
          newStyle = "consistent with this illustration: <описать 1-2 предложениями стиль/палитру/персонажей, чтобы зафиксировать>"
          window.__pg__.updateBook(bookId, { illusStyle: newStyle })
          toast("Иллюстрация вставлена. Стиль книги зафиксирован: …")
      else toast("Иллюстрация вставлена (стиль книги сохранён)")
      снять индикатор.
  - РукB ОБЯЗАН сам вешать #ai-gen click и слушать события. ai.js стартует после DOMContentLoaded и ожидает window.__pg__ (polling до 2с).

## 7. UI (РукA)
Панель сверху (как Word): [логотип ✒ Пергамин] [выбор книги ▾] [+ Новая книга] [шрифт ▾] [размер] [B][I][U] [заголовок ▾] [выравнивание L/C/R] [бумага ▾] [Страницы 1/2 ▾] ...справа... [☰ линейка] [🤖 Иллюстрация(#ai-gen)] [💾 Сохранено].
  - B/I/U/выравнивание/заголовки — document.execCommand на .manuscript.
  - Кнопка «⇥» (__tab) — вставляет отступ. ВАЖНО: в Chromium баг — multi-NBSP через execCommand('insertText') кривится (2-й символ становится обычным пробелом 32). Рабочий способ: execCommand('insertHTML', false, '<span style="white-space:pre">    </span>') (4 обычных пробела в pre-span). Не «чинить» в insertText.
  - Горячие клавиши (document-level keydown, только внутри рукописи, без Shift): Ctrl+B/I/U — bold/italic/underline; Ctrl+L / Ctrl+E / Ctrl+R — выравнивание left/center/right; Ctrl+J — justified; Ctrl+S — сохранить (preventDefault). Отображаются в title/подсказках кнопок.
  - Режим страниц (#pages select, 1|2): class .book.twp. Реализация — #ms{column-count:2;column-gap:64px} (текст течёт 2 колонками), центральный корешок #page::after (градиент), колонтитул (название книги) вверху ОБЕИХ страниц (#book-title grid 1fr 1fr, span .rt-l/.rt-r), нумерация — .folio .fl «— 1 —» слева / .fr «— 2 —» справа (justify-between). В .twp скрываются .ornament (чтобы не пересекали корешок) — орнаменты вне #ms, не колончатся. Сохраняется в localStorage('pergamin.pages'), по умолчанию 2.
  - ВАЖНО (cache): при любой правке book.css/book.js/index.html бить версию CACHE в sw.js (pergamin-shell-vN) — иначе service worker отдаёт старое (cache-first).
  - Адаптивная ширина (под любой монитор, в т.ч. ultrawide 3440×1440): `main{width:min(3040px,96vw);margin:auto}` — книга тянется на всю доступную ширину, центрируется, без фиксированного 1030px. `.frame-body` — flex; #page-viewport `flex:1`. Подпись `.desk-note` должна быть ПОСЛЕ `</div>` .page-frame (не внутри .frame-body — иначе сжимает книгу и даёт пустой правый столбец). Шрифт/поля растут на широких экранах: @media(min-width:1900px) 25px / (min-width:2600px) 29px + увеличенные padding #page.
  - Пагинация (стрелки внизу по углам + счётчик): DOM `#page-viewport`(рамка, overflow:hidden, фикс. высота `min(78vh,1080px)`) → `#page-scroll`(overflow-y:auto) → `.book`. Стрелки #pg-prev(‹)/#pg-next(›) + #pg-count стоят ВНУТРИ #page-viewport, но ПОСЛЕ #page-scroll — не скроллятся. Страница = окно по высоте (viewport-windowed), НЕ разрезание DOM. `pgMetrics()`: vh=clientHeight, total=scrollHeight, `n=floor((total-vh)/vh)+1` (недостижимый хвост — не страница), `i=clamp(round(scrollTop/vh),0,n-1)`. `pgGo(i)` скроллит на i*vh (instant, behavior:smooth — зависал в headless). Кнопки читают `pgMetrics().i` LIVE (не кэшированный pgI). `pgPaint()` обновляет текст счётчика + disabled стрелок. Обновление: scroll-обработчик (fast path) + setInterval 120ms (safety net — scroll/rAF не срабатывают в headless-браузере и в фоновой вкладке) + MutationObserver(#ms subtree/characterData) + ResizeObserver(viewport) + resize. ВАЖНО: headless-браузер не fire rAF и не даёт scroll-события на программный scrollTop — poll обязателен.
  - Линейка — ВНЕ книги, Word-стиль, ДВЕ оси. .page-frame оборачивает .book: сверху горизонтальная #ruler-h (полоса тиков + 3 перетаскиваемых маркера: #rh-left левый, #rh-first первая строка, #rh-right правый + readout #ruler-read «l · f · r»), слева вертикальная #ruler-v (тики + индикатор #rv-cursor — строка, где каретка, только показ). Кнопка-переключатель #ruler-toggle (☰, справа в панели; class .ruler-off на .page-frame, скрывает ОБЕ линейки).
     Горизонталь: pointerdown на маркере → pointermove/pointerup/pointercancel на window (НЕ полагаться на setPointerCapture — в Chromium при preventDefault() в pointerdown capture ломает роутинг move; window-уровень надёжен). Корректирует отступы ТЕКУЩЕГО абзаца (currentBlock): paddingLeft / textIndent / paddingRight. Математика — АБСОЛЮТНАЯ от стартового (startInd в pointerdown): значение = startInd ± dx; НИКОГДА не кумулятивно. КЛАМП: l 0..(colW-40), f 0..(colW-l-10), r 0..(colW-l-f-10). В развороте (.twp) — относительно АКТИВНОЙ колонки (rulerGeom: colW=(msW-gap)/2, origin по колонке) — маркеры не пересекают корешок.
     Вертикаль: rv-cursor следует за строкой каретки (collapsed range getClientRects → top+height/2, clamp по высоте #ruler-v); opacity 0 без каретки в тексте.
     rulerSync() — на selectionchange/resize и после drag; drag вызывает changed() → автосохранение (отступы в inline-стилях <p>, персистят в IndexedDB).
     Маркеры l и f при равных значениях НАКЛАДЫВАЮТСЯ — в CSS разделены по вертикали (rh-first верх z:4, rh-left низ), как в Word.
     Тест: CDP Input.dispatchMouseEvent (reliable); синтетические PointerEvent — нет (pointerup не срабатывает). node --check + живой drag-тест обязательны.
  - "+ Новая книга": модалка (название + описание стиля иллюстраций, необязательно) → создаёт book с пустым content.
  - Переключатель книг: перерисовывает .manuscript + применяет стиль книги.
  - Автосохранение: input → debounce 500мс → updateBook.
Визуал книги: СВЕТЛАЯ старинная (выбор пользователя) — светлый переплёт/ткань, без тёмной рамки: .book border #cbb18a, bg linear-gradient #e3cfae→#ddc9a8 (светлые тона, орнамент-полоса), .spine #a08355, светлый .book:after. Цвет листа (пергамент #f2e4c4) — без изменений, нравится. Переплёт + орнаменты сохранены, только светлые тона.
Иллюстрация (figure.illus): рамка, лёгкий поворот, капшион курсивом, img из dataUrl. Генерация (ai.js): retry ×3 + фолбэк модели flux→turbo при 500/429 (Pollinations бесплатный, падает под нагрузкой); при полном провале — понятная ошибка со сводкой попыток, без 500 в UI.

## 8. Офлайн
- sw.js: cache-first для shell/шрифтов/иконок; навигация → index.html.
- navigator.onLine события → window.__pg__.on('online'/'offline') (РукA эмитит, РукB слушает).
- Офлайн: #ai-gen disabled + tooltip "нет интернета". Всё остальное (писать, редактировать, книги, ранее сгенерированные рисунки) работает.

## 9. Пуск
- start.bat (Windows): поднимает python http.server 8321 в папке и открывает chrome/edge в app-режиме (или просто http://127.0.0.1:8321). Комментарий внутри.
- manifest.webmanifest + иконки → "Установить как приложение" на ПК и телефоне.
- README.md: как открыть на ПК, как установить на телефон, что работает офлайн/онлайн.

## 10. Done-критерии + self-test
РукA self-test: открыть index.html → создаётся демо-книга; написать текст → сохранилось (обновить страницу, текст на месте); B/I/U/шрифт/бумага меняют вид; новая книга изолирована; window.__pg__ доступен (console: Object.keys(window.__pg__)).
РукB self-test (без реального A): сделать мини-стенд (отдельный test-standalone.html, МОЖНО не включать в доставку), где мок window.__pg__ реализует контракт → проверить, что ai.js строит промт по правилу п.6, корректно работает офлайн-ветка и ветка фиксации стиля. test-standalone.html — только для проверки, в index.html не подключать.

## 11. MVP-расширения (26.09.2026)
- Модель книги дополнена `wordGoal: number` (0 = цель выключена).
- Полнотекстовый поиск по открытой книге: Ctrl+F, список совпадений, переход к найденному фрагменту.
- Статистика рукописи: слова, знаки, время чтения и прогресс цели.
- Меню управления книгой: переименование, безопасное удаление, автономный HTML-экспорт.
- Переносимая JSON-копия всей библиотеки и восстановление с валидацией/санитизацией HTML.
- Мобильный режим всегда показывает одну страницу; сохранённый разворот автоматически возвращается на широком экране.
- Пагинация обязана включать последний неполный экран и доводить прокрутку до `scrollHeight-clientHeight`.
- Тесты: `npm test` и `npm run test:e2e` (изолированный временный Chrome-профиль, реальные IndexedDB/DOM/CDP-проверки).
