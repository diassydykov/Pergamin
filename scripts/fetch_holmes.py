"""Download one historical Russian translation per Holmes work from Wikisource.

Run: uv run --with beautifulsoup4 python -X utf8 scripts/fetch_holmes.py
Sources are cached and revision-pinned by fetch_catalog.fetch. No modern translations
or overlapping collected editions are included. Existing non-Holmes entries survive.
"""
import hashlib
import json
import re
from bs4 import BeautifulSoup
from fetch_catalog import ROOT, fetch, extract

# Canonical Doyle story codes prevent duplicates despite different Russian titles.
WORKS = [
    ('STUD', 'Этюд в багровых тонах', 'Красное по белому (Дойль; Облеухов)'),
    ('HOUN', 'Собака Баскервилей', 'Собака Баскервилей (Дойль; Ломиковская)'),
    ('SCAN', 'Скандал в Богемии', 'Скандальная история в княжестве О... (Дойль; Латернер)'),
    ('REDH', 'Союз рыжих', 'Союз рыжеволосых (Дойль)/ДО'),
    ('BLUE', 'Голубой карбункул', 'История голубого алмаза (Дойль; Латернер)'),
    ('SPEC', 'Пёстрая лента', 'Пёстрая лента (Дойль; 1896)'),
    ('NOBL', 'Знатный холостяк', 'Аристократ-холостяк (Дойль; Репина)/ДО'),
    ('BERY', 'Берилловая диадема', 'Изумрудная диадема (Дойль; 1894)'),
    ('COPP', 'Медные буки', 'Усадьба «Под буками» (Дойль; Репина)/ДО'),
    ('SILV', 'Серебряный', 'Сильвер Блэз (Дойль; Туфанов)'),
    ('YELL', 'Жёлтое лицо', "Жёлтое лицо (Дойль; д'Андре)"),
    ('MUSG', 'Обряд дома Месгрейвов', 'Мёсгрэвский обряд (Дойль; Репина)/ДО'),
    ('CROO', 'Горбун', 'Калека (Дойль; д`Андре)'),
    ('GREE', 'Случай с переводчиком', 'Грек-толмач (Дойль; Туфанов)'),
    ('NAVA', 'Морской договор', 'Морской договор (Дойль; Репина)/ДО'),
    ('FINA', 'Последнее дело Холмса', 'Последнее дело Холмса (Дойль; Туфанов)'),
    ('EMPT', 'Пустой дом', 'В пустом доме (Дойль; 1903)'),
    ('NORW', 'Подрядчик из Норвуда', 'Норвудский архитектор (Дойль; 1904)'),
    ('SOLI', 'Одинокая велосипедистка', 'Одинокая велосипедистка (Дойль; 1904)'),
    ('PRIO', 'Случай в интернате', 'Случай в школе (Дойль; Облеухов)/ДО'),
    ('BLAC', 'Чёрный Пётр', 'Чёрный Пётр (Дойль; Облеухов)/ДО'),
    ('SIXN', 'Шесть Наполеонов', 'Шесть Наполеонов (Дойль; 1925)'),
    ('3STU', 'Три студента', 'Кто из трёх? (Дойль; Облеухов)/ДО'),
    ('GOLD', 'Золотое пенсне', 'Золотое пенсне (Дойль; 1907)/ДО'),
    ('MISS', 'Пропавший регбист', 'Исчезновение чемпиона (Дойль; 1907)/ДО'),
    ('ABBE', 'Убийство в Эбби-Грейндж', 'Красный шнурок (Дойль; 1907)/ДО'),
    ('SECO', 'Второе пятно', 'Кровавое пятно (Дойль; 1907)/ДО'),
    ('LAST', 'Его прощальный поклон', 'Новое дело Шерлока Холмса (Дойль; Журавская)'),
    ('SUSS', 'Вампир в Суссексе', 'Вампир из Суссекса (Дойль; 1927)'),
    ('THOR', 'Загадка Торского моста', 'Загадка Торского моста (Дойль; 1928)'),
    ('VEIL', 'Жилица под вуалью', 'Жилица под вуалью (Дойль; 1927)'),
    ('SHOS', 'Загадка поместья Шоскомб', 'Приключение в усадьбе Шоском (Дойль; 1927)'),
]


def main():
    books = []
    assert len({code for code, _, _ in WORKS}) == len(WORKS)
    for code, title, page in WORKS:
        data = fetch(page)
        soup = BeautifulSoup(data['text']['*'], 'html.parser')
        text = soup.get_text(' ', strip=True)
        if not re.search(r'общественн\w* достояни[ие]', text):
            raise ValueError('Missing source rights statement: ' + page)
        if 'список редакций одного произведения' in text:
            raise ValueError('Not a complete edition: ' + page)
        content = extract(data['text']['*'])
        if len(content) < (180000 if code in ('STUD', 'HOUN') else 12000):
            raise ValueError('Unexpectedly short work: ' + page)
        # Retain original section headings, but provide navigation in long novels.
        # The 1909 Oblyukhov page holds two novels back to back (A Study in Scarlet,
        # then The Sign of the Four); split them into separate catalog books.
        works = [(code, title, title, content)]
        if code == 'STUD' and 'Часть вторая' in content:
            marker = content.find('Часть вторая')
            works = [('STUD', title, title, content[:marker]),
                     ('SIGN', 'Знак четырёх', 'Знак четырёх (Дойль; Облеухов)', content[marker:])]
        header = soup.select_one('#headertemplate')
        attribution = header.get_text(' ', strip=True) if header else text.split('Это произведение')[0]
        source = 'https://ru.wikisource.org/w/index.php?oldid=' + str(data['revid'])
        for work_code, work_title, work_source_title, work_content in works:
            chapters = []
            if work_code in ('STUD', 'SIGN', 'HOUN'):
                dom = BeautifulSoup(work_content, 'html.parser')
                heading, blocks = work_title, []
                for node in dom.children:
                    if not getattr(node, 'name', None):
                        continue
                    if node.name == 'h2':
                        if blocks:
                            chapters.append(dict(title=heading, html='\n'.join(blocks)))
                            blocks = []
                        heading = re.sub(r'\s+', ' ', node.get_text(' ', strip=True))
                    else:
                        blocks.append(str(node))
                if blocks:
                    chapters.append(dict(title=heading, html='\n'.join(blocks)))
            else:
                chapters = [dict(title=work_title, html=work_content)]
            work_content = ''.join(c['html'] for c in chapters)
            books.append(dict(
                id='ws-' + str(data['pageid']) + ('-sign' if work_code == 'SIGN' else ''),
                canonicalWork=work_code, title=work_title,
                author='Артур Конан Дойл', sortAuthor='Дойл', authorDeath=1930,
                genre='holmes', language='ru', origin='catalog', source=source,
                sourceTitle=work_source_title, revision=data['revid'],
                description='Шерлок Холмс. Исторический русский перевод. Название в источнике: '
                    + work_source_title + '. Сохранена орфография издания, в том числе дореформенная.',
                rights='По отметке Викитеки, оригинал и перевод находятся в общественном достоянии. '
                    'Подготовка текста: участники Викитеки, CC BY-SA 4.0. Удалены навигация, '
                    'справочные примечания и изображения; преобразована разметка. Источник издания: '
                    + re.sub(r'\s+', ' ', attribution),
                licenseUrl='https://creativecommons.org/licenses/by-sa/4.0/',
                chapters=chapters, sha256=hashlib.sha256(work_content.encode()).hexdigest()))
            print(work_code, work_title, len(work_content), len(chapters), flush=True)
    # All downloads and validation succeed before changing the live catalog.
    path = ROOT / 'catalog/starter.json'
    catalog = json.loads(path.read_text(encoding='utf-8'))
    identities = {b['id'] for b in books}
    hashes = {b['sha256'] for b in books}
    existing = [b for b in catalog['books'] if b['id'] not in identities
                and b.get('canonicalWork') not in {w[0] for w in WORKS}
                and b.get('sha256') not in hashes]
    catalog['books'] = existing + books
    (ROOT / 'catalog/holmes.json').write_text(json.dumps(dict(version=1, books=books), ensure_ascii=False, indent=2), encoding='utf-8')
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    print('HOLMES DOWNLOADED', len(books), 'TOTAL', len(catalog['books']))


if __name__ == '__main__':
    main()
