/* Kolibri — price resolution: finds a market for a called token and measures what happened
 * 24 hours and 7 days after the post.
 *
 *   tickers   -> Binance spot (USDT pairs, full history) -> DexScreener search fallback
 *   addresses -> DexScreener (chain + pools) -> GeckoTerminal OHLCV
 *
 * All network access goes through ctx.fetchJson so the same code runs in the extension
 * service worker, in the Node server and in tests with recorded payloads.
 * Exposes globalThis.Kolibri.prices (and module.exports in Node). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.Kolibri.config;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  (root.Kolibri = root.Kolibri || {}).prices = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cfg) {
  'use strict';

  const E = cfg.ENDPOINTS;
  const MIN = cfg.MIN;
  const DAY_S = 86400;
  const MIN_TICKER_LIQUIDITY = 20000; // USD; below this a ticker->DEX match is too ambiguous
  const STALE_ENTRY_S = 2 * DAY_S; // last trade before the post may be this old and still count
  const GECKO_FRAMES = [['minute', 15, 900], ['hour', 1, 3600], ['day', 1, 86400]];

  class PriceError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  // ---------------------------------------------------------------- candles

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function cleanCandles(list) {
    const seen = new Set();
    return list
      .filter((c) => Number.isFinite(c.t) && c.c > 0 && Number.isFinite(c.c))
      .sort((a, b) => a.t - b.t)
      .filter((c) => (seen.has(c.t) ? false : (seen.add(c.t), true)));
  }

  /** Binance klines rows -> [{t (sec), o, h, l, c, v}] ascending. */
  function normBinance(rows) {
    if (!Array.isArray(rows)) return [];
    return cleanCandles(rows.map((r) => ({
      t: Math.floor(num(r[0]) / 1000), o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]), v: num(r[5])
    })));
  }

  /** GeckoTerminal OHLCV response -> [{t (sec), o, h, l, c, v}] ascending. */
  function normGecko(json) {
    const list = json && json.data && json.data.attributes && json.data.attributes.ohlcv_list;
    if (!Array.isArray(list)) return [];
    return cleanCandles(list.map((r) => ({
      t: Math.floor(num(r[0])), o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]), v: num(r[5])
    })));
  }

  /** Index of the last candle starting at or before t (sec), or -1. */
  function lastAtOrBefore(candles, t) {
    let lo = 0;
    let hi = candles.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /**
   * Measure a call against a candle series.
   * entry = close of the candle containing the post (≤ one candle after it was posted);
   * p24/p7 = last close at post+24h / post+7d; peak/low = best/worst close within 7 days.
   */
  function evaluate(candles, postedAtMs, nowMs, intervalSec) {
    const out = {
      status: 'no-entry', entry: null, entryAt: null, p24: null, p7: null, peak: null, peakAt: null,
      low: null, r24: null, r7: null, rPeak: null, rLow: null, nextCheckAt: null
    };
    if (!Array.isArray(candles) || !candles.length) return out;
    const iv = intervalSec || 900;
    const t0 = Math.floor(postedAtMs / 1000);
    const now = Math.floor(nowMs / 1000);

    const i0 = lastAtOrBefore(candles, t0);
    let entryIdx = -1;
    let entry = null;
    let entryAt = null;
    if (i0 >= 0 && t0 - candles[i0].t <= Math.max(STALE_ENTRY_S, 2 * iv)) {
      entryIdx = i0;
      entry = candles[i0].c;
      entryAt = t0 < candles[i0].t + iv ? candles[i0].t + iv : t0;
    } else if (i0 + 1 < candles.length && candles[i0 + 1].t - t0 <= 2 * iv) {
      entryIdx = i0 + 1;
      entry = candles[i0 + 1].o > 0 ? candles[i0 + 1].o : candles[i0 + 1].c;
      entryAt = candles[i0 + 1].t;
    }
    if (!(entry > 0)) return out;

    out.entry = entry;
    out.entryAt = entryAt * 1000;

    const priceAt = (offsetSec) => {
      const target = t0 + offsetSec;
      if (now < target) return null;
      const i = lastAtOrBefore(candles, target);
      return i >= entryIdx ? candles[i].c : entry;
    };
    out.p24 = priceAt(DAY_S);
    out.p7 = priceAt(7 * DAY_S);

    const windowEnd = Math.min(now, t0 + 7 * DAY_S);
    let peak = entry;
    let peakAt = out.entryAt;
    let low = entry;
    for (let i = entryIdx + 1; i < candles.length && candles[i].t <= windowEnd; i++) {
      const c = candles[i].c;
      if (c > peak) { peak = c; peakAt = candles[i].t * 1000; }
      if (c < low) low = c;
    }
    out.peak = peak;
    out.peakAt = peakAt;
    out.low = low;
    out.r24 = out.p24 != null ? out.p24 / entry - 1 : null;
    out.r7 = out.p7 != null ? out.p7 / entry - 1 : null;
    out.rPeak = peak / entry - 1;
    out.rLow = low / entry - 1;
    if (out.p7 != null) {
      out.status = 'priced';
    } else {
      out.status = 'partial';
      out.nextCheckAt = out.p24 == null
        ? (t0 + DAY_S) * 1000 + 20 * MIN
        : (t0 + 7 * DAY_S) * 1000 + 20 * MIN;
    }
    return out;
  }

  // ---------------------------------------------------------------- markets

  function liq(p) {
    return (p && p.liquidity && num(p.liquidity.usd)) || 0;
  }

  function sameAddr(a, b) {
    if (!a || !b) return false;
    return /^0x/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b;
  }

  function binanceMarket(symbol) {
    return {
      source: 'binance',
      symbol,
      pair: symbol + 'USDT',
      label: symbol + '/USDT',
      venue: 'Binance',
      url: `https://www.binance.com/en/trade/${symbol}_USDT?type=spot`,
      match: 'ticker'
    };
  }

  function poolRef(p) {
    return {
      chain: p.chainId,
      network: cfg.DEX_TO_GECKO[p.chainId] || null,
      pool: p.pairAddress,
      dex: p.dexId || '',
      liquidity: liq(p),
      createdAt: Number(p.pairCreatedAt) || null
    };
  }

  const VENUES = {
    pumpfun: 'pump.fun', pumpswap: 'PumpSwap', raydium: 'Raydium', orca: 'Orca', meteora: 'Meteora', uniswap: 'Uniswap',
    aerodrome: 'Aerodrome', pancakeswap: 'PancakeSwap', sushiswap: 'SushiSwap', camelot: 'Camelot', traderjoe: 'Trader Joe',
    sunswap: 'SunSwap', stonfi: 'STON.fi', dedust: 'DeDust', moonshot: 'Moonshot', launchlab: 'LaunchLab', fourmeme: 'four.meme'
  };
  function venueName(dexId, chain) {
    const id = String(dexId || '').toLowerCase();
    if (VENUES[id]) return VENUES[id];
    const s = id || String(chain || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  /** Build a DEX market from pairs of ONE token (best first). */
  function dexMarket(pairs, match) {
    const top = pairs[0];
    const symbol = String(top.baseToken.symbol || '').toUpperCase();
    const quote = String((top.quoteToken && top.quoteToken.symbol) || '').toUpperCase();
    return {
      source: 'dex',
      symbol,
      name: top.baseToken.name || '',
      token: top.baseToken.address,
      chain: top.chainId,
      label: quote ? `${symbol}/${quote}` : symbol,
      venue: venueName(top.dexId, top.chainId),
      url: top.url || `https://dexscreener.com/${top.chainId}/${top.pairAddress}`,
      match,
      pools: pairs.slice(0, 8).map(poolRef)
    };
  }

  /** From pairs of possibly several tokens/chains, keep the token with the most liquidity. */
  function bestTokenPairs(pairs) {
    const groups = new Map();
    for (const p of pairs) {
      const k = p.chainId + ':' + String(p.baseToken.address).toLowerCase();
      if (!groups.has(k)) groups.set(k, { total: 0, pairs: [] });
      const g = groups.get(k);
      g.total += liq(p);
      g.pairs.push(p);
    }
    let best = null;
    for (const g of groups.values()) if (!best || g.total > best.total) best = g;
    return best ? best.pairs.sort((a, b) => liq(b) - liq(a)) : [];
  }

  async function resolveSymbol(symbol, ctx, opts) {
    const o = opts || {};
    if (!o.skipBinance && ctx.binanceSymbols) {
      let set = null;
      try { set = await ctx.binanceSymbols(); } catch (_) { set = null; }
      if (set && set.has(symbol + 'USDT')) return binanceMarket(symbol);
    }
    const js = await ctx.fetchJson(`${E.dexscreener}/latest/dex/search?q=${encodeURIComponent(symbol)}`);
    const pairs = ((js && js.pairs) || []).filter((p) =>
      p && p.baseToken && String(p.baseToken.symbol || '').toUpperCase() === symbol && liq(p) >= MIN_TICKER_LIQUIDITY);
    if (!pairs.length) return null;
    return dexMarket(bestTokenPairs(pairs), 'ticker');
  }

  async function findPair(address, chain, ctx) {
    if (chain) {
      try {
        const js = await ctx.fetchJson(`${E.dexscreener}/latest/dex/pairs/${chain}/${address}`);
        const p = (js && js.pairs && js.pairs[0]) || (js && js.pair);
        if (p && p.baseToken) return p;
      } catch (_) { /* fall through to search */ }
    }
    const js = await ctx.fetchJson(`${E.dexscreener}/latest/dex/search?q=${encodeURIComponent(address)}`);
    return ((js && js.pairs) || []).find((p) => p && sameAddr(p.pairAddress, address)) || null;
  }

  async function resolveAddress(token, ctx) {
    const address = token.address;
    const js = await ctx.fetchJson(`${E.dexscreener}/latest/dex/tokens/${address}`);
    const all = ((js && js.pairs) || []).filter((p) => p && p.baseToken);
    let pairs = all.filter((p) => sameAddr(p.baseToken.address, address));
    if (!pairs.length) {
      // The link may have pointed at a pool/pair rather than the token itself.
      const pair = all.find((p) => sameAddr(p.pairAddress, address)) || await findPair(address, token.chain, ctx);
      if (pair) {
        const js2 = await ctx.fetchJson(`${E.dexscreener}/latest/dex/tokens/${pair.baseToken.address}`);
        pairs = ((js2 && js2.pairs) || []).filter((p) => p && p.baseToken && sameAddr(p.baseToken.address, pair.baseToken.address));
        if (!pairs.length) pairs = [pair];
      }
    }
    if (!pairs.length) return null;
    if (token.chain) {
      const onChain = pairs.filter((p) => p.chainId === token.chain);
      if (onChain.length) pairs = onChain;
    }
    return dexMarket(bestTokenPairs(pairs), 'address');
  }

  /** Find a market for a token ({kind:'symbol', symbol} | {kind:'address', address, chain}). */
  async function resolveMarket(token, ctx) {
    if (token.kind === 'symbol') return resolveSymbol(token.symbol, ctx);
    return resolveAddress(token, ctx);
  }

  // ---------------------------------------------------------------- OHLCV

  function geckoBase(ctx) { return ctx.geckoKey ? E.geckoDemo : E.gecko; }
  function geckoOpts(ctx) { return ctx.geckoKey ? { headers: { 'x-cg-demo-api-key': ctx.geckoKey } } : undefined; }

  async function geckoNetwork(pool, ctx) {
    if (pool.network) return pool.network;
    const json = await ctx.fetchJson(`${geckoBase(ctx)}/search/pools?query=${encodeURIComponent(pool.pool)}`, geckoOpts(ctx));
    for (const item of (json && json.data) || []) {
      const addr = item && item.attributes && item.attributes.address;
      if (addr && sameAddr(addr, pool.pool) && typeof item.id === 'string' && item.id.endsWith('_' + addr)) {
        pool.network = item.id.slice(0, item.id.length - addr.length - 1);
        return pool.network;
      }
    }
    return null;
  }

  async function binanceCandles(market, t0, end, ctx) {
    const start = t0 - 30 * MIN;
    const url = `${E.binance}/klines?symbol=${market.pair}&interval=15m&startTime=${start}&endTime=${end}&limit=1000`;
    return { candles: normBinance(await ctx.fetchJson(url)), interval: 900, frame: '15m' };
  }

  async function geckoCandles(pool, tokenAddress, t0, end, ctx) {
    const network = await geckoNetwork(pool, ctx);
    if (!network) throw new PriceError('no-network', 'GeckoTerminal does not know chain ' + pool.chain);
    const existedAtCall = !pool.createdAt || pool.createdAt <= t0 + 3600 * 1000;
    let result = { candles: [], interval: 900, frame: 'minute' };
    for (const [frame, aggregate, iv] of GECKO_FRAMES) {
      const before = Math.ceil(end / 1000) + iv;
      const from = Math.floor(t0 / 1000) - 2 * iv;
      const limit = Math.max(10, Math.min(1000, Math.ceil((before - from) / iv) + 2));
      const url = `${geckoBase(ctx)}/networks/${network}/pools/${pool.pool}/ohlcv/${frame}` +
        `?aggregate=${aggregate}&before_timestamp=${before}&limit=${limit}&currency=usd&token=${tokenAddress}`;
      const candles = normGecko(await ctx.fetchJson(url, geckoOpts(ctx)));
      result = { candles, interval: iv, frame };
      const covers = candles.length && candles[0].t <= Math.floor(t0 / 1000) + iv;
      // Empty or not reaching the post although the pool already existed: finer data may be
      // retained for a shorter period, so try a coarser frame. Otherwise this is the answer.
      if (covers || (candles.length && !existedAtCall)) return result;
    }
    return result;
  }

  function finish(ev, market, extra, now) {
    return Object.assign(ev, extra || {}, { venue: market.venue, checkedAt: now || Date.now() });
  }

  async function priceOnDex(call, market, ctx, now, end) {
    const t0 = call.postedAt;
    const pools = (market.pools || []).slice();
    if (!pools.length) return { status: 'unresolved' };
    const top = pools[0];
    // Prefer a pool that already existed at the time of the call (e.g. a launchpad curve
    // before migration), then fill in later prices from the main pool.
    const existed = pools.filter((p) => !p.createdAt || p.createdAt <= t0 + 3600 * 1000);
    const entryPool = existed[0] || top;

    const first = await geckoCandles(entryPool, market.token, t0, end, ctx);
    let ev = evaluate(first.candles, t0, now, first.interval);
    let used = entryPool;

    if (ev.status !== 'no-entry' && entryPool !== top && top.createdAt && top.createdAt > t0) {
      // Stitch: entry pool until the main pool starts trading, main pool afterwards.
      const main = await geckoCandles(top, market.token, t0, end, ctx);
      if (main.candles.length) {
        const cut = main.candles[0].t;
        const merged = first.candles.filter((c) => c.t < cut).concat(main.candles);
        ev = evaluate(merged, t0, now, Math.max(first.interval, main.interval));
        used = top;
      }
    } else if (ev.status === 'no-entry' && entryPool !== top) {
      const main = await geckoCandles(top, market.token, t0, end, ctx);
      ev = evaluate(main.candles, t0, now, main.interval);
      used = top;
    }
    return finish(ev, market, { frame: first.frame, pool: used.pool, network: used.network }, now);
  }

  /**
   * Price one call. Returns the evaluation plus `market` when a different market was used
   * (e.g. a ticker listed on Binance only after the call).
   */
  async function priceCall(call, market, ctx) {
    const now = ctx.now ? ctx.now() : Date.now();
    const t0 = call.postedAt;
    const end = Math.min(now, t0 + cfg.D7 + 30 * MIN);
    if (!market) return { status: 'unresolved' };

    if (market.source === 'binance') {
      const res = await binanceCandles(market, t0, end, ctx);
      const ev = evaluate(res.candles, t0, now, res.interval);
      if (ev.status !== 'no-entry') return finish(ev, market, { frame: res.frame }, now);
      // Listed on Binance after the call: measure it where it traded at the time.
      const dex = await resolveSymbol(market.symbol, ctx, { skipBinance: true });
      if (!dex) return finish(ev, market, null, now);
      const evDex = await priceCall(call, dex, ctx);
      evDex.market = dex;
      return evDex;
    }

    if (now - t0 > cfg.DEX_HISTORY_DAYS * cfg.DAY && !ctx.geckoHistory) {
      return { status: 'too-old', checkedAt: now };
    }
    return priceOnDex(call, market, ctx, now, end);
  }

  return {
    PriceError,
    normBinance,
    normGecko,
    evaluate,
    lastAtOrBefore,
    resolveMarket,
    resolveSymbol,
    resolveAddress,
    priceCall,
    binanceMarket,
    dexMarket,
    bestTokenPairs
  };
});
