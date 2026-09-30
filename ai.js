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

  function sessionKey() {
    try { return String(sessionStorage.getItem('pg.pollinations.key') || '').trim(); }
    catch (e) { return ''; }
  }

  function base64Url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomToken(size) {
    var bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  function redirectUri() {
    return location.origin + location.pathname;
  }

  async function pkceChallenge(verifier) {
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
  }

  async function oauthEndpoints() {
    var fallback = {
      authorization_endpoint: 'https://enter.pollinations.ai/authorize',
      token_endpoint: 'https://enter.pollinations.ai/api/oauth/token'
    };
    try {
      var response = await fetch('https://enter.pollinations.ai/.well-known/oauth-authorization-server', {cache:'no-store'});
      if (!response.ok) return fallback;
      var metadata = await response.json();
      for (var key of ['authorization_endpoint','token_endpoint']) {
        var url = new URL(metadata[key]);
        if (url.protocol !== 'https:' || url.hostname !== 'enter.pollinations.ai') return fallback;
      }
      return metadata;
    } catch (e) { return fallback; }
  }

  async function beginOAuth(clientId) {
    var verifier = randomToken(48), state = randomToken(24), redirect = redirectUri();
    var challenge = await pkceChallenge(verifier);
    sessionStorage.setItem('pg.oauth.verifier', verifier);
    sessionStorage.setItem('pg.oauth.state', state);
    sessionStorage.setItem('pg.oauth.client', clientId);
    localStorage.setItem('pg.pollinations.clientId', clientId);
    var endpoints = await oauthEndpoints();
    var params = new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirect,scope:'usage',models:'flux,turbo',budget:'10',expiry:'7',state:state,code_challenge:challenge,code_challenge_method:'S256'});
    location.assign(endpoints.authorization_endpoint + '?' + params.toString());
  }

  async function finishOAuth(pg, refresh) {
    var query = new URLSearchParams(location.search), code = query.get('code'), error = query.get('error');
    if (!code && !error) return;
    try {
      if (error) throw new Error(query.get('error_description') || error);
      var state = sessionStorage.getItem('pg.oauth.state') || '';
      if (!state || query.get('state') !== state) throw new Error('Проверка state не прошла');
      var verifier = sessionStorage.getItem('pg.oauth.verifier') || '';
      var clientId = sessionStorage.getItem('pg.oauth.client') || localStorage.getItem('pg.pollinations.clientId') || '';
      if (!verifier || !clientId) throw new Error('Сеанс подключения истёк');
      var endpoints = await oauthEndpoints();
      var response = await fetch(endpoints.token_endpoint, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:code,client_id:clientId,redirect_uri:redirectUri(),code_verifier:verifier})});
      var payload = await response.json().catch(function(){ return {}; });
      if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || 'Pollinations не выдал токен');
      sessionStorage.setItem('pg.pollinations.key', payload.access_token);
      safeToast(pg, 'Pollinations подключён через BYOP');
    } catch (err) {
      safeToast(pg, 'Не удалось подключить Pollinations: ' + String(err.message || err).slice(0, 90));
    } finally {
      for (var key of ['pg.oauth.verifier','pg.oauth.state','pg.oauth.client']) sessionStorage.removeItem(key);
      history.replaceState({}, document.title, location.pathname + location.hash);
      refresh();
    }
  }

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
    var settingsBtn = document.getElementById('generation-settings');
    var settingsDialog = document.getElementById('generation-dialog');
    var settingsForm = document.getElementById('generation-form');
    var clientInput = document.getElementById('generation-client-id');
    var redirectInput = document.getElementById('generation-redirect');
    var generationStatus = document.getElementById('generation-status');
    if (!btn) return;

    var busy = false;

    function refreshOnline() {
      var online = true;
      try {
        online = typeof pg.isOnline === 'function' ? !!pg.isOnline() : true;
      } catch (e) {
        online = true;
      }
      if (!busy) {
        setButtonOnlineState(btn, online && !!sessionKey());
        if (online && !sessionKey()) btn.setAttribute('title', 'Сначала: Книга → Подключить генерацию');
      }
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
    finishOAuth(pg, refreshOnline);

    if (settingsBtn && settingsDialog && settingsForm && clientInput) {
      settingsBtn.addEventListener('click', function () {
        var menu = settingsBtn.closest('details');
        if (menu) menu.removeAttribute('open');
        try { clientInput.value = localStorage.getItem('pg.pollinations.clientId') || ''; } catch (e) { clientInput.value = ''; }
        if (redirectInput) redirectInput.value = redirectUri();
        if (generationStatus) generationStatus.textContent = sessionKey() ? 'Аккаунт подключён до закрытия приложения.' : 'Аккаунт не подключён.';
        settingsDialog.showModal();
        clientInput.focus();
      });
      var cancelSettings = document.getElementById('cancel-generation');
      if (cancelSettings) cancelSettings.addEventListener('click', function () { settingsDialog.close(); });
      var disconnect = document.getElementById('disconnect-generation');
      if (disconnect) disconnect.addEventListener('click', function () { sessionStorage.removeItem('pg.pollinations.key'); refreshOnline(); if (generationStatus) generationStatus.textContent='Аккаунт не подключён.'; safeToast(pg,'Pollinations отключён'); });
      settingsForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        var clientId = String(clientInput.value || '').trim();
        if (!/^pk_[A-Za-z0-9_-]{6,}$/.test(clientId)) { safeToast(pg,'Нужен публичный App Key, начинающийся с pk_'); clientInput.focus(); return; }
        try {
          await beginOAuth(clientId);
        } catch (e) {
          safeToast(pg, 'Не удалось начать OAuth: ' + String(e.message || e).slice(0, 80));
        }
      });
    }

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
      var bookSelect = document.getElementById('books');
      var newBookButton = document.getElementById('new-book');
      var bookSelectWasDisabled = bookSelect ? bookSelect.disabled : false;
      var newBookWasDisabled = newBookButton ? newBookButton.disabled : false;
      if (bookSelect) bookSelect.disabled = true;
      if (newBookButton) newBookButton.disabled = true;
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
            var inserted = pg.insertFigureAtSelection(bookId, {
              dataUrl: dataUrl,
              caption: caption,
              prompt: prompt
            });
            if (!inserted) {
              throw new Error('Книга была удалена или стала недоступна');
            }
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
          if (bookSelect) bookSelect.disabled = bookSelectWasDisabled;
          if (newBookButton) newBookButton.disabled = newBookWasDisabled;
          refreshOnline();
        });
    });
  }

  /** Fetches one illustration image (dataUrl blob). prompt+seed decide the result. */
  function fetchIllustration(prompt, seed, signal) {
   var MODELS = ['flux', 'turbo'];
   var key = sessionKey();
   if (!key) return Promise.reject(new Error('Сначала настройте ключ генерации в меню «Книга»'));
   function buildUrl(model) {
   return 'https://gen.pollinations.ai/image/' + encodeURIComponent(prompt) +
   '?width=768&height=768&seed=' + seed + '&model=' + model + '&nologo=true&private=true';
   }
   function attempt(model) {
   var options = { cache: 'no-store', signal: signal };
   options.headers = { Authorization: 'Bearer ' + key }; options.credentials = 'omit'; options.referrerPolicy = 'no-referrer';
   return fetch(buildUrl(model), options)
   .then(function (res) {
   if (!res.ok) {
   var e = new Error(res.status === 401 || res.status === 403 ? 'Ключ генерации не принят' : 'Сервер ответил ' + res.status);
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
  window.__pgAiOAuth = { beginOAuth: beginOAuth, redirectUri: redirectUri, pkceChallenge: pkceChallenge, oauthEndpoints: oauthEndpoints };

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
