/* Kolibri — finds token "calls" in a post: $CASHTAGS, contract addresses and terminal links.
 * Exposes globalThis.Kolibri.extract (and module.exports in Node). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.Kolibri.config;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  (root.Kolibri = root.Kolibri || {}).extract = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cfg) {
  'use strict';

  const B58 = '1-9A-HJ-NP-Za-km-z';
  const RE_CASHTAG = /(?<![\p{L}\p{N}_$])\$([A-Za-z][A-Za-z0-9]{1,11})(?![\p{L}\p{N}_])/gu;
  const RE_EVM = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9A-Za-z])/g;
  const RE_B58 = new RegExp(`(?<![${B58}])[${B58}]{32,44}(?![${B58}])`, 'g');

  const SKIP_SYMBOLS = new Set([...cfg.STABLES, ...cfg.NOT_CRYPTO]);
  const MAJORS = new Set(cfg.MAJORS);

  // Well-known addresses that are never a "call" (wrapped natives, stables, system programs).
  const SKIP_ADDRESSES = new Set([
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
    '0x4200000000000000000000000000000000000006',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead'
  ]);

  const GECKO_TO_DEX = Object.fromEntries(Object.entries(cfg.DEX_TO_GECKO).map(([d, g]) => [g, d]));

  function chainFromAlias(name) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    return cfg.CHAIN_ALIASES[n] || GECKO_TO_DEX[n] || (cfg.DEX_TO_GECKO[n] ? n : null);
  }

  function normalizeText(s) {
    return String(s || '')
      .replace(/[​-‍⁠﻿]/g, '')
      .replace(/[   ]/g, ' ')
      .replace(/＄/g, '$');
  }

  function isEvm(addr) { return /^0x[0-9a-fA-F]{40}$/.test(addr); }

  function looksLikeBase58Address(s) {
    // Real Solana/Tron addresses mix digits, upper and lower case. Plain words never do.
    return s.length >= 32 && s.length <= 44 && /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s);
  }

  function normAddress(addr) {
    return isEvm(addr) ? addr.toLowerCase() : addr;
  }

  function tokenKeyFor(t) {
    if (t.kind === 'symbol') return 'sym:' + t.symbol;
    return (isEvm(t.address) ? 'evm:' : 'b58:') + normAddress(t.address);
  }

  function findAddressesInString(s) {
    const out = [];
    for (const m of s.matchAll(RE_EVM)) out.push(m[0]);
    // Blank out hex runs first so the tail of an EVM address or tx hash is not read as base58.
    const rest = s.replace(/0x[0-9a-fA-F]+/g, (h) => ' '.repeat(h.length));
    for (const m of rest.matchAll(RE_B58)) if (looksLikeBase58Address(m[0])) out.push(m[0]);
    return out;
  }

  // Link rules: host pattern, optional path pattern capturing chain/address, default chain,
  // and whether the address in the link is usually a pool/pair rather than the token itself.
  const LINK_RULES = [
    { host: /(^|\.)dexscreener\.com$/, path: /^\/([a-z0-9-]+)\/([A-Za-z0-9]{32,66})/, chain: 1, addr: 2, pair: true },
    { host: /(^|\.)dextools\.io$/, path: /\/app\/[a-z-]+\/([a-z0-9-]+)\/pair-explorer\/([A-Za-z0-9]{32,66})/, chain: 1, addr: 2, pair: true },
    { host: /(^|\.)geckoterminal\.com$/, path: /^\/([a-z0-9_-]+)\/pools\/([A-Za-z0-9]{32,66})/, chain: 1, addr: 2, pair: true },
    { host: /(^|\.)gmgn\.ai$/, path: /^\/([a-z]+)\/token\/(?:[A-Za-z0-9]+_)?([A-Za-z0-9]{32,44})/, chain: 1, addr: 2 },
    { host: /(^|\.)birdeye\.so$/, query: 'chain', fallbackChain: 'solana' },
    { host: /(^|\.)pump\.fun$/, fallbackChain: 'solana' },
    { host: /(^|\.)(photon-sol\.tinyastro\.io|bullx\.io|axiom\.trade|jup\.ag|raydium\.io|solscan\.io|letsbonk\.fun|believe\.app|moonshot\.cc)$/, fallbackChain: 'solana', pairHost: /photon|tinyastro/ },
    { host: /(^|\.)etherscan\.io$/, fallbackChain: 'ethereum' },
    { host: /(^|\.)basescan\.org$/, fallbackChain: 'base' },
    { host: /(^|\.)bscscan\.com$/, fallbackChain: 'bsc' },
    { host: /(^|\.)arbiscan\.io$/, fallbackChain: 'arbitrum' },
    { host: /(^|\.)(uniswap\.org|app\.uniswap\.org)$/, query: 'chain', fallbackChain: 'ethereum' },
    { host: /(^|\.)(four\.meme|sunpump\.meme|tronscan\.org)$/, fallbackChain: null }
  ];

  /** Parse a URL and return [{address, chain, maybePair}] it points to. */
  function addressesFromLink(href) {
    let url;
    try { url = new URL(String(href).replace(/&amp;/g, '&')); } catch (_) { return []; }
    const host = url.hostname.toLowerCase();
    if (host === 't.co' || host.endsWith('twitter.com') || host === 'x.com' || host === 't.me') return [];
    const rule = LINK_RULES.find((r) => r.host.test(host));
    const found = [];
    if (rule && rule.path) {
      const m = url.pathname.match(rule.path);
      if (m) {
        const addr = m[rule.addr];
        // Terminals put addresses in a fixed path slot; some (DexScreener) lower-case them.
        if (isEvm(addr) || looksLikeBase58Address(addr) || /^[0-9a-z]{32,44}$/.test(addr)) {
          found.push({ address: addr, chain: chainFromAlias(m[rule.chain]), maybePair: Boolean(rule.pair) });
        }
      }
    }
    if (!found.length) {
      const haystack = decodeURIComponent(url.pathname + ' ' + url.search);
      let chain = null;
      if (rule) {
        chain = (rule.query && chainFromAlias(url.searchParams.get(rule.query))) || rule.fallbackChain || null;
      }
      for (const addr of findAddressesInString(haystack)) {
        found.push({ address: addr, chain, maybePair: Boolean(rule && rule.pairHost && rule.pairHost.test(host)) });
      }
    }
    return found;
  }

  /**
   * Extract tokens from one post.
   * @param {string} text   visible post text
   * @param {string[]} links hrefs found in the post
   * @param {{includeMajors?: boolean}} opts
   * @returns {{tokens: Array, skipped: string|null}}
   */
  function extractTokens(text, links, opts) {
    const options = opts || {};
    const body = normalizeText(text);
    const addresses = new Map(); // normalized address -> token

    const addAddress = (address, chain, maybePair) => {
      const norm = normAddress(address);
      if (SKIP_ADDRESSES.has(norm)) return;
      const prev = addresses.get(norm);
      if (prev) {
        if (!prev.chain && chain) prev.chain = chain;
        if (!maybePair) prev.maybePair = false;
        return;
      }
      addresses.set(norm, { kind: 'address', address: norm, chain: chain || null, maybePair: Boolean(maybePair) });
    };

    for (const href of links || []) {
      for (const a of addressesFromLink(href)) addAddress(a.address, a.chain, a.maybePair);
    }
    for (const addr of findAddressesInString(body)) addAddress(addr, null, false);

    const symbols = new Map();
    for (const m of body.matchAll(RE_CASHTAG)) {
      const sym = m[1].toUpperCase();
      if (SKIP_SYMBOLS.has(sym)) continue;
      const major = MAJORS.has(sym);
      if (major && !options.includeMajors) continue;
      if (!symbols.has(sym)) symbols.set(sym, major ? { kind: 'symbol', symbol: sym, major: true } : { kind: 'symbol', symbol: sym });
    }

    let tokens;
    if (addresses.size) {
      tokens = [...addresses.values()];
      // "CA: <token> + chart link to <pool>": the pool is the same token, keep the CA only.
      if (tokens.some((t) => !t.maybePair)) tokens = tokens.filter((t) => !t.maybePair);
      // "$TICKER  CA: <address>" is one call; the ticker becomes a hint for the address.
      if (tokens.length === 1 && symbols.size === 1) tokens[0].symbolHint = [...symbols.keys()][0];
    } else {
      tokens = [...symbols.values()];
    }

    if (tokens.length > cfg.MAX_TOKENS_PER_POST) return { tokens: [], skipped: 'list' };
    for (const t of tokens) t.key = tokenKeyFor(t);
    return { tokens, skipped: null };
  }

  /** Tweet ids are snowflakes: the creation time is encoded in them. */
  function snowflakeToMs(id) {
    try {
      const n = BigInt(String(id));
      if (n < 1n << 22n) return null;
      return Number((n >> 22n) + 1288834974657n);
    } catch (_) {
      return null;
    }
  }

  function snippet(text, max) {
    const s = normalizeText(text).replace(/\s+/g, ' ').trim();
    const n = max || 220;
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  return {
    extractTokens,
    addressesFromLink,
    findAddressesInString,
    tokenKeyFor,
    normalizeText,
    normAddress,
    isEvm,
    chainFromAlias,
    snowflakeToMs,
    snippet
  };
});
