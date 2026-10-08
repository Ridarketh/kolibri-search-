'use strict';
// A tiny market simulator that answers like Binance, DexScreener and GeckoTerminal do,
// so price resolution can be tested without network access.

/** Price series: fn(tSec) -> price, sampled every `step` seconds between from..to (sec). */
function series(fn, fromSec, toSec, step) {
  const out = [];
  for (let t = Math.floor(fromSec / step) * step; t <= toSec; t += step) {
    const o = fn(t);
    const c = fn(t + step - 1);
    out.push({ t, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: 1000 });
  }
  return out;
}

function aggregate(candles, step) {
  const map = new Map();
  for (const c of candles) {
    const k = Math.floor(c.t / step) * step;
    const g = map.get(k);
    if (!g) map.set(k, { t: k, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    else { g.h = Math.max(g.h, c.h); g.l = Math.min(g.l, c.l); g.c = c.c; g.v += c.v; }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

class MarketSim {
  constructor() {
    this.binance = new Map(); // SYMBOLUSDT -> 15m candles
    this.pools = new Map(); // `${network}/${pool}` -> 15m candles
    this.dexTokens = new Map(); // address -> pairs[]
    this.dexPairs = new Map(); // `${chain}/${pair}` -> pair
    this.dexSearch = new Map(); // query -> pairs[]
    this.geckoSearch = new Map(); // query -> data[]
    this.requests = [];
    this.minuteRetentionSec = Infinity; // pretend minute candles are kept only this long
    this.now = 0;
  }

  ctx(nowMs) {
    this.now = nowMs;
    return {
      now: () => nowMs,
      fetchJson: (url, opts) => this.fetchJson(url, opts),
      binanceSymbols: async () => new Set(this.binance.keys())
    };
  }

  async fetchJson(url) {
    this.requests.push(url);
    const u = new URL(url);
    const p = u.pathname;
    let m;
    if (u.hostname === 'data-api.binance.vision' && p.endsWith('/ticker/price')) {
      return [...this.binance.keys()].map((symbol) => ({ symbol, price: '1' })).concat([{ symbol: 'BTCEUR', price: '1' }]);
    }
    if (u.hostname === 'data-api.binance.vision' && p.endsWith('/klines')) {
      const rows = this.binance.get(u.searchParams.get('symbol'));
      if (!rows) throw Object.assign(new Error('HTTP 400'), { status: 400 });
      const start = +u.searchParams.get('startTime') / 1000;
      const end = +u.searchParams.get('endTime') / 1000;
      const limit = +u.searchParams.get('limit');
      return rows.filter((c) => c.t >= Math.floor(start / 900) * 900 && c.t <= end).slice(0, limit)
        .map((c) => [c.t * 1000, String(c.o), String(c.h), String(c.l), String(c.c), '1', c.t * 1000 + 899999]);
    }
    if (u.hostname === 'api.dexscreener.com') {
      if ((m = p.match(/^\/latest\/dex\/tokens\/(.+)$/))) return { schemaVersion: '1.0.0', pairs: this.dexTokens.get(m[1]) || null };
      if ((m = p.match(/^\/latest\/dex\/pairs\/([^/]+)\/(.+)$/))) {
        const pair = this.dexPairs.get(m[1] + '/' + m[2]);
        return { schemaVersion: '1.0.0', pairs: pair ? [pair] : null, pair: pair || null };
      }
      if (p === '/latest/dex/search') return { schemaVersion: '1.0.0', pairs: this.dexSearch.get(u.searchParams.get('q')) || [] };
    }
    if (u.hostname === 'api.geckoterminal.com') {
      if (p === '/api/v2/search/pools') return { data: this.geckoSearch.get(u.searchParams.get('query')) || [] };
      if ((m = p.match(/^\/api\/v2\/networks\/([^/]+)\/pools\/([^/]+)\/ohlcv\/(minute|hour|day)$/))) {
        const base = this.pools.get(m[1] + '/' + m[2]);
        if (!base) throw Object.assign(new Error('HTTP 404'), { status: 404 });
        const step = m[3] === 'minute' ? 60 * +u.searchParams.get('aggregate') : m[3] === 'hour' ? 3600 : 86400;
        let candles = step === 900 ? base : aggregate(base, step);
        if (m[3] === 'minute') candles = candles.filter((c) => this.now / 1000 - c.t <= this.minuteRetentionSec);
        const before = +u.searchParams.get('before_timestamp');
        const limit = +u.searchParams.get('limit');
        const list = candles.filter((c) => c.t < before).slice(-limit).reverse()
          .map((c) => [c.t, c.o, c.h, c.l, c.c, c.v]);
        return { data: { id: 'x', type: 'ohlcv_request_response', attributes: { ohlcv_list: list } }, meta: {} };
      }
    }
    throw Object.assign(new Error('unmocked ' + url), { status: 404 });
  }
}

function pair({ chain, dex, pair, base, symbol, quote = 'SOL', liquidity, createdAt }) {
  return {
    chainId: chain, dexId: dex, url: `https://dexscreener.com/${chain}/${pair.toLowerCase()}`, pairAddress: pair,
    baseToken: { address: base, name: symbol + ' token', symbol },
    quoteToken: { address: 'Q', name: quote, symbol: quote },
    priceNative: '1', priceUsd: '1', liquidity: { usd: liquidity, base: 1, quote: 1 },
    pairCreatedAt: createdAt
  };
}

module.exports = { MarketSim, series, aggregate, pair };
