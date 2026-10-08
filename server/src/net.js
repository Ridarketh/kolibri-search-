'use strict';
// Outbound HTTP with per-host rate limits, timeouts and 429 back-off (mirrors the extension's net.js).

class HttpError extends Error {
  constructor(status, url) {
    super('HTTP ' + status);
    this.status = status;
    this.code = 'http-' + status;
    this.url = url;
  }
}

function makeNet(fetchImpl, limits, userAgent) {
  const buckets = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function slot(host) {
    const rpm = limits[host] || 120;
    const gap = Math.ceil(60000 / rpm);
    const now = Date.now();
    const at = Math.max(now, buckets.get(host) || 0);
    buckets.set(host, at + gap);
    if (at > now) await sleep(at - now);
  }

  async function request(url, opts, attempt) {
    const o = opts || {};
    const host = new URL(url).hostname;
    await slot(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 20000);
    let res;
    try {
      res = await fetchImpl(url, {
        method: o.method || 'GET',
        headers: Object.assign({ Accept: o.accept || 'application/json', 'User-Agent': userAgent }, o.headers || {}),
        body: o.body,
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && !attempt) {
      const wait = (Number(res.headers && res.headers.get && res.headers.get('retry-after')) || 30) * 1000;
      buckets.set(host, Date.now() + wait);
      return request(url, opts, 1);
    }
    if (!res.ok) throw new HttpError(res.status, url);
    return res;
  }

  return {
    request,
    fetchJson: async (url, opts) => (await request(url, opts)).json(),
    fetchText: async (url, opts) => (await request(url, Object.assign({ accept: 'text/html,*/*' }, opts || {}))).text()
  };
}

module.exports = { makeNet, HttpError };
