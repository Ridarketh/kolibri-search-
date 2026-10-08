'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Store } = require('../server/src/db.js');
const { createApp } = require('../server/src/core.js');
const { createHandler } = require('../server/src/http.js');
const { loadConfig } = require('../server/src/config.js');
const FX = require('./e2e/fixtures.js');
const { world } = require('./helpers/fake-world.js');

const now = Date.now();
const DAY = 86400000;

function makeApp(env) {
  const config = Object.assign(loadConfig(Object.assign({ PRO_KEYS: 'KOLIBRI-TEST-PRO-0001', ADMIN_TOKEN: 'admin-secret', X_BEARER_TOKEN: 'xtoken' }, env || {})), {
    rateLimits: { 'api.geckoterminal.com': 60000, 'api.dexscreener.com': 60000, 'data-api.binance.vision': 60000, 't.me': 60000, 'publish.twitter.com': 60000, 'api.x.com': 60000 }
  });
  const w = world(now);
  const store = new Store(':memory:');
  const app = createApp({ config, store, fetchImpl: w.fetchImpl, log: { warn() {} } });
  return { app, store, config, w };
}

async function priceAll(app) {
  for (let i = 0; i < 50; i++) if (!(await app.priceDue(20))) return;
}

test('collects a Telegram channel from t.me and grades it', async () => {
  const { app, store } = makeApp();
  const res = await app.collectTelegram('alphacalls');
  assert.equal(res.key, 'tg:alphacalls');
  assert.equal(store.calls('tg:alphacalls').length, 9);
  await priceAll(app);
  const s = store.summary('tg:alphacalls');
  assert.equal(s.author.name, 'Alpha Calls');
  assert.equal(s.summary.priced7, 7);
  assert.match(s.summary.grade, /^[ABCDF]$/);
  // collecting again adds nothing new
  assert.equal((await app.collectTelegram('alphacalls')).added, 0);
});

test('free cards show recent calls only; Pro sees everything and can export', async () => {
  const { app } = makeApp();
  await app.collectTelegram('busycalls');
  await priceAll(app);
  const free = app.card('tg:busycalls', app.planFor(null));
  assert.equal(free.calls.length, 10);
  assert.equal(free.total, 14);
  assert.equal(free.truncated, true);
  assert.ok(free.calls[0].postedAt > free.calls[9].postedAt, 'most recent first');
  const pro = app.card('tg:busycalls', app.planFor('KOLIBRI-TEST-PRO-0001'));
  assert.equal(pro.calls.length, 14);
  assert.equal(pro.truncated, false);
  assert.equal(app.csv('tg:busycalls').trim().split('\n').length, 15);
});

test('crowd-sourced X posts are verified through oEmbed and credited to the real author', async () => {
  const { app, store, w } = makeApp();
  const r = app.accept([
    { platform: 'x', handle: 'impostor', postId: w.tweetId }, // wrong handle claimed first
    { platform: 'x', handle: 'blknoiz06', postId: w.tweetId }, // same post again: deduped
    { platform: 'x', handle: 'blknoiz06', postId: 'not-a-number' },
    { platform: 'x', handle: 'someone', postId: '1234567890123' }, // X does not know it
    { platform: 'tg', handle: 'gemhunters' }
  ]);
  assert.deepEqual(r, { queued: 2, channels: 1 });
  await app.processQueue(10);
  const calls = store.calls('x:blknoiz06');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token.symbol, 'WIF');
  assert.equal(calls[0].postedAt, require('../extension/shared/extract.js').snowflakeToMs(w.tweetId));
  assert.equal(store.getKol('x:blknoiz06').name, 'Ansem');
  assert.equal(store.getKol('x:impostor'), null, 'nothing is credited to the claimed handle');
  assert.equal(store.getKol('tg:gemhunters').tracked, true);
  assert.equal(store.stats().queued, 0, 'unknown posts are dropped after a 404');
});

test('optional X API collector uses expanded links', async () => {
  const { app, store } = makeApp();
  const res = await app.collectXApi('apikol');
  assert.equal(res.key, 'x:apikol');
  const calls = store.calls('x:apikol');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token.address, FX.ADDR.GIGA);
  assert.equal(store.getKol('x:apikol').handle, 'ApiKol');
});

test('licenses: env keys, stored keys, expiry', () => {
  const { app, store } = makeApp();
  assert.deepEqual(app.verifyLicense('KOLIBRI-TEST-PRO-0001'), { valid: true, plan: 'pro', expiresAt: null });
  assert.equal(app.verifyLicense('nope').valid, false);
  store.upsertLicense('KOLIBRI-STORED-1', 'pro', new Date(now + DAY).toISOString(), null, now);
  store.upsertLicense('KOLIBRI-EXPIRED-1', 'pro', new Date(now - DAY).toISOString(), null, now);
  assert.equal(app.planFor('KOLIBRI-STORED-1'), 'pro');
  assert.equal(app.planFor('KOLIBRI-EXPIRED-1'), 'free');
  assert.equal(app.verifyLicense('KOLIBRI-EXPIRED-1').valid, false);
});

test('HTTP API', async () => {
  const { app, config } = makeApp();
  await app.collectTelegram('alphacalls');
  await app.collectTelegram('busycalls');
  await priceAll(app);
  const server = http.createServer(createHandler(app, config));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, h) => fetch(base + p, { headers: h || {} });
  const post = (p, body, h) => fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, h || {}), body: JSON.stringify(body) });
  try {
    const health = await (await get('/v1/health')).json();
    assert.equal(health.ok, true);
    assert.equal(health.kols, 2);

    const board = await (await get('/v1/leaderboard')).json();
    assert.equal(board.items.length, 2);
    assert.ok(board.items[0].summary.grade);

    const sums = await (await get('/v1/summaries?keys=' + encodeURIComponent('tg:alphacalls,x:nobody,TG:BusyCalls'))).json();
    assert.deepEqual(Object.keys(sums.items).sort(), ['TG:BusyCalls', 'tg:alphacalls']);

    const card = await (await get('/v1/kols/tg/busycalls')).json();
    assert.equal(card.truncated, true);
    assert.equal(card.calls.length, 10);
    const proCard = await (await get('/v1/kols/tg/busycalls', { Authorization: 'Bearer KOLIBRI-TEST-PRO-0001' })).json();
    assert.equal(proCard.calls.length, 14);
    assert.equal((await get('/v1/kols/tg/nobody')).status, 404);
    assert.equal((await get('/v1/kols/tg/%23123')).status, 404);

    assert.equal((await get('/v1/kols/tg/busycalls/export.csv')).status, 402);
    const csv = await get('/v1/kols/tg/busycalls/export.csv', { Authorization: 'Bearer KOLIBRI-TEST-PRO-0001' });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);

    assert.deepEqual(await (await post('/v1/license/verify', { key: 'KOLIBRI-TEST-PRO-0001' })).json(), { valid: true, plan: 'pro', expiresAt: null });
    assert.deepEqual(await (await post('/v1/ingest', { posts: [{ platform: 'tg', handle: 'newchannel' }] })).json(), { queued: 0, channels: 1 });
    assert.equal((await post('/v1/admin/track', { platform: 'tg', handle: 'other' })).status, 401);
    assert.equal((await post('/v1/admin/track', { platform: 'tg', handle: 'other' }, { Authorization: 'Bearer admin-secret' })).status, 200);
    assert.equal((await post('/v1/license/verify', '{oops')).status, 200);
    const bad = await fetch(base + '/v1/ingest', { method: 'POST', body: '{oops' });
    assert.equal(bad.status, 400);

    const page = await (await get('/')).text();
    assert.match(page, /Alpha Calls/);
    assert.match(page, /Busy Calls/);
    assert.equal((await get('/nope')).status, 404);
  } finally {
    server.close();
  }
});
