/* Kolibri — background pricing queue. Picks calls that need a price (new, or a 24h/7d
 * horizon has passed), resolves the market once per token and measures the call.
 * Survives service-worker restarts: all state lives in storage, an alarm resumes work. */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const P = K.prices;
  const L = K.ledger;
  const Store = K.store;
  const Net = K.net;

  const BURST_MS = 4 * 60 * 1000;
  let running = false;
  let focusKey = null;
  let focusAt = 0;
  let binanceCache = null; // {set, at}

  function setFocus(key) {
    focusKey = key;
    focusAt = Date.now();
  }

  async function binanceSymbols() {
    if (binanceCache && Date.now() - binanceCache.at < 12 * 3600000) return binanceCache.set;
    const stored = await Store.get('binance:symbols');
    if (stored && Date.now() - stored.at < 24 * 3600000) {
      binanceCache = { set: new Set(stored.list), at: stored.at };
      return binanceCache.set;
    }
    const rows = await Net.fetchJson(K.config.ENDPOINTS.binance + '/ticker/price');
    const list = (Array.isArray(rows) ? rows : []).map((r) => r.symbol).filter((s) => /USDT$/.test(s));
    await chrome.storage.local.set({ 'binance:symbols': { list, at: Date.now() } });
    binanceCache = { set: new Set(list), at: Date.now() };
    return binanceCache.set;
  }

  async function ctx() {
    const settings = await Store.getSettings();
    return {
      now: () => Date.now(),
      fetchJson: (url, opts) => Net.fetchJson(url, opts),
      binanceSymbols,
      geckoKey: settings.geckoKey || null
    };
  }

  function marketCacheKey(token) {
    return (token.kind === 'symbol' ? 'sym:' + token.symbol : 'addr:' + token.address) + (token.chain ? '@' + token.chain : '');
  }

  async function marketFor(token, c) {
    const cacheKey = marketCacheKey(token);
    const cached = await Store.getMarketCache(cacheKey);
    if (cached !== undefined) return cached;
    const market = await P.resolveMarket(token, c);
    await Store.setMarketCache(cacheKey, market);
    return market;
  }

  async function nextDue() {
    const due = (await Store.get('due')) || {};
    const now = Date.now();
    let key = null;
    if (focusKey && Date.now() - focusAt < 10 * 60000 && due[focusKey] !== undefined && due[focusKey] <= now) key = focusKey;
    if (!key) {
      let best = Infinity;
      for (const [k, t] of Object.entries(due)) if (t <= now && t < best) { best = t; key = k; }
    }
    if (!key) return null;
    const rec = await Store.getKol(key);
    if (!rec) {
      await Store.withLock('due', async () => {
        const d = (await Store.get('due')) || {};
        delete d[key];
        await chrome.storage.local.set({ due: d });
      });
      return { key, call: null };
    }
    // newest calls first: those are what people look at
    const call = rec.calls.filter((c) => L.isDue(c, now)).sort((a, b) => b.postedAt - a.postedAt)[0] || null;
    if (!call) await Store.withLock('kol:' + key, async () => {
      const fresh = await Store.getKol(key);
      if (fresh) await Store.saveKol(fresh); // recomputes the due index
    });
    return { key, call };
  }

  async function priceOne(key, call) {
    const c = await ctx();
    let market;
    let result;
    let error = null;
    try {
      market = call.market || await marketFor(call.token, c);
      result = market ? await P.priceCall(call, market, c) : { status: 'unresolved' };
    } catch (err) {
      error = err;
    }
    const now = Date.now();
    await Store.withLock('kol:' + key, async () => {
      const rec = await Store.getKol(key);
      if (!rec) return;
      const target = rec.calls.find((x) => x.id === call.id);
      if (!target) return;
      if (error) {
        // A pool GeckoTerminal does not know (404) will not appear later: give up on it.
        if (error.status === 404 || error.code === 'no-network') L.applyResult(target, market, { status: 'unresolved' }, now);
        else L.applyError(target, error, now);
      } else {
        L.applyResult(target, market, result, now);
        // the token's market is shared by all its calls
        for (const other of rec.calls) if (other !== target && other.tokenKey === target.tokenKey && !other.market && market) other.market = market;
      }
      await Store.saveKol(rec);
    });
    if (market && !error) await Store.setMarketCache(marketCacheKey(call.token), market);
    return !error;
  }

  /** Work through due calls for a while. Safe to call often; only one burst runs at a time. */
  async function pump() {
    if (running) return;
    running = true;
    const stopAt = Date.now() + BURST_MS;
    try {
      while (Date.now() < stopAt) {
        const next = await nextDue();
        if (!next) break;
        if (!next.call) continue;
        await priceOne(next.key, next.call);
      }
    } catch (err) {
      console.warn('[kolibri] pricing burst stopped:', err);
    } finally {
      running = false;
    }
  }

  async function forgetMarket(token) {
    await chrome.storage.local.remove('mkt:' + marketCacheKey(token));
  }

  K.resolver = { pump, setFocus, priceOne, binanceSymbols, forgetMarket, isRunning: () => running };
})(globalThis);
