'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../extension/shared/minihtml.js');
const TG = require('../extension/shared/telegram-preview.js');
const X = require('../extension/shared/extract.js');

const html = fs.readFileSync(path.join(__dirname, 'fixtures/tme-alphacalls.html'), 'utf8');

test('minihtml: entities, void tags, raw text and nesting', () => {
  const doc = H.parse('<div class="a b"><p>Hi &amp; bye<br>next</p><img src=x><script>var s="<p>no</p>"</script><span>&#128640;&nbsp;ok</span></div>');
  const div = H.find(doc, H.byClass('b'));
  assert.ok(div);
  assert.equal(H.findAll(doc, H.byTag('p')).length, 1);
  assert.equal(H.text(H.find(doc, H.byTag('p'))).trim(), 'Hi & bye\nnext');
  assert.equal(H.text(H.find(doc, H.byTag('span'))), '\u{1F680} ok');
  assert.equal(H.find(doc, H.byTag('img')).attrs.src, 'x');
});

test('minihtml: unclosed and stray tags do not break the tree', () => {
  const doc = H.parse('<div><span>a<b>b</span></i>c</div><p>d');
  assert.equal(H.text(doc).replace(/\s+/g, ''), 'abcd');
});

test('t.me preview: channel info and posts', () => {
  const page = TG.parseChannelPage(html, 'alphacalls');
  assert.equal(page.ok, true);
  assert.equal(page.channel.username, 'AlphaCalls');
  assert.equal(page.channel.title, 'Alpha Calls \u{1F426}');
  assert.equal(page.channel.avatar, 'https://cdn4.cdn-telegram.org/file/alpha.jpg');
  // the <script> template is not parsed as a message; the service message has no date
  assert.deepEqual(page.posts.map((p) => p.id), [101, 102, 104]);
  assert.equal(page.minId, 101);
  assert.equal(page.hasMore, true);
  const [p101, p102, p104] = page.posts;
  assert.equal(p101.postedAt, Date.parse('2025-05-01T10:15:00Z'));
  assert.equal(p101.url, 'https://t.me/AlphaCalls/101');
  assert.match(p101.text, /CA: 63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9/);
  assert.ok(p101.links[0].startsWith('https://dexscreener.com/solana/4xxm4cdb6mescxm52xvynknbrbx8bt2zi3gfrjqqfhpo'));
  // reply quote text is not part of the post
  assert.doesNotMatch(p102.text, /OLDCOIN/);
  assert.match(p102.text, /\$POPCAT/);
  assert.equal(p104.forwarded, true);
  assert.equal(p104.links[0], 'https://basescan.org/token/0x532f27101965dd16442E59d40670FaF5eBB142E4');
});

test('t.me preview posts feed straight into extraction', () => {
  const page = TG.parseChannelPage(html, 'alphacalls');
  const first = X.extractTokens(page.posts[0].text, page.posts[0].links);
  // CA in text + a chart link to its pool: one call, the ticker becomes the hint
  assert.equal(first.tokens.length, 1);
  assert.equal(first.tokens[0].address, '63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9');
  assert.equal(first.tokens[0].symbolHint, 'GIGA');
  const second = X.extractTokens(page.posts[1].text, page.posts[1].links);
  assert.deepEqual(second.tokens.map((t) => t.key), ['sym:GIGA', 'sym:POPCAT']);
  const third = X.extractTokens(page.posts[2].text, page.posts[2].links);
  assert.equal(third.tokens[0].chain, 'base');
});

test('t.me preview: page without a channel is not ok', () => {
  const page = TG.parseChannelPage('<html><body><div class="tgme_page">Not found</div></body></html>', 'nope');
  assert.equal(page.ok, false);
  assert.equal(page.posts.length, 0);
  assert.equal(TG.pageUrl('durov', 50), 'https://t.me/s/durov?before=50');
  assert.equal(TG.isValidUsername('ab'), false);
  assert.equal(TG.isValidUsername('alpha_calls'), true);
});
