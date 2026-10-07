# Gates: Пергамин — читательская библиотека

OWNS: library*, catalog/**, scripts/**, tests/**, index.html, sw.js, desktop-launcher/**, Pergamin.exe, README.md, GATES.md, LIBRARY-DESIGN.md

Scope: Стартовая библиотека со стеллажами, каталогом открытых произведений, личными полками, импортом, отдельным читателем и сохранением данных без регрессий редактора.

- [x] G1: Каталог содержит полные тексты, атрибуцию и проверяемые источники; импорт и хранение защищены от активного содержимого.
  CHECK: node --test --test-reporter=tap tests/library.test.mjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=24f81780d7b4ebdcd1d812784febc3e41b934a385eee0df08b4481492d659a15; exit=0; EXPECT=matched; output-sha256=dde1dba0c4fd547183f831ed7a7aea0ac0167065a3ed8fdf00ab798ef663d5b6; output-bytes=688; shell=C:\Windows\system32\cmd.exe; cwd=E:\pergamin; path=2be1b464a2d7/32 entries
- [x] G2: Реальный браузер проходит полки, поиск, чтение, закладки, заметки, импорт, восстановление, офлайн и мобильный экран.
  CHECK: node tests/library.e2e.mjs
  EXPECT: LIBRARY E2E PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5d8e6c8e5569cc168349b471196a467798080a7b34569f3392cbbc5bc009e652; exit=0; EXPECT=matched; output-sha256=c00680593934f0321ad9de64d414928fca10d86f2b1624f7767cb059125b6d77; output-bytes=19; shell=C:\Windows\system32\cmd.exe; cwd=E:\pergamin; path=2be1b464a2d7/32 entries
- [x] G3: Существующие сценарии редактора не сломаны.
  CHECK: node tests/mvp.e2e.mjs
  EXPECT: "ok": true
  EVIDENCE: automatic-evidence=v1; definition-sha256=53bf972563247cbb8062e134dc38abd131afe480760a783d36d806024cfca3d3; exit=0; EXPECT=matched; output-sha256=30ee476cd0df96e6204dd41f6f89e59fdbf8c2933aa53f522ca03cd50975fb45; output-bytes=2886; shell=C:\Windows\system32\cmd.exe; cwd=E:\pergamin; path=2be1b464a2d7/32 entries
- [x] G4: Настольный сервер обслуживает библиотеку и не раскрывает пользовательские файлы.
  CHECK: C:\Users\diass\.local\bin\uv.exe run --python 3.12 python -m unittest discover -s desktop-launcher -p test_launcher.py
  EXPECT: OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=e6f6aa2928fb1be672444f049d6951ded730fca5aa4044060e22530f7c7e2da0; exit=0; EXPECT=matched; output-sha256=17e66ddd9c16ada79f72fce53bc4c0a5daf6e7934cb5a0851955b42769a8f89e; output-bytes=108; shell=C:\Windows\system32\cmd.exe; cwd=E:\pergamin; path=2be1b464a2d7/32 entries
- [x] G5: Стеллажи, переход, читатель и узкий экран визуально проверены.
  EVIDENCE: 2026-10-01: просмотрены test-results/library-home.png, library-section.png, library-turn.png, library-reader.png, library-mobile.png и library-mobile-reader.png. На 1440 px стеллажи и подписи выровнены, во время переворота виден текст на листе; на 390 px нет горизонтального переполнения, управление и завершение чтения доступны. При reduced-motion анимация отключена и путь остаётся рабочим (G2).
- [x] G6: Пересобранный EXE запускается и обслуживает библиотеку и каталог.
  CHECK: C:\Users\diass\.local\bin\uv.exe run --python 3.12 python tests/desktop_smoke.py
  EXPECT: DESKTOP SMOKE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ecf877627e243df8e34b7c6c169fab93fa2a092849b694ba1c5e2e17adfac798; exit=0; EXPECT=matched; output-sha256=9bde040a1b761dfab8d8db4fb05916a6210341042defb856df2574aba59b08c0; output-bytes=22; shell=C:\Windows\system32\cmd.exe; cwd=E:\pergamin; path=2be1b464a2d7/32 entries
