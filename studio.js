/** Pergamin Studio — versions, outline, notes, media tools and publication export. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const ms = $("ms");
  let pg = null,
    studioDb = null,
    activeTab = "outline",
    noteExcerpt = "",
    noteAnchor = null,
    cropFigure = null;
  let autoTimer = null,
    lastAutoAt = 0;

  function toast(message) {
    try {
      pg?.toast(message);
    } catch (e) {}
  }
  function uuid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(36).slice(2);
  }
  function activeBook() {
    return pg?.getBook(pg.currentBookId());
  }
  function saveBlob(name, blob) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function safeName(value) {
    return (
      String(value || "book")
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
        .replace(/[. ]+$/, "")
        .slice(0, 80) || "book"
    );
  }
  function esc(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function commitEditor() {
    ms.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertReplacementText",
      }),
    );
  }

  function openStudioDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("pergamin-studio", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("snapshots")) {
          const s = db.createObjectStore("snapshots", { keyPath: "id" });
          s.createIndex("bookId", "bookId");
          s.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function storeRequest(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = studioDb.transaction("snapshots", mode),
        store = tx.objectStore("snapshots");
      let result;
      try {
        result = action(store);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error("Ошибка хранилища версий"));
    });
  }
  async function snapshotsFor(bookId) {
    if (!studioDb) return [];
    return new Promise((resolve, reject) => {
      const req = studioDb
        .transaction("snapshots")
        .objectStore("snapshots")
        .index("bookId")
        .getAll(bookId);
      req.onsuccess = () =>
        resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => reject(req.error);
    });
  }
  async function createSnapshot(reason = "manual", quiet = false) {
    const book = activeBook();
    if (!book || !studioDb) return null;
    await window.__pgMvp__?.flush?.();
    const fresh = activeBook(),
      existing = await snapshotsFor(fresh.id),
      latest = existing[0];
    const snapshotState = (book) =>
      JSON.stringify({
        title: book.title,
        content: book.content,
        font: book.font,
        fsize: book.fsize,
        headingFont: book.headingFont,
        headingStyle: book.headingStyle,
        paper: book.paper,
        illusStyle: book.illusStyle,
        illusHistory: book.illusHistory,
        wordGoal: book.wordGoal,
        spellLanguage: book.spellLanguage,
        notes: book.notes,
      });
    if (
      latest &&
      snapshotState(latest.book) === snapshotState(fresh) &&
      reason !== "manual"
    ) {
      lastAutoAt = Date.now();
      return latest;
    }
    const snapshot = {
      id: uuid(),
      bookId: fresh.id,
      createdAt: Date.now(),
      reason,
      book: structuredClone(fresh),
    };
    await storeRequest("readwrite", (store) => store.put(snapshot));
    const all = await snapshotsFor(fresh.id);
    for (const old of all.slice(50))
      await storeRequest("readwrite", (store) => store.delete(old.id));
    lastAutoAt = Date.now();
    if (!quiet) toast("Версия книги сохранена");
    if (activeTab === "versions") renderVersions();
    return snapshot;
  }
  async function restoreSnapshot(id) {
    const rows = await snapshotsFor(pg.currentBookId()),
      snap = rows.find((x) => x.id === id);
    if (!snap) return;
    if (
      !confirm(
        "Восстановить эту версию? Перед восстановлением будет создан снимок текущего текста.",
      )
    )
      return;
    await createSnapshot("before-restore", true);
    const patch = structuredClone(snap.book);
    delete patch.id;
    await pg.updateBook(snap.bookId, patch);
    toast("Версия восстановлена");
    renderAll();
  }
  async function deleteSnapshot(id) {
    if (!confirm("Удалить эту версию без возможности восстановления?")) return;
    await storeRequest("readwrite", (store) => store.delete(id));
    renderVersions();
  }
  function autoInterval() {
    let n = 5;
    try {
      n = Number(localStorage.getItem("pg.snapshot.minutes")) || 5;
    } catch (e) {}
    return Math.max(1, Math.min(60, n));
  }
  function scheduleSnapshots() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => {
      if (Date.now() - lastAutoAt >= autoInterval() * 60000)
        createSnapshot("auto", true).catch(console.error);
    }, 30000);
  }

  function setStudio(open, tab = activeTab) {
    const panel = $("studio-panel");
    panel.hidden = !open;
    $("studio-toggle").setAttribute("aria-expanded", String(open));
    if (open) {
      setTab(tab);
      renderAll();
    }
  }
  function setTab(tab) {
    activeTab = tab;
    for (const b of document.querySelectorAll("[data-studio-tab]"))
      b.setAttribute("aria-selected", String(b.dataset.studioTab === tab));
    for (const pane of document.querySelectorAll(".studio-pane"))
      pane.hidden = pane.id !== "studio-" + tab;
    const names = {
      outline: "Структура книги",
      notes: "Редакторские заметки",
      versions: "История версий",
    };
    $("studio-panel-title").textContent = names[tab] || "Навигатор";
    if (tab === "outline") renderOutline();
    else if (tab === "notes") renderNotes();
    else renderVersions();
  }
  function renderOutline() {
    const host = $("studio-outline"),
      heads = Array.from(ms.querySelectorAll("h1,h2,h3"));
    host.replaceChildren();
    if (!heads.length) {
      const empty = document.createElement("p");
      empty.className = "studio-empty";
      empty.textContent =
        "Добавьте заголовки «Глава» или «Подзаголовок» — они появятся здесь.";
      host.append(empty);
      return;
    }
    heads.forEach((heading, index) => {
      const b = document.createElement("button");
      b.className = "outline-item level-" + heading.tagName.toLowerCase();
      b.textContent = heading.textContent.trim() || "Без названия";
      b.addEventListener("click", () => {
        heading.scrollIntoView({ block: "center", behavior: "smooth" });
        const r = document.createRange();
        r.selectNodeContents(heading);
        r.collapse(false);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        ms.focus();
      });
      host.append(b);
    });
  }
  function textRange(needle) {
    if (!needle) return null;
    const walker = document.createTreeWalker(ms, NodeFilter.SHOW_TEXT),
      nodes = [];
    let text = "",
      node;
    while ((node = walker.nextNode())) {
      nodes.push({
        node,
        start: text.length,
        end: text.length + node.data.length,
      });
      text += node.data;
    }
    const at = text.indexOf(needle);
    if (at < 0) return null;
    const end = at + needle.length,
      startNode = nodes.find((x) => at >= x.start && at <= x.end),
      endNode =
        nodes.find((x) => end >= x.start && end <= x.end) || nodes.at(-1);
    if (!startNode || !endNode) return null;
    const r = document.createRange();
    r.setStart(
      startNode.node,
      Math.min(startNode.node.length, at - startNode.start),
    );
    r.setEnd(endNode.node, Math.min(endNode.node.length, end - endNode.start));
    return r;
  }
  function textIndexRange(range) {
    const walker = document.createTreeWalker(ms, NodeFilter.SHOW_TEXT);
    let index = 0,
      start = -1,
      end = -1,
      node;
    while ((node = walker.nextNode())) {
      if (node === range.startContainer) start = index + range.startOffset;
      if (node === range.endContainer) {
        end = index + range.endOffset;
        break;
      }
      index += node.data.length;
    }
    if (start < 0 || end < start) return null;
    const text = ms.textContent || "";
    return {
      start,
      before: text.slice(Math.max(0, start - 80), start),
      after: text.slice(end, Math.min(text.length, end + 80)),
    };
  }
  function noteRange(note) {
    let r = textRange(note.excerpt);
    if (r || !note.anchor) return r;
    const text = ms.textContent || "",
      at = Math.max(0, Math.min(text.length, Number(note.anchor.start) || 0)),
      before = String(note.anchor.before || "").slice(-40),
      after = String(note.anchor.after || "").slice(0, 40);
    const left = before ? text.indexOf(before) : -1,
      right = after ? text.indexOf(after, Math.max(0, left)) : -1;
    if (left >= 0 && right > left) {
      const guess = text.slice(left + before.length, right).trim();
      if (guess) r = textRange(guess);
    }
    if (!r && note.excerpt) {
      const words = note.excerpt.split(/\s+/).filter((x) => x.length > 3);
      for (const word of words.slice(0, 5)) {
        const i = text.indexOf(word, Math.max(0, at - 240));
        if (i >= 0 && i < at + 240) {
          r = textRange(word);
          break;
        }
      }
    }
    return r;
  }
  function jumpToNote(note) {
    const r = noteRange(note);
    if (!r) {
      toast("Фрагмент заметки больше не найден");
      return;
    }
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    r.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    ms.focus();
  }
  function jumpToExcerpt(excerpt) {
    const r = textRange(excerpt);
    if (!r) {
      toast("Фрагмент заметки больше не найден");
      return;
    }
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    r.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    ms.focus();
  }
  function renderNotes() {
    const host = $("studio-notes"),
      book = activeBook(),
      notes = book?.notes || [];
    host.replaceChildren();
    const add = document.createElement("button");
    add.className = "studio-primary";
    add.textContent = "＋ Заметка к выделению";
    add.onclick = openNoteDialog;
    host.append(add);
    if (!notes.length) {
      const empty = document.createElement("p");
      empty.className = "studio-empty";
      empty.textContent =
        "Заметок пока нет. Выделите текст и добавьте редакторский комментарий.";
      host.append(empty);
      return;
    }
    for (const note of [...notes].reverse()) {
      const card = document.createElement("article");
      card.className = "note-card" + (note.resolved ? " resolved" : "");
      const quote = document.createElement("button");
      quote.className = "note-quote";
      quote.textContent = "“" + note.excerpt + "”";
      quote.onclick = () => jumpToNote(note);
      const body = document.createElement("p");
      body.textContent = note.text;
      const meta = document.createElement("small");
      meta.textContent = new Date(note.createdAt).toLocaleString("ru-RU");
      const actions = document.createElement("div");
      actions.className = "note-actions";
      const done = document.createElement("button");
      done.textContent = note.resolved ? "Вернуть" : "Готово";
      done.onclick = () => updateNote(note.id, { resolved: !note.resolved });
      const del = document.createElement("button");
      del.textContent = "Удалить";
      del.onclick = () => deleteNote(note.id);
      actions.append(done, del);
      card.append(quote, body, meta, actions);
      host.append(card);
    }
  }
  function openNoteDialog() {
    const r = getSelection();
    noteExcerpt =
      r && r.rangeCount && ms.contains(r.getRangeAt(0).commonAncestorContainer)
        ? r.toString().trim()
        : "";
    noteAnchor =
      r && r.rangeCount && ms.contains(r.getRangeAt(0).commonAncestorContainer)
        ? textIndexRange(r.getRangeAt(0))
        : null;
    if (!noteExcerpt) {
      toast("Сначала выделите фрагмент текста");
      return;
    }
    noteExcerpt = noteExcerpt.slice(0, 500);
    $("note-excerpt").textContent = noteExcerpt;
    $("note-text").value = "";
    $("note-dialog").showModal();
    $("note-text").focus();
  }
  async function updateNote(id, patch) {
    const b = activeBook();
    if (!b) return;
    await pg.updateBook(b.id, {
      notes: b.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    });
    renderNotes();
  }
  async function deleteNote(id) {
    const b = activeBook();
    if (!b || !confirm("Удалить заметку?")) return;
    await pg.updateBook(b.id, { notes: b.notes.filter((n) => n.id !== id) });
    renderNotes();
  }
  async function renderVersions() {
    const host = $("studio-versions");
    host.replaceChildren();
    const controls = document.createElement("div");
    controls.className = "version-controls";
    controls.innerHTML =
      '<label>Автоснимок каждые <select id="snapshot-interval"><option value="1">1 мин</option><option value="5">5 мин</option><option value="15">15 мин</option><option value="30">30 мин</option><option value="60">60 мин</option></select></label><button id="version-create">Создать сейчас</button>';
    host.append(controls);
    controls.querySelector("select").value = String(autoInterval());
    controls.querySelector("select").onchange = (e) => {
      try {
        localStorage.setItem("pg.snapshot.minutes", e.target.value);
      } catch (err) {}
      scheduleSnapshots();
    };
    controls.querySelector("button").onclick = () => createSnapshot("manual");
    const book = activeBook();
    if (!book) return;
    const rows = await snapshotsFor(book.id);
    if (!rows.length) {
      const p = document.createElement("p");
      p.className = "studio-empty";
      p.textContent =
        "Версий пока нет. Автоснимки создаются только во время работы приложения.";
      host.append(p);
      return;
    }
    for (const row of rows) {
      const card = document.createElement("article");
      card.className = "version-card";
      const date = document.createElement("strong");
      date.textContent = new Date(row.createdAt).toLocaleString("ru-RU");
      const info = document.createElement("small");
      info.textContent =
        (row.reason === "auto"
          ? "Автоматически"
          : row.reason === "before-restore"
            ? "Перед восстановлением"
            : "Вручную") +
        " · " +
        plainText(row.book.content).split(/\s+/).filter(Boolean).length +
        " слов";
      const actions = document.createElement("div");
      actions.className = "version-actions";
      const restore = document.createElement("button");
      restore.textContent = "Восстановить";
      restore.onclick = () => restoreSnapshot(row.id);
      const del = document.createElement("button");
      del.textContent = "Удалить";
      del.onclick = () => deleteSnapshot(row.id);
      const compare = document.createElement("button");
      compare.textContent = "Сравнить";
      compare.onclick = () => window.__pgAtelier__?.compareVersion(row);
      actions.append(compare, restore, del);
      card.append(date, info, actions);
      host.append(card);
    }
  }
  function renderAll() {
    if (!$("studio-panel").hidden) setTab(activeTab);
    const b = activeBook();
    if (b) {
      $("spell-language").value = b.spellLanguage || "ru";
      ms.lang = b.spellLanguage || "ru";
    }
  }

  function plainText(html) {
    const d = document.createElement("div");
    d.innerHTML = String(html || "");
    return d.textContent || "";
  }
  function selectedFigure() {
    return ms.querySelector("figure.illus.sel");
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Изображение не читается"));
      i.src = src;
    });
  }
  async function rotateFigure(fig, clockwise) {
    const img = fig?.querySelector("img");
    if (!img) return;
    const source = await loadImage(img.src),
      canvas = document.createElement("canvas");
    canvas.width = source.naturalHeight;
    canvas.height = source.naturalWidth;
    const c = canvas.getContext("2d");
    c.translate(canvas.width / 2, canvas.height / 2);
    c.rotate(((clockwise ? 1 : -1) * Math.PI) / 2);
    c.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2);
    img.src = canvas.toDataURL("image/png");
    commitEditor();
    window.dispatchEvent(new Event("resize"));
    toast("Изображение повёрнуто");
  }
  function drawCropPreview() {
    if (!cropFigure) return;
    const img = cropFigure.querySelector("img");
    loadImage(img.src)
      .then((source) => {
        const l = +$("crop-left").value / 100,
          r = +$("crop-right").value / 100,
          t = +$("crop-top").value / 100,
          b = +$("crop-bottom").value / 100,
          w = Math.max(0.05, 1 - l - r),
          h = Math.max(0.05, 1 - t - b),
          canvas = $("crop-preview"),
          ctx = canvas.getContext("2d");
        ctx.fillStyle = "#dedad2";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(
          canvas.width / (source.naturalWidth * w),
          canvas.height / (source.naturalHeight * h),
        );
        const dw = source.naturalWidth * w * scale,
          dh = source.naturalHeight * h * scale;
        ctx.drawImage(
          source,
          source.naturalWidth * l,
          source.naturalHeight * t,
          source.naturalWidth * w,
          source.naturalHeight * h,
          (canvas.width - dw) / 2,
          (canvas.height - dh) / 2,
          dw,
          dh,
        );
      })
      .catch((e) => toast(e.message));
  }
  function openCrop(fig) {
    cropFigure = fig;
    for (const id of ["crop-left", "crop-right", "crop-top", "crop-bottom"])
      $(id).value = 0;
    $("crop-alt").value = fig.querySelector("img")?.alt || "";
    $("crop-dialog").showModal();
    drawCropPreview();
  }
  async function applyCrop() {
    const fig = cropFigure,
      img = fig?.querySelector("img");
    if (!img) return;
    const source = await loadImage(img.src),
      l = +$("crop-left").value / 100,
      r = +$("crop-right").value / 100,
      t = +$("crop-top").value / 100,
      b = +$("crop-bottom").value / 100,
      w = Math.max(0.05, 1 - l - r),
      h = Math.max(0.05, 1 - t - b),
      max = 2400,
      sw = source.naturalWidth * w,
      sh = source.naturalHeight * h,
      scale = Math.min(1, max / Math.max(sw, sh)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    canvas
      .getContext("2d")
      .drawImage(
        source,
        source.naturalWidth * l,
        source.naturalHeight * t,
        sw,
        sh,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    img.src = canvas.toDataURL("image/jpeg", 0.92);
    img.alt = $("crop-alt").value.trim() || "Иллюстрация";
    commitEditor();
    $("crop-dialog").close();
    cropFigure = null;
    window.dispatchEvent(new Event("resize"));
    toast("Кадрирование применено");
  }
  function layerFigure(fig, delta) {
    if (!fig) return;
    if (fig.dataset.layout !== "free")
      document.querySelector('#fig-tools [data-fig="free"]')?.click();
    const z = Math.max(
      1,
      Math.min(20, (parseInt(fig.style.zIndex, 10) || 4) + delta),
    );
    fig.style.zIndex = String(z);
    commitEditor();
    toast(delta > 0 ? "Изображение поднято выше" : "Изображение опущено ниже");
  }
  async function importImage(file) {
    if (!file || !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) {
      toast("Выберите PNG, JPEG, WebP, GIF или AVIF");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast("Изображение больше 20 МБ");
      return;
    }
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    await loadImage(data);
    const id = pg.currentBookId();
    pg.insertFigureAtSelection(id, {
      dataUrl: data,
      caption: file.name,
      prompt: "",
    });
    requestAnimationFrame(() => {
      const figs = ms.querySelectorAll("figure.illus");
      figs[figs.length - 1]?.focus();
    });
    toast("Изображение добавлено");
  }

  // ZIP writer (store method): enough for standards-compliant EPUB and DOCX without dependencies.
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(data) {
    let c = 0xffffffff;
    for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function u16(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255]);
  }
  function u32(n) {
    return new Uint8Array([
      n & 255,
      (n >>> 8) & 255,
      (n >>> 16) & 255,
      (n >>> 24) & 255,
    ]);
  }
  function concat(parts) {
    const size = parts.reduce((n, p) => n + p.length, 0),
      out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
  function zip(entries) {
    let offset = 0;
    const local = [],
      central = [];
    for (const entry of entries) {
      const name = enc.encode(entry.name),
        data =
          entry.data instanceof Uint8Array
            ? entry.data
            : enc.encode(entry.data),
        crc = crc32(data),
        header = concat([
          u32(0x04034b50),
          u16(20),
          u16(0x800),
          u16(0),
          u16(0),
          u16(0),
          u32(crc),
          u32(data.length),
          u32(data.length),
          u16(name.length),
          u16(0),
          name,
        ]);
      local.push(header, data);
      central.push(
        concat([
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(0x800),
          u16(0),
          u16(0),
          u16(0),
          u32(crc),
          u32(data.length),
          u32(data.length),
          u16(name.length),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
          name,
        ]),
      );
      offset += header.length + data.length;
    }
    const body = concat(local),
      dir = concat(central),
      end = concat([
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(entries.length),
        u16(entries.length),
        u32(dir.length),
        u32(body.length),
        u16(0),
      ]);
    return new Blob([body, dir, end], { type: "application/zip" });
  }
  function dataUrlBytes(src) {
    const m = String(src).match(/^data:([^;,]+);base64,(.+)$/);
    if (!m) return null;
    const raw = atob(m[2]),
      data = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
    return { mime: m[1], data };
  }
  function cleanHost(book) {
    const host = document.createElement("div");
    host.innerHTML = book.content;
    host
      .querySelectorAll("script,style,iframe,form,button,input,textarea,select")
      .forEach((x) => x.remove());
    for (const el of host.querySelectorAll("*")) {
      for (const a of [...el.attributes])
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      el.classList.remove("sel", "moving");
      el.removeAttribute("contenteditable");
      el.removeAttribute("tabindex");
    }
    host.querySelectorAll("del[data-pg-change]").forEach((x) => x.remove());
    host.querySelectorAll("ins[data-pg-change]").forEach((x) => {
      const p = x.parentNode;
      while (x.firstChild) p.insertBefore(x.firstChild, x);
      x.remove();
    });
    return host;
  }
  function outlineItems(host) {
    return [...host.querySelectorAll("h1,h2,h3")].map((h, i) => {
      const id = h.id || "toc-" + (i + 1);
      h.id = id;
      return { id, level: h.tagName === "H3" ? 2 : 1, title: h.textContent.trim() || "Раздел" };
    });
  }
  function xhtmlBody(host) {
    return host.innerHTML
      .replace(/<br>/gi, "<br />")
      .replace(/<img([^>]*?)(?<!\/)\s*>/gi, "<img$1 />");
  }
  async function exportEpubBlob(book = activeBook()) {
    const host = cleanHost(book),
      entries = [{ name: "mimetype", data: "application/epub+zip" }],
      images = [],
      manifest = [];
    const toc = outlineItems(host);
    const cover = dataUrlBytes(book.coverImage || '');
    if (cover) {
      const path = 'images/cover.' + (cover.mime === 'image/jpeg' ? 'jpg' : 'png');
      images.push({name:'OEBPS/' + path,data:cover.data});
      manifest.push('<item id="cover-image" href="' + path + '" media-type="' + esc(cover.mime) + '" properties="cover-image"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
      entries.push({name:'OEBPS/cover.xhtml',data:'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Обложка</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body><section epub:type="cover" xmlns:epub="http://www.idpf.org/2007/ops"><img src="' + path + '" alt="' + esc(book.title) + '"/></section></body></html>'});
    }
    let n = 0;
    for (const img of host.querySelectorAll("img")) {
      const parsed = dataUrlBytes(img.src);
      if (!parsed) {
        img.remove();
        continue;
      }
      n++;
      const ext = parsed.mime.includes("png")
          ? "png"
          : parsed.mime.includes("webp")
            ? "webp"
            : parsed.mime.includes("gif")
              ? "gif"
              : "jpg",
        name = "image" + n + "." + ext;
      images.push({ name: "OEBPS/images/" + name, data: parsed.data });
      manifest.push(
        '<item id="img' +
          n +
          '" href="images/' +
          name +
          '" media-type="' +
          esc(parsed.mime) +
          '"' +
          "/>",
      );
      img.setAttribute("src", "images/" + name);
    }
    for (const fig of host.querySelectorAll("figure")) {
      fig.style.position = "relative";
      fig.style.left = "";
      fig.style.top = "";
      fig.style.width = "auto";
      fig.style.maxWidth = "100%";
      fig.style.float = "none";
      fig.style.margin = "1.2em auto";
    }
    const uid = "urn:uuid:" + book.id,
      navItems = toc.length
        ? toc
            .map(
              (item) =>
                '<li><a href="content.xhtml#' +
                esc(item.id) +
                '">' +
                esc(item.title) +
                "</a></li>",
            )
            .join("")
        : '<li><a href="content.xhtml">' + esc(book.title) + "</a></li>",
      content =
        '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="' +
        esc(book.spellLanguage || "ru") +
        '"><head><title>' +
        esc(book.title) +
        '</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body><h1>' +
        esc(book.title) +
        "</h1>" +
        xhtmlBody(host) +
        "</body></html>";
    entries.push(
      {
        name: "META-INF/container.xml",
        data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      },
      { name: "OEBPS/content.xhtml", data: content },
      {
        name: "OEBPS/nav.xhtml",
        data:
          '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Навигация</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="content.xhtml">' +
          esc(book.title) +
          "</a></li>" +
          navItems +
          "</ol></nav></body></html>",
      },
      {
        name: "OEBPS/styles.css",
        data: "body{font-family:serif;line-height:1.6;margin:5%}h1,h2,h3{text-align:center}img{max-width:100%;height:auto}figure{page-break-inside:avoid}",
      },
      {
        name: "OEBPS/content.opf",
        data:
          '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">' +
          esc(uid) +
          "</dc:identifier><dc:title>" +
          esc(book.title) +
          "</dc:title><dc:language>" +
          (book.spellLanguage || "ru") +
          "</dc:language><dc:creator>" +
          esc(book.byline || "") +
          '</dc:creator><meta property="dcterms:modified">' +
          new Date().toISOString().replace(/\.\d{3}Z$/, "Z") +
          '</meta></metadata><manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="styles.css" media-type="text/css"/>' +
          manifest.join("") +
          '</manifest><spine>' + (cover ? '<itemref idref="cover"/>' : '') + '<itemref idref="content"/></spine></package>',
      },
      ...images,
    );
    return zip(entries);
  }
  function imageToPng(src) {
    return loadImage(src).then(
      (img) =>
        new Promise((resolve) => {
          const max = 1800,
            scale = Math.min(
              1,
              max / Math.max(img.naturalWidth, img.naturalHeight),
            ),
            c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(
            async (b) => resolve(new Uint8Array(await b.arrayBuffer())),
            "image/png",
          );
        }),
    );
  }
  function docxRuns(root) {
    const walk=(node,bold=false,italic=false,underline=false)=>{
      if(node.nodeType===Node.TEXT_NODE)return '<w:r><w:rPr>'+(bold?'<w:b/>':'')+(italic?'<w:i/>':'')+(underline?'<w:u w:val="single"/>':'')+'</w:rPr><w:t xml:space="preserve">'+esc(node.data)+'</w:t></w:r>';
      if(node.nodeType!==Node.ELEMENT_NODE)return '';
      if(node.tagName==='BR')return '<w:r><w:br/></w:r>';
      return [...node.childNodes].map(c=>walk(c,bold||['B','STRONG'].includes(node.tagName)||node.style.fontWeight==='bold',italic||['I','EM'].includes(node.tagName)||node.style.fontStyle==='italic',underline||node.tagName==='U'||node.style.textDecoration.includes('underline'))).join('');
    };
    return walk(root);
  }
  async function exportDocxBlob(book = activeBook()) {
    const host = cleanHost(book),
      toc = outlineItems(host),
      media = [],
      rels = [],
      body = [];
    let imgN = 0;
    if (toc.length)
      body.push(
        '<w:p><w:r><w:t>Оглавление</w:t></w:r></w:p><w:p><w:fldSimple w:instr="TOC \\o &quot;1-2&quot; \\h \\z \\u"><w:r><w:t>Обновите поле оглавления в Word.</w:t></w:r></w:fldSimple></w:p>',
      );
    for (const node of host.children) {
      const imgs = node.matches("img")
        ? [node]
        : [...node.querySelectorAll("img")];
      if (imgs.length) {
        for (const img of imgs) {
          try {
            imgN++;
            const sourceImage=await loadImage(img.src),scale=Math.min(4572000/sourceImage.naturalWidth,6400800/sourceImage.naturalHeight),cx=Math.round(sourceImage.naturalWidth*scale),cy=Math.round(sourceImage.naturalHeight*scale);
            const data = await imageToPng(img.src),
              rid = "rId" + imgN;
            media.push({ name: "word/media/image" + imgN + ".png", data });
            rels.push(
              '<Relationship Id="' +
                rid +
                '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' +
                imgN +
                '.png"/>',
            );
            body.push(
              '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="' +
                imgN +
                '" name="Image ' +
                imgN +
                '"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' +
                imgN +
                '" name="' +
                esc(img.alt || "Illustration") +
                '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' +
                rid +
                '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
            );
          } catch (e) {}
        }
        continue;
      }
      const text = node.textContent.trim();
      if (!text) continue;
      const style = /^H[12]$/.test(node.tagName)
        ? '<w:pStyle w:val="Heading1"/>'
        : node.tagName === "H3"
          ? '<w:pStyle w:val="Heading2"/>'
          : "";
      body.push(
        "<w:p><w:pPr>" +
          style +
          (['left','center','right','justify'].includes(node.style.textAlign)?'<w:jc w:val="'+(node.style.textAlign==='justify'?'both':node.style.textAlign)+'"/>':'') +
          '</w:pPr>' + docxRuns(node) + '</w:p>',
      );
    }
    const ns =
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    const entries = [
      {
        name: "[Content_Types].xml",
        data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      },
      {
        name: "_rels/.rels",
        data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      },
      {
        name: "docProps/core.xml",
        data:
          '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' +
          esc(book.title) +
          "</dc:title><dc:creator>" +
          esc(book.byline || "") +
          "</dc:creator><cp:lastModifiedBy>Pergamin</cp:lastModifiedBy><dcterms:modified xsi:type=\"dcterms:W3CDTF\">" +
          new Date().toISOString().replace(/\.\d{3}Z$/, "Z") +
          "</dcterms:modified></cp:coreProperties>",
      },
      {
        name: "word/document.xml",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' +
          ns +
          '><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>' +
          esc(book.title) +
          "</w:t></w:r></w:p>" +
          (book.byline ? '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>'+esc(book.byline)+'</w:t></w:r></w:p>' : '') +
          body.join("") +
          '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>',
      },
      {
        name: "word/styles.xml",
        data: '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>',
      },
      {
        name: "word/_rels/document.xml.rels",
        data:
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          rels.join("") +
          "</Relationships>",
      },
      ...media,
    ];
    return zip(entries);
  }
  function openPrint(book, settings) {
    const host = cleanHost(book);
    for (const fig of host.querySelectorAll("figure")) {
      fig.style.position = "relative";
      fig.style.left = "";
      fig.style.top = "";
      fig.style.float = "none";
      fig.style.margin = "1em auto";
      fig.style.maxWidth = "100%";
    }
    const title = settings.title ? '<section class="title-page"><h1>' + esc(book.title) + '</h1><p>' + esc(book.subtitle||'') + '</p><p>' + esc(book.byline||'') + '</p></section>' : '',
      cover = settings.cover && book.coverImage ? '<section class="cover-page"><img src="' + esc(book.coverImage) + '" alt="Обложка"/></section>' : '',
      toc = settings.toc ? '<section class="print-toc"><h1>Оглавление</h1><ol>' + outlineItems(host).map(h=>'<li><a href="#'+esc(h.id)+'">'+esc(h.title)+'</a></li>').join('') + '</ol></section>' : '',
      numbers = settings.numbers
        ? "@page{@bottom-center{content:counter(page)}}"
        : "",
      html =
        '<!doctype html><html lang="' +
        esc(book.spellLanguage || "ru") +
        '"><head><meta charset="utf-8"><title>' +
        esc(book.title) +
        "</title><style>@page{size:" +
        settings.size +
        ";margin:" +
        settings.margin +
        "mm}*{box-sizing:border-box}body{font:" +
        settings.fontSize +
        "pt/1.6 Georgia,serif;color:#222}h1,h2,h3{text-align:center;page-break-after:avoid}img{max-width:100%;height:auto}figure{page-break-inside:avoid}.title-page,.print-toc,.cover-page{break-after:page}.title-page{text-align:center;padding-top:35%}.title-page h1{font-size:2.4em}.title-page p{margin-top:3em}.cover-page{text-align:center}.cover-page img{width:auto;max-height:240mm}.print-toc a{color:inherit;text-decoration:none}.print-toc li{margin:.8em 0}p{orphans:3;widows:3}" +
        (settings.chapters ? 'h2{break-before:page}' : '') +
        numbers +
        "</style></head><body>" +
        cover + title + toc +
        host.innerHTML +
        '<script>addEventListener("load",()=>setTimeout(()=>print(),250))<\/script></body></html>';
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" })),
      win = window.open(url, "_blank");
    if (!win) {
      URL.revokeObjectURL(url);
      toast("Разрешите всплывающее окно для печати");
    } else {
      try {
        win.opener = null;
      } catch (e) {}
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }

  function toggleFocus(force) {
    const on = force ?? !document.body.classList.contains("focus-mode");
    document.body.classList.toggle("focus-mode", on);
    $("focus-toggle").setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem("pg.focus", on ? "1" : "0");
    } catch (e) {}
    if (on) {
      ms.focus();
      toast("Фокус-режим · F9 или Esc для выхода");
    }
  }

  async function init() {
    pg = window.__pg__;
    if (!pg) return;
    try {
      studioDb = await openStudioDb();
    } catch (e) {
      console.error(e);
      toast("История версий недоступна");
    }
    $("studio-toggle").onclick = () => {
      const panel = $("studio-panel");
      if (panel.hidden) setStudio(true, "outline");
      else if (activeTab !== "outline") setTab("outline");
      else setStudio(false);
    };
    $("studio-close").onclick = () => setStudio(false);
    for (const b of document.querySelectorAll("[data-studio-tab]"))
      b.onclick = () => setTab(b.dataset.studioTab);
    $("spell-language").onchange = (e) => {
      const b = activeBook();
      if (b) pg.updateBook(b.id, { spellLanguage: e.target.value });
      ms.lang = e.target.value;
      toast("Язык проверки изменён");
    };
    $("add-note").onclick = openNoteDialog;
    $("cancel-note").onclick = () => $("note-dialog").close();
    $("note-form").onsubmit = (e) => {
      e.preventDefault();
      const b = activeBook(),
        text = $("note-text").value.trim();
      if (!b || !text) return;
      pg.updateBook(b.id, {
        notes: [
          ...(b.notes || []),
          {
            id: uuid(),
            excerpt: noteExcerpt,
            anchor: noteAnchor,
            text,
            createdAt: Date.now(),
            resolved: false,
          },
        ],
      });
      $("note-dialog").close();
      setStudio(true, "notes");
      toast("Заметка сохранена");
    };
    $("snapshot-now").onclick = () => {
      document.querySelector(".book-actions")?.removeAttribute("open");
      createSnapshot("manual");
    };
    $("focus-toggle").onclick = () => toggleFocus();
    document.addEventListener("keydown", (e) => {
      if (e.key === "F9") {
        e.preventDefault();
        toggleFocus();
      } else if (
        e.key === "Escape" &&
        document.body.classList.contains("focus-mode")
      )
        toggleFocus(false);
    });
    $("image-upload").onclick = () => $("image-file").click();
    $("image-file").onchange = (e) => {
      importImage(e.target.files?.[0]).catch((err) => toast(err.message));
      e.target.value = "";
    };
    $("fig-tools").addEventListener("click", (e) => {
      const act = e.target.closest("[data-fig]")?.dataset.fig,
        fig = selectedFigure();
      if (!fig) return;
      if (act === "crop") openCrop(fig);
      else if (act === "rotate-left")
        rotateFigure(fig, false).catch((x) => toast(x.message));
      else if (act === "rotate-right")
        rotateFigure(fig, true).catch((x) => toast(x.message));
      else if (act === "front") layerFigure(fig, 1);
      else if (act === "back") layerFigure(fig, -1);
    });
    for (const id of ["crop-left", "crop-right", "crop-top", "crop-bottom"])
      $(id).oninput = drawCropPreview;
    $("cancel-crop").onclick = () => {
      $("crop-dialog").close();
      cropFigure = null;
    };
    $("crop-form").onsubmit = (e) => {
      e.preventDefault();
      applyCrop().catch((x) => toast(x.message));
    };
    $("export-epub").onclick = async () => {
      document.querySelector(".book-actions")?.removeAttribute("open");
      try {
        const b = activeBook();
        saveBlob(safeName(b.title) + ".epub", await exportEpubBlob(b));
        toast("EPUB подготовлен");
      } catch (e) {
        console.error(e);
        toast("Не удалось создать EPUB");
      }
    };
    $("export-docx").onclick = async () => {
      document.querySelector(".book-actions")?.removeAttribute("open");
      try {
        const b = activeBook();
        saveBlob(safeName(b.title) + ".docx", await exportDocxBlob(b));
        toast("DOCX подготовлен");
      } catch (e) {
        console.error(e);
        toast("Не удалось создать DOCX");
      }
    };
    $("print-book").onclick = () => {
      document.querySelector(".book-actions")?.removeAttribute("open");
      $("print-dialog").showModal();
    };
    $("cancel-print").onclick = () => $("print-dialog").close();
    $("print-form").onsubmit = (e) => {
      e.preventDefault();
      const b = activeBook();
      openPrint(b, {
        size: $("print-size").value,
        margin: Math.max(5, Math.min(40, +$("print-margin").value || 18)),
        fontSize: Math.max(9, Math.min(18, +$("print-font-size").value || 12)),
        title: $("print-title").checked,
        numbers: $("print-numbers").checked,
        toc: $("print-toc")?.checked || false,
        chapters: $("print-chapters")?.checked || false,
        cover: $("print-cover")?.checked || false,
      });
      $("print-dialog").close();
    };
    pg.on("bookopen", () => {
      renderAll();
      lastAutoAt = Date.now();
    });
    new MutationObserver(() => {
      if (!$("studio-panel").hidden && activeTab === "outline") renderOutline();
    }).observe(ms, { childList: true, subtree: true, characterData: true });
    scheduleSnapshots();
    renderAll();
    try {
      if (localStorage.getItem("pg.focus") === "1") toggleFocus(true);
    } catch (e) {}
    window.__pgStudio__ = {
      createSnapshot,
      snapshotsFor,
      restoreSnapshot,
      exportEpubBlob,
      exportDocxBlob,
      zip,
      renderOutline,
      openPrint,
    };
  }
  function wait() {
    if (window.__pg__ && window.__pgMvp__) init();
    else setTimeout(wait, 50);
  }
  wait();
})();
