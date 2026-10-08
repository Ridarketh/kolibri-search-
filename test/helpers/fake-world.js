'use strict';
// A fake internet for the server: answers like Binance, DexScreener, GeckoTerminal, t.me,
// X oEmbed and the X API, using the e2e fixtures and the market simulator.
const FX = require('../e2e/fixtures.js');

const DAY = 86400000;

function response({ status = 200, json, text, headers = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => json,
    text: async () => (text !== undefined ? text : JSON.stringify(json))
  };
}

/** A fetch() that answers like Binance, DexScreener, GeckoTerminal, t.me, X oEmbed and the X API. */
function world(now) {
  const sim = FX.market(now);
  const channels = FX.tgChannels(now);
  // a busier channel to exercise the free-tier limit: 14 calls, one every 2 days
  const syms = ['PEPE', 'WIF', 'BONK', 'POPCAT', 'FLOKI'];
  channels.busy = {
    username: 'busycalls', title: 'Busy Calls', peerId: '-100555',
    posts: Array.from({ length: 14 }, (_, i) => ({ id: 200 + i, at: now - (40 - i * 2.5) * DAY, text: `call #${i}: $${syms[i % 5]}` }))
  };
  const tweetAt = now - 12 * DAY;
  const tweetId = FX.snowflake(tweetAt, 1);
  const apiTweetAt = now - 20 * DAY;
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const u = new URL(url);
    if (/binance|dexscreener|geckoterminal/.test(u.hostname)) {
      try { return response({ json: await sim.fetchJson(url) }); } catch (e) { return response({ status: e.status || 500, json: {} }); }
    }
    if (u.hostname === 't.me') {
      const m = /^\/s\/([A-Za-z0-9_]+)/.exec(u.pathname);
      const ch = m && Object.values(channels).find((c) => c.username.toLowerCase() === m[1].toLowerCase());
      if (!ch) return response({ status: 200, text: '<html><body><div class="tgme_page">nothing</div></body></html>' });
      return response({ text: FX.tmePage(ch, Number(u.searchParams.get('before')) || 0) });
    }
    if (u.hostname === 'publish.twitter.com') {
      const target = u.searchParams.get('url');
      if (!target.includes(tweetId)) return response({ status: 404, json: {} });
      return response({ json: {
        author_name: 'Ansem', author_url: 'https://twitter.com/blknoiz06',
        html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">sending <a href="https://twitter.com/search?q=%24WIF&amp;src=ctag&amp;ref_src=twsrc%5Etfw">$WIF</a> higher</p>&mdash; Ansem (@blknoiz06) <a href="https://twitter.com/blknoiz06/status/${tweetId}">Sep 26</a></blockquote>`
      } });
    }
    if (u.hostname === 'api.x.com') {
      if (u.pathname.startsWith('/2/users/by/username/')) return response({ json: { data: { id: '42', name: 'Api Kol', username: 'ApiKol', profile_image_url: 'https://pbs.twimg.com/x.jpg' } } });
      if (u.pathname === '/2/users/42/tweets') {
        return response({ json: { data: [
          { id: FX.snowflake(apiTweetAt, 3), text: 'chart https://t.co/abc', created_at: new Date(apiTweetAt).toISOString(), entities: { urls: [{ url: 'https://t.co/abc', expanded_url: `https://dexscreener.com/solana/${FX.ADDR.GIGA}` }] } },
          { id: FX.snowflake(apiTweetAt + DAY, 4), text: 'gm', created_at: new Date(apiTweetAt + DAY).toISOString() }
        ], meta: { result_count: 2 } } });
      }
    }
    return response({ status: 404, json: {} });
  };
  return { fetchImpl, requests, tweetId, channels };
}

module.exports = { world, response };
