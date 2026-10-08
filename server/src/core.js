'use strict';
// The Kolibri network: collects calls (Telegram channels, verified X posts, optional X API),
// prices them with the same code the extension uses, and serves report cards.

const path = require('path');
const SHARED = path.join(__dirname, '..', '..', 'extension', 'shared');
const CFG = require(path.join(SHARED, 'config.js'));
const X = require(path.join(SHARED, 'extract.js'));
const P = require(path.join(SHARED, 'prices.js'));
const S = require(path.join(SHARED, 'score.js'));
const L = require(path.join(SHARED, 'ledger.js'));
const TG = require(path.join(SHARED, 'telegram-preview.js'));
const H = require(path.join(SHARED, 'minihtml.js'));
const { makeNet } = require('./net');

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const DAY = 86400000;

function createApp({ config, store, fetchImpl, now, log }) {
  const clock = now || Date.now;
  const logger = log || console;
  const limits = Object.assign({}, CFG.RATE_LIMITS, { 'publish.twitter.com': 50, 'api.x.com': 40 }, config.rateLimits || {});
  const net = makeNet(fetchImpl || fetch, limits, `KolibriServer/${CFG.VERSION}`);

  // ---------------------------------------------------------------- ledger

  function authorOf(kol) {
    return kol ? { platform: kol.platform, handle: kol.handle, name: kol.name || kol.handle, avatar: kol.avatar || null } : null;
  }

  function scoredCalls(key) {
    return store.calls(key).filter((c) => !(c.token && c.token.major));
  }

  function refreshSummary(key) {
    const kol = store.getKol(key);
    if (!kol) return null;
    const entry = { key, author: authorOf(kol), summary: S.summarize(scoredCalls(key), { now: clock() }) };
    store.saveSummary(key, kol.platform, entry, clock());
    return entry;
  }

  /** Add mentions for an author; regroup calls; refresh the summary. */
  function ingest(author, mentions) {
    const key = L.authorKey(author.platform, author.handle);
    return store.tx(() => {
      store.upsertKol(key, author, clock());
      const added = store.addMentions(key, mentions);
      if (added) store.replaceCalls(key, L.groupCalls(store.mentions(key), store.calls(key)));
      refreshSummary(key);
      return { key, added };
    });
  }

  function mentionsFor(post, text, links) {
    const { tokens } = X.extractTokens(text, links, { includeMajors: true });
    return L.mentionsFromPost(Object.assign({ snippet: X.snippet(text) }, post), tokens);
  }

  // ---------------------------------------------------------------- pricing

  let binance = { set: null, at: 0 };
  async function binanceSymbols() {
    if (binance.set && clock() - binance.at < 12 * 3600000) return binance.set;
    const rows = await net.fetchJson(CFG.ENDPOINTS.binance + '/ticker/price');
    binance = { set: new Set((Array.isArray(rows) ? rows : []).map((r) => r.symbol).filter((s) => /USDT$/.test(s))), at: clock() };
    return binance.set;
  }

  const priceCtx = () => ({ now: clock, fetchJson: net.fetchJson, binanceSymbols, geckoKey: config.geckoKey || null });

  function marketKey(token) {
    return (token.kind === 'symbol' ? 'sym:' + token.symbol : 'addr:' + token.address) + (token.chain ? '@' + token.chain : '');
  }

  async function priceOne(key, call) {
    const ctx = priceCtx();
    let market;
    let result;
    let error = null;
    try {
      market = call.market;
      if (!market) {
        const cached = store.market(marketKey(call.token), clock());
        market = cached !== undefined ? cached : await P.resolveMarket(call.token, ctx);
        if (cached === undefined) store.setMarket(marketKey(call.token), market, clock());
      }
      result = market ? await P.priceCall(call, market, ctx) : { status: 'unresolved' };
    } catch (err) {
      error = err;
    }
    store.tx(() => {
      const current = store.calls(key).find((c) => c.id === call.id);
      if (!current) return;
      if (error) {
        if (error.status === 404 || error.code === 'no-network') L.applyResult(current, market, { status: 'unresolved' }, clock());
        else L.applyError(current, error, clock());
      } else {
        L.applyResult(current, market, result, clock());
      }
      store.saveCall(key, current);
      refreshSummary(key);
    });
    if (error && error.status !== 404) logger.warn(`[price] ${key} ${call.id}: ${error.message}`);
  }

  async function priceDue(limit) {
    const due = store.dueCalls(clock(), limit || 10);
    for (const { key, call } of due) await priceOne(key, call);
    return due.length;
  }

  // ---------------------------------------------------------------- Telegram channels (t.me/s, no login)

  async function collectTelegram(username, opts) {
    const o = opts || {};
    if (!TG.isValidUsername(username)) throw new Error('invalid channel username');
    const key = L.authorKey('tg', username);
    const known = store.knownPostIds(key);
    const firstRun = known.size === 0;
    const cutoff = clock() - (o.historyDays || config.historyDays) * DAY;
    let before = null;
    let pages = 0;
    let added = 0;
    let author = { platform: 'tg', handle: username };
    for (; pages < (o.maxPages || 40); pages++) {
      const page = TG.parseChannelPage(await net.fetchText(TG.pageUrl(username, before)), username);
      if (!page.ok) {
        if (pages === 0) throw new Error('channel has no public preview');
        break;
      }
      if (pages === 0 && page.channel) author = { platform: 'tg', handle: page.channel.username || username, name: page.channel.title, avatar: page.channel.avatar };
      const mentions = [];
      for (const post of page.posts) {
        if (post.postedAt < cutoff) continue;
        mentions.push(...mentionsFor({ postId: post.id, postedAt: post.postedAt, url: post.url }, post.text, post.links));
      }
      added += ingest(author, mentions).added;
      const allKnown = page.posts.length > 0 && page.posts.every((p) => known.has(String(p.id)));
      if (!page.hasMore || !page.posts.length || page.posts[0].postedAt < cutoff || (!firstRun && allKnown)) break;
      before = page.minId;
    }
    const k = L.authorKey('tg', author.handle);
    store.setCollected(k, clock());
    return { key: k, pages: pages + 1, added };
  }

  // ---------------------------------------------------------------- X: verify crowd-sourced posts via oEmbed

  /** Re-read a post from X's public oEmbed endpoint. Only what X returns is stored, and the post is
   * credited to the author X reports — the handle a client claimed is just a hint for the URL. */
  async function verifyX(handle, postId) {
    if (!/^\d{5,25}$/.test(String(postId))) return { ok: false, reason: 'invalid' };
    const user = HANDLE_RE.test(handle || '') ? handle : 'i';
    const postUrl = `https://twitter.com/${user}/status/${postId}`;
    const json = await net.fetchJson(`https://publish.twitter.com/oembed?url=${encodeURIComponent(postUrl)}&omit_script=true&dnt=true&hide_thread=true`);
    const m = /(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\b/i.exec(String(json && json.author_url));
    if (!m) return { ok: false, reason: 'no-author' };
    const doc = H.parse(json.html || '');
    const p = H.find(doc, H.byTag('p'));
    const text = p ? H.text(p) : '';
    const links = p ? H.findAll(p, H.byTag('a')).map((a) => a.attrs.href).filter(Boolean) : [];
    const postedAt = X.snowflakeToMs(String(postId));
    if (!postedAt) return { ok: false, reason: 'bad-id' };
    const author = { platform: 'x', handle: m[1], name: json.author_name || m[1] };
    const res = ingest(author, mentionsFor({ postId: String(postId), postedAt, url: `https://x.com/${m[1]}/status/${postId}` }, text, links));
    return { ok: true, key: res.key, added: res.added };
  }

  async function processQueue(limit) {
    const items = store.nextQueued(clock(), limit || 5);
    for (const it of items) {
      try {
        if (it.platform === 'x') await verifyX(it.handle, it.postId);
        store.dequeue(it.platform, it.postId);
      } catch (err) {
        if (err.status === 404 || err.status === 403 || it.attempts >= 4) store.dequeue(it.platform, it.postId);
        else store.retryLater(it.platform, it.postId, it.attempts + 1, clock() + (it.attempts + 1) * 10 * 60000);
      }
    }
    return items.length;
  }

  /** Accept post references from extension users. X posts are queued for verification;
   * Telegram channels are added to the tracked list and read from t.me directly. */
  function accept(posts) {
    let queued = 0;
    let channels = 0;
    for (const p of (Array.isArray(posts) ? posts : []).slice(0, 200)) {
      if (!p || typeof p !== 'object') continue;
      if (p.platform === 'x' && HANDLE_RE.test(p.handle || '') && /^\d{5,25}$/.test(String(p.postId))) {
        queued += store.enqueue('x', p.handle, String(p.postId), clock());
      } else if (p.platform === 'tg' && TG.isValidUsername(p.handle || '')) {
        const key = L.authorKey('tg', p.handle);
        if (!store.getKol(key)) { store.upsertKol(key, { platform: 'tg', handle: p.handle }, clock()); channels++; }
        store.setTracked(key, true);
      }
    }
    return { queued, channels };
  }

  // ---------------------------------------------------------------- X API v2 (optional, needs X_BEARER_TOKEN)

  async function collectXApi(handle) {
    if (!config.xBearer) throw new Error('X_BEARER_TOKEN is not set');
    const auth = { headers: { Authorization: 'Bearer ' + config.xBearer } };
    const user = await net.fetchJson(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=profile_image_url,name`, auth);
    if (!user || !user.data) throw new Error('user not found');
    const author = { platform: 'x', handle: user.data.username, name: user.data.name, avatar: user.data.profile_image_url || null };
    const cutoff = new Date(clock() - config.historyDays * DAY).toISOString();
    let token = null;
    let added = 0;
    for (let page = 0; page < 10; page++) {
      const q = `max_results=100&exclude=retweets&tweet.fields=created_at,entities&start_time=${encodeURIComponent(cutoff)}` + (token ? '&pagination_token=' + token : '');
      const res = await net.fetchJson(`https://api.x.com/2/users/${user.data.id}/tweets?${q}`, auth);
      const mentions = [];
      for (const t of (res && res.data) || []) {
        const links = ((t.entities && t.entities.urls) || []).map((u) => u.expanded_url || u.url).filter(Boolean);
        const postedAt = X.snowflakeToMs(t.id) || Date.parse(t.created_at);
        mentions.push(...mentionsFor({ postId: t.id, postedAt, url: `https://x.com/${author.handle}/status/${t.id}` }, t.text || '', links));
      }
      added += ingest(author, mentions).added;
      token = res && res.meta && res.meta.next_token;
      if (!token) break;
    }
    const key = L.authorKey('x', author.handle);
    store.setCollected(key, clock());
    return { key, added };
  }

  // ---------------------------------------------------------------- tracking & licenses

  function track(platform, handle) {
    if (platform === 'tg' && !TG.isValidUsername(handle)) throw new Error('invalid channel username');
    if (platform === 'x' && !HANDLE_RE.test(handle)) throw new Error('invalid handle');
    const key = L.authorKey(platform, handle);
    if (!store.getKol(key)) store.upsertKol(key, { platform, handle }, clock());
    store.setTracked(key, true);
    return key;
  }

  function planFor(licenseKey) {
    if (!licenseKey) return 'free';
    if (config.proKeys.includes(licenseKey)) return 'pro';
    const lic = store.license(licenseKey);
    if (!lic) return 'free';
    if (lic.expiresAt && Date.parse(lic.expiresAt) < clock()) return 'free';
    return lic.plan || 'pro';
  }

  function verifyLicense(licenseKey) {
    const key = String(licenseKey || '').trim();
    if (!key) return { valid: false, plan: 'free' };
    if (config.proKeys.includes(key)) return { valid: true, plan: 'pro', expiresAt: null };
    const lic = store.license(key);
    if (!lic) return { valid: false, plan: 'free' };
    const expired = lic.expiresAt && Date.parse(lic.expiresAt) < clock();
    return { valid: !expired, plan: expired ? 'free' : lic.plan, expiresAt: lic.expiresAt };
  }

  // ---------------------------------------------------------------- read models

  function card(key, plan) {
    const kol = store.getKol(key);
    if (!kol) return null;
    const all = scoredCalls(key);
    const counted = all.filter(S.counted);
    const summary = S.summarize(all, { now: clock() });
    const pro = plan === 'pro';
    const calls = pro ? all : counted.slice(0, CFG.FREE_RECENT_CALLS);
    return {
      author: authorOf(kol),
      summary,
      calls,
      total: counted.length,
      truncated: !pro && counted.length > CFG.FREE_RECENT_CALLS,
      plan,
      updatedAt: clock()
    };
  }

  function csv(key) {
    const kol = store.getKol(key);
    if (!kol) return null;
    return L.toCsv(authorOf(kol), scoredCalls(key));
  }

  function summaries(keys) {
    const out = {};
    for (const k of keys.slice(0, 100)) {
      const s = store.summary(String(k).toLowerCase());
      if (s && s.summary && s.summary.calls > 0) out[k] = s;
    }
    return out;
  }

  function leaderboard(platform, limit) {
    return store.leaderboard(platform === 'x' || platform === 'tg' ? platform : null, Math.min(500, limit || 100));
  }

  // ---------------------------------------------------------------- workers

  const timers = [];
  function loop(name, everyMs, fn) {
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try { await fn(); } catch (err) { logger.warn(`[${name}] ${err.message}`); } finally { busy = false; }
    };
    timers.push(setInterval(run, everyMs));
    setTimeout(run, 1000);
  }

  function start() {
    loop('price', config.priceEverySec * 1000, () => priceDue(10));
    loop('verify', config.verifyEverySec * 1000, () => processQueue(3));
    loop('collect', 60000, async () => {
      const stale = clock() - config.collectEveryMin * 60000;
      for (const k of store.tracked('tg')) {
        if (k.collectedAt && k.collectedAt > stale) continue;
        try { await collectTelegram(k.handle); } catch (err) { logger.warn(`[collect] t.me/${k.handle}: ${err.message}`); store.setCollected(k.key, clock()); }
      }
      if (config.xBearer) {
        for (const k of store.tracked('x')) {
          if (k.collectedAt && k.collectedAt > stale) continue;
          try { await collectXApi(k.handle); } catch (err) { logger.warn(`[collect] x/${k.handle}: ${err.message}`); store.setCollected(k.key, clock()); }
        }
      }
    });
  }

  function stop() {
    while (timers.length) clearInterval(timers.pop());
  }

  return {
    store, net, ingest, priceOne, priceDue, collectTelegram, verifyX, processQueue, accept, collectXApi,
    track, planFor, verifyLicense, card, csv, summaries, leaderboard, refreshSummary, start, stop
  };
}

module.exports = { createApp };
