/* Kolibri — content-script plumbing: messaging, settings, summary cache, theme detection. */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const C = (K.content = K.content || {});

  const DEFAULTS = { showOnX: true, showOnTelegram: true, showEmpty: false, includeMajors: false, apiUrl: '', autoHistory: true, historyDepthDays: 120 };
  let alive = true;
  const deadHandlers = [];

  C.settings = Object.assign({}, DEFAULTS);

  C.isAlive = function () {
    try { return alive && Boolean(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  };

  function markDead() {
    if (!alive) return;
    alive = false;
    for (const fn of deadHandlers) { try { fn(); } catch (_) { /* ignore */ } }
  }
  C.onDead = (fn) => deadHandlers.push(fn);

  /** Send a message to the service worker; resolves with data or rejects with the error text. */
  C.send = async function (type, payload) {
    if (!C.isAlive()) throw new Error('Kolibri was updated — reload the page');
    let res;
    try {
      res = await chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
    } catch (err) {
      if (/context invalidated/i.test(String(err && err.message))) markDead();
      throw err;
    }
    if (!res) throw new Error('No response from Kolibri');
    if (!res.ok) throw new Error(res.error || 'Kolibri error');
    return res.data;
  };

  C.loadSettings = async function () {
    try {
      const o = await chrome.storage.local.get('settings');
      C.settings = Object.assign({}, DEFAULTS, o.settings || {});
    } catch (_) { /* keep defaults */ }
    return C.settings;
  };

  // ---- storage change fan-out
  const storageListeners = [];
  C.onStorage = (fn) => storageListeners.push(fn);
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) C.settings = Object.assign({}, DEFAULTS, changes.settings.newValue || {});
      for (const fn of storageListeners) { try { fn(changes); } catch (e) { console.warn('[kolibri]', e); } }
    });
  } catch (_) { /* context gone */ }

  // ---- summaries for badges: {local, network} per author key
  const summaries = new Map();
  const waiting = new Set();
  const subscribers = new Set();
  let batchTimer = null;

  C.summary = (key) => summaries.get(key);
  C.onSummaries = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };

  function emit(keys) {
    for (const fn of subscribers) { try { fn(keys); } catch (e) { console.warn('[kolibri]', e); } }
  }

  C.requestSummaries = function (keys, force) {
    for (const k of keys) if (force || !summaries.has(k)) waiting.add(k);
    if (!waiting.size || batchTimer) return;
    batchTimer = setTimeout(async () => {
      batchTimer = null;
      const batch = Array.from(waiting).slice(0, 150);
      batch.forEach((k) => waiting.delete(k));
      try {
        const res = await C.send('summaries', { keys: batch });
        for (const k of batch) summaries.set(k, { local: res.local[k] || null, network: res.network[k] || null });
        emit(batch);
      } catch (_) { /* extension reloading */ }
      if (waiting.size) C.requestSummaries([]);
    }, 120);
  };

  C.onStorage((changes) => {
    const changed = [];
    for (const [name, ch] of Object.entries(changes)) {
      if (!name.startsWith('sum:')) continue;
      const key = name.slice(4);
      const prev = summaries.get(key) || { local: null, network: null };
      summaries.set(key, { local: ch.newValue || null, network: prev.network });
      changed.push(key);
    }
    if (changed.length) emit(changed);
  });

  /** The summary a badge should show: the network's when it has graded data, else local. */
  C.bestSummary = function (key) {
    const s = summaries.get(key);
    if (!s) return null;
    const net = s.network && s.network.summary;
    const loc = s.local && s.local.summary;
    if (net && (net.grade || !loc || net.calls >= loc.calls)) return { source: 'network', summary: net, author: s.network.author };
    if (loc) return { source: 'local', summary: loc, author: s.local.author };
    return null;
  };

  // ---- helpers
  C.throttle = function (fn, ms) {
    let t = null;
    let pending = false;
    return function () {
      if (t) { pending = true; return; }
      fn();
      t = setTimeout(function tick() {
        if (pending) { pending = false; fn(); t = setTimeout(tick, ms); } else t = null;
      }, ms);
    };
  };

  C.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function luminance(color) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(color || '');
    if (!m) return null;
    if (m[4] !== undefined && +m[4] < 0.5) return null;
    return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
  }

  /** 'dark' or 'light', read from the page's actual background. */
  C.theme = function (el) {
    let node = el || document.body;
    while (node && node.nodeType === 1) {
      const l = luminance(getComputedStyle(node).backgroundColor);
      if (l !== null) return l < 0.5 ? 'dark' : 'light';
      node = node.parentElement;
    }
    const l = luminance(getComputedStyle(document.documentElement).backgroundColor);
    if (l !== null) return l < 0.5 ? 'dark' : 'light';
    return matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
})(globalThis);
