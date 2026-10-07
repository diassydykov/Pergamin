# Gates: Sherlock Holmes collection

OWNS: scripts/build_holmes.py, scripts/assets/**, catalog/**, library.js, sw.js, tests/holmes*, tests/library*, HOLMES-GATES.md

Scope: The full canonical Sherlock Holmes canon (4 novels + 5 collections = 9 books, 60 works,
«Записки о Шерлоке Холмсе» complete) on a dedicated shelf, from a clean modern-translation
source, replacing the earlier defective per-story set without touching user's own books.

SOURCE (2026-10-01 replacement): the 2016 АСТ edition «Весь Шерлок Холмс»
(coollib.in/b/453797, ~6.4 MB FB2, Штенгель/Волжина/Дехтерева). Stored at
scripts/assets/ast_ves_sholmes_2016.fb2. Verified: 0 «Хольмс», 0 рублёвых доходов
(все вхождения «рубл» = отрублен/прорублено/изрубленных), современная орфография
(0 ѣ/і/ѳ/ѵ), единое «Уотсон», все 4 повести + 56 рассказов. «В Сиреневой Сторожке»
= Wisteria Lodge, «Человек с белым лицом» = The Blanched Soldier. Файл группирует
рассказы НЕ по каноническим сборникам (Картонная коробка стоит в «Прощальном поклоне»,
Глория Скотт и Второе пятно в «Возвращении»), поэтому build_holmes.py разбивает его по
заголовкам и перегруппировывает по канону.

- [x] H1: 9 canonical books (4 novels + 5 collections), complete texts, clean orthography.
  CHECK: node --test --test-reporter=tap tests/holmes.test.mjs
  EXPECT: # fail 0
  EVIDENCE: 2026-10-01: 9 книг (Этюд/Знак/Собака/Долина + Приключения 12, Записки 12,
  Возвращение 13, Прощальный поклон 7, Архив 12 = 60 произведений), 3,26 МБ текста,
  0 «Хольмс», 0 рублёвых доходов, уникальные id/canonicalWork/sha256, все sha256 сверены,
  «Записки о Шерлоке Холмсе» полная (12, с Картонной коробкой и Глорией Скотт).

- [x] H2: Shelf opens in the reader, survives reload, retires stale old books, keeps personal books.
  CHECK: node tests/holmes.e2e.mjs
  EXPECT: HOLMES READER VERIFIED
  EVIDENCE: 2026-10-01: стеллаж «Шерлок Холмс» = ровно 9 книг, «Собака Баскервилей» открылась
  (>1 страницы), прогресс сохранён, pageerror=0; после посева OLD-книги (ws-1040503, origin=catalog)
  и личной книги (local-*) при перезагрузке старая удалена, 9 канонических на месте, личная
  книга сохранилась, нигде нет «Хольмс». Миграция подтверждена и на реальном профиле
  (E:\pergamin\pergamin-data): 33 старые → 0, добавлено 9, личных книг не было.
  Механизм: init() в library.js удаляет origin==='catalog' книги, отсутствующие в starter.json
  (никакие personal/import не трогаются). sw.js CACHE bump v35→v36.

## Зарубежная классика (foreign shelf)

- [x] F1: Каталог зарубежных книг содержит полные тексты с проверенной отметкой общественного достояния и атрибуцией.
  CHECK: node --test --test-reporter=tap tests/library.test.mjs
  EXPECT: # fail 0
  EVIDENCE: 2026-10-01: 7 книг (Дракула/Стокер, Три мушкетёра/Дюма 2 тома, Портрет Дориана Грея/Уайльд, Том Сойер + Гек Финн/Твен, Алиса в стране чудес/Кэрролл, Щелкунчик и мышиный король/Гофман), 3,31 МБ текста, права подтверждены отметкой Викитеки, все sha256 сверены. Общий каталог = 62 книги (22 стартовые + 33 Холмс + 7 зарубежные), стеллаж «Зарубежная классика» добавлен в genres. Исключены произведения, имеющиеся на Викитеке только как страницы-оглавления (Гюго, Диккенс, Свифт, Верн, Андерсен, Боккаччо, Стивенсон, Кафка, Шелли) — нарушение G1 «проверяемые источники».
