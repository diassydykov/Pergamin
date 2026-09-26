import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const js = await readFile(new URL('book.js', root), 'utf8');
const sw = await readFile(new URL('sw.js', root), 'utf8');

function hasId(id) {
  return new RegExp(`id=["']${id}["']`).test(html);
}

test('MVP exposes a searchable manuscript UI', () => {
  for (const id of ['search-toggle', 'search-panel', 'search-input', 'search-results']) {
    assert.ok(hasId(id), `missing #${id}`);
  }
  assert.match(js, /function\s+searchBook\s*\(/, 'searchBook helper is missing');
});

test('MVP includes library backup, restore and book export controls', () => {
  for (const id of ['export-book', 'backup-library', 'restore-library', 'restore-file']) {
    assert.ok(hasId(id), `missing #${id}`);
  }
  assert.match(js, /function\s+createBackup\s*\(/, 'createBackup helper is missing');
  assert.match(js, /function\s+restoreBackup\s*\(/, 'restoreBackup helper is missing');
});

test('MVP includes live writing statistics and a persistent word goal', () => {
  for (const id of ['writing-stats', 'stat-words', 'stat-chars', 'word-goal', 'goal-progress']) {
    assert.ok(hasId(id), `missing #${id}`);
  }
  assert.match(js, /function\s+textStats\s*\(/, 'textStats helper is missing');
});

test('MVP provides library rename and safe delete actions', () => {
  for (const id of ['rename-book', 'delete-book']) assert.ok(hasId(id), `missing #${id}`);
  assert.match(js, /function\s+deleteBook\s*\(/, 'deleteBook helper is missing');
});

test('service worker cache version is newer than the v18 baseline', () => {
  const match = sw.match(/pergamin-shell-v(\d+)/);
  assert.ok(match, 'cache version missing');
  assert.ok(Number(match[1]) > 18, 'cache version must be bumped');
});
