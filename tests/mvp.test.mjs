import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const js = await readFile(new URL("book.js", root), "utf8");
const ai = await readFile(new URL("ai.js", root), "utf8");
const studio = await readFile(new URL("studio.js", root), "utf8");
const sw = await readFile(new URL("sw.js", root), "utf8");

function hasId(id) {
  return new RegExp(`id=["']${id}["']`).test(html);
}

test("MVP exposes a searchable manuscript UI", () => {
  for (const id of [
    "search-toggle",
    "search-panel",
    "search-input",
    "search-results",
  ]) {
    assert.ok(hasId(id), `missing #${id}`);
  }
  assert.match(
    js,
    /function\s+searchBook\s*\(/,
    "searchBook helper is missing",
  );
});

test("MVP includes library backup, restore and book export controls", () => {
  for (const id of [
    "export-book",
    "backup-library",
    "restore-library",
    "restore-file",
    "backup-encrypted",
  ]) {
    assert.ok(hasId(id), `missing #${id}`);
  }
  assert.match(
    js,
    /function\s+createBackup\s*\(/,
    "createBackup helper is missing",
  );
  assert.match(
    js,
    /function\s+restoreBackup\s*\(/,
    "restoreBackup helper is missing",
  );
  assert.match(js, /function\s+encryptBackup\s*\(/);
});

test("MVP includes live writing statistics and a persistent word goal", () => {
  for (const id of [
    "writing-stats",
    "stat-words",
    "stat-chars",
    "word-goal",
    "goal-progress",
  ]) {
    assert.ok(hasId(id), `missing #${id}`);
  }
  assert.match(js, /function\s+textStats\s*\(/, "textStats helper is missing");
});

test("MVP provides library rename and safe delete actions", () => {
  for (const id of ["rename-book", "delete-book"])
    assert.ok(hasId(id), `missing #${id}`);
  assert.match(
    js,
    /function\s+deleteBook\s*\(/,
    "deleteBook helper is missing",
  );
});

test("service worker cache version is newer than the v18 baseline", () => {
  const match = sw.match(/pergamin-shell-v(\d+)/);
  assert.ok(match, "cache version missing");
  assert.ok(Number(match[1]) > 18, "cache version must be bumped");
});

test("editor includes OAuth generation settings and eight image resize handles", () => {
  for (const id of [
    "generation-settings",
    "generation-dialog",
    "generation-client-id",
    "generation-redirect",
    "fig-resize",
  ]) {
    assert.ok(hasId(id), `missing #${id}`);
  }
  assert.equal((html.match(/data-resize=/g) || []).length, 8);
  for (const family of ["Literata", "Lora", "Vollkorn"])
    assert.match(html, new RegExp(family));
  assert.match(js, /dataset\.layout\s*=\s*['"]free['"]/);
  assert.match(ai, /\.well-known\/oauth-authorization-server/);
  assert.match(ai, /code_challenge_method:'S256'/);
  assert.match(ai, /scope:'usage'/);
});

test("studio adds versions, navigation, notes, media tools and publication exports", () => {
  for (const id of [
    "studio-panel",
    "studio-outline",
    "studio-notes",
    "studio-versions",
    "image-upload",
    "crop-dialog",
    "print-dialog",
    "export-epub",
    "export-docx",
    "spell-language",
    "focus-toggle",
    "track-toggle",
    "track-accept",
    "track-reject",
  ]) {
    assert.ok(hasId(id), `missing #${id}`);
  }
  assert.match(html, /src="studio\.js"/);
  assert.match(studio, /function\s+createSnapshot\s*\(/);
  assert.match(studio, /function\s+exportEpubBlob\s*\(/);
  assert.match(studio, /function\s+exportDocxBlob\s*\(/);
  assert.match(studio, /function\s+openCrop\s*\(/);
});

test("print wizard opens a usable window and EPUB follows the book language", () => {
  assert.match(studio, /window\.open\(url, "_blank"\)/);
  assert.doesNotMatch(studio, /window\.open\(url, "_blank", "noopener"\)/);
  assert.match(studio, /esc\(book\.spellLanguage \|\| "ru"\)/);
});
