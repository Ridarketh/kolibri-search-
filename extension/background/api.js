/* Kolibri — client for the optional Kolibri network API (see /server).
 * Off unless the user sets an API URL in Options (and grants that host). */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const Store = K.store;
  const Net = K.net;

  const cache = new Map(); // url -> {at, data}
  const TTL = 5 * 60 * 1000;
  let outbox = [];
  let flushTimer = null;

  async function base() {
    const s = await Store.getSettings();
    return (s.apiUrl || '').trim().replace(/\/+$/, '');
  }

  async function licenseKey() {
    const lic = await Store.get('license');
    return lic && lic.valid && lic.key ? lic.key : null;
  }

  async function plan() {
    const lic = await Store.get('license');
    if (!lic || !lic.valid) return 'free';
    if (lic.expiresAt && Date.parse(lic.expiresAt) < Date.now()) return 'free';
    return lic.plan || 'pro';
  }

  async function call(path, opts) {
    const b = await base();
    if (!b) return null;
    const o = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    const key = o.auth === false ? null : await licenseKey();
    if (key) headers.Authorization = 'Bearer ' + key;
    const url = b + path;
    if (!o.method || o.method === 'GET') {
      const hit = cache.get(url + '|' + (key || ''));
      if (hit && Date.now() - hit.at < (o.ttl || TTL)) return hit.data;
    }
    const res = await Net.request(url, {
      method: o.method || 'GET',
      headers,
      body: o.body ? JSON.stringify(o.body) : undefined,
      accept: o.text ? 'text/csv,*/*' : 'application/json',
      timeout: 15000
    });
    const data = o.text ? await res.text() : await res.json();
    if (!o.method || o.method === 'GET') cache.set(url + '|' + (key || ''), { at: Date.now(), data });
    return data;
  }

  function pathFor(key) {
    const k = K.ledger.parseKey(key);
    if (!k) return null;
    return `/v1/kols/${k.platform}/${encodeURIComponent(k.handle || '#' + k.channelId)}`;
  }

  async function getCard(key) {
    const p = pathFor(key);
    if (!p) return null;
    try { return await call(p); } catch (err) { if (err.status === 404) return null; throw err; }
  }

  async function summaries(keys) {
    if (!keys.length || !(await base())) return {};
    const sorted = keys.slice().sort();
    try {
      const data = await call('/v1/summaries?keys=' + encodeURIComponent(sorted.join(',')), { ttl: 10 * 60 * 1000 });
      return (data && data.items) || {};
    } catch (_) {
      return {};
    }
  }

  async function leaderboard(platform) {
    const q = platform && platform !== 'all' ? '?platform=' + platform : '';
    return call('/v1/leaderboard' + q, { ttl: 10 * 60 * 1000 });
  }

  async function exportCsv(key) {
    const p = pathFor(key);
    return call(p + '/export.csv', { text: true, ttl: 1 });
  }

  async function verifyLicense(licenseKeyValue) {
    const b = await base();
    if (!b) throw new Error('Set the Kolibri API URL first');
    const res = await Net.request(b + '/v1/license/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: licenseKeyValue }),
      timeout: 15000
    });
    return res.json();
  }

  async function health(url) {
    const res = await Net.request(url.replace(/\/+$/, '') + '/v1/health', { timeout: 8000 });
    return res.json();
  }

  /** Queue post references for the network (the server re-fetches and verifies them). */
  async function contribute(refs) {
    const s = await Store.getSettings();
    if (!s.contribute || !s.apiUrl) return;
    outbox.push(...refs);
    if (outbox.length > 500) outbox = outbox.slice(-500);
    if (!flushTimer) flushTimer = setTimeout(flush, 15000);
  }

  async function flush() {
    flushTimer = null;
    if (!outbox.length) return;
    const batch = outbox.splice(0, 100);
    try {
      await call('/v1/ingest', { method: 'POST', body: { posts: batch }, auth: false });
    } catch (err) {
      console.warn('[kolibri] contribute failed', err && err.message);
    }
    if (outbox.length) flushTimer = setTimeout(flush, 15000);
  }

  function clearCache() { cache.clear(); }

  K.api = { base, plan, getCard, summaries, leaderboard, exportCsv, verifyLicense, health, contribute, flush, clearCache };
})(globalThis);
