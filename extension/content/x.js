/* Kolibri on X (x.com / twitter.com): badges next to authors, call collection from visible posts,
 * and an optional "scan timeline" on a profile page. */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const C = K.content;
  const UI = K.ui;
  const X = K.extract;
  const L = K.ledger;

  // X's own test ids are the most stable hooks it offers. Keep all selectors here.
  const SEL = {
    tweet: 'article[data-testid="tweet"]',
    userName: '[data-testid="User-Name"]',
    tweetText: '[data-testid="tweetText"]',
    avatar: '[data-testid="Tweet-User-Avatar"] img',
    profileName: '[data-testid="UserName"]',
    userCell: '[data-testid="UserCell"]',
    hoverCard: '[data-testid="HoverCard"]',
    primaryColumn: '[data-testid="primaryColumn"]'
  };
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose', 'login',
    'logout', 'signup', 'tos', 'privacy', 'jobs', 'premium', 'premium_sign_up', 'communities', 'lists', 'bookmarks', 'grok',
    'hashtag', 'intent', 'share', 'account', 'topics', 'verified-choose', 'download', 'about', 'help', 'jobs', 'spaces',
    'downloads', 'following', 'followers', 'creators', 'business', 'ads', 'analytics']);
  const PROFILE_TABS = new Set(['with_replies', 'media', 'likes', 'highlights', 'articles', 'superfollows', 'verified_followers',
    'followers', 'following', 'affiliates', 'followers_you_follow', 'creator-subscriptions']);
  const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
  const DAY = 86400000;

  function enabled() { return C.settings.showOnX !== false; }

  function profileHandle() {
    const seg = location.pathname.split('/').filter(Boolean);
    if (!seg.length || !HANDLE_RE.test(seg[0]) || RESERVED.has(seg[0].toLowerCase())) return null;
    if (seg.length > 1 && !PROFILE_TABS.has(seg[1])) return null;
    return seg[0];
  }

  function textOf(el) {
    let s = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) s += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.tagName === 'IMG') s += c.getAttribute('alt') || '';
          else if (c.tagName === 'BR') s += '\n';
          else walk(c);
        }
      }
    };
    walk(el);
    return s;
  }

  function linkCandidates(a) {
    const out = [a.href];
    const title = a.getAttribute('title');
    if (title) out.push(title);
    const shown = (a.textContent || '').replace(/…$/, '').trim();
    if (/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/\S+$/i.test(shown)) out.push(/^https?:/i.test(shown) ? shown : 'https://' + shown);
    return out;
  }

  function parseTweet(article) {
    let statusLink = null;
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      if (a.querySelector('time')) { statusLink = a; break; }
    }
    if (!statusLink) return null;
    const href = statusLink.getAttribute('href') || '';
    const idMatch = /\/status\/(\d+)/.exec(href);
    if (!idMatch) return null;
    const id = idMatch[1];
    const time = statusLink.querySelector('time');
    const postedAt = X.snowflakeToMs(id) || Date.parse(time && time.getAttribute('datetime'));
    if (!Number.isFinite(postedAt)) return null;

    // Author: the permalink's first segment, unless X used a generic /i/status/<id> link;
    // then the profile link in the post header.
    const userName = article.querySelector(SEL.userName);
    let handle = null;
    const fromLink = /^\/([A-Za-z0-9_]{1,15})\/status\//.exec(href);
    if (fromLink && fromLink[1].toLowerCase() !== 'i') handle = fromLink[1];
    if (!handle && userName) {
      for (const a of userName.querySelectorAll('a[href^="/"]')) {
        const h = /^\/([A-Za-z0-9_]{1,15})$/.exec(a.getAttribute('href') || '');
        if (h && h[1].toLowerCase() !== 'i') { handle = h[1]; break; }
      }
    }
    if (!handle || RESERVED.has(handle.toLowerCase())) return null;

    let name = handle;
    if (userName) {
      const nameLink = userName.querySelector('a[href^="/"]');
      const t = nameLink ? textOf(nameLink).trim() : '';
      if (t && !t.startsWith('@')) name = t;
    }
    const avatarImg = article.querySelector(SEL.avatar);

    // Main post text only: a quoted post sits inside a div[role=link] card.
    const texts = Array.from(article.querySelectorAll(SEL.tweetText)).filter((el) => {
      const q = el.closest('div[role="link"]');
      return !q || !article.contains(q);
    });
    let text = '';
    const links = [];
    for (const el of texts) {
      text += (text ? '\n' : '') + textOf(el);
      for (const a of el.querySelectorAll('a[href]')) links.push(...linkCandidates(a));
    }
    return {
      handle, id, postedAt, name, userName,
      avatar: avatarImg ? avatarImg.src : null,
      text, links,
      url: `https://x.com/${handle}/status/${id}`
    };
  }

  // ---------------------------------------------------------------- badges

  function cardOpts(author, extra) {
    const handle = author.handle;
    return Object.assign({
      key: L.authorKey('x', handle),
      platform: 'x',
      author: { platform: 'x', handle, name: author.name || handle, avatar: author.avatar || null },
      canScan: () => (profileHandle() || '').toLowerCase() === handle.toLowerCase(),
      scanState: () => Scanner.state(handle),
      startScan: () => Scanner.start(handle),
      stopScan: () => Scanner.stop()
    }, extra || {});
  }

  /** Climb from el to the child of the nearest horizontal flex row, so a badge can sit beside it. */
  function rowChild(el, stopAt) {
    let cur = el;
    while (cur && cur.parentElement && cur.parentElement !== stopAt) {
      const st = getComputedStyle(cur.parentElement);
      if (st.display.includes('flex') && st.flexDirection.startsWith('row')) return cur;
      cur = cur.parentElement;
    }
    return cur;
  }

  function placeBadge(container, after, opts) {
    let host = container.querySelector('.kolibri-badge-host');
    if (host) {
      if (host._kolibri.key !== opts.key) UI.rekeyBadge(host, opts);
      return host;
    }
    host = UI.createBadge(opts);
    if (after && after.isConnected && container.contains(after)) after.after(host);
    else container.appendChild(host);
    return host;
  }

  function tweetBadge(t) {
    if (!t.userName) return;
    placeBadge(t.userName, t.userName.firstElementChild, cardOpts(t));
  }

  let fallbackHost = null;
  let profileSeenAt = 0;
  let lastProfile = null;

  function profileBadge(keys) {
    const handle = profileHandle();
    if (handle !== lastProfile) { lastProfile = handle; profileSeenAt = Date.now(); }
    if (!handle) { removeFallback(); return; }
    keys.add(L.authorKey('x', handle));
    const header = document.querySelector(`${SEL.primaryColumn} ${SEL.profileName}`) || document.querySelector(SEL.profileName);
    const avatarImg = document.querySelector(`a[href="/${handle}/photo" i] img`);
    if (header) {
      removeFallback();
      const nameEl = header.querySelector('span');
      const author = { handle, name: nameEl ? textOf(nameEl).trim() : handle, avatar: avatarImg ? avatarImg.src : null };
      const handleSpan = Array.from(header.querySelectorAll('span')).find((s) => s.textContent.trim().toLowerCase() === '@' + handle.toLowerCase());
      const after = handleSpan ? rowChild(handleSpan, header) : null;
      const host = placeBadge(header, after, cardOpts(author, { big: true, always: true }));
      if (host && host._kolibri) Object.assign(host._kolibri, { big: true, always: true });
      UI.updateBadge(host);
      return;
    }
    // X changed its markup? Keep the feature usable with a floating badge.
    if (Date.now() - profileSeenAt > 2500) {
      const opts = cardOpts({ handle, avatar: avatarImg ? avatarImg.src : null }, { big: true, always: true });
      if (!fallbackHost) {
        fallbackHost = document.createElement('div');
        fallbackHost.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483645;';
        document.documentElement.appendChild(fallbackHost);
      }
      placeBadge(fallbackHost, null, opts);
    }
  }

  function removeFallback() {
    if (fallbackHost) { fallbackHost.remove(); fallbackHost = null; }
  }

  function cellBadges(keys) {
    for (const cell of document.querySelectorAll(`${SEL.userCell}, ${SEL.hoverCard}`)) {
      const span = Array.from(cell.querySelectorAll('span')).find((s) => /^@[A-Za-z0-9_]{1,15}$/.test(s.textContent.trim()));
      if (!span) continue;
      const handle = span.textContent.trim().slice(1);
      keys.add(L.authorKey('x', handle));
      const img = cell.querySelector('img[src*="profile_images"]');
      placeBadge(cell, rowChild(span, cell), cardOpts({ handle, avatar: img ? img.src : null }));
    }
  }

  // ---------------------------------------------------------------- collection

  const outbox = new Map();
  let flushTimer = null;

  function queue(t, tokens) {
    const key = L.authorKey('x', t.handle);
    if (!outbox.has(key)) outbox.set(key, { author: { platform: 'x', handle: t.handle, name: t.name, avatar: t.avatar }, posts: [] });
    outbox.get(key).posts.push({ postId: t.id, postedAt: t.postedAt, url: t.url, snippet: X.snippet(t.text), tokens });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 500);
  }

  async function flush() {
    const batch = Array.from(outbox.values());
    outbox.clear();
    for (const item of batch) {
      try { await C.send('ingest', item); } catch (_) { return; }
    }
  }

  // ---------------------------------------------------------------- timeline scan

  const Scanner = {
    running: false,
    handle: null,
    posts: 0,
    calls: 0,
    old: 0,
    seen: new Set(),
    state(handle) {
      if (!this.handle || !handle || this.handle.toLowerCase() !== handle.toLowerCase()) return null;
      return { running: this.running, posts: this.posts, calls: this.calls };
    },
    note(t, tokenCount) {
      if (!this.running || t.handle.toLowerCase() !== this.handle.toLowerCase() || this.seen.has(t.id)) return;
      this.seen.add(t.id);
      this.posts += 1;
      this.calls += tokenCount;
      if (t.postedAt < Date.now() - (C.settings.historyDepthDays || 120) * DAY) this.old += 1;
    },
    async start(handle) {
      if (this.running) return;
      Object.assign(this, { running: true, handle, posts: 0, calls: 0, old: 0, seen: new Set() });
      UI.card.freeze(true);
      scanNow();
      let idle = 0;
      let last = -1;
      for (let i = 0; i < 150 && this.running; i++) {
        window.scrollBy(0, Math.round(window.innerHeight * 0.9));
        await C.sleep(1000 + Math.random() * 600);
        scanNow();
        idle = this.posts === last ? idle + 1 : 0;
        last = this.posts;
        UI.card.refresh();
        if (idle >= 6 || this.old >= 3) break; // end of timeline, or far enough back
      }
      this.running = false;
      await flush();
      window.scrollTo(0, 0);
      UI.card.freeze(false);
      UI.card.refresh();
    },
    stop() { this.running = false; }
  };

  // ---------------------------------------------------------------- main loop

  const processed = new WeakMap(); // article -> {href, key}

  function statusHref(article) {
    const time = article.querySelector('a[href*="/status/"] time');
    return time && time.parentElement ? time.parentElement.getAttribute('href') : null;
  }

  function scanNow() {
    if (!C.isAlive()) return;
    if (!enabled()) return;
    const keys = new Set();
    for (const article of document.querySelectorAll(SEL.tweet)) {
      const done = processed.get(article);
      if (done && article.querySelector('.kolibri-badge-host') && statusHref(article) === done.href) {
        keys.add(done.key);
        continue;
      }
      const t = parseTweet(article);
      if (!t) continue;
      const key = L.authorKey('x', t.handle);
      keys.add(key);
      if (article.dataset.kolibriSeen !== t.id) {
        article.dataset.kolibriSeen = t.id;
        const { tokens } = X.extractTokens(t.text, t.links, { includeMajors: true });
        if (tokens.length) queue(t, tokens);
        Scanner.note(t, tokens.length);
      }
      tweetBadge(t);
      processed.set(article, { href: statusHref(article), key });
    }
    profileBadge(keys);
    cellBadges(keys);
    if (keys.size) C.requestSummaries(Array.from(keys));
  }

  function removeAllBadges() {
    for (const el of document.querySelectorAll('.kolibri-badge-host')) el.remove();
    removeFallback();
    UI.card.close();
  }

  const scheduleScan = C.throttle(scanNow, 350);
  const observer = new MutationObserver(() => scheduleScan());

  C.onStorage((changes) => {
    if (!changes.settings) return;
    if (!enabled()) removeAllBadges();
    else { UI.refreshAllBadges(); scheduleScan(); }
  });
  C.onDead(() => observer.disconnect());

  (async function init() {
    await C.loadSettings();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scanNow();
  })();

  K.x = { parseTweet, profileHandle, scanNow, Scanner };
})(globalThis);
