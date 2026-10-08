/* Kolibri on Telegram Web (both clients: /k/ "WebK" and /a/ "WebA").
 * Badge next to the open channel's title and channels in the chat list, call collection from
 * visible channel posts, and history loading from the channel's public t.me preview. */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const C = K.content;
  const UI = K.ui;
  const X = K.extract;
  const L = K.ledger;
  const TG = K.tgPreview;

  const CLIENT = location.pathname.startsWith('/a') ? 'A' : 'K';
  const OFFSET = 2 ** 32; // WebK stores channel message ids as 2^32 + server id
  const DAY = 86400000;
  let tgmap = {};

  function enabled() { return C.settings.showOnTelegram !== false; }

  /** Normalise peer ids from both clients (-1234567890 in WebK, -1001234567890 in WebA) to the bare channel id. */
  function channelIdOf(raw) {
    if (raw === undefined || raw === null) return null;
    let s = String(raw).trim().replace(/^-/, '');
    if (!/^\d+$/.test(s)) return null;
    if (s.startsWith('100') && s.length >= 13) s = s.slice(3);
    return s;
  }

  function keyFor(channelId, username) {
    const u = username || (channelId && tgmap[channelId]) || null;
    return L.authorKey('tg', u, channelId);
  }

  function textOf(el, skipSelector) {
    let s = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) s += c.nodeValue;
        else if (c.nodeType === 1) {
          if (skipSelector && c.matches(skipSelector)) continue;
          if (c.tagName === 'IMG') s += c.getAttribute('alt') || '';
          else if (c.tagName === 'BR') s += '\n';
          else walk(c);
        }
      }
    };
    walk(el);
    return s;
  }

  function linksOf(el, skipSelector) {
    return Array.from(el.querySelectorAll('a[href]'))
      .filter((a) => !(skipSelector && a.closest(skipSelector)))
      .map((a) => a.href);
  }

  // ---------------------------------------------------------------- WebA date headers

  let dateCache = null;
  function dateLookup() {
    const langs = Array.from(new Set([document.documentElement.lang, navigator.language, 'en'].filter(Boolean)));
    const today = new Date();
    const stamp = langs.join(',') + today.toDateString();
    if (dateCache && dateCache.stamp === stamp) return dateCache.map;
    const map = new Map();
    const add = (label, d) => {
      const k = String(label).toLowerCase().replace(/\s+/g, ' ').trim();
      if (k && !map.has(k)) map.set(k, d);
    };
    for (const lang of langs) {
      let long;
      let longY;
      let wd;
      let rel;
      try {
        long = new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric' });
        longY = new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric', year: 'numeric' });
        wd = new Intl.DateTimeFormat(lang, { weekday: 'long' });
        rel = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
      } catch (_) { continue; }
      for (let i = 0; i < 400; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        if (i === 0) add(rel.format(0, 'day'), d);
        if (i === 1) add(rel.format(-1, 'day'), d);
        if (i < 7) add(wd.format(d), d);
        if (d.getFullYear() === today.getFullYear()) add(long.format(d), d);
        add(longY.format(d), d);
      }
    }
    dateCache = { stamp, map };
    return map;
  }

  function parseClock(text) {
    const m = /(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?/.exec(text || '');
    if (!m) return null;
    let h = +m[1];
    const min = +m[2];
    if (m[3]) {
      const pm = m[3].toLowerCase() === 'p';
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
    }
    return h < 24 && min < 60 ? { h, min } : null;
  }

  function webATimestamp(msgEl) {
    const group = msgEl.closest('.message-date-group');
    const label = group && group.querySelector('.sticky-date');
    const timeEl = msgEl.querySelector('.message-time');
    const clock = parseClock(timeEl && timeEl.textContent);
    if (!label || !clock) return null;
    const day = dateLookup().get(label.textContent.toLowerCase().replace(/\s+/g, ' ').trim());
    if (!day) return null;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.h, clock.min).getTime();
  }

  // ---------------------------------------------------------------- client adapters

  const WebK = {
    chat() {
      const chat = document.querySelector('.chats-container .chat.active') || document.querySelector('.chat.active');
      if (!chat) return null;
      const title = chat.querySelector('.topbar .user-title .peer-title') || chat.querySelector('.topbar .peer-title');
      if (!title) return null;
      const channelId = channelIdOf(title.dataset.peerId);
      const hash = /^#@([A-Za-z][A-Za-z0-9_]{3,31})/.exec(location.hash || '');
      return {
        root: chat,
        channelId,
        username: hash ? hash[1] : null,
        title: textOf(title).trim(),
        isChannel: Boolean(chat.querySelector('.bubbles-inner.is-broadcast')),
        headerAfter: title.closest('.user-title') || title,
        headerRow: (title.closest('.user-title') || title).parentElement
      };
    },
    posts(chat) {
      const out = [];
      for (const b of chat.root.querySelectorAll('.bubble.channel-post[data-mid][data-timestamp]')) {
        const mid = Number(b.dataset.mid);
        const ts = Number(b.dataset.timestamp) * 1000;
        if (!Number.isFinite(mid) || !Number.isFinite(ts)) continue;
        const id = mid >= OFFSET && mid < 2 * OFFSET ? mid - OFFSET : mid;
        const msg = b.querySelector('.message');
        if (!msg) continue;
        const skip = '.time, .reply, .reactions, .bubble-name-forwarded, .name';
        out.push({ el: b, id, postedAt: ts, text: textOf(msg, skip), links: linksOf(msg, '.reply') });
      }
      return out;
    },
    list() {
      const out = [];
      for (const a of document.querySelectorAll('.chatlist-chat')) {
        const title = a.querySelector('.peer-title');
        if (!title) continue;
        const raw = title.dataset.peerId || (a.getAttribute('href') || '').replace('#', '');
        if (!/^-/.test(String(raw))) continue; // users and bots have positive ids
        out.push({ el: a, channelId: channelIdOf(raw), title: textOf(title).trim(), after: title.closest('.user-title') || title });
      }
      return out;
    }
  };

  const WebA = {
    chat() {
      const header = document.querySelector('.MiddleHeader');
      if (!header) return null;
      const h3 = header.querySelector('.ChatInfo .title h3') || header.querySelector('.ChatInfo h3');
      if (!h3) return null;
      const m = /^#(-?\d+)/.exec(location.hash || '');
      const channelId = m ? channelIdOf(m[1]) : null;
      if (!channelId || !String(m[1]).startsWith('-')) return null;
      const extra = document.querySelector('#RightColumn .ChatExtra');
      let username = null;
      if (extra) {
        for (const t of extra.querySelectorAll('.title, a')) {
          const u = /t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})\b/.exec(t.textContent || '');
          if (u) { username = u[1]; break; }
        }
      }
      const list = document.querySelector('.MessageList');
      return {
        root: list || document,
        channelId,
        username,
        title: textOf(h3).trim(),
        isChannel: Boolean(list && list.querySelector('.Message.has-views')),
        headerAfter: h3,
        headerRow: h3.parentElement
      };
    },
    posts(chat) {
      const out = [];
      for (const el of chat.root.querySelectorAll('.Message.has-views[data-message-id]')) {
        const id = Number(el.dataset.messageId);
        const ts = webATimestamp(el);
        if (!Number.isFinite(id) || !ts) continue;
        const content = el.querySelector('.text-content') || el.querySelector('.message-content');
        if (!content) continue;
        const skip = '.MessageMeta, .EmbeddedMessage, .Reactions';
        out.push({ el, id, postedAt: ts, text: textOf(content, skip), links: linksOf(content, '.EmbeddedMessage') });
      }
      return out;
    },
    list() {
      const out = [];
      for (const a of document.querySelectorAll('.chat-list a.ListItem-button[href^="#-"]')) {
        const title = a.querySelector('.title h3') || a.querySelector('h3');
        if (!title) continue;
        out.push({ el: a, channelId: channelIdOf(a.getAttribute('href').slice(1)), title: textOf(title).trim(), after: title });
      }
      return out;
    }
  };

  const client = CLIENT === 'A' ? WebA : WebK;

  // ---------------------------------------------------------------- badges

  function cardOpts(chat) {
    const username = chat.username || tgmap[chat.channelId] || null;
    const key = keyFor(chat.channelId, username);
    return {
      key,
      platform: 'tg',
      author: { platform: 'tg', handle: username, name: chat.title, channelId: chat.channelId },
      tgUsername: () => chat.username || tgmap[chat.channelId] || null,
      loadHistory: () => C.send('tgHistory', { username: chat.username || tgmap[chat.channelId], channelId: chat.channelId, title: chat.title }),
      linkUsername: async (u) => {
        await C.send('tgLink', { channelId: chat.channelId, username: u, title: chat.title });
        tgmap[chat.channelId] = u;
        await C.send('tgHistory', { username: u, channelId: chat.channelId, title: chat.title });
        const fresh = Object.assign({}, chat, { username: u });
        const opts = cardOpts(fresh);
        if (headerHost) UI.rekeyBadge(headerHost, Object.assign(opts, { big: true, always: true }));
        C.requestSummaries([opts.key], true);
        if (headerHost) UI.card.open(headerHost, headerHost._kolibri, true);
      }
    };
  }

  let headerHost = null;

  function placeBadge(container, after, opts) {
    let host = container.querySelector(':scope > .kolibri-badge-host');
    if (host) {
      if (host._kolibri.key !== opts.key) UI.rekeyBadge(host, Object.assign(host._kolibri, opts));
      return host;
    }
    host = UI.createBadge(opts);
    if (after && after.parentElement === container) after.after(host);
    else container.appendChild(host);
    return host;
  }

  // ---------------------------------------------------------------- collection

  const seen = new Set();
  const autoLoaded = new Set();

  async function maybeAutoHistory(chat, key) {
    const username = chat.username || tgmap[chat.channelId];
    if (!username || !TG.isValidUsername(username) || C.settings.autoHistory === false) return;
    if (autoLoaded.has(key)) return;
    autoLoaded.add(key);
    try {
      const o = await chrome.storage.local.get('job:' + key);
      const job = o['job:' + key];
      if (job && (job.state === 'running' || (job.finishedAt && Date.now() - job.finishedAt < DAY))) return;
      await C.send('tgHistory', { username, channelId: chat.channelId, title: chat.title });
    } catch (_) { /* ignore */ }
  }

  let lastChatKey = null;

  function scanNow() {
    if (!C.isAlive() || !enabled()) return;
    const keys = new Set();
    const chat = client.chat();
    if (chat && chat.channelId && chat.isChannel) {
      if (chat.username && tgmap[chat.channelId] !== chat.username) {
        tgmap[chat.channelId] = chat.username;
        C.send('tgLink', { channelId: chat.channelId, username: chat.username, title: chat.title }).catch(() => {});
      }
      const opts = Object.assign(cardOpts(chat), { big: true, always: true });
      keys.add(opts.key);
      if (chat.headerRow) headerHost = placeBadge(chat.headerRow, chat.headerAfter, opts);
      if (opts.key !== lastChatKey) {
        lastChatKey = opts.key;
        maybeAutoHistory(chat, opts.key);
      }

      const posts = [];
      for (const p of client.posts(chat)) {
        const sid = chat.channelId + ':' + p.id;
        if (seen.has(sid)) continue;
        seen.add(sid);
        const { tokens } = X.extractTokens(p.text, p.links, { includeMajors: true });
        if (!tokens.length) continue;
        const username = opts.author.handle;
        posts.push({
          postId: p.id,
          postedAt: p.postedAt,
          url: username ? `https://t.me/${username}/${p.id}` : `https://t.me/c/${chat.channelId}/${p.id}`,
          snippet: X.snippet(p.text),
          tokens
        });
      }
      if (posts.length) C.send('ingest', { author: opts.author, posts }).catch(() => {});
    }

    for (const item of client.list()) {
      if (!item.channelId || !item.after || !item.after.parentElement) continue;
      const opts = cardOpts({ channelId: item.channelId, username: null, title: item.title });
      keys.add(opts.key);
      placeBadge(item.after.parentElement, item.after, opts);
    }
    if (keys.size) C.requestSummaries(Array.from(keys));
  }

  function removeAllBadges() {
    for (const el of document.querySelectorAll('.kolibri-badge-host')) el.remove();
    UI.card.close();
  }

  const scheduleScan = C.throttle(scanNow, 400);
  const observer = new MutationObserver(() => scheduleScan());

  C.onStorage((changes) => {
    if (changes.tgmap) {
      tgmap = changes.tgmap.newValue || {};
      scheduleScan();
    }
    if (changes.settings) {
      if (!enabled()) removeAllBadges();
      else { UI.refreshAllBadges(); scheduleScan(); }
    }
  });
  C.onDead(() => observer.disconnect());
  window.addEventListener('hashchange', () => scheduleScan());

  (async function init() {
    await C.loadSettings();
    try { tgmap = (await chrome.storage.local.get('tgmap')).tgmap || {}; } catch (_) { tgmap = {}; }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scanNow();
  })();

  K.telegram = { channelIdOf, parseClock, dateLookup, webATimestamp, client: CLIENT, scanNow };
})(globalThis);
