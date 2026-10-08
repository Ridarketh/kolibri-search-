/* Kolibri — the ledger: turns raw token mentions into calls, carries pricing across updates,
 * decides what needs (re)pricing and exports CSV.
 * Exposes globalThis.Kolibri.ledger (and module.exports in Node). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.Kolibri.config;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  (root.Kolibri = root.Kolibri || {}).ledger = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cfg) {
  'use strict';

  const MAX_MENTIONS = 6000;
  const PRICE_FIELDS = ['status', 'entry', 'entryAt', 'p24', 'p7', 'peak', 'peakAt', 'low', 'r24', 'r7', 'rPeak', 'rLow',
    'venue', 'frame', 'pool', 'network', 'nextCheckAt', 'checkedAt', 'attempts', 'error'];
  const RETRY_MS = [5 * cfg.MIN, 30 * cfg.MIN, 3 * cfg.HOUR, 12 * cfg.HOUR, cfg.DAY];

  function authorKey(platform, handle, channelId) {
    if (platform === 'x') return 'x:' + String(handle).toLowerCase();
    if (platform === 'tg') return handle ? 'tg:' + String(handle).toLowerCase() : 'tg:#' + String(channelId);
    throw new Error('unknown platform ' + platform);
  }

  function parseKey(key) {
    const m = /^(x|tg):(#?)(.+)$/.exec(String(key || ''));
    if (!m) return null;
    return m[2] ? { platform: m[1], channelId: m[3], handle: null } : { platform: m[1], handle: m[3], channelId: null };
  }

  function emptyRecord(key, author) {
    return { key, author: Object.assign({}, author), mentions: [], calls: [], updatedAt: 0 };
  }

  function mentionId(m) { return m.postId + '~' + m.tokenKey; }

  /** Deterministically group mentions into calls: first mention of a token opens a call,
   * repeats within REPEAT_WINDOW_MS of it are folded into that call. */
  function groupCalls(mentions, previous) {
    const prevById = new Map((previous || []).map((c) => [c.id, c]));
    const marketByToken = new Map();
    for (const c of previous || []) if (c.market && !marketByToken.has(c.tokenKey)) marketByToken.set(c.tokenKey, c.market);

    const byToken = new Map();
    for (const m of mentions) {
      if (!byToken.has(m.tokenKey)) byToken.set(m.tokenKey, []);
      byToken.get(m.tokenKey).push(m);
    }
    const calls = [];
    for (const [tokenKey, list] of byToken) {
      list.sort((a, b) => a.postedAt - b.postedAt || String(a.postId).localeCompare(String(b.postId)));
      let cur = null;
      for (const m of list) {
        if (cur && m.postedAt - cur.postedAt <= cfg.REPEAT_WINDOW_MS) {
          cur.mentions += 1;
          cur.lastMentionAt = m.postedAt;
          if (!cur.token.chain && m.token.chain) cur.token.chain = m.token.chain;
          if (!cur.token.symbolHint && m.token.symbolHint) cur.token.symbolHint = m.token.symbolHint;
          continue;
        }
        const id = mentionId(m);
        const prev = prevById.get(id);
        cur = {
          id,
          postId: m.postId,
          postedAt: m.postedAt,
          url: m.url,
          snippet: m.snippet || '',
          tokenKey,
          token: Object.assign({}, m.token),
          symbol: (prev && prev.symbol) || m.token.symbol || m.token.symbolHint || null,
          mentions: 1,
          lastMentionAt: m.postedAt,
          market: (prev && prev.market) || marketByToken.get(tokenKey) || null,
          status: 'new',
          attempts: 0
        };
        if (prev) for (const f of PRICE_FIELDS) if (prev[f] !== undefined) cur[f] = prev[f];
        calls.push(cur);
      }
    }
    calls.sort((a, b) => b.postedAt - a.postedAt);
    return calls;
  }

  /** Add mentions (deduped by post+token). Returns number of new mentions. */
  function addMentions(record, mentions) {
    const seen = new Set(record.mentions.map(mentionId));
    let added = 0;
    for (const m of mentions || []) {
      if (!m || !m.postId || !m.tokenKey || !Number.isFinite(m.postedAt)) continue;
      const id = mentionId(m);
      if (seen.has(id)) continue;
      seen.add(id);
      record.mentions.push({
        postId: String(m.postId),
        tokenKey: m.tokenKey,
        token: m.token,
        postedAt: m.postedAt,
        url: m.url || '',
        snippet: (m.snippet || '').slice(0, 200)
      });
      added++;
    }
    if (added) {
      if (record.mentions.length > MAX_MENTIONS) {
        record.mentions.sort((a, b) => b.postedAt - a.postedAt);
        record.mentions.length = MAX_MENTIONS;
      }
      record.calls = groupCalls(record.mentions, record.calls);
    }
    return added;
  }

  /** Mentions -> from a post's extracted tokens. */
  function mentionsFromPost(post, tokens) {
    return (tokens || []).map((t) => ({
      postId: String(post.postId),
      tokenKey: t.key,
      token: { kind: t.kind, symbol: t.symbol || null, address: t.address || null, chain: t.chain || null, maybePair: Boolean(t.maybePair), symbolHint: t.symbolHint || null, major: Boolean(t.major) },
      postedAt: post.postedAt,
      url: post.url,
      snippet: post.snippet || ''
    }));
  }

  function isDue(call, now) {
    if (!call) return false;
    switch (call.status) {
      case 'new': return true;
      case 'partial': return !call.nextCheckAt || call.nextCheckAt <= now;
      case 'error': return !call.nextCheckAt || call.nextCheckAt <= now;
      default: return false;
    }
  }

  function applyResult(call, market, result, now) {
    if (market !== undefined) call.market = market;
    if (result && result.market) call.market = result.market;
    if (call.market && call.market.symbol) call.symbol = call.market.symbol;
    for (const f of PRICE_FIELDS) if (result && result[f] !== undefined && f !== 'attempts' && f !== 'error') call[f] = result[f];
    call.status = (result && result.status) || 'unresolved';
    call.checkedAt = now;
    call.error = null;
    call.attempts = 0;
    if (call.status !== 'partial') call.nextCheckAt = null;
  }

  function applyError(call, err, now) {
    call.attempts = (call.attempts || 0) + 1;
    call.error = String((err && (err.code || err.message)) || err).slice(0, 120);
    call.checkedAt = now;
    if (call.attempts >= RETRY_MS.length + 1) {
      call.status = 'unresolved';
      call.nextCheckAt = null;
      return;
    }
    call.status = 'error';
    call.nextCheckAt = now + RETRY_MS[Math.min(call.attempts - 1, RETRY_MS.length - 1)];
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toPrecision(10))) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(author, calls) {
    const head = ['author', 'platform', 'posted_at_utc', 'token', 'address', 'chain', 'market', 'entry_price',
      'price_24h', 'return_24h_pct', 'price_7d', 'return_7d_pct', 'peak_7d_pct', 'drawdown_7d_pct', 'status', 'mentions', 'post_url'];
    const pct = (r) => (typeof r === 'number' ? +(r * 100).toFixed(2) : null);
    const rows = [head.join(',')];
    for (const c of calls) {
      rows.push([
        author.handle || author.name, author.platform, new Date(c.postedAt).toISOString(),
        c.symbol || c.token.symbol || c.token.symbolHint || '', c.token.address || '', (c.market && c.market.chain) || c.token.chain || '',
        c.market ? `${c.market.label} @ ${c.market.venue}` : '', c.entry, c.p24, pct(c.r24), c.p7, pct(c.r7), pct(c.rPeak), pct(c.rLow),
        c.status, c.mentions, c.url
      ].map(csvCell).join(','));
    }
    return rows.join('\n') + '\n';
  }

  return { authorKey, parseKey, emptyRecord, groupCalls, addMentions, mentionsFromPost, isDue, applyResult, applyError, toCsv, PRICE_FIELDS };
});
