"""Fetch verified Kazakh-national literature (Kazakh language) for the
Pergamin catalog, from the main wikisource.org host.

These are Kazakh folk epics / national tales («Қазақ халық ертегілері»).
Basis for inclusion (the user asked to "проверять прежде чем загружать"):
- Anonymous FOLK epics -> public domain by nature (no author, centuries of
  oral transmission); PD basis is stated honestly in the rights field.
- Text quality verified by inspection: complete beginning, complete ending,
  no OCR placeholders / stray-Latin / editorial markers (done 2026-10-01).
- All-or-nothing: catalog untouched until every book is fetched + validated.

Run: uv run --with beautifulsoup4 python -X utf8 scripts/fetch_kazakh.py
"""
import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from bs4 import BeautifulSoup

from fetch_catalog import ROOT

HOST = 'wikisource.org'

# key, title, source_label, page, min_content_chars
WORKS = [
    ('kz-tostik', 'Ер Төстік', 'Қазақ халық ертегісі', 'Ер Төстік', 15000),
    ('kz-samyr', 'Алып қара құс (Самұрық)', 'Қазақ халық ертегісі', 'Алып қара құс - Самұрық', 10000),
    ('kz-alpamis', 'Алты жасар Алпамыс', 'Қазақ халық ертегісі', 'Алты жасар Алпамыс', 5000),
]

PD_NOTE = ('Народный казахский эпос (Қазақ халық ертегісі) — общественное достояние: '
           'народное творчество, автор неизвестен. '
           'Подготовка текста: участники Викитеки, CC BY-SA 4.0. Удалены навигация, '
           'справочные примечания и изображения; преобразована разметка.')


def fetch_page(page, tries=12):
    url = f'https://{HOST}/w/api.php?' + urllib.parse.urlencode(dict(
        action='parse', page=page, prop='text|revid|title|pageid', format='json', redirects=1))
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (pergamin-catalog-fetch)'})
    for a in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.loads(r.read().decode('utf-8'))
            par = d.get('parse')
            if not par:
                raise ValueError('No parse: ' + page)
            return par
        except urllib.error.HTTPError as e:
            if e.code == 429 and a < tries - 1:
                time.sleep(20 * (a + 1)); continue
            raise


def clean_extract(raw_html, minimum):
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
        if re.search(r'Ескертпе|Түсіндірме|Сілтемелер|Дереккөздер|Тағы қара|Нұсқалар|Пайдаланылған', heading.get_text()):
            boundary = heading.parent if 'mw-heading' in heading.parent.get('class', []) else heading
            for node in list(boundary.next_siblings):
                node.extract()
            boundary.extract()
    blocks = []
    for node in root.select('p,h2,h3,h4,.poem,li'):
        if node.find_parent(class_='poem'):
            continue
        for br in node.select('br'):
            br.replace_with('\n')
        text = node.get_text().strip()
        if not text or 'public domain' in text.lower() or 'құқығы' in text:
            continue
        tag = 'h2' if node.name.startswith('h') else ('li' if node.name == 'li' else 'p')
        cls = ' class="verse"' if 'poem' in node.get('class', []) else ''
        blocks.append(f'<{tag}{cls}>' + html.escape(text) + f'</{tag}>')
    result = '\n'.join(blocks)
    if len(result) < minimum:
        raise ValueError(f'Text too short ({len(result)} < {minimum})')
    return result


def build_book(key, title, label, page, minimum):
    data = fetch_page(page)
    raw = data['text']['*']
    content = clean_extract(raw, minimum)
    plain = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', content)).strip()
    # Quality gates (the user's "проверяй прежде чем загружать" requirement).
    # Run on the RAW text (before html.escape) so that quote entities don't false-positive.
    if len(plain) < minimum:
        raise ValueError(f'Cleaned plain text too short: {len(plain)}')
    stray = re.findall(r'[A-Za-zÀ-ÿ]{4,}', plain)  # Latin words >=4 -> OCR/foreign garbage
    allow = {'http', 'https', 'www', 'wiki', 'wikisource', 'quot', 'amp', 'nbsp', 'lt', 'gt'}
    stray = [s for s in stray if s.lower() not in allow]
    if stray:
        raise ValueError(f'Stray-Latin (possible OCR errors): {stray[:10]}')
    for marker in ('[edit]', '[ править ]', 'Примечание', 'См. также', '{{', '}}', '[[', ']]'):
        if marker in plain:
            raise ValueError(f'Editorial/placeholder marker present: {marker!r}')
    return dict(
        id='ws-' + str(data['pageid']),
        canonicalWork='kaz-' + key,
        title=title, author='Қазақ халық ертегісі', sortAuthor='Қазақ',
        authorDeath=1, genre='children', language='kk', origin='catalog',
        source='https://wikisource.org/w/index.php?oldid=' + str(data['revid']),
        sourceTitle=data['title'], revision=data['revid'],
        description=('Қазақ халық ертегісі (народный казахский эпос) на казахском языке. '
                     'Название в источнике: ' + data['title'] + '.'),
        rights=PD_NOTE + ' Источник издания: ' + label + '.',
        licenseUrl='https://creativecommons.org/licenses/by-sa/4.0/',
        chapters=[dict(title=title, html=content)],
        sha256=hashlib.sha256(content.encode()).hexdigest(),
    )


def main():
    books = []
    for w in WORKS:
        key, title, label, page, minimum = w
        try:
            book = build_book(*w)
        except Exception as e:
            print(f'FAIL  {key:12} {title!r}: {e}')
            raise  # all-or-nothing
        books.append(book)
        plain = re.sub(r'<[^>]+>', '', book['chapters'][0]['html'])
        print(f'OK    {key:12} {title:28} {len(plain):6} revid {book["revision"]}')

    path = ROOT / 'catalog/starter.json'
    catalog = json.loads(path.read_text(encoding='utf-8'))
    identities = {b['id'] for b in books}
    hashes = {b['sha256'] for b in books}
    keys = {b['canonicalWork'] for b in books}
    existing = [b for b in catalog['books'] if b['id'] not in identities
                and b.get('canonicalWork') not in keys and b.get('sha256') not in hashes]
    catalog['books'] = existing + books
    (ROOT / 'catalog/kazakh.json').write_text(
        json.dumps(dict(version=1, books=books), ensure_ascii=False, indent=2), encoding='utf-8')
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    print('KAZAKH BUILT', len(books), 'TOTAL', len(catalog['books']))


if __name__ == '__main__':
    main()
