/* Kolibri — network helper for the service worker: per-host rate limits, timeouts, 429 back-off. */
(function (root) {
  'use strict';
  const cfg = root.Kolibri.config;

  class HttpError extends Error {
    constructor(status, url, body) {
      super('HTTP ' + status);
      this.status = status;
      this.code = 'http-' + status;
      this.url = url;
      this.body = body;
    }
  }

  const buckets = new Map(); // host -> next allowed time (ms)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (_) { return ''; }
  }

  async function slot(host) {
    const rpm = cfg.RATE_LIMITS[host] || 120;
    const gap = Math.ceil(60000 / rpm);
    const now = Date.now();
    const at = Math.max(now, buckets.get(host) || 0);
    buckets.set(host, at + gap);
    if (at > now) await sleep(at - now);
  }

  function cooldown(host, ms) {
    buckets.set(host, Math.max(buckets.get(host) || 0, Date.now() + ms));
  }

  async function request(url, opts, attempt) {
    const o = opts || {};
    const host = hostOf(url);
    await slot(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 20000);
    let res;
    try {
      res = await fetch(url, {
        method: o.method || 'GET',
        headers: Object.assign({ Accept: o.accept || 'application/json' }, o.headers || {}),
        body: o.body,
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch (err) {
      clearTimeout(timer);
      const e = new Error(err && err.name === 'AbortError' ? 'timeout' : 'network');
      e.code = e.message;
      throw e;
    }
    clearTimeout(timer);
    if (res.status === 429 && (attempt || 0) < 1) {
      const retryAfter = Number(res.headers.get('retry-after')) || 30;
      cooldown(host, retryAfter * 1000);
      return request(url, opts, (attempt || 0) + 1);
    }
    if (!res.ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 300); } catch (_) { /* ignore */ }
      if (res.status === 429) cooldown(host, 60000);
      throw new HttpError(res.status, url, body);
    }
    return res;
  }

  async function fetchJson(url, opts) {
    const res = await request(url, opts);
    return res.json();
  }

  async function fetchText(url, opts) {
    const res = await request(url, Object.assign({ accept: 'text/html,*/*' }, opts || {}));
    return res.text();
  }

  root.Kolibri.net = { fetchJson, fetchText, request, HttpError, hostOf };
})(globalThis);
