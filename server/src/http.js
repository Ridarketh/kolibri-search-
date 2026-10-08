'use strict';
// HTTP API for the extension, plus a public leaderboard page at "/".

const path = require('path');
const CFG = require(path.join(__dirname, '..', '..', 'extension', 'shared', 'config.js'));
const F = require(path.join(__dirname, '..', '..', 'extension', 'shared', 'format.js'));
const L = require(path.join(__dirname, '..', '..', 'extension', 'shared', 'ledger.js'));

const MAX_BODY = 256 * 1024;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers) {
  const isText = typeof body === 'string';
  res.writeHead(status, Object.assign({
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, headers || {}));
  res.end(isText ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new ApiError(413, 'request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new ApiError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Fixed-window per-IP limiter for write endpoints. */
function limiter(perMinute) {
  const hits = new Map();
  return (ip) => {
    const minute = Math.floor(Date.now() / 60000);
    const k = ip + ':' + minute;
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (hits.size > 5000) for (const key of hits.keys()) if (!key.endsWith(':' + minute)) hits.delete(key);
    return n <= perMinute;
  };
}

function kolKey(platform, handle) {
  if (platform !== 'x' && platform !== 'tg') throw new ApiError(404, 'unknown platform');
  if (!/^[A-Za-z0-9_]{1,32}$/.test(handle)) throw new ApiError(404, 'unknown account');
  return L.authorKey(platform, handle);
}

function leaderboardPage(app, config) {
  const items = app.leaderboard(null, 200);
  const esc = F.escapeHtml;
  const rows = items.map((it, i) => {
    const s = it.summary;
    const a = it.author || {};
    const link = a.platform === 'tg' ? `https://t.me/${encodeURIComponent(a.handle)}` : `https://x.com/${encodeURIComponent(a.handle)}`;
    return `<tr><td class="n">${s.grade ? i + 1 : ''}</td>
      <td><a href="${esc(link)}" rel="noopener">${esc(a.name || a.handle)}</a><small>${a.platform === 'tg' ? 't.me/' + esc(a.handle) : '@' + esc(a.handle)}</small></td>
      <td>${s.calls}</td><td>${F.share(s.win24)}</td><td>${F.share(s.win7)}</td><td class="${F.tone(s.med7)}">${F.pct(s.med7)}</td>
      <td><span class="g ${s.grade ? 't-' + s.tone : 't-none'}">${s.grade || '?'}</span></td></tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.name)} — KOL leaderboard</title>
<style>
:root{--bg:#fff;--ink:#0f1b2d;--muted:#5b6b7f;--line:#e3eaee;--up:#087f5b;--up-bg:#dcf5ea;--down:#c81e43;--down-bg:#fde4ea;--mid:#a4660f;--mid-bg:#fbefd9;--none-bg:#e7edf2;--serif:Charter,"Iowan Old Style",Georgia,serif}
@media (prefers-color-scheme:dark){:root{--bg:#0e1726;--ink:#e6edf5;--muted:#8a9bb0;--line:#22324a;--up:#3dd9a0;--up-bg:rgba(61,217,160,.13);--down:#ff6b8a;--down-bg:rgba(255,107,138,.13);--mid:#f2b84b;--mid-bg:rgba(242,184,75,.13);--none-bg:rgba(138,155,176,.16)}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:900px;margin:0 auto;padding:40px 20px}
h1{margin:0;font-size:30px;letter-spacing:-.02em}p.lead{color:var(--muted);margin:6px 0 28px;max-width:62ch}
table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th{font-size:12.5px;color:var(--muted);font-weight:600}th:nth-child(2),td:nth-child(2){text-align:left;white-space:normal}
td a{color:inherit;font-weight:650;text-decoration:none}td small{display:block;color:var(--muted)}td.n{color:var(--muted);width:2em}
.up{color:var(--up)}.down{color:var(--down)}.g{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;font:700 19px var(--serif)}
.t-good{color:var(--up);background:var(--up-bg)}.t-mid{color:var(--mid);background:var(--mid-bg)}.t-bad{color:var(--down);background:var(--down-bg)}.t-none{background:var(--none-bg)}
footer{margin-top:24px;color:var(--muted);font-size:13px}
</style></head><body><main>
<h1>${esc(config.name)}</h1>
<p class="lead">Every token these accounts called, and whether it was up a day and a week later. Grades need 3 calls with a 7-day result.</p>
<table><thead><tr><th></th><th>Account</th><th>Calls</th><th>Up after 24h</th><th>Up after 7d</th><th>Median 7d</th><th>Grade</th></tr></thead><tbody>
${rows || '<tr><td colspan="7" style="text-align:left;color:var(--muted)">No calls collected yet.</td></tr>'}
</tbody></table>
<footer>Kolibri ${CFG.VERSION}. Get the browser extension to see these report cards next to names on X and Telegram.</footer>
</main></body></html>`;
}

function createHandler(app, config) {
  const allowWrite = limiter(config.ingestPerMinute);

  const routes = [
    ['GET', /^\/v1\/health$/, () => Object.assign({ ok: true, name: config.name, version: CFG.VERSION }, app.store.stats())],
    ['GET', /^\/v1\/leaderboard$/, (req, url) => ({ items: app.leaderboard(url.searchParams.get('platform'), Number(url.searchParams.get('limit')) || 100) })],
    ['GET', /^\/v1\/summaries$/, (req, url) => ({ items: app.summaries((url.searchParams.get('keys') || '').split(',').filter(Boolean)) })],
    ['GET', /^\/v1\/kols\/(x|tg)\/([^/]+)$/, (req, url, m) => {
      const key = kolKey(m[1], decodeURIComponent(m[2]));
      const data = app.card(key, app.planFor(bearer(req)));
      if (!data) throw new ApiError(404, 'no data for this account');
      return data;
    }],
    ['GET', /^\/v1\/kols\/(x|tg)\/([^/]+)\/export\.csv$/, (req, url, m, res) => {
      const key = kolKey(m[1], decodeURIComponent(m[2]));
      if (app.planFor(bearer(req)) !== 'pro') throw new ApiError(402, 'CSV export is a Kolibri Pro feature');
      const csv = app.csv(key);
      if (!csv) throw new ApiError(404, 'no data for this account');
      send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="kolibri-${key.replace(/[^a-z0-9]+/gi, '-')}.csv"` });
      return undefined;
    }],
    ['POST', /^\/v1\/license\/verify$/, async (req) => app.verifyLicense((await readJson(req)).key)],
    ['POST', /^\/v1\/ingest$/, async (req) => {
      const ip = req.socket.remoteAddress || '?';
      if (!allowWrite(ip)) throw new ApiError(429, 'slow down');
      const body = await readJson(req);
      return app.accept(body.posts);
    }],
    ['POST', /^\/v1\/admin\/track$/, async (req) => {
      requireAdmin(req);
      const body = await readJson(req);
      const key = app.track(body.platform, body.handle);
      return { key, tracked: true };
    }],
    ['POST', /^\/v1\/admin\/licenses$/, async (req) => {
      requireAdmin(req);
      const body = await readJson(req);
      if (!body.key || String(body.key).length < 12) throw new ApiError(400, 'license key must be at least 12 characters');
      app.store.upsertLicense(String(body.key), body.plan || 'pro', body.expiresAt || null, body.note || null, Date.now());
      return { ok: true };
    }],
    ['GET', /^\/$/, (req, url, m, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
      res.end(leaderboardPage(app, config));
      return undefined;
    }]
  ];

  function requireAdmin(req) {
    if (!config.adminToken || bearer(req) !== config.adminToken) throw new ApiError(401, 'admin token required');
  }

  return async function handler(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { return send(res, 400, { error: 'bad url' }); }
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    for (const [method, re, fn] of routes) {
      const m = re.exec(pathname);
      if (!m || method !== req.method) continue;
      try {
        const out = await fn(req, url, m, res);
        if (out !== undefined) send(res, 200, out);
      } catch (err) {
        const status = err.status && err.status < 600 ? err.status : 500;
        if (status >= 500) console.error('[http]', err);
        send(res, status, { error: status >= 500 ? 'internal error' : err.message });
      }
      return undefined;
    }
    return send(res, 404, { error: 'not found' });
  };
}

module.exports = { createHandler, ApiError };
