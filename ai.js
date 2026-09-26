/**
 * Pergamin — модуль ИИ-иллюстраций (РукB).
 * Контракт: SPEC §5 (window.__pg__), §6 (промт и поведение).
 * Без зависимостей; один IIFE.
 */
(function () {
  'use strict';

  var POLL_MS = 50;
  var POLL_MAX_MS = 2000;
  var FETCH_TIMEOUT_MS = 60000;
  var OFFLINE_TITLE = 'Генерация доступна только при интернете';

  /** Стабильный целочисленный hash строки (для seed на книгу). */
  function hashString(str) {
    var h = 2166136261;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // неотрицательное 31-битное целое
    return (h >>> 0) % 2147483647;
  }

  function truncateExcerpt(text, maxLen) {
    var t = String(text || '');
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen) + '…';
  }

  /**
   * Строит промт строго по SPEC §6 (конкатенация строк).
   * Экспортируем на window.__pgAiBuildPrompt только для самопроверки.
   */
  function buildPrompt(book, excerpt) {
    var title = (book && book.title) || '';
    var style = (book && book.illusStyle) || '';
    var history = (book && book.illusHistory) || [];
    var ex = truncateExcerpt(excerpt, 500);

    var prompt =
      "Generate ONE book illustration for the excerpt below from the book '" + title + "'." +
      (style
        ? '\nBOOK STYLE (MANDATORY, keep consistent for the WHOLE book): ' + style
        : '\nBOOK STYLE NOT SET YET: choose an expressive, distinctive illustration style and make it memorable (it will be fixed for the whole book).') +
      '\nCONTEXT: consider the WHOLE book so all illustrations stay consistent (same characters, places, palette).' +
      (history.length
        ? '\nAlready illustrated in this book: ' +
          history
            .slice(-3)
            .map(function (h) {
              return h.what;
            })
            .join('; ') +
          '. Do not contradict them.'
        : '\nThis is the FIRST illustration — it sets the visual tone of the book.') +
      '\nExcerpt: "' +
      ex +
      '"' +
      '\nNo text, NO letters, NO words, NO signature, NO logo, NO watermark, NO label, NO stamp of any kind - only the pure artwork, clean background. Square composition.\nCOMPOSITION VARIETY (IMPORTANT): illustrate the actual moment of the excerpt, not a generic portrait. Vary the pictures across the book: wide landscapes, interiors, streets, close-ups of hands or objects, animals, weather, one symbolic detail. Show a full person only when the excerpt truly centres on one - and even then vary the framing (back view, hands only, silhouette, a small figure in a large scene). Do NOT default to a portrait of a young woman.';

    return prompt;
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error('Не удалось прочитать изображение'));
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Pollinations рисует логотип/подпись в нижнем (и иногда верхнем) поясе даже при
   * nologo=true — отрезаем эти пояса, чтобы в книге не было водяных знаков.
   */
  function cropWatermarkClient(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var W = img.naturalWidth, H = img.naturalHeight;
          var crop = Math.round(H * 0.07);
          var canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = Math.max(64, H - crop * 2);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, crop, W, H - crop * 2, 0, 0, W, H - crop * 2);
          canvas.toBlob(function (b) {
            URL.revokeObjectURL(url);
            if (!b) { reject(new Error('Не удалось обработать изображение')); return; }
            blobToDataUrl(b).then(resolve, reject);
          }, 'image/jpeg', 0.92);
        } catch (err) { URL.revokeObjectURL(url); reject(err); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
      img.src = url;
    });
  }

  function showLoading(host) {
    if (!host) return;
    host.innerHTML =
      '<div class="ai-loading" style="' +
      'margin:12px auto;max-width:28rem;padding:1rem 1.25rem;' +
      'background:linear-gradient(180deg,#f4e8d0,#e8d4b0);' +
      'border:1px solid #c4a574;border-radius:6px;' +
      'box-shadow:0 2px 8px rgba(80,50,20,.15);' +
      'font-family:Georgia,serif;color:#3a2a18;text-align:center;' +
      '">' +
      '🖋 Рисую иллюстрацию…' +
      '</div>';
  }

  function clearLoading(host) {
    if (host) host.innerHTML = '';
  }

  function setButtonOnlineState(btn, online) {
    if (!btn) return;
    if (online) {
      btn.removeAttribute('disabled');
      btn.removeAttribute('title');
    } else {
      btn.setAttribute('disabled', 'disabled');
      btn.setAttribute('title', OFFLINE_TITLE);
    }
  }

  function safeToast(pg, msg) {
    try {
      if (pg && typeof pg.toast === 'function') pg.toast(msg);
    } catch (e) {
      /* ignore */
    }
  }

  function waitForPg(cb) {
    var started = Date.now();
    (function poll() {
      if (window.__pg__ && typeof window.__pg__.on === 'function') {
        cb(window.__pg__);
        return;
      }
      if (Date.now() - started >= POLL_MAX_MS) {
        // тайм-аут ожидания — всё равно пробуем, если объект частично есть
        if (window.__pg__) cb(window.__pg__);
        return;
      }
      setTimeout(poll, POLL_MS);
    })();
  }

  function bind(pg) {
    var btn = document.getElementById('ai-gen');
    var host = document.getElementById('ai-host');
    if (!btn) return;

    var busy = false;

    function refreshOnline() {
      var online = true;
      try {
        online = typeof pg.isOnline === 'function' ? !!pg.isOnline() : true;
      } catch (e) {
        online = true;
      }
      if (!busy) setButtonOnlineState(btn, online);
      else if (!online) {
        btn.setAttribute('disabled', 'disabled');
        btn.setAttribute('title', OFFLINE_TITLE);
      }
    }

    try {
      if (typeof pg.on === 'function') {
        pg.on('online', refreshOnline);
        pg.on('offline', refreshOnline);
      }
    } catch (e) {
      /* ignore */
    }
    refreshOnline();

    btn.addEventListener('click', function () {
      if (busy) return;

      var excerpt = '';
      try {
        excerpt = (pg.getSelectionText && pg.getSelectionText()) || '';
      } catch (e) {
        excerpt = '';
      }
      excerpt = String(excerpt).trim();

      if (!excerpt) {
        safeToast(pg, 'Сначала выделите текст, который нужно проиллюстрировать');
        return;
      }

      var online = true;
      try {
        online = typeof pg.isOnline === 'function' ? !!pg.isOnline() : true;
      } catch (e) {
        online = true;
      }
      if (!online) {
        safeToast(pg, 'Нет интернета — генерация недоступна');
        return;
      }

      var bookId = '';
      try {
        bookId = pg.currentBookId && pg.currentBookId();
      } catch (e) {
        bookId = '';
      }
      if (!bookId) {
        safeToast(pg, 'Книга не открыта');
        return;
      }

      var book = null;
      try {
        book = pg.getBook && pg.getBook(bookId);
      } catch (e) {
        book = null;
      }
      if (!book) {
        safeToast(pg, 'Не удалось загрузить книгу');
        return;
      }

      var prompt = buildPrompt(book, excerpt);
      // Random seed per request: same text → genuinely different illustration
      // (a fixed seed made "regenerate" return the identical image).
      var seed = 1 + Math.floor(Math.random() * 2e9);

      busy = true;
      btn.setAttribute('disabled', 'disabled');
      showLoading(host);

      var controller = new AbortController();
      var timer = setTimeout(function () {
        try {
          controller.abort();
        } catch (e) {
          /* ignore */
        }
      }, FETCH_TIMEOUT_MS);

      fetchIllustration(prompt, seed, controller.signal)
        .then(function (blob) {
          if (!blob || !blob.type || blob.type.indexOf('image/') !== 0) {
            throw new Error('Ответ не является изображением');
          }
          return cropWatermarkClient(blob);
        })
        .then(function (dataUrl) {
          var caption = excerpt.slice(0, 90);
          try {
            pg.insertFigureAtSelection(bookId, {
              dataUrl: dataUrl,
              caption: caption,
              prompt: prompt
            });
          } catch (e) {
            throw new Error('Не удалось вставить иллюстрацию');
          }

          var styleWasEmpty = !book.illusStyle;
          if (styleWasEmpty) {
            var newStyle =
              'стиль, заданный первой иллюстрацией этой книги (палитра и техника соответствуют первому рисунку)';
            try {
              pg.updateBook(bookId, { illusStyle: newStyle });
            } catch (e) {
              /* ignore persistence error after insert */
            }
            safeToast(pg, 'Иллюстрация вставлена. Стиль книги зафиксирован.');
          } else {
            safeToast(pg, 'Иллюстрация вставлена — стиль книги сохранён.');
          }
        })
        .catch(function (err) {
          var msg = 'Ошибка генерации';
          if (err && err.name === 'AbortError') {
            msg = 'Таймаут генерации (60 с)';
          } else if (err && err.message) {
            msg = 'Ошибка: ' + String(err.message).slice(0, 80);
          }
          safeToast(pg, msg);
        })
        .then(function () {
          clearTimeout(timer);
          clearLoading(host);
          busy = false;
          refreshOnline();
        });
    });
  }

  /** Fetches one illustration image (dataUrl blob). prompt+seed decide the result. */
  function fetchIllustration(prompt, seed, signal) {
   var MODELS = ['flux', 'turbo'];
   function buildUrl(model) {
   return 'https://image.pollinations.ai/prompt/' +
   encodeURIComponent(prompt) +
   '?width=768&height=768&seed=' + seed + '&model=' + model + '&nologo=true&private=true';
   }
   function attempt(model) {
   return fetch(buildUrl(model), { cache: 'no-store', signal: signal })
   .then(function (res) {
   if (!res.ok) {
   var e = new Error('Сервер ответил ' + res.status);
   e.status = res.status;
   e.transient = (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 429);
   throw e;
   }
   var ct = (res.headers.get('content-type') || '').toLowerCase();
   if (ct.indexOf('image/') !== 0) throw new Error('Ответ не является изображением');
   return res.blob();
   });
   }
   var errs = [];
   function nextModel(mi, triesLeft) {
   if (mi >= MODELS.length) {
   if (triesLeft <= 0) return Promise.reject(new Error('Сервис картинок недоступен (' + (errs.join(', ') || 'таймаут') + ')'));
   return nextModel(0, triesLeft - 1);
   }
   return attempt(MODELS[mi]).catch(function (e) {
   errs.push(MODELS[mi] + ':' + (e.status || e.name || e.message));
   if (e && e.transient && triesLeft > 0) {
   return new Promise(function (r) { setTimeout(r, 1500); }).then(function () {
   return attempt(MODELS[mi]).catch(function (e2) {
   errs.push(MODELS[mi] + ':' + (e2.status || e2.name || e2.message));
   return nextModel(mi + 1, triesLeft - 1);
   });
   });
   }
   return nextModel(mi + 1, triesLeft);
   });
   }
   return nextModel(0, 2);
  }

  // для самопроверки промта без сети
  window.__pgAiBuildPrompt = buildPrompt;
  window.__pgAiHash = hashString;
  window.__pgAiFetchIllustration = fetchIllustration;

  function start() {
    waitForPg(function (pg) {
      try {
        bind(pg);
      } catch (e) {
        try {
          if (pg && pg.toast) pg.toast('Ошибка инициализации ИИ-модуля');
        } catch (e2) {
          /* ignore */
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
