'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../extension/shared/extract.js');

const keys = (r) => r.tokens.map((t) => t.key);

test('cashtags are found, upper-cased and de-duplicated', () => {
  const r = X.extractTokens('Loading more $PEPE here. $wif looks ready, $PEPE again', []);
  assert.deepEqual(keys(r), ['sym:PEPE', 'sym:WIF']);
});

test('majors, stables, fiat and stocks are not calls by default', () => {
  assert.deepEqual(keys(X.extractTokens('$BTC $ETH $SOL $USDT $USD $TSLA $MSTR', [])), []);
  assert.deepEqual(keys(X.extractTokens('$BTC and $ETH', [], { includeMajors: true })), ['sym:BTC', 'sym:ETH']);
});

test('dollar amounts and US$ prices are not cashtags', () => {
  assert.deepEqual(keys(X.extractTokens('raised $5M at $0.002, mcap $100k, US$5, abc$DEF', [])), []);
});

test('solana contract address in text', () => {
  const r = X.extractTokens('new gem CA: 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr ape', []);
  assert.equal(r.tokens.length, 1);
  assert.equal(r.tokens[0].kind, 'address');
  assert.equal(r.tokens[0].key, 'b58:7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
});

test('EVM address is lower-cased; tx hashes are ignored', () => {
  const r = X.extractTokens('0x6982508145454Ce325dDbE47a25d4ec3d2311933 and tx 0x' + 'ab'.repeat(32), []);
  assert.deepEqual(keys(r), ['evm:0x6982508145454ce325ddbe47a25d4ec3d2311933']);
});

test('ticker next to a single CA becomes a symbol hint, not a second call', () => {
  const r = X.extractTokens('$GIGA\nCA 63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9', []);
  assert.equal(r.tokens.length, 1);
  assert.equal(r.tokens[0].symbolHint, 'GIGA');
});

test('terminal links give chain hints and mark pair addresses', () => {
  const r = X.extractTokens('chart', ['https://dexscreener.com/solana/8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj']);
  assert.equal(r.tokens[0].chain, 'solana');
  assert.equal(r.tokens[0].maybePair, true);
  const p = X.extractTokens('', ['https://pump.fun/coin/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump']);
  assert.equal(p.tokens[0].address, '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump');
  assert.equal(p.tokens[0].chain, 'solana');
  assert.equal(p.tokens[0].maybePair, false);
  const b = X.extractTokens('', ['https://basescan.org/token/0x532f27101965dd16442E59d40670FaF5eBB142E4']);
  assert.equal(b.tokens[0].chain, 'base');
  const g = X.extractTokens('', ['https://www.geckoterminal.com/polygon_pos/pools/0xa374094527e1673a86de625aa59517c5de346d32']);
  assert.equal(g.tokens[0].chain, 'polygon');
});

test('link and the same address in text merge into one token', () => {
  const addr = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump';
  const r = X.extractTokens('CA ' + addr, ['https://pump.fun/coin/' + addr]);
  assert.equal(r.tokens.length, 1);
  assert.equal(r.tokens[0].chain, 'solana');
});

test('posts listing many tokens are commentary, not calls', () => {
  const r = X.extractTokens('watchlist: $AAA $BBB $CCC $DDD $EEE $FFF $GGG', []);
  assert.equal(r.tokens.length, 0);
  assert.equal(r.skipped, 'list');
});

test('long words and wrapped SOL are not addresses', () => {
  assert.deepEqual(keys(X.extractTokens('Supercalifragilisticexpialidociousness IsJustAVeryLongCamelCaseWordWithoutDigits', [])), []);
  assert.deepEqual(keys(X.extractTokens('So11111111111111111111111111111111111111112', [])), []);
});

test('t.co and x.com links are ignored', () => {
  assert.deepEqual(keys(X.extractTokens('', ['https://t.co/abc', 'https://x.com/someone/status/123'])), []);
});

test('zero-width characters do not hide a cashtag', () => {
  assert.deepEqual(keys(X.extractTokens('$​POPCAT is $POP‍CAT', [])), ['sym:POPCAT']);
});

test('snowflake ids decode to the post time', () => {
  const t = Date.UTC(2025, 4, 17, 12, 30, 0);
  const id = ((BigInt(t) - 1288834974657n) << 22n) | 12345n;
  assert.equal(X.snowflakeToMs(id.toString()), t);
  assert.equal(X.snowflakeToMs('123'), null);
  assert.equal(X.snowflakeToMs('not-a-number'), null);
});
