"""Reproducible small public-domain selection. Requires beautifulsoup4, curl.
Only original literary text is retained, without modern editorial notes or images.
Generated catalog is committed; this script is not run on client startup.
"""
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
BELKIN = 'Повести покойного Ивана Петровича Белкина (Пушкин)/'
WORKS = [
    ('Метель', 'Александр Пушкин', 'Пушкин', 1837, 'classic', BELKIN+'Метель'),
    ('Выстрел', 'Александр Пушкин', 'Пушкин', 1837, 'classic', BELKIN+'Выстрел'),
    ('Гробовщик', 'Александр Пушкин', 'Пушкин', 1837, 'fantasy', BELKIN+'Гробовщик'),
    ('Станционный смотритель', 'Александр Пушкин', 'Пушкин', 1837, 'classic', BELKIN+'Станционный смотритель'),
    ('Барышня-крестьянка', 'Александр Пушкин', 'Пушкин', 1837, 'classic', BELKIN+'Барышня-крестьянка'),
    ('Пиковая дама', 'Александр Пушкин', 'Пушкин', 1837, 'fantasy', 'Пиковая дама (Пушкин)'),
    ('Сказка о рыбаке и рыбке', 'Александр Пушкин', 'Пушкин', 1837, 'children', 'Сказка о рыбаке и рыбке (Пушкин)'),
    ('Сказка о царе Салтане', 'Александр Пушкин', 'Пушкин', 1837, 'children', 'Сказка о царе Салтане (Пушкин)'),
    ('Сказка о золотом петушке', 'Александр Пушкин', 'Пушкин', 1837, 'children', 'Сказка о золотом петушке (Пушкин)'),
    ('Сказка о мёртвой царевне и о семи богатырях', 'Александр Пушкин', 'Пушкин', 1837, 'children', 'Сказка о мёртвой царевне и о семи богатырях (Пушкин)'),
    ('Каштанка', 'Антон Чехов', 'Чехов', 1904, 'classic', 'Каштанка (Чехов)'),
    ('Хамелеон', 'Антон Чехов', 'Чехов', 1904, 'classic', 'Хамелеон (Чехов)'),
    ('Толстый и тонкий', 'Антон Чехов', 'Чехов', 1904, 'classic', 'Толстый и тонкий (Чехов)/ПСС 1903 (ВТ)'),
    ('Ванька', 'Антон Чехов', 'Чехов', 1904, 'classic', 'Ванька (Чехов, 1886)'),
    ('Нос', 'Николай Гоголь', 'Гоголь', 1852, 'fantasy', 'Нос (Гоголь)'),
    ('Шинель', 'Николай Гоголь', 'Гоголь', 1852, 'classic', 'Шинель (Гоголь)/ПСС 1938 (СО)'),
    ('Вий', 'Николай Гоголь', 'Гоголь', 1852, 'fantasy', 'Вий (Гоголь)'),
    ('Кавказский пленник', 'Лев Толстой', 'Толстой', 1910, 'history', 'Кавказский пленник (Толстой)'),
    ('После бала', 'Лев Толстой', 'Толстой', 1910, 'history', 'После бала (Толстой)'),
    ('Бородино', 'Михаил Лермонтов', 'Лермонтов', 1841, 'poetry', 'Бородино (Лермонтов)/Соч. в 6 т. 1954 (СО)'),
    ('Мцыри', 'Михаил Лермонтов', 'Лермонтов', 1841, 'poetry', 'Мцыри (Лермонтов)'),
    ('Медный всадник', 'Александр Пушкин', 'Пушкин', 1837, 'poetry', 'Медный всадник (Пушкин)'),
]

def fetch(page):
    cache = ROOT / '.catalog-cache'
    cache.mkdir(exist_ok=True)
    cached = cache / (hashlib.sha256(page.encode()).hexdigest()+'.json')
    if cached.exists():
        return json.loads(cached.read_text(encoding='utf-8'))
    url = 'https://ru.wikisource.org/w/api.php?' + urllib.parse.urlencode(dict(action='parse', page=page, prop='text|revid', format='json', redirects=1))
    payload = None
    for attempt in range(6):
        try:
            payload = json.loads(subprocess.check_output(['curl.exe', '-fsSL', '--retry', '2', '--max-time', '45', url]))
            break
        except subprocess.CalledProcessError as exc:
            if b'429' in (exc.output or b'') and attempt < 5:
                time.sleep(20 * (attempt + 1))
                continue
            raise
    if 'parse' not in payload:
        raise ValueError(f'{page}: {payload}')
    cached.write_text(json.dumps(payload['parse'], ensure_ascii=False), encoding='utf-8')
    time.sleep(2)
    return payload['parse']

def extract(raw):
    soup = BeautifulSoup(raw, 'html.parser')
    root = soup.select_one('.mw-parser-output')
    if not root:
        raise ValueError('No literary container')
    rights = root.get_text(' ', strip=True)
    for node in root.select('.ws-noexport, #headertemplate, .license, .licensetpl, .mw-editsection, .reference, .references, .reflist, .catlinks, .navbox, .noprint, .header, .header_notes, .linenum, .linenumright, .ifimg, .thumb, figure, figcaption, #toc, script, style, img'):
        node.decompose()
    # Remove section headings for modern notes, and everything following them.
    for heading in list(root.select('h2,h3,h4')):
        if re.search(r'Примечания|Комментарии|Ссылки|Источники|См. также|Вариант', heading.get_text()):
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
    if len(result) < 900:
        raise ValueError(f'Text too short: {len(result)}')
    return result

def main():
    output = ROOT / 'catalog'
    output.mkdir(exist_ok=True)
    books = []
    for title, author, sort_author, death, genre, page in WORKS:
        if death > 1910:
            raise ValueError('Collection limited to verified pre-1911 original authors')
        data = fetch(page)
        soup = BeautifulSoup(data['text']['*'], 'html.parser')
        if 'список редакций одного произведения' in soup.get_text():
            variants = list(dict.fromkeys(a.get('title') for a in soup.select('a') if a.get('title', '').startswith(page+'/') and 'Вариант' in a.get('title', '')))
            if not variants:
                raise ValueError('Choose edition explicitly: '+page)
            data = fetch(variants[-1])
        if page == 'Нос (Гоголь)':
            chapters = []
            for number in ['I', 'II', 'III']:
                part = fetch(page+'/Глава '+number)
                chapters.append(dict(title='Глава '+number, html=extract(part['text']['*']), source='https://ru.wikisource.org/w/index.php?oldid='+str(part['revid'])))
        else:
            chapters = [dict(title=title, html=extract(data['text']['*']))]
        content = ''.join(c['html'] for c in chapters)
        book = dict(id='ws-'+str(data['pageid']), title=title, author=author, sortAuthor=sort_author,
            authorDeath=death, genre=genre, language='ru', origin='catalog',
            description='Полный текст произведения. Орфография источника сохранена; справочный аппарат и иллюстрации не включены.',
            source='https://ru.wikisource.org/w/index.php?oldid='+str(data['revid']),
            sourceTitle=data['title'], revision=data['revid'],
            rights='Оригинальное произведение — общественное достояние. Подготовка текста: участники Викитеки, CC BY-SA 4.0. Изменения: удалены навигация, справочный аппарат и изображения; преобразована разметка.',
            licenseUrl='https://creativecommons.org/licenses/by-sa/4.0/',
            chapters=chapters,
            sha256=hashlib.sha256(content.encode()).hexdigest())
        books.append(book)
        print(title, len(content), data['revid'], flush=True)
    holmes = output / 'holmes.json'
    if holmes.exists():
        books.extend(json.loads(holmes.read_text(encoding='utf-8'))['books'])
    (output / 'starter.json').write_text(json.dumps(dict(version=1, books=books), ensure_ascii=False, indent=2), encoding='utf-8')
    print('CATALOG BUILT', len(books))

if __name__ == '__main__':
    main()
