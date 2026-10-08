/* Kolibri — background service worker: storage owner, pricing queue, message router. */
'use strict';

importScripts(
  '../shared/config.js',
  '../shared/minihtml.js',
  '../shared/extract.js',
  '../shared/prices.js',
  '../shared/score.js',
  '../shared/ledger.js',
  '../shared/telegram-preview.js',
  'net.js',
  'store.js',
  'resolver.js',
  'history.js',
  'api.js'
);

const K = globalThis.Kolibri;
const { store: Store, ledger: L, score: S, resolver: Resolver, api: Api, history: History, config: CFG } = K;

const TICK = 'kolibri-tick';
let pumpTimer = null;

function schedulePump(delay) {
  clearTimeout(pumpTimer);
  pumpTimer = setTimeout(() => Resolver.pump(), delay === undefined ? 1200 : delay);
}

function ensureAlarm() {
  chrome.alarms.get(TICK, (a) => {
    if (!a) chrome.alarms.create(TICK, { periodInMinutes: 1, delayInMinutes: 0.5 });
  });
}

async function resolveTgKey(author) {
  let handle = author.handle || null;
  const channelId = author.channelId ? String(author.channelId) : null;
  if (!handle && channelId) handle = (await Store.getTgMap())[channelId] || null;
  if (handle && channelId) {
    const changed = await Store.setTgAlias(channelId, handle);
    if (changed) await Store.mergeKol(L.authorKey('tg', null, channelId), L.authorKey('tg', handle), Object.assign({}, author, { handle }));
  }
  return { key: L.authorKey('tg', handle, channelId), handle };
}

function sortCalls(calls) {
  return calls.slice().sort((a, b) => b.postedAt - a.postedAt);
}

async function localCard(key, settings, limit) {
  const rec = await Store.getKol(key);
  if (!rec) return null;
  const calls = sortCalls(Store.visibleCalls(rec, settings));
  return {
    author: rec.author,
    summary: S.summarize(calls),
    calls: limit ? calls.slice(0, limit) : calls,
    total: calls.length,
    pricing: calls.filter((c) => c.status === 'new' || c.status === 'error').length,
    updatedAt: rec.updatedAt
  };
}

const handlers = {
  async ingest({ author, posts }) {
    if (!author || !Array.isArray(posts)) throw new Error('bad ingest');
    let key;
    const a = Object.assign({}, author);
    if (a.platform === 'tg') {
      const r = await resolveTgKey(a);
      key = r.key;
      a.handle = r.handle;
    } else {
      if (!a.handle) throw new Error('missing handle');
      key = L.authorKey('x', a.handle);
    }
    const mentions = [];
    for (const p of posts) if (p && Array.isArray(p.tokens)) mentions.push(...L.mentionsFromPost(p, p.tokens));
    const res = await Store.ingest(key, a, mentions);
    if (res.added) {
      schedulePump();
      const handle = a.handle || null;
      if (handle) Api.contribute(posts.map((p) => ({ platform: a.platform, handle, postId: String(p.postId), url: p.url })));
    }
    return res;
  },

  async summaries({ keys }) {
    const list = Array.from(new Set(keys || [])).slice(0, 200);
    const local = await Store.getSummaries(list);
    let network = {};
    const settings = await Store.getSettings();
    if (settings.apiUrl) {
      for (let i = 0; i < list.length; i += 40) Object.assign(network, await Api.summaries(list.slice(i, i + 40)));
    }
    return { local, network };
  },

  async card({ key }) {
    const settings = await Store.getSettings();
    Resolver.setFocus(key);
    schedulePump(0);
    const [local, job, plan] = await Promise.all([localCard(key, settings, 12), Store.get('job:' + key), Api.plan()]);
    let network = null;
    if (settings.apiUrl) {
      try { network = await Api.getCard(key); } catch (err) { network = { error: String(err.message || err) }; }
    }
    return { key, local, network, job: job || null, plan, hasApi: Boolean(settings.apiUrl) };
  },

  async report({ key }) {
    const settings = await Store.getSettings();
    const [local, plan] = await Promise.all([localCard(key, settings, 0), Api.plan()]);
    let network = null;
    if (settings.apiUrl) {
      try { network = await Api.getCard(key); } catch (err) { network = { error: String(err.message || err) }; }
    }
    return { key, local, network, plan, hasApi: Boolean(settings.apiUrl), gateLocal: CFG.GATE_LOCAL_DATA };
  },

  async leaderboard({ scope, platform }) {
    if (scope === 'network') return (await Api.leaderboard(platform)) || { items: [] };
    const items = (await Store.allSummaries())
      .filter((x) => x.summary && x.summary.calls > 0)
      .filter((x) => !platform || platform === 'all' || (x.author && x.author.platform === platform))
      .sort(S.rankCompare);
    return { items };
  },

  async exportCsv({ key, source }) {
    const plan = await Api.plan();
    if (source === 'network') {
      if (plan !== 'pro') throw new Error('CSV export of network history is a Pro feature');
      return Api.exportCsv(key);
    }
    if (CFG.GATE_LOCAL_DATA && plan !== 'pro') throw new Error('CSV export is a Pro feature');
    const settings = await Store.getSettings();
    const rec = await Store.getKol(key);
    if (!rec) throw new Error('No data for this account yet');
    return L.toCsv(rec.author, sortCalls(Store.visibleCalls(rec, settings)));
  },

  async tgHistory({ username, channelId, title }) {
    const res = await History.loadTelegram(username, {
      channelId,
      title,
      onDone: () => schedulePump(0)
    });
    if (channelId) await resolveTgKey({ platform: 'tg', handle: username, channelId, name: title });
    return res;
  },

  async tgLink({ channelId, username, title }) {
    const { key } = await resolveTgKey({ platform: 'tg', handle: username, channelId, name: title });
    return { key };
  },

  async tgKey({ channelId, username }) {
    if (username) return { key: L.authorKey('tg', username) };
    const map = await Store.getTgMap();
    const handle = map[String(channelId)] || null;
    return { key: L.authorKey('tg', handle, channelId), handle };
  },

  async reprice({ key }) {
    const tokens = [];
    await Store.withLock('kol:' + key, async () => {
      const rec = await Store.getKol(key);
      if (!rec) return;
      for (const c of rec.calls) {
        if (['unresolved', 'error', 'no-entry'].includes(c.status)) {
          c.status = 'new';
          c.attempts = 0;
          c.market = null;
          c.nextCheckAt = null;
          tokens.push(c.token);
        }
      }
      await Store.saveKol(rec);
    });
    // forget cached "no market" answers so the tokens are looked up again
    await Promise.all(tokens.map((t) => Resolver.forgetMarket(t)));
    schedulePump(0);
    return true;
  },

  async openReport({ key }) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('report/report.html') + '?key=' + encodeURIComponent(key) });
    return true;
  },

  async openOptions() {
    await chrome.runtime.openOptionsPage();
    return true;
  },

  async getSettings() {
    return Store.getSettings();
  },

  async setSettings({ patch }) {
    const before = await Store.getSettings();
    const next = await Store.setSettings(patch);
    if (before.includeMajors !== next.includeMajors) await Store.resummarizeAll();
    if (before.apiUrl !== next.apiUrl) Api.clearCache();
    return next;
  },

  async verifyLicense({ key }) {
    const res = await Api.verifyLicense(String(key || '').trim());
    const lic = { key: String(key || '').trim(), valid: Boolean(res && res.valid), plan: (res && res.plan) || 'free', expiresAt: (res && res.expiresAt) || null, verifiedAt: Date.now() };
    await chrome.storage.local.set({ license: lic });
    Api.clearCache();
    return lic;
  },

  async clearLicense() {
    await chrome.storage.local.remove('license');
    Api.clearCache();
    return true;
  },

  async testApi({ url }) {
    return Api.health(url);
  },

  async deleteKol({ key }) {
    await Store.removeKol(key);
    return true;
  },

  async clearAll() {
    await Store.clearAll();
    return true;
  },

  async exportAll() {
    return Store.exportAll();
  },

  async importAll({ data }) {
    const n = await Store.importAll(data);
    schedulePump(0);
    return n;
  },

  async status() {
    const due = (await Store.get('due')) || {};
    const idx = (await Store.get('idx')) || [];
    return { kols: idx.length, queued: Object.keys(due).length, pricing: Resolver.isRunning(), plan: await Api.plan() };
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((data) => sendResponse({ ok: true, data }), (err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK) return;
  Resolver.pump();
  Api.flush();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  ensureAlarm();
  const current = await Store.get('settings');
  if (!current) await chrome.storage.local.set({ settings: Object.assign({}, Store.DEFAULT_SETTINGS) });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') + '?welcome=1' });
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  schedulePump(3000);
});

ensureAlarm();
