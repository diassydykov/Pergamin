"""Build the clean Holmes catalog from the AAST 2016 "Vesy Sherlock Holms" FB2.

Dry-run with --check: verify every one of the 60 canonical works is found
exactly once, in order, with adequate length and zero 'Holms'/ruble errors.
Without --check: also write catalog/holmes.json and merge into starter.json.

Usage:
  python -X utf8 scripts/build_holmes.py --check
  python -X utf8 scripts/build_holmes.py
"""
import hashlib, html as H, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'scripts' / 'assets' / 'ast_ves_sholmes_2016.fb2'
OUT_HOLMES = ROOT / 'catalog' / 'holmes.json'
OUT_STARTER = ROOT / 'catalog' / 'starter.json'

AUTHOR = 'Артур Конан Дойл'
SOURCE = 'https://coollib.in/b/453797-konan-doyl-ves-sherlok-holms'
RIGHTS = ('Оригинальные произведения (Дойль, ум. 1930) и их русские переводы '
          '(Штенгель, Волжина, Дехтерева и др.) находятся в общественном '
          'достоянии. Текст: изд. «Весь Шерлок Холмс» (АСТ, 2016), переведён '
          'для Пергамина; удалены иллюстрации, сноски и навигация, нормализована '
          'орфография.')

def norm(s): return re.sub(r'\s+', ' ', s).strip()

def load_paras():
    raw = SRC.read_bytes().decode('utf-8', 'replace')
    body = re.search(r'<body>(.*)', raw, re.S).group(1)
    paras = []
    for m in re.finditer(r'<p>(.*?)</p>', body, re.S):
        inner = m.group(1)
        paras.append((re.sub(r'<[^>]+>', '', inner).strip(), '<strong>' in inner))
    return paras

def esc(text):
    return H.escape(text, quote=False)

# Volume divider headers (strong lines) that are NOT story titles or chapters and
# would otherwise leak into a chapter tail. Novel titles ("... ( 1887 )") don't
# contain "Шерлока Холмса (", so they are never matched here.
SEC_DIV = re.compile(r'Шерлока Холмса\s*\(')

def paras_html(paras, indices, skip=()):
    out = []
    for i in indices:
        if i in skip:
            continue
        t = paras[i][0]
        if t:
            out.append(f'<p>{esc(t)}</p>')
    return '\n'.join(out)

def split_novel(paras, a, b):
    """Split a novel into chapters on 'Глава N.' / 'Часть N.' strong lines."""
    chapters = []
    title = ''
    buf = []
    skip = {i for i in range(a + 1, b) if paras[i][1] and SEC_DIV.search(paras[i][0])}
    def flush():
        nonlocal title, buf
        h = paras_html(paras, buf, skip=skip)
        if title or h:
            chapters.append(dict(title=title or 'Текст', html=h))
        buf = []
    for i in range(a + 1, b):
        t, strong = paras[i]
        if strong and re.match(r'^(Глава |Часть )', norm(t)):
            if buf or title:
                flush()
            title = norm(t)
        else:
            buf.append(i)
    if buf or title:
        flush()
    return chapters

def story_chapter(paras, a, b, title):
    skip = {i for i in range(a + 1, b) if paras[i][1] and SEC_DIV.search(paras[i][0])}
    return [dict(title=title, html=paras_html(paras, range(a + 1, b), skip=skip))]

# (code, collection, title, file_header, kind)  -- in canonical reading order
WORKS = [
    # 4 novels
    ('STUD','STUD','Этюд в багровых тонах','Этюд в багровых тонах ( 1887 )','novel'),
    ('SIGN','SIGN','Знак четырёх','Знак четырех ( 1890 )','novel'),
    ('HOUN','HOUN','Собака Баскервилей','Собака Баскервилей ( 1901-1902 )','novel'),
    ('VFEAR','VFEAR','Долина ужаса','Долина ужаса ( 1914-1915 )','novel'),
    # Adventures of Sherlock Holmes (1892) — 12
    ('ADV1','ADV','Скандал в Богемии','Скандал в Богемии','story'),
    ('ADV2','ADV','Союз рыжих','Союз рыжих','story'),
    ('ADV3','ADV','Установление личности','Установление личности','story'),
    ('ADV4','ADV','Тайна Боскомской долины','Тайна Боскомской долины','story'),
    ('ADV5','ADV','Пять апельсиновых зернышек','Пять апельсиновых зернышек','story'),
    ('ADV6','ADV','Человек с рассечённой губой','Человек с рассеченной губой','story'),
    ('ADV7','ADV','Голубой карбункул','Голубой карбункул','story'),
    ('ADV8','ADV','Пёстрая лента','Пестрая лента','story'),
    ('ADV9','ADV','Палец инженера','Палец инженера','story'),
    ('ADV10','ADV','Знатный холостяк','Знатный холостяк','story'),
    ('ADV11','ADV','Берилловая диадема','Берилловая диадема','story'),
    ('ADV12','ADV','Медные буки','«Медные буки»','story'),
    # The Memoirs of Sherlock Holmes (1894) — 12, in canonical publication order
    # (Cardboard Box is #2 here; Gloria Scott #5)
    ('MEM1','MEM','Серебряный','Серебряный','story'),
    ('MEM2','MEM','Картонная коробка','Картонная коробка','story'),
    ('MEM3','MEM','Жёлтое лицо','Желтое лицо','story'),
    ('MEM4','MEM','Приключения клерка','Приключения клерка','story'),
    ('MEM5','MEM','Глория Скотт','«Глория Скотт»','story'),
    ('MEM6','MEM','Обряд дома Месгрейвов','Обряд дома Месгрейвов','story'),
    ('MEM7','MEM','Рейгетские сквайры','Рейгетские сквайры','story'),
    ('MEM8','MEM','Горбун','Горбун','story'),
    ('MEM9','MEM','Постоянный пациент','Постоянный пациент','story'),
    ('MEM10','MEM','Случай с переводчиком','Случай с переводчиком','story'),
    ('MEM11','MEM','Морской договор','Морской договор','story'),
    ('MEM12','MEM','Последнее дело Холмса','Последнее дело Холмса','story'),
    # The Return of Sherlock Holmes (1905) — 13
    ('RET1','RET','Пустой дом','Пустой дом','story'),
    ('RET2','RET','Подрядчик из Норвуда','Подрядчик из Норвуда','story'),
    ('RET3','RET','Пляшущие человечки','Пляшущие человечки','story'),
    ('RET4','RET','Одинокая велосипедистка','Одинокая велосипедистка','story'),
    ('RET5','RET','Случай в интернате','Случай в интернате','story'),
    ('RET6','RET','Чёрный Пётр','Черный Питер','story'),
    ('RET7','RET','Конец Чарльза Огастеса Милвертона','Конец Чарльза Огастеса Милвертона','story'),
    ('RET8','RET','Шесть Наполеонов','Шесть Наполеонов','story'),
    ('RET9','RET','Три студента','Три студента','story'),
    ('RET10','RET','Пенсне в золотой оправе','Пенсне в золотой оправе','story'),
    ('RET11','RET','Пропавший регбист','Пропавший регбист','story'),
    ('RET12','RET','Убийство в Эбби-Грейндж','Убийство в Эбби-Грэйндж','story'),
    ('RET13','RET','Второе пятно','Второе пятн','story'),
    # His Last Bow (1917) — 6  (Cardboard Box moved to Memoirs)
    ('LHB1','LHB','Усадьба под буками','В Сиреневой Сторожке','story'),
    ('LHB2','LHB','Алое кольцо','Алое кольцо','story'),
    ('LHB3','LHB','Чертежи Брюса-Партингтона','Чертежи Брюса-Партингтона','story'),
    ('LHB4','LHB','Шерлок Холмс при смерти','Шерлок Холмс при смерти','story'),
    ('LHB5','LHB','Исчезновение леди Фрэнсис Карфэкс','Исчезновение леди Фрэнсис Карфэкс','story'),
    ('LHB6','LHB','Дьяволова нога','Дьяволова нога','story'),
    ('LHB7','LHB','Его прощальный поклон','Его прощальный поклон','story'),
    # The Case-Book of Sherlock Holmes (1927) — 12
    ('ARC1','ARC','Камень Мазарини','Камень Мазарини','story'),
    ('ARC2','ARC','Загадка Торского моста','Загадка Торского моста','story'),
    ('ARC3','ARC','Человек на четвереньках','Человек на четвереньках','story'),
    ('ARC4','ARC','Вампир в Суссексе','Вампир в Суссексе','story'),
    ('ARC5','ARC','Три Гарридеба','Три Гарридеба','story'),
    ('ARC6','ARC','Знатный клиент','Знатный клиент','story'),
    ('ARC7','ARC','Происшествие на вилле «Три конька»','Происшествие на вилле «Три конька»','story'),
    ('ARC8','ARC','Бледный солдат','Человек с белым лицом','story'),
    ('ARC9','ARC','Львиная грива','Львиная грива','story'),
    ('ARC10','ARC','Москательщик на покое','Москательщик на покое','story'),
    ('ARC11','ARC','Жилица под вуалью','История жилички под вуалью','story'),
    ('ARC12','ARC','Загадка поместья Шоскомб','Загадка поместья Шоскомб','story'),
]

COLL_BOOKS = [
    ('STUD','Этюд в багровых тонах'),
    ('SIGN','Знак четырёх'),
    ('HOUN','Собака Баскервилей'),
    ('VFEAR','Долина ужаса'),
    ('ADV','Приключения Шерлока Холмса'),
    ('MEM','Записки о Шерлоке Холмсе'),
    ('RET','Возвращение Шерлока Холмса'),
    ('LHB','Его прощальный поклон'),
    ('ARC','Архив Шерлока Холмса'),
]
COLL_DESC = {
 'ADV':'«Приключения Шерлока Холмса» (1892) — первый сборник из 12 рассказов.',
 'MEM':'«Записки о Шерлоке Холмсе» (1894) — 12 рассказов, включая «Последнее дело Холмса».',
 'RET':'«Возвращение Шерлока Холмса» (1905) — 13 рассказов.',
 'LHB':'«Его прощальный поклон» (1917) — 6 рассказов.',
 'ARC':'«Архив Шерлока Холмса» (1927) — 12 рассказов.',
}

def main():
    check_only = '--check' in sys.argv
    paras = load_paras()
    strong_idx = [i for i,(t,s) in enumerate(paras) if s and t]
    idx_of = {}
    for i in strong_idx:
        idx_of.setdefault(norm(paras[i][0]), []).append(i)

    # locate each work header
    loc = []
    for code, coll, title, hdr, kind in WORKS:
        ms = idx_of.get(norm(hdr), [])
        if len(ms) != 1:
            print(f'  !! {code} {hdr!r}: {len(ms)} matches {ms}')
            return 2
        loc.append((code, coll, title, hdr, kind, ms[0]))

    # in-file order
    order = sorted(loc, key=lambda x: x[5])
    problems = 0
    for k in range(len(order)-1):
        if order[k][5] >= order[k+1][5]:
            print(f'  !! order problem at {order[k][0]}')
            problems += 1

    books = {}
    for k,(code,coll,title,hdr,kind,start) in enumerate(order):
        end = order[k+1][5] if k+1 < len(order) else len(paras)
        if kind == 'novel':
            ch = split_novel(paras, start, end)
        else:
            ch = story_chapter(paras, start, end, title)
        content = ''.join(c['html'] for c in ch)
        text = re.sub(r'<[^>]+>', '', content)
        holms = len(re.findall(r'Хольмс', text))
        # real ruble money (not отрублен/прорублено/обрублен)
        ruble = len(re.findall(r'рубл', text)) - len(re.findall(r'[аеёоу]рубл|прорубл|отрубл|обрубл', text))
        books[code] = dict(code=code, coll=coll, title=title, start=start, end=end,
                           nch=len(ch), chars=len(text), holms=holms, ruble=max(0,ruble))
        if holms: problems += 1
        if len(text) < 3000: print(f'  !! {code} too short {len(text)}')

    # assemble 9 books — chapters follow CANONICAL order (WORKS list), not file order
    work_by_code = {w[0]: w for w in WORKS}
    final = []
    for coll, title in COLL_BOOKS:
        if coll in ('STUD','SIGN','HOUN','VFEAR'):
            w = next(w for w in WORKS if w[1]==coll)
            m = books[w[0]]
            ch = split_novel(paras, m['start'], m['end'])
        else:
            # canonical order = order of these codes in the WORKS list
            codes_in_order = [w[0] for w in WORKS if w[1]==coll]
            ch = []
            for code in codes_in_order:
                m = books[code]
                ch += story_chapter(paras, m['start'], m['end'], m['title'])
        content = ''.join(c['html'] for c in ch)
        desc = ('Повесть о Шерлоке Холмсе.' if coll in ('STUD','SIGN','HOUN','VFEAR') else '') + COLL_DESC.get(coll,'')
        final.append(dict(
            id=f'holmes-{coll.lower()}',
            canonicalWork=coll, title=title, author=AUTHOR, sortAuthor='Дойл',
            authorDeath=1930, genre='holmes', language='ru', origin='catalog',
            source=SOURCE, sourceTitle='Весь Шерлок Холмс (АСТ, 2016)', revision=0,
            description=desc, rights=RIGHTS, licenseUrl='',
            chapters=ch, sha256=hashlib.sha256(content.encode()).hexdigest(),
            _nch=len(ch), _chars=len(re.sub(r'<[^>]+>','',content))))

    # report
    total = 0
    for b in final:
        txt = re.sub(r'<[^>]+>','',b['chapters'][0]['html'] if b['chapters'] else '')
        print(f"{b['id']:22} {b['title']:28} chapters={b['_nch']:>2} chars={b['_chars']:>7}")
        total += b['_chars']
    print(f"\nTOTAL books={len(final)}  chars={total}")
    codes = [b['canonicalWork'] for b in final]
    # per-collection story count check
    expected = {'ADV':12,'MEM':12,'RET':13,'LHB':7,'ARC':12}
    ok = True
    for coll, want in expected.items():
        got = len([b for b in final if b['canonicalWork']==coll][0]['chapters'])
        status = 'OK' if got==want else f'WANT {want}'
        if got!=want: ok=False
        print(f"  {coll}: {got} stories  {status}")

    if problems or not ok:
        print(f'\nPROBLEMS: {problems}'); return 2
    if check_only:
        print('\nCHECK PASSED (no writes)')
        return 0

    # write holmes.json
    out_books = [{k:v for k,v in b.items() if not k.startswith('_')} for b in final]
    OUT_HOLMES.write_text(json.dumps(dict(version=2, books=out_books), ensure_ascii=False, indent=2), encoding='utf-8')

    # merge into starter.json (preserve non-holmes books, replace holmes)
    starter = json.loads(OUT_STARTER.read_text(encoding='utf-8'))
    keep = [b for b in starter['books'] if b.get('genre') != 'holmes']
    starter['books'] = keep + out_books
    OUT_STARTER.write_text(json.dumps(starter, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\nWROTE {OUT_HOLMES} ({len(out_books)} books)')
    print(f'WROTE {OUT_STARTER} (total {len(starter["books"])} books, {len(keep)} non-holmes preserved)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
