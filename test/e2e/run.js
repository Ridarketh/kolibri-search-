#!/usr/bin/env node
/* End-to-end test: loads the unpacked extension in Chromium, serves mock X / Telegram Web pages
 * and a simulated market (Binance, DexScreener, GeckoTerminal, t.me), and checks the whole flow:
 * collection -> pricing -> grades -> badges -> report card -> popup / report / options pages.
 *
 *   npm run test:e2e            (headless)
 *   HEADED=1 npm run test:e2e   (watch it)
 *   SHOTS=1 npm run test:e2e    (also write docs/screenshots/*.png)
 */
'use strict';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { chromium } = require('playwright');
const FX = require('./fixtures.js');

const ROOT = path.join(__dirname, '..', '..');
const EXT = path.join(ROOT, 'extension');
const SHOTS = process.env.SHOTS ? path.join(ROOT, 'docs', 'screenshots') : null;

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail !== undefined ? '\n       ' + JSON.stringify(detail).slice(0, 600) : '')); }
}

async function waitFor(fn, pred, timeout, label) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('  …timed out waiting for ' + label);
  return last;
}

(async () => {
  const now = Date.now();
  const sim = FX.market(now);
  const x = FX.xFixture(now);
  const xNew = FX.xFixtureNew(now);
  const tg = FX.tgChannels(now);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kolibri-e2e-'));

  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: SHOTS ? 2 : 1,
    colorScheme: 'light',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };

  // ---- network: everything is simulated
  const apiCalls = [];
  await ctx.route(/^https:\/\/(data-api\.binance\.vision|api\.dexscreener\.com|api\.geckoterminal\.com)\//, async (route) => {
    const url = route.request().url();
    apiCalls.push(url);
    try {
      await route.fulfill({ json: await sim.fetchJson(url) });
    } catch (e) {
      await route.fulfill({ status: e.status || 500, json: { error: String(e.message) } });
    }
  });
  await ctx.route('https://t.me/**', async (route) => {
    const u = new URL(route.request().url());
    const m = /^\/s\/([A-Za-z0-9_]+)/.exec(u.pathname);
    const ch = m && tg[m[1].toLowerCase()];
    if (!ch) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: FX.tmePage(ch, Number(u.searchParams.get('before')) || 0) });
  });
  const avatars = { alphaguy: ['A', '#7856ff'], otherkol: ['O', '#f91880'], newkol: ['N', '#1d9bf0'], alphacalls: ['A', '#0e9f6e'], gemhunters: ['G', '#e28b00'], busycalls: ['B', '#d6336c'] };
  await ctx.route(/^https:\/\/(pbs\.twimg\.com|cdn4\.cdn-telegram\.org)\//, (route) => {
    const name = path.basename(new URL(route.request().url()).pathname, '.svg');
    const [letter, color] = avatars[name] || ['?', '#888'];
    return route.fulfill({ contentType: 'image/svg+xml', body: FX.avatarSvg(letter, color) });
  });
  await ctx.route('https://x.com/**', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: new URL(route.request().url()).pathname.startsWith('/newkol') ? xNew.html : x.html
  }));
  await ctx.route('https://web.telegram.org/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/a')) {
      const ch = tg.gemhunters;
      const visible = [
        { id: 47, at: ch.posts[2].at, text: ch.posts[2].text },
        { id: 49, at: now - 3 * FX.DAY, text: '$BONK pump starting' },
        { id: 50, at: now - 2 * FX.HOUR, text: '$PEPE again' }
      ];
      if (!ch.posts.some((p) => p.id === 49)) ch.posts.push({ id: 49, at: visible[1].at, text: visible[1].text }, { id: 50, at: visible[2].at, text: visible[2].text });
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: FX.webAPage(ch, visible, now) });
    }
    const ch = tg.alphacalls;
    const visible = ch.posts.filter((p) => p.id >= 118);
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: FX.webKPage(ch, visible, [{ peerId: '-1555555555', title: 'Quiet Channel', last: 'gm' }, { peerId: '777000', title: 'Telegram', last: 'Login code' }])
    });
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  const store = (key) => sw.evaluate((k) => chrome.storage.local.get(k).then((o) => o[k]), key);
  console.log('Extension', extId);

  // The install hook opens the welcome page.
  const welcome = await waitFor(async () => ctx.pages().find((p) => p.url().includes('options.html')), Boolean, 8000, 'welcome tab');
  check('install opens the welcome page', Boolean(welcome));

  // ------------------------------------------------------------------ X
  console.log('\nX profile');
  const xp = await ctx.newPage();
  watch(xp, 'x');
  await xp.goto('https://x.com/alphaguy');
  await xp.waitForSelector('[data-testid="UserName"] .kolibri-badge-host', { state: 'attached', timeout: 15000 });
  check('profile header badge is injected', true);

  const rec = await waitFor(() => store('kol:x:alphaguy'), (r) => r && r.calls && r.calls.length >= 8, 20000, 'alphaguy calls');
  const tokensOf = (r) => (r ? r.calls.filter((c) => !c.token.major).map((c) => c.token.symbol || c.token.symbolHint || c.token.address).sort() : []);
  check('collects every call of the author, majors and list posts excluded', JSON.stringify(tokensOf(rec)) === JSON.stringify(['BRETT', 'GIGA', 'PEPE', 'PEPE', 'POPCAT', 'WIF', 'WIF', FX.ADDR.MOON].sort()), tokensOf(rec));
  check('majors are stored (hidden unless "Count majors" is on)', rec && rec.calls.filter((c) => c.token.major).length === 2);
  const other = await store('kol:x:otherkol');
  check('a repost is credited to the original author (even with an /i/status/ permalink)', other && other.calls.length === 1 && other.calls[0].token.symbol === 'BONK', other && tokensOf(other));
  check('no account named "i" is created from generic permalinks', !(await store('kol:x:i')));
  check('a quoted post is not credited to the quoting author', rec && !rec.mentions.some((m) => m.token.symbol === 'FLOKI'));
  const pepeCalls = rec ? rec.calls.filter((c) => c.token.symbol === 'PEPE') : [];
  check('same token 17 days later is a new call', pepeCalls.length === 2);
  const tweetTime = x.tweets.find((t) => t.text.startsWith('Loading up')).at;
  check('post time comes from the tweet id', rec && rec.calls.some((c) => c.postedAt === tweetTime));

  console.log('  pricing (GeckoTerminal is rate-limited to ~9 requests/min, this takes a minute)…');
  const sum = await waitFor(() => store('sum:x:alphaguy'), (s) => s && s.summary && s.summary.priced7 >= 6 && s.counts.pricing === 0, 240000, 'alphaguy pricing');
  check('7-day results for every call older than a week', sum && sum.summary.priced7 === 6, sum && sum.summary);
  check('a grade is assigned', sum && /^[ABCDF]$/.test(sum.summary.grade || ''), sum && sum.summary);
  const priced = await store('kol:x:alphaguy');
  const byTok = (sym, i) => priced.calls.filter((c) => (c.symbol || c.token.symbol) === sym).sort((a, b) => a.postedAt - b.postedAt)[i || 0];
  const close = (a, b, tol) => Math.abs(a - b) <= tol;
  const pepe = byTok('PEPE', 0);
  check('Binance call measured: PEPE +2%/day -> about +14.9% after 7d', pepe && close(pepe.r7, Math.pow(1.02, 7) - 1, 0.01), pepe && pepe.r7);
  const wif = byTok('WIF', 0);
  check('losing call measured: WIF about -16% after 7d', wif && close(wif.r7, Math.pow(0.975, 7) - 1, 0.01), wif && wif.r7);
  const moon = priced.calls.find((c) => c.token.address === FX.ADDR.MOON);
  check('launchpad call priced through migration (entry on curve, 7d on AMM)', moon && moon.status === 'priced' && moon.market && moon.market.symbol === 'MOON' && moon.r7 > 2.5 && moon.rPeak > moon.r7, moon && { r7: moon.r7, peak: moon.rPeak, status: moon.status, err: moon.error });
  const brett = byTok('BRETT', 0);
  check('call from 6 days ago has 24h result, 7d pending', brett && brett.status === 'partial' && typeof brett.r24 === 'number' && brett.r7 == null, brett && { s: brett.status, r24: brett.r24 });
  const wifNew = byTok('WIF', 1);
  check('call from 3 hours ago waits for its 24h result', wifNew && wifNew.status === 'partial' && wifNew.r24 == null && wifNew.nextCheckAt > Date.now(), wifNew && wifNew.status);

  await xp.waitForFunction(() => {
    const host = document.querySelector('[data-testid="UserName"] .kolibri-badge-host');
    return host && /[ABCDF]/.test(host.shadowRoot.querySelector('.t').textContent);
  }, null, { timeout: 15000 }).catch(() => {});
  const badgeText = await xp.evaluate(() => document.querySelector('[data-testid="UserName"] .kolibri-badge-host').shadowRoot.querySelector('.t').textContent);
  check('profile badge shows grade and 7d win rate', /^[ABCDF]\d+%$/.test(badgeText), badgeText);
  const badgeColors = await xp.evaluate(() => {
    const b = document.querySelector('[data-testid="UserName"] .kolibri-badge-host').shadowRoot.querySelector('.b');
    const st = getComputedStyle(b);
    return { cls: b.className, bg: st.backgroundColor, color: st.color };
  });
  check('badge is tinted with its grade colour', /tone-(good|mid|bad)/.test(badgeColors.cls) && badgeColors.bg !== 'rgba(0, 0, 0, 0)' && badgeColors.color !== 'rgb(0, 0, 0)', badgeColors);
  const tweetBadges = await xp.evaluate(() => Array.from(document.querySelectorAll('article [data-testid="User-Name"] .kolibri-badge-host')).filter((h) => h.style.display !== 'none').length);
  check('badges next to authors in the timeline', tweetBadges >= 10, tweetBadges);

  await xp.hover('[data-testid="UserName"] .kolibri-badge-host');
  await xp.waitForFunction(() => {
    const host = document.querySelector('#kolibri-card-host');
    return host && host.shadowRoot.querySelector('.stats') && host.shadowRoot.querySelectorAll('tbody tr').length > 0;
  }, null, { timeout: 10000 }).catch(() => {});
  const card = await xp.evaluate(() => {
    const r = document.querySelector('#kolibri-card-host')?.shadowRoot;
    if (!r) return null;
    return {
      name: r.querySelector('.name')?.textContent,
      grade: r.querySelector('.grade b')?.textContent,
      stats: Array.from(r.querySelectorAll('.stat .v')).map((e) => e.textContent),
      rows: r.querySelectorAll('tbody tr').length,
      spark: r.querySelectorAll('.spark rect').length,
      follow: r.querySelector('.follow')?.textContent,
      actions: Array.from(r.querySelectorAll('.actions .btn')).map((b) => b.textContent)
    };
  });
  check('hover opens the report card', card && card.name === 'Alpha Guy' && card.rows >= 6, card);
  check('card shows 24h / 7d stats and per-call bars', card && card.stats.length === 4 && card.spark === 6, card && card.stats);
  check('card offers full report and timeline scan', card && card.actions.includes('Full report') && card.actions.includes('Scan timeline'), card && card.actions);
  if (SHOTS) {
    await xp.waitForTimeout(300);
    await xp.screenshot({ path: path.join(SHOTS, 'x-card.png'), clip: { x: 88, y: 0, width: 1000, height: 760 } });
    await xp.locator('#kolibri-card-host .card').screenshot({ path: path.join(SHOTS, 'card-light.png'), omitBackground: true });
  }

  // timeline scan runs and finishes (mock page has no more posts to load)
  await xp.evaluate(() => {
    const r = document.querySelector('#kolibri-card-host').shadowRoot;
    r.querySelector('[data-act="scan"]').click();
  });
  const scanDone = await waitFor(() => xp.evaluate(() => {
    const r = document.querySelector('#kolibri-card-host')?.shadowRoot;
    return r ? Array.from(r.querySelectorAll('.actions .btn')).map((b) => b.textContent).join('|') : 'closed';
  }), (s) => /Scan timeline/.test(s) || s === 'closed', 30000, 'scan end');
  check('timeline scan runs and stops at the end of the timeline', /Scan timeline/.test(scanDone), scanDone);
  await xp.mouse.click(5, 5);

  // ------------------------------------------------------------------ Telegram Web K (dark)
  console.log('\nTelegram Web K');
  const kp = await ctx.newPage();
  watch(kp, 'tg-k');
  await kp.emulateMedia({ colorScheme: 'dark' });
  await kp.goto('https://web.telegram.org/k/#@alphacalls');
  await kp.waitForSelector('.topbar .kolibri-badge-host', { state: 'attached', timeout: 15000 });
  check('badge next to the channel title', true);
  const tgRec = await waitFor(() => store('kol:tg:alphacalls'), (r) => r && r.calls && r.calls.length >= 9, 30000, 'alphacalls history');
  const tgTokens = tokensOf(tgRec);
  check('channel history loaded from t.me and merged with visible posts', tgRec && tgRec.calls.length === 9, tgTokens);
  check('WebK message ids map to channel post ids', tgRec && tgRec.mentions.some((m) => m.postId === '122') && !tgRec.mentions.some((m) => Number(m.postId) > 2 ** 31));
  const job = await waitFor(() => store('job:tg:alphacalls'), (j) => j && j.state !== 'running', 20000, 'history job');
  check('history job finished', job && job.state === 'done', job);
  const tgmap = await store('tgmap');
  check('channel id is linked to its username', tgmap && tgmap['1234567890'] === 'alphacalls', tgmap);
  const tgSum = await waitFor(() => store('sum:tg:alphacalls'), (s) => s && s.summary.grade && s.counts.pricing === 0, 240000, 'alphacalls pricing');
  check('channel gets a grade', tgSum && /^[ABCDF]$/.test(tgSum.summary.grade || ''), tgSum && tgSum.summary);
  const listBadges = await kp.evaluate(() => document.querySelectorAll('.chatlist .kolibri-badge-host').length);
  check('chat list: badges only for channels, not users', listBadges === 2, listBadges);
  await kp.hover('.topbar .kolibri-badge-host');
  await kp.waitForFunction(() => document.querySelector('#kolibri-card-host')?.shadowRoot.querySelector('.stats'), null, { timeout: 10000 }).catch(() => {});
  const tgCard = await kp.evaluate(() => {
    const r = document.querySelector('#kolibri-card-host')?.shadowRoot;
    return r ? { dark: r.querySelector('.kl').classList.contains('dark'), sub: r.querySelector('.sub').textContent, rows: r.querySelectorAll('tbody tr').length } : null;
  });
  check('card follows the dark theme', tgCard && tgCard.dark, tgCard);
  check('card names the channel link', tgCard && tgCard.sub === 't.me/alphacalls on Telegram', tgCard);
  if (SHOTS) {
    await kp.waitForTimeout(300);
    await kp.screenshot({ path: path.join(SHOTS, 'telegram-card.png'), clip: { x: 300, y: 0, width: 980, height: 760 } });
    await kp.locator('#kolibri-card-host .card').screenshot({ path: path.join(SHOTS, 'card-dark.png'), omitBackground: true });
  }

  // ------------------------------------------------------------------ Telegram Web A
  console.log('\nTelegram Web A');
  const ap = await ctx.newPage();
  watch(ap, 'tg-a');
  await ap.goto('https://web.telegram.org/a/#-1009876543210');
  await ap.waitForSelector('.MiddleHeader .kolibri-badge-host', { state: 'attached', timeout: 15000 });
  const aRec = await waitFor(() => store('kol:tg:#9876543210'), (r) => r && r.calls && r.calls.length >= 3, 15000, 'WebA DOM calls');
  check('WebA posts collected with dates read from the day headers', aRec && aRec.calls.length === 3, aRec && tokensOf(aRec));
  const bonk = aRec && aRec.mentions.find((m) => m.postId === '49');
  check('WebA timestamp reconstructed to the minute', bonk && Math.abs(bonk.postedAt - (now - 3 * FX.DAY)) < 60000, bonk && new Date(bonk.postedAt).toISOString());
  await ap.click('.MiddleHeader .kolibri-badge-host');
  await ap.waitForFunction(() => document.querySelector('#kolibri-card-host')?.shadowRoot.querySelector('input.link'), null, { timeout: 10000 }).catch(() => {});
  // Channel without a known username: link it from the card.
  await ap.evaluate(() => {
    const r = document.querySelector('#kolibri-card-host').shadowRoot;
    const input = r.querySelector('input.link');
    if (input) { input.value = 'https://t.me/gemhunters'; r.querySelector('form').requestSubmit(); }
  });
  const linked = await waitFor(() => store('kol:tg:gemhunters'), (r) => r && r.calls && r.calls.length >= 5, 30000, 'gemhunters history');
  check('linking a public channel loads its history and merges local posts', linked && linked.calls.length === 5, linked && tokensOf(linked));
  check('the id-keyed record is merged away', !(await store('kol:tg:#9876543210')));

  // ------------------------------------------------------------------ extension pages
  console.log('\nExtension pages');
  const popup = await ctx.newPage();
  watch(popup, 'popup');
  await popup.setViewportSize({ width: 392, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForSelector('#list .row', { timeout: 10000 }).catch(() => {});
  const rows = await popup.evaluate(() => Array.from(document.querySelectorAll('#list .row .name')).map((e) => e.textContent));
  check('popup leaderboard lists tracked KOLs', rows.length >= 4 && rows.includes('Alpha Guy') && rows.includes('Alpha Calls'), rows);
  if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'popup.png') });

  const report = await ctx.newPage();
  watch(report, 'report');
  await report.goto(`chrome-extension://${extId}/report/report.html?key=x%3Aalphaguy`);
  await report.waitForSelector('#rows tr', { timeout: 10000 }).catch(() => {});
  const rep = await report.evaluate(() => ({
    title: document.querySelector('#who h1')?.textContent,
    rows: document.querySelectorAll('#rows tr').length,
    bars: document.querySelectorAll('#chart rect').length,
    exportEnabled: !document.querySelector('#export').disabled
  }));
  check('report lists every call with a chart', rep.title === 'Alpha Guy' && rep.rows === 8 && rep.bars === 6, rep);
  check('CSV export of local data is available', rep.exportEnabled);
  const csv = await report.evaluate(() => chrome.runtime.sendMessage({ type: 'exportCsv', key: 'x:alphaguy', source: 'local' }));
  check('CSV export has a header and one row per call', csv.ok && csv.data.trim().split('\n').length === 9, csv.ok ? csv.data.split('\n')[0] : csv.error);
  if (SHOTS) {
    await report.setViewportSize({ width: 1200, height: 900 });
    await report.screenshot({ path: path.join(SHOTS, 'report.png'), fullPage: true });
  }

  const opts = await ctx.newPage();
  watch(opts, 'options');
  await opts.goto(`chrome-extension://${extId}/options/options.html?welcome=1`);
  await opts.waitForSelector('[data-setting="showOnX"]');
  check('options page renders settings', await opts.evaluate(() => document.querySelector('[data-setting="showOnX"]').checked === true));
  // Toggle "count majors" and confirm summaries are recomputed with BTC/ETH included
  await opts.evaluate(() => { const i = document.querySelector('[data-setting="includeMajors"]'); i.checked = true; i.dispatchEvent(new Event('change')); });
  const withMajors = await waitFor(() => store('sum:x:alphaguy'), (s) => s && s.summary.calls === 10, 10000, 'majors on');
  check('"Count majors" re-scores existing data', withMajors && withMajors.summary.calls === 10, withMajors && withMajors.summary.calls);
  await opts.evaluate(() => { const i = document.querySelector('[data-setting="includeMajors"]'); i.checked = false; i.dispatchEvent(new Event('change')); });
  if (SHOTS) {
    await opts.setViewportSize({ width: 1000, height: 900 });
    await opts.screenshot({ path: path.join(SHOTS, 'options.png'), fullPage: false });
  }

  // ------------------------------------------------------------------ Kolibri network (a real local server)
  console.log('\nKolibri network');
  const { Store } = require('../../server/src/db.js');
  const { createApp } = require('../../server/src/core.js');
  const { createHandler } = require('../../server/src/http.js');
  const { loadConfig } = require('../../server/src/config.js');
  const { world } = require('../helpers/fake-world.js');
  const XS = require('../../extension/shared/extract.js');
  const LS = require('../../extension/shared/ledger.js');
  const fast = {};
  for (const h of ['api.geckoterminal.com', 'api.dexscreener.com', 'data-api.binance.vision', 't.me', 'publish.twitter.com', 'api.x.com']) fast[h] = 60000;
  const netCfg = Object.assign(loadConfig({ PRO_KEYS: 'KOLIBRI-E2E-PRO-0001', WORKERS: '0', PUBLIC_NAME: 'Kolibri test network' }), { rateLimits: fast });
  const netApp = createApp({ config: netCfg, store: new Store(':memory:'), fetchImpl: world(now).fetchImpl, log: { warn() {} } });
  await netApp.collectTelegram('busycalls');
  const alphaMentions = x.tweets.filter((t) => t.handle === 'alphaguy').flatMap((t) =>
    LS.mentionsFromPost({ postId: t.id, postedAt: t.at, url: `https://x.com/alphaguy/status/${t.id}`, snippet: t.text }, XS.extractTokens(t.text, [], { includeMajors: true }).tokens));
  netApp.ingest({ platform: 'x', handle: 'alphaguy', name: 'Alpha Guy' }, alphaMentions);
  for (let i = 0; i < 60 && (await netApp.priceDue(20)); i++);
  const server = http.createServer(createHandler(netApp, netCfg));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await sw.evaluate(async (url) => {
    const o = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: Object.assign({}, o.settings, { apiUrl: url, contribute: true }) });
  }, base);

  const netRep = await ctx.newPage();
  watch(netRep, 'report-net');
  await netRep.goto(`chrome-extension://${extId}/report/report.html?key=tg%3Abusycalls`);
  await netRep.waitForSelector('#rows tr', { timeout: 10000 }).catch(() => {});
  const readRep = () => netRep.evaluate(() => ({
    rows: document.querySelectorAll('#rows tr').length,
    lock: !document.querySelector('#lock').hidden,
    exportDisabled: document.querySelector('#export').disabled,
    title: document.querySelector('#who h1') && document.querySelector('#who h1').textContent
  }));
  const freeRep = await readRep();
  check('network report, free plan: 10 most recent calls and a Pro prompt', freeRep.title === 'Busy Calls' && freeRep.rows === 10 && freeRep.lock && freeRep.exportDisabled, freeRep);
  if (SHOTS) {
    await netRep.setViewportSize({ width: 1200, height: 900 });
    await netRep.screenshot({ path: path.join(SHOTS, 'report-network-free.png'), fullPage: true });
  }
  const lic = await netRep.evaluate(() => chrome.runtime.sendMessage({ type: 'verifyLicense', key: 'KOLIBRI-E2E-PRO-0001' }));
  check('license key verified by the server', lic.ok && lic.data.valid && lic.data.plan === 'pro', lic);
  await netRep.reload();
  await netRep.waitForSelector('#rows tr', { timeout: 10000 }).catch(() => {});
  const proRep = await readRep();
  check('Pro unlocks the full history and CSV export', proRep.rows === 14 && !proRep.lock && !proRep.exportDisabled, proRep);
  const netCsv = await netRep.evaluate(() => chrome.runtime.sendMessage({ type: 'exportCsv', key: 'tg:busycalls', source: 'network' }));
  check('network CSV export', netCsv.ok && netCsv.data.trim().split('\n').length === 15, netCsv.ok ? netCsv.data.split('\n')[0] : netCsv.error);

  const popup2 = await ctx.newPage();
  watch(popup2, 'popup-net');
  await popup2.setViewportSize({ width: 392, height: 600 });
  await popup2.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup2.waitForSelector('#scope:not([hidden])', { timeout: 10000 }).catch(() => {});
  await popup2.click('#scope button[data-scope="network"]').catch(() => {});
  await popup2.waitForFunction(() => Array.from(document.querySelectorAll('#list .name')).some((e) => e.textContent === 'Busy Calls'), null, { timeout: 10000 }).catch(() => {});
  const netRows = await popup2.evaluate(() => Array.from(document.querySelectorAll('#list .name')).map((e) => e.textContent));
  check('popup network tab shows the server leaderboard', netRows.includes('Busy Calls') && netRows.includes('Alpha Guy') && netRows.length === 2, netRows);

  // The X card now has both the network's history and this device's.
  await xp.bringToFront();
  await xp.reload();
  await xp.waitForSelector('[data-testid="UserName"] .kolibri-badge-host', { state: 'attached', timeout: 15000 });
  await xp.waitForTimeout(800);
  await xp.hover('[data-testid="UserName"] .kolibri-badge-host');
  await xp.waitForFunction(() => document.querySelector('#kolibri-card-host')?.shadowRoot.querySelector('.seg'), null, { timeout: 10000 }).catch(() => {});
  const seg = await xp.evaluate(() => {
    const r = document.querySelector('#kolibri-card-host')?.shadowRoot;
    return r && r.querySelector('.seg') ? Array.from(r.querySelectorAll('.seg button')).map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')) : null;
  });
  check('card switches between network and device data', seg && seg[0] === 'Kolibri network:true' && seg[1] === 'This device:false', seg);
  await xp.mouse.move(5, 700);

  // Contributing: a new call seen on X reaches the server's verification queue.
  const xn = await ctx.newPage();
  watch(xn, 'x-new');
  await xn.goto('https://x.com/newkol');
  const queued = await waitFor(async () => netApp.store.stats().queued, (q) => q >= 1, 30000, 'contribution');
  check('new calls are shared with the network when enabled', queued >= 1, queued);
  server.close();

  // ------------------------------------------------------------------ hygiene
  console.log('\nHygiene');
  const ghReq = apiCalls.filter((u) => u.includes('geckoterminal')).length;
  console.log(`  ${apiCalls.length} simulated API requests (${ghReq} GeckoTerminal)`);
  check('no page or content-script errors', errors.length === 0, errors);

  await ctx.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll e2e checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
