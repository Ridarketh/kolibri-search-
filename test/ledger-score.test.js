'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../extension/shared/ledger.js');
const S = require('../extension/shared/score.js');
const F = require('../extension/shared/format.js');

const DAY = 86400000;
const T = Date.UTC(2025, 0, 1);
const mention = (postId, sym, day) => ({
  postId: String(postId), tokenKey: 'sym:' + sym, token: { kind: 'symbol', symbol: sym }, postedAt: T + day * DAY, url: 'u' + postId, snippet: 's'
});

test('author keys', () => {
  assert.equal(L.authorKey('x', 'Ansem'), 'x:ansem');
  assert.equal(L.authorKey('tg', null, '1234'), 'tg:#1234');
  assert.deepEqual(L.parseKey('tg:#1234'), { platform: 'tg', channelId: '1234', handle: null });
  assert.deepEqual(L.parseKey('x:ansem'), { platform: 'x', handle: 'ansem', channelId: null });
});

test('repeat mentions within 7 days fold into one call, regardless of discovery order', () => {
  const ms = [mention(1, 'AAA', 0), mention(2, 'AAA', 6), mention(3, 'AAA', 10), mention(4, 'BBB', 1)];
  const forward = L.emptyRecord('x:k', {});
  L.addMentions(forward, ms);
  const backward = L.emptyRecord('x:k', {});
  for (const m of ms.slice().reverse()) L.addMentions(backward, [m]);
  const shape = (r) => r.calls.map((c) => [c.id, c.mentions]);
  assert.deepEqual(shape(forward), shape(backward));
  assert.deepEqual(shape(forward), [['3~sym:AAA', 1], ['4~sym:BBB', 1], ['1~sym:AAA', 2]]);
});

test('pricing survives regrouping; duplicates are ignored', () => {
  const r = L.emptyRecord('x:k', {});
  L.addMentions(r, [mention(1, 'AAA', 0)]);
  L.applyResult(r.calls[0], { symbol: 'AAA', label: 'AAA/USDT', venue: 'Binance' }, { status: 'priced', entry: 1, r24: 0.1, r7: 0.5 }, T);
  assert.equal(L.addMentions(r, [mention(1, 'AAA', 0)]), 0);
  assert.equal(L.addMentions(r, [mention(2, 'AAA', 3), mention(5, 'CCC', 4)]), 2);
  const a = r.calls.find((c) => c.tokenKey === 'sym:AAA');
  assert.equal(a.status, 'priced');
  assert.equal(a.r7, 0.5);
  assert.equal(a.mentions, 2);
  const c = r.calls.find((x) => x.tokenKey === 'sym:CCC');
  assert.equal(c.status, 'new');
  assert.equal(L.isDue(c, T), true);
  assert.equal(L.isDue(a, T), false);
});

test('errors back off and eventually give up', () => {
  const call = { status: 'new' };
  L.applyError(call, new Error('HTTP 429'), T);
  assert.equal(call.status, 'error');
  assert.equal(call.nextCheckAt, T + 5 * 60000);
  assert.equal(L.isDue(call, T), false);
  for (let i = 0; i < 10; i++) L.applyError(call, new Error('boom'), T);
  assert.equal(call.status, 'unresolved');
});

test('CSV export escapes and formats', () => {
  const csv = L.toCsv({ handle: 'kol', platform: 'x' }, [{
    postedAt: T, token: { kind: 'symbol', symbol: 'AAA' }, symbol: 'AAA', market: { label: 'AAA/USDT', venue: 'Binance', chain: null },
    entry: 0.000012, p24: 0.000015, r24: 0.25, p7: 0.00001, r7: -0.1666666, rPeak: 0.5, rLow: -0.2, status: 'priced', mentions: 2, url: 'https://x.com/kol/status/1?a=1,2'
  }]);
  const [head, row] = csv.trim().split('\n');
  assert.ok(head.startsWith('author,platform,posted_at_utc,token'));
  assert.ok(row.includes('2025-01-01T00:00:00.000Z'));
  assert.ok(row.includes(',25,'));
  assert.ok(row.includes(',-16.67,'));
  assert.ok(row.endsWith('"https://x.com/kol/status/1?a=1,2"'));
});

test('score and grade: small samples are shrunk toward average', () => {
  assert.equal(S.scoreFrom([]), null);
  const great3 = S.scoreFrom([0.5, 0.6, 0.7]);
  const great20 = S.scoreFrom(Array(20).fill(0.6));
  assert.ok(great20 > great3, 'more evidence -> stronger grade');
  assert.equal(S.gradeFor(great20, 20).grade, 'A');
  const coin = S.scoreFrom([0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1]);
  assert.equal(S.gradeFor(coin, 8).grade, 'C');
  const bad = S.scoreFrom(Array(15).fill(-0.4).concat([0.2, 0.3]));
  assert.equal(S.gradeFor(bad, 17).grade, 'F');
  assert.equal(S.gradeFor(90, 2).grade, null, 'needs MIN_CALLS_FOR_GRADE');
});

test('summarize: win rates, medians, follow-all ROI, skips unpriceable calls', () => {
  const calls = [
    { id: 'a', symbol: 'A', status: 'priced', r24: 0.2, r7: 1.0, rPeak: 2, postedAt: T },
    { id: 'b', symbol: 'B', status: 'priced', r24: -0.1, r7: -0.5, rPeak: 0.1, postedAt: T + DAY },
    { id: 'c', symbol: 'C', status: 'priced', r24: 0.05, r7: 0.1, rPeak: 0.3, postedAt: T + 2 * DAY },
    { id: 'd', symbol: 'D', status: 'partial', r24: 0.3, r7: null, rPeak: 0.4, postedAt: T + 9 * DAY },
    { id: 'e', symbol: 'E', status: 'unresolved', postedAt: T + 3 * DAY }
  ];
  const s = S.summarize(calls, { now: T + 10 * DAY });
  assert.equal(s.calls, 4);
  assert.equal(s.tracked, 5);
  assert.equal(s.skipped, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.priced7, 3);
  assert.equal(s.win24, 0.75);
  assert.equal(Math.round(s.win7 * 100), 67);
  assert.equal(s.med7, 0.1);
  assert.ok(Math.abs(s.avg7 - 0.2) < 1e-9);
  assert.equal(s.best.id, 'a');
  assert.equal(s.worst.id, 'b');
  assert.ok(s.grade);
  assert.equal(s.lastAt, T + 9 * DAY);
});

test('format helpers', () => {
  assert.equal(F.ret(0.1234), '+12%');
  assert.equal(F.ret(-0.084), '−8.4%');
  assert.equal(F.ret(3.1), '4.1x');
  assert.equal(F.ret(0), '0%');
  assert.equal(F.ret(null), '—');
  assert.equal(F.share(0.614), '61%');
  assert.equal(F.price(0.00001234), '$0.0₄1234');
  assert.equal(F.price(1234.5), '$1,235');
  assert.equal(F.price(0.5432), '$0.5432');
  assert.equal(F.date(Date.UTC(2024, 2, 3, 12), Date.UTC(2025, 0, 1)), 'Mar 3, 2024');
  assert.equal(F.escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});
