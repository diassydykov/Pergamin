"""Download a popular foreign (non-Russian) public-domain selection, Russian
translations, from ru.wikisource. Same safety model as fetch_holmes.py:
- rights statement must be present in the source text (verified PD),
- no anthology/duplicate pages, minimum length, revision-pinned source URL,
- unique ids (ws-<pageid>), canonical ids (foreign-<key>),
- all-or-nothing: nothing written until every download+validation succeeds,
- existing catalog entries survive.

Run: uv run --with beautifulsoup4 python -X utf8 scripts/fetch_foreign.py
All page titles below were verified to exist on ru.wikisource (2026-10-01).
Books go to the dedicated 'foreign' (Зарубежная классика) shelf.
"""
import hashlib
import json
import re
from bs4 import BeautifulSoup
from fetch_catalog import ROOT, fetch, extract

# key, title, author, deathYear, wikisource page, minContentChars.
# Only works that have a COMPLETE text + a public-domain rights statement on
# ru.wikisource. (Many popular foreign titles — Hugo, Dickens, Swift, Verne,
# Andersen, Carroll, Boccaccio, Jekyll — exist only as index/disambiguation
# pages there and are deliberately excluded per the G1 "verifiable source" gate.)
WORKS = [
    ('dracula', 'Вампир (Граф Дракула)', 'Брэм Стокер', 1912, 'Вампир (Граф Дракула) (Стокер)', 15000),
    ('three', 'Три мушкетёра', 'Александр Дюма', 1870, ['Три мушкетера (Дюма)/Том 1/ДО', 'Три мушкетера (Дюма)/Том 2/ДО'], 100000),
    ('dorian', 'Портрет Дориана Грея', 'Оскар Уайльд', 1900, 'Портрет Дориана Грея (Уайльд; Ликиардопуло)', 20000),
    ('tom', 'Приключения Тома Сойера', 'Марк Твен', 1910, 'Приключения Тома Сойера (Твен; Николаева)/ДО', 30000),
    ('huck', 'Похождения Гекльберри Финна', 'Марк Твен', 1910, 'Похождения Гекльберри Финна (Твен; Ранцов)', 30000),
    ('alice', 'Алиса в стране чудес', 'Льюис Кэрролл', 1898, 'Алиса в стране чудес (Кэрролл; Д’Актиль)', 20000),
    ('walnut', 'Щелкунчик и мышиный король', 'Э. Т. А. Гофман', 1822, 'Щелкунчик и мышинный король (Гофман)/ДО', 30000),
]


def main():
    books = []
    for key, title, author, death, pages, minimum in WORKS:
        pages = pages if isinstance(pages, list) else [pages]
        parts = []  # (chapter_title, content_html, data, soup, text)
        for i, part in enumerate(pages):
            data = fetch(part)
            soup = BeautifulSoup(data['text']['*'], 'html.parser')
            text = soup.get_text(' ', strip=True)
            if not re.search(r'общественн\w* достояни[ие]', text):
                raise ValueError('Missing source rights statement: ' + part)
            if 'список редакций одного произведения' in text:
                raise ValueError('Not a complete edition: ' + part)
            part_content = extract(data['text']['*'])
            ch_title = title if len(pages) == 1 else ('Том %d' % (i + 1))
            parts.append((ch_title, part_content, data, soup, text))
        content = ''.join(p[1] for p in parts)
        if len(content) < minimum:
            raise ValueError('Unexpectedly short work (%d < %d): ' % (len(content), minimum) + pages[0])
        first_data = parts[0][2]
        first_soup, first_text = parts[0][3], parts[0][4]
        header = first_soup.select_one('#headertemplate')
        attribution = header.get_text(' ', strip=True) if header else first_text.split('Это произведение')[0]
        source = 'https://ru.wikisource.org/w/index.php?oldid=' + str(first_data['revid'])
        chapters = [dict(title=p[0], html=p[1]) for p in parts]
        books.append(dict(
            id='ws-' + str(first_data['pageid']), canonicalWork='foreign-' + key, title=title,
            author=author, sortAuthor=author.split()[-1], authorDeath=death,
            genre='foreign', language='ru', origin='catalog', source=source,
            sourceTitle=first_data['title'], revision=first_data['revid'],
            description='Зарубежная классика в историческом русском переводе. Название в источнике: '
                + first_data['title'] + '. Сохранена орфография издания.',
            rights='По отметке Викитеки, оригинал и перевод находятся в общественном достоянии. '
                'Подготовка текста: участники Викитеки, CC BY-SA 4.0. Удалены навигация, '
                'справочные примечания и изображения; преобразована разметка. Источник издания: '
                + re.sub(r'\s+', ' ', attribution),
            licenseUrl='https://creativecommons.org/licenses/by-sa/4.0/',
            chapters=chapters, sha256=hashlib.sha256(content.encode()).hexdigest()))
        print(key, title, len(content), len(chapters), flush=True)
    # All downloads and validation succeed before changing the live catalog.
    path = ROOT / 'catalog/starter.json'
    catalog = json.loads(path.read_text(encoding='utf-8'))
    identities = {b['id'] for b in books}
    hashes = {b['sha256'] for b in books}
    keys = {b['canonicalWork'] for b in books}
    existing = [b for b in catalog['books'] if b['id'] not in identities
                and b.get('canonicalWork') not in keys
                and b.get('sha256') not in hashes]
    catalog['books'] = existing + books
    (ROOT / 'catalog/foreign.json').write_text(json.dumps(dict(version=1, books=books), ensure_ascii=False, indent=2), encoding='utf-8')
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    print('FOREIGN DOWNLOADED', len(books), 'TOTAL', len(catalog['books']))


if __name__ == '__main__':
    main()
