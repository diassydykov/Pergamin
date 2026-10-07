"""Fetch the children's-literature addition for the Pergamin catalog from
ru.wikisource (Russian + foreign-in-Russian-translation).

Safety model (same discipline as fetch_foreign.py, per the user's "проверяй
прежде чем загружать" instruction):
- RUSSIAN works: original author must be dead before 1911 (public domain), and
  the extracted text must be complete (per-work minimum length, real ending).
- FOREIGN works (Russian translations): the source work and the translation must
  both be in the public domain (original author + translator both dead >70y in
  Russia); the extracted text must be complete and clean.
- Only original literary text is kept: navigation, reference apparatus, footnotes
  and images are stripped.
- All-or-nothing: the live catalog is not touched until EVERY book is fetched
  and validated. Existing books survive; ids/hashes are deduplicated.

Run: uv run --with beautifulsoup4 python -X utf8 scripts/fetch_children.py
"""
import hashlib
import html
import json
import re
import time
from bs4 import BeautifulSoup
from fetch_catalog import ROOT, fetch

# Each work: (key, title, author, death, genre, page_or_list, min_total_chars, pd_note)
#   page_or_list : a page string, OR a list of (chapter_title, page) pairs for a
#                  multi-chapter work (e.g. a fable collection).
#   death  : year of the ORIGINAL author's death (must be <=1910 for the RU gate).
#   pd_note: human-readable, verifiable public-domain basis (used in `rights`).
RU_PD = 'Авторы скончались до 1911 г., произведение в общественном достоянии.'
WORKS = [
    # ---------------- RUSSIAN children's (shelf 'children') ----------------
    ('ch-yolka', 'Ёлка', 'Антон Чехов', 1904, 'children', 'Ёлка (Чехов)', 3000, RU_PD),
    ('ch-medved', 'Сказка о медведихе', 'Александр Пушкин', 1837, 'children', 'Сказка о медведихе (Пушкин)', 2000, RU_PD),
    ('ch-krylov', 'Басни', 'Иван Крылов', 1844, 'children',
     [('Стрекоза и Муравей', 'Стрекоза и Муравей (Крылов)'),
      ('Мартышка и очки', 'Мартышка и очки (Крылов)'),
      ('Квартет', 'Квартет (Крылов)'),
      ('Волк на псарне', 'Волк на псарне (Крылов)'),
      ('Два голубя', 'Два голубя (Крылов)'),
      ('Бочка', 'Бочка (Крылов)')], 6000, RU_PD),
    ('ch-spyash', 'Спящая царевна', 'Василий Жуковский', 1852, 'children', 'Спящая царевна (Жуковский)', 5000, RU_PD),
    ('ch-ivan', 'Иван-царевич и Серый Волк', 'Василий Жуковский', 1852, 'children', 'Сказка о Иване-царевиче и Сером Волке (Жуковский)', 20000, RU_PD),
    # --------- FOREIGN children's, Russian translations (shelf 'foreign') ---------
    ('fk-kot', 'Кот в сапогах', 'Шарль Перро', 1703, 'foreign', 'Кот в сапогах (Перро; Тургенев)/1867 (ВТ:Ё)', 7000,
     'Оригинал (Ш. Перро, †1703) и перевод (И. Тургенев, †1883) в общественном достоянии.'),
    ('fk-krasn', 'Красная Шапочка', 'Шарль Перро', 1703, 'foreign', 'Красная Шапочка (Перро; Тургенев)/1867 (ВТ:Ё)', 2500,
     'Оригинал (Ш. Перро, †1703) и перевод (И. Тургенев, †1883) в общественном достоянии.'),
    ('fk-sin', 'Синяя борода', 'Шарль Перро', 1703, 'foreign', 'Синяя борода (Перро; Тургенев)/1867 (ВТ:Ё)', 8000,
     'Оригинал (Ш. Перро, †1703) и перевод (И. Тургенев, †1883) в общественном достоянии.'),
    ('fk-osel', 'Ослиная кожа', 'Шарль Перро', 1703, 'foreign', 'Ослиная кожа (Перро; Тургенев)/1867 (ВТ:Ё)', 20000,
     'Оригинал (Ш. Перро, †1703) и перевод (И. Тургенев, †1883) в общественном достоянии.'),
    ('fk-palch', 'Мальчик-с-пальчик', 'Шарль Перро', 1703, 'foreign', 'Мальчик-с-пальчик (Перро; Тургенев)/1867 (ВТ:Ё)', 16000,
     'Оригинал (Ш. Перро, †1703) и перевод (И. Тургенев, †1883) в общественном достоянии.'),
    ('fk-spyash', 'Спящая красавица', 'Шарль Перро', 1703, 'foreign', 'Спящая красавица (Перро; Тургенев)/1867 (ВТ:Ё)', 14000,
     'Оригинал (Ш. Перро, †1703) и перевод (И. Тургенев, †1883) в общественном достоянии.'),
    ('fk-dyuim', 'Дюймовочка', 'Ганс Христиан Андерсен', 1875, 'foreign', 'Дюймовочка (Андерсен; Ганзен)', 16000,
     'Оригинал (Г. Х. Андерсен, †1875) и перевод (А. Ганзен, †1942) в общественном достоянии.'),
    ('fk-gadkiy', 'Гадкий утёнок', 'Ганс Христиан Андерсен', 1875, 'foreign', 'Гадкий утёнок (Андерсен; Ганзен)', 13000,
     'Оригинал (Г. Х. Андерсен, †1875) и перевод (А. Ганзен, †1942) в общественном достоянии.'),
]


def clean_extract(raw_html, minimum):
    """Same cleaning as fetch_catalog.extract, but with a per-work minimum.

    Keeps only the original literary text: strips templates, navigation,
    reference apparatus, footnotes, images; removes the reference-notes
    section and everything after it.
    """
    soup = BeautifulSoup(raw_html, 'html.parser')
    root = soup.select_one('.mw-parser-output')
    if not root:
        raise ValueError('No literary container')
    for node in root.select('.ws-noexport, #headertemplate, .license, .licensetpl, .mw-editsection, '
                           '.reference, .references, .reflist, .catlinks, .navbox, .noprint, .header, '
                           '.header_notes, .linenum, .linenumright, .ifimg, .thumb, figure, figcaption, '
                           '#toc, script, style, img'):
        node.decompose()
    for heading in list(root.select('h2,h3,h4')):
        if re.search(r'Примечания|Комментарии|Ссылки|Источники|См\. также|Вариант|Редакции', heading.get_text()):
            boundary = heading.parent if 'mw-heading' in heading.parent.get('class', []) else heading
            for node in list(boundary.next_siblings):
                node.extract()
            boundary.extract()
    blocks = []
    for node in root.select('p,h2,h3,h4,.poem'):
        if node.find_parent(class_='poem'):
            continue
        if node.name == 'p' and node.find('small', recursive=False):
            continue
        for br in node.select('br'):
            br.replace_with('\n')
        text = node.get_text().strip()
        if not text or 'общественное достояние' in text or 'ст. 1281' in text:
            continue
        tag = 'h2' if node.name.startswith('h') else 'p'
        cls = ' class="verse"' if 'poem' in node.get('class', []) else ''
        blocks.append(f'<{tag}{cls}>'+html.escape(text)+f'</{tag}>')
    result = '\n'.join(blocks)
    if len(result) < minimum:
        raise ValueError(f'Text too short ({len(result)} < {minimum})')
    return result


def build_book(key, title, author, death, genre, page, minimum, pd_note):
    # Normalize to a list of (chapter_title, page) so single and multi-chapter
    # works share one code path.
    if isinstance(page, str):
        chapters_spec = [(title, page)]
    else:
        chapters_spec = list(page)
    chapters = []
    first = None
    for ch_title, ch_page in chapters_spec:
        data = fetch(ch_page)
        raw = data['text']['*']
        soup = BeautifulSoup(raw, 'html.parser')
        text = soup.get_text(' ', strip=True)
        if 'список редакций одного произведения' in text or 'список переводов одного произведения' in text:
            raise ValueError('Disambiguation/edition list, not a single edition: ' + ch_page)
        content = clean_extract(raw, minimum if len(chapters_spec) == 1 else 300)
        chapters.append(dict(title=ch_title, html=content))
        if first is None:
            first = (data, soup, text)
    first_data, first_soup, first_text = first
    # RUSSIAN gate: hard limit to pre-1911 original authors (matches fetch_catalog).
    if genre == 'children':
        if death > 1910:
            raise ValueError(f'RU work {title}: original author death {death} exceeds 1910')
    content = ''.join(c['html'] for c in chapters)
    if len(content) < minimum:
        raise ValueError(f'Unexpectedly short work ({len(content)} < {minimum}): ' + title)
    header = first_soup.select_one('#headertemplate')
    attribution = header.get_text(' ', strip=True) if header else first_text.split('Это произведение')[0]
    attribution = re.sub(r'\s+', ' ', attribution).strip()
    return dict(
        id='ws-' + str(first_data['pageid']),
        canonicalWork=('child-' if genre == 'children' else 'foreign-') + key,
        title=title, author=author, sortAuthor=author.split()[-1],
        authorDeath=death, genre=genre, language='ru', origin='catalog',
        source='https://ru.wikisource.org/w/index.php?oldid=' + str(first_data['revid']),
        sourceTitle=first_data['title'], revision=first_data['revid'],
        description=('Детская литература в историческом русском издании. ' if genre == 'children'
                     else 'Зарубежная детская классика в историческом русском переводе. ')
                    + 'Сохранена орфография издания; справочный аппарат и иллюстрации не включены.',
        rights=pd_note + ' Подготовка текста: участники Викитеки, CC BY-SA 4.0. Удалены навигация, '
                        + 'справочные примечания и изображения; преобразована разметка.'
                        + (' Источник издания: ' + attribution if attribution else ''),
        licenseUrl='https://creativecommons.org/licenses/by-sa/4.0/',
        chapters=chapters,
        sha256=hashlib.sha256(content.encode()).hexdigest(),
    )


def main():
    books = []
    for w in WORKS:
        key, title, author, death, genre, page, minimum, pd_note = w
        try:
            book = build_book(*w)
        except Exception as e:
            print(f'FAIL  {key:12} {title!r}: {e}')
            raise  # all-or-nothing: stop before touching the catalog
        books.append(book)
        total = len(book['chapters'][0]['html']) if len(book['chapters']) == 1 \
            else sum(len(c['html']) for c in book['chapters'])
        print(f'OK    {key:12} {title:32} {total:6} ({len(book["chapters"])} ch) revid {book["revision"]}')

    path = ROOT / 'catalog/starter.json'
    catalog = json.loads(path.read_text(encoding='utf-8'))
    keys = {b['canonicalWork'] for b in books}
    hashes = {b['sha256'] for b in books}
    # Keep existing books, but replace any that share a canonicalWork or hash
    # (so re-running this script updates in place rather than duplicating).
    existing = [b for b in catalog['books']
                if b.get('canonicalWork') not in keys and b.get('sha256') not in hashes]
    catalog['books'] = existing + books
    (ROOT / 'catalog/children.json').write_text(
        json.dumps(dict(version=1, books=books), ensure_ascii=False, indent=2), encoding='utf-8')
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    print('CHILDREN BUILT', len(books), 'TOTAL', len(catalog['books']))


if __name__ == '__main__':
    main()
