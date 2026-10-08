'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../extension/shared/prices.js');
const { MarketSim, series, pair } = require('./helpers/market-sim.js');

const H = 3600;
const D = 86400;
const T0 = Date.UTC(2025, 5, 2, 14, 7, 0); // post time (ms), mid-candle
const t0 = T0 / 1000;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('evaluate: entry, 24h, 7d, peak and drawdown on a rising series', () => {
  // price = 1 + hours since t0 / 100, with a dip on day 2
  const f = (t) => (t > t0 + 1.5 * D && t < t0 + 2 * D ? 0.8 : 1 + (t - t0) / H / 100);
  const candles = series(f, t0 - 2 * H, t0 + 8 * D, 900);
  const ev = P.evaluate(candles, T0, T0 + 30 * D * 1000, 900);
  const c0 = candles.find((c) => c.t <= t0 && t0 < c.t + 900);
  assert.equal(ev.status, 'priced');
  assert.equal(ev.entry, c0.c);
  const c24 = candles.find((c) => c.t <= t0 + D && t0 + D < c.t + 900);
  assert.equal(ev.p24, c24.c);
  assert.ok(close(ev.r24, c24.c / c0.c - 1));
  assert.ok(ev.r7 > 1.6 && ev.r7 < 1.7, 'about +168% after 168 hours');
  assert.ok(ev.rPeak >= ev.r7);
  assert.ok(ev.rLow < -0.15, 'captures the day-2 dip');
  assert.equal(ev.nextCheckAt, null);
});

test('evaluate: horizons in the future stay pending with a next check time', () => {
  const candles = series(() => 2, t0 - H, t0 + 2 * H, 900);
  const ev = P.evaluate(candles, T0, T0 + 2 * H * 1000, 900);
  assert.equal(ev.status, 'partial');
  assert.equal(ev.p24, null);
  assert.equal(ev.r24, null);
  assert.equal(ev.nextCheckAt, (t0 + D) * 1000 + 20 * 60 * 1000);
  const later = series(() => 2, t0 - H, t0 + 2 * D, 900);
  const ev2 = P.evaluate(later, T0, T0 + 2 * D * 1000, 900);
  assert.equal(ev2.r24, 0);
  assert.equal(ev2.nextCheckAt, (t0 + 7 * D) * 1000 + 20 * 60 * 1000);
});

test('evaluate: a pool that starts trading right after the post uses its first open', () => {
  const candles = series((t) => (t < t0 + 900 ? 5 : 6), t0 + 600, t0 + 8 * D, 900);
  const ev = P.evaluate(candles, T0, T0 + 9 * D * 1000, 900);
  assert.equal(ev.entry, candles[0].o);
});

test('evaluate: no data near the post means no entry', () => {
  const candles = series(() => 1, t0 + 3 * D, t0 + 9 * D, 900);
  assert.equal(P.evaluate(candles, T0, T0 + 10 * D * 1000, 900).status, 'no-entry');
  assert.equal(P.evaluate([], T0, T0, 900).status, 'no-entry');
});

test('evaluate: sparse trading carries the last trade forward', () => {
  const candles = [
    { t: t0 - D, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { t: t0 + 2 * D, o: 2, h: 2, l: 2, c: 2, v: 1 }
  ];
  const ev = P.evaluate(candles, T0, T0 + 8 * D * 1000, 900);
  assert.equal(ev.entry, 1);
  assert.equal(ev.r24, 0);
  assert.equal(ev.r7, 1);
});

test('normGecko sorts descending GeckoTerminal lists and drops junk', () => {
  const json = { data: { attributes: { ohlcv_list: [[300, 1, 1, 1, 3, 1], [200, 1, 1, 1, 2, 1], [100, 1, 1, 1, 0, 1], [200, 9, 9, 9, 9, 9]] } } };
  assert.deepEqual(P.normGecko(json).map((c) => [c.t, c.c]), [[200, 2], [300, 3]]);
  assert.deepEqual(P.normGecko(null), []);
});

test('resolveAddress: picks the chain/token with the most liquidity, honors chain hints', async () => {
  const sim = new MarketSim();
  const addr = '0x532f27101965dd16442e59d40670faf5ebb142e4';
  sim.dexTokens.set(addr, [
    pair({ chain: 'ethereum', dex: 'uniswap', pair: '0xe1', base: '0x532F27101965dd16442E59d40670FaF5eBB142E4', symbol: 'BRETT', liquidity: 90000 }),
    pair({ chain: 'base', dex: 'aerodrome', pair: '0xb1', base: '0x532F27101965dd16442E59d40670FaF5eBB142E4', symbol: 'BRETT', liquidity: 4000000 }),
    pair({ chain: 'base', dex: 'uniswap', pair: '0xb2', base: '0x532F27101965dd16442E59d40670FaF5eBB142E4', symbol: 'BRETT', liquidity: 800000 }),
    pair({ chain: 'base', dex: 'uniswap', pair: '0xq', base: '0xother', symbol: 'WETH', liquidity: 9e9 })
  ]);
  const ctx = sim.ctx(T0);
  const m = await P.resolveAddress({ kind: 'address', address: addr }, ctx);
  assert.equal(m.source, 'dex');
  assert.equal(m.chain, 'base');
  assert.equal(m.symbol, 'BRETT');
  assert.deepEqual(m.pools.map((p) => p.pool), ['0xb1', '0xb2']);
  assert.equal(m.pools[0].network, 'base');
  const hinted = await P.resolveAddress({ kind: 'address', address: addr, chain: 'ethereum' }, ctx);
  assert.equal(hinted.chain, 'ethereum');
  assert.equal(hinted.pools[0].network, 'eth');
});

test('resolveAddress: a pool address from a chart link resolves to its token', async () => {
  const sim = new MarketSim();
  const poolAddr = '4xxm4cdb6mescxm52xvynknbrbx8bt2zi3gfrjqqfhpo';
  const token = 'TokenMint1111111111111111111111111111111pump';
  const p = pair({ chain: 'solana', dex: 'raydium', pair: poolAddr, base: token, symbol: 'GIGA', liquidity: 300000 });
  sim.dexPairs.set('solana/' + poolAddr, p);
  sim.dexTokens.set(token, [p]);
  const m = await P.resolveAddress({ kind: 'address', address: poolAddr, chain: 'solana', maybePair: true }, sim.ctx(T0));
  assert.equal(m.token, token);
  assert.equal(m.symbol, 'GIGA');
});

test('resolveSymbol: Binance first, then the most liquid exact-symbol DEX token', async () => {
  const sim = new MarketSim();
  sim.binance.set('PEPEUSDT', []);
  assert.equal((await P.resolveSymbol('PEPE', sim.ctx(T0))).source, 'binance');

  sim.dexSearch.set('MOODENG', [
    pair({ chain: 'solana', dex: 'raydium', pair: 'P1', base: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', symbol: 'MOODENG', liquidity: 5e6 }),
    pair({ chain: 'solana', dex: 'orca', pair: 'P2', base: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', symbol: 'MOODENG', liquidity: 1e6 }),
    pair({ chain: 'base', dex: 'uniswap', pair: 'P3', base: '0xfake', symbol: 'MOODENG', liquidity: 3e6 }),
    pair({ chain: 'bsc', dex: 'pancake', pair: 'P4', base: '0xscam', symbol: 'MOODENG', liquidity: 500 }),
    pair({ chain: 'solana', dex: 'raydium', pair: 'P5', base: 'X', symbol: 'MOODENGX', liquidity: 9e9 })
  ]);
  const m = await P.resolveSymbol('MOODENG', sim.ctx(T0));
  assert.equal(m.source, 'dex');
  assert.equal(m.chain, 'solana');
  assert.equal(m.match, 'ticker');
  assert.deepEqual(m.pools.map((p) => p.pool), ['P1', 'P2']);
  assert.equal(await P.resolveSymbol('NOPE', sim.ctx(T0)), null);
});

test('priceCall: Binance ticker', async () => {
  const sim = new MarketSim();
  sim.binance.set('WIFUSDT', series((t) => 2 + (t - t0) / D * 0.1, t0 - 2 * D, t0 + 12 * D, 900));
  const ctx = sim.ctx(T0 + 20 * D * 1000);
  const market = await P.resolveSymbol('WIF', ctx);
  const ev = await P.priceCall({ postedAt: T0 }, market, ctx);
  assert.equal(ev.status, 'priced');
  assert.ok(close(ev.r7, (2 + 0.7) / 2 - 1, 0.01));
  assert.equal(ev.venue, 'Binance');
});

test('priceCall: ticker listed on Binance after the call is measured on the DEX', async () => {
  const sim = new MarketSim();
  const mint = 'Mint22222222222222222222222222222222222pump';
  sim.binance.set('NEWUSDT', series(() => 9, t0 + 5 * D, t0 + 12 * D, 900));
  sim.dexSearch.set('NEW', [pair({ chain: 'solana', dex: 'raydium', pair: 'PoolNew', base: mint, symbol: 'NEW', liquidity: 2e6, createdAt: T0 - 3 * D * 1000 })]);
  sim.pools.set('solana/PoolNew', series((t) => (t < t0 + 5 * D ? 1 : 9), t0 - 3 * D, t0 + 12 * D, 900));
  const ctx = sim.ctx(T0 + 20 * D * 1000);
  const market = await P.resolveSymbol('NEW', ctx);
  assert.equal(market.source, 'binance');
  const ev = await P.priceCall({ postedAt: T0 }, market, ctx);
  assert.equal(ev.status, 'priced');
  assert.equal(ev.entry, 1);
  assert.equal(ev.r7, 8);
  assert.equal(ev.market.source, 'dex');
});

test('priceCall: launchpad call stitched with the post-migration pool', async () => {
  const sim = new MarketSim();
  const mint = 'Mint33333333333333333333333333333333333pump';
  // Bonding curve trades from before the call until migration 2 days later; the AMM pool
  // (most liquidity today) only exists after migration.
  sim.pools.set('solana/Curve', series((t) => 1 + (t - t0) / D * 0.5, t0 - D, t0 + 2 * D, 900));
  sim.pools.set('solana/Amm', series(() => 4, t0 + 2 * D, t0 + 12 * D, 900));
  const market = P.dexMarket([
    pair({ chain: 'solana', dex: 'raydium', pair: 'Amm', base: mint, symbol: 'CAT', liquidity: 9e5, createdAt: T0 + 2 * D * 1000 }),
    pair({ chain: 'solana', dex: 'pumpfun', pair: 'Curve', base: mint, symbol: 'CAT', liquidity: 0, createdAt: T0 - D * 1000 })
  ], 'address');
  const ctx = sim.ctx(T0 + 20 * D * 1000);
  const ev = await P.priceCall({ postedAt: T0 }, market, ctx);
  assert.equal(ev.status, 'priced');
  assert.ok(close(ev.entry, 1, 0.01));
  assert.ok(close(ev.p24, 1.5, 0.01), 'day 1 from the curve');
  assert.equal(ev.p7, 4, 'day 7 from the AMM pool');
  assert.ok(ev.rPeak > 2.9, 'peak comes from the AMM pool');
});

test('priceCall: coarser frames are used when minute candles are not retained', async () => {
  const sim = new MarketSim();
  sim.minuteRetentionSec = 30 * D;
  sim.pools.set('base/0xb1', series(() => 1, t0 - 30 * D, t0 + 100 * D, 900));
  const market = P.dexMarket([pair({ chain: 'base', dex: 'aerodrome', pair: '0xb1', base: '0xabc', symbol: 'OLD', liquidity: 1e6, createdAt: T0 - 30 * D * 1000 })], 'address');
  const ev = await P.priceCall({ postedAt: T0 }, market, sim.ctx(T0 + 90 * D * 1000));
  assert.equal(ev.status, 'priced');
  assert.equal(ev.frame, 'hour');
  assert.equal(sim.requests.filter((u) => u.includes('/ohlcv/')).length, 2);
});

test('priceCall: DEX calls older than the free history window are not guessed', async () => {
  const sim = new MarketSim();
  const market = P.dexMarket([pair({ chain: 'base', dex: 'x', pair: '0x1', base: '0x2', symbol: 'Z', liquidity: 1 })], 'address');
  const ev = await P.priceCall({ postedAt: T0 }, market, sim.ctx(T0 + 400 * D * 1000));
  assert.equal(ev.status, 'too-old');
  assert.equal(sim.requests.length, 0);
});

test('unknown DexScreener chains are mapped through GeckoTerminal search', async () => {
  const sim = new MarketSim();
  sim.geckoSearch.set('0xpool', [{ id: 'some-new-chain_0xpool', type: 'pool', attributes: { address: '0xpool' } }]);
  sim.pools.set('some-new-chain/0xpool', series(() => 3, t0 - D, t0 + 9 * D, 900));
  const market = P.dexMarket([pair({ chain: 'somenewchain', dex: 'x', pair: '0xpool', base: '0xt', symbol: 'N', liquidity: 1e5 })], 'address');
  const ev = await P.priceCall({ postedAt: T0 }, market, sim.ctx(T0 + 10 * D * 1000));
  assert.equal(ev.status, 'priced');
  assert.equal(ev.network, 'some-new-chain');
});
