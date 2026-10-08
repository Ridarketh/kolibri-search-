/* Kolibri — storage for the service worker (the only writer).
 *   kol:<key>   full record {key, author, mentions, calls}
 *   sum:<key>   {key, author, summary, counts, updatedAt}   (read by content scripts for badges)
 *   idx         [keys]
 *   due         {key: earliest time a call of this KOL needs pricing}
 *   mkt:<token> {market, at}
 *   tgmap       {channelId: username}
 *   settings, license, job:<key>
 */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const L = K.ledger;
  const S = K.score;
  const local = chrome.storage.local;

  const DEFAULT_SETTINGS = Object.freeze({
    showOnX: true,
    showOnTelegram: true,
    showEmpty: false,
    includeMajors: false,
    apiUrl: '',
    contribute: false,
    geckoKey: '',
    autoHistory: true,
    historyDepthDays: 120
  });

  // ---- simple per-key mutex so read-modify-write cycles never interleave
  const locks = new Map();
  function withLock(name, fn) {
    const prev = locks.get(name) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(name, tail);
    tail.then(() => { if (locks.get(name) === tail) locks.delete(name); });
    return run;
  }

  async function get(key) {
    const o = await local.get(key);
    return o[key];
  }

  async function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, (await get('settings')) || {});
  }

  async function setSettings(patch) {
    return withLock('settings', async () => {
      const next = Object.assign(await getSettings(), patch || {});
      await local.set({ settings: next });
      return next;
    });
  }

  async function getKol(key) {
    return (await get('kol:' + key)) || null;
  }

  function visibleCalls(record, settings) {
    const includeMajors = settings && settings.includeMajors;
    return (record.calls || []).filter((c) => includeMajors || !(c.token && c.token.major));
  }

  function earliestDue(record) {
    let due = null;
    for (const c of record.calls || []) {
      let t = null;
      if (c.status === 'new') t = 0;
      else if ((c.status === 'partial' || c.status === 'error') && c.nextCheckAt) t = c.nextCheckAt;
      if (t !== null && (due === null || t < due)) due = t;
    }
    return due;
  }

  function summaryEntry(record, settings) {
    const calls = visibleCalls(record, settings);
    return {
      key: record.key,
      author: record.author,
      summary: S.summarize(calls),
      counts: {
        mentions: (record.mentions || []).length,
        pricing: calls.filter((c) => c.status === 'new' || c.status === 'error').length
      },
      updatedAt: record.updatedAt
    };
  }

  /** Persist a record and everything derived from it. Call inside withLock('kol:'+key). */
  async function saveKol(record, settings) {
    record.updatedAt = Date.now();
    const st = settings || await getSettings();
    const sum = summaryEntry(record, st);
    const writes = { ['kol:' + record.key]: record, ['sum:' + record.key]: sum };
    await local.set(writes);
    await withLock('idx', async () => {
      const idx = (await get('idx')) || [];
      if (!idx.includes(record.key)) {
        idx.push(record.key);
        await local.set({ idx });
      }
    });
    await withLock('due', async () => {
      const due = (await get('due')) || {};
      const d = earliestDue(record);
      if (d === null) delete due[record.key];
      else due[record.key] = d;
      await local.set({ due });
    });
    return sum;
  }

  /** Re-derive all summaries (e.g. after "count majors" changes). */
  async function resummarizeAll() {
    const st = await getSettings();
    const idx = (await get('idx')) || [];
    for (const key of idx) {
      await withLock('kol:' + key, async () => {
        const rec = await getKol(key);
        if (rec) await local.set({ ['sum:' + key]: summaryEntry(rec, st) });
      });
    }
  }

  function mergeAuthor(prev, next) {
    const a = Object.assign({}, prev || {});
    for (const [k, v] of Object.entries(next || {})) if (v !== undefined && v !== null && v !== '') a[k] = v;
    return a;
  }

  /** Add mentions for an author. Returns {key, added}. */
  async function ingest(key, author, mentions) {
    return withLock('kol:' + key, async () => {
      const rec = (await getKol(key)) || L.emptyRecord(key, author);
      const before = JSON.stringify(rec.author);
      rec.author = mergeAuthor(rec.author, author);
      const added = L.addMentions(rec, mentions);
      if (added || !rec.updatedAt || before !== JSON.stringify(rec.author)) await saveKol(rec);
      return { key, added };
    });
  }

  /** Move a channel's data from its id-based key to its username key. */
  async function mergeKol(fromKey, toKey, author) {
    if (fromKey === toKey) return;
    const from = await getKol(fromKey);
    await withLock('kol:' + toKey, async () => {
      const to = (await getKol(toKey)) || L.emptyRecord(toKey, author);
      to.author = mergeAuthor(mergeAuthor(from && from.author, to.author), author);
      if (from) {
        const prevCalls = (to.calls || []).concat(from.calls || []);
        L.addMentions(to, from.mentions || []);
        to.calls = L.groupCalls(to.mentions, prevCalls);
      }
      await saveKol(to);
    });
    if (from) await removeKol(fromKey);
  }

  async function removeKol(key) {
    await withLock('kol:' + key, () => local.remove(['kol:' + key, 'sum:' + key, 'job:' + key]));
    await withLock('idx', async () => {
      const idx = ((await get('idx')) || []).filter((k) => k !== key);
      await local.set({ idx });
    });
    await withLock('due', async () => {
      const due = (await get('due')) || {};
      delete due[key];
      await local.set({ due });
    });
  }

  async function getSummaries(keys) {
    if (!keys || !keys.length) return {};
    const o = await local.get(keys.map((k) => 'sum:' + k));
    const out = {};
    for (const k of keys) if (o['sum:' + k]) out[k] = o['sum:' + k];
    return out;
  }

  async function allSummaries() {
    const idx = (await get('idx')) || [];
    return Object.values(await getSummaries(idx));
  }

  async function getTgMap() {
    return (await get('tgmap')) || {};
  }

  async function setTgAlias(channelId, username) {
    return withLock('tgmap', async () => {
      const map = await getTgMap();
      if (map[channelId] === username) return false;
      map[channelId] = username;
      await local.set({ tgmap: map });
      return true;
    });
  }

  async function setJob(key, job) {
    await local.set({ ['job:' + key]: Object.assign({ updatedAt: Date.now() }, job) });
  }

  async function getMarketCache(cacheKey) {
    const v = await get('mkt:' + cacheKey);
    if (!v) return undefined;
    const ttl = v.market ? 14 * 86400000 : 86400000;
    return Date.now() - v.at < ttl ? v.market : undefined;
  }

  async function setMarketCache(cacheKey, market) {
    await local.set({ ['mkt:' + cacheKey]: { market: market || null, at: Date.now() } });
  }

  async function clearAll() {
    const settings = await get('settings');
    const license = await get('license');
    await local.clear();
    await local.set(Object.assign({}, settings ? { settings } : {}, license ? { license } : {}));
  }

  async function exportAll() {
    const idx = (await get('idx')) || [];
    const o = await local.get(idx.map((k) => 'kol:' + k));
    return {
      format: 'kolibri-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      kols: idx.map((k) => o['kol:' + k]).filter(Boolean).map((r) => ({ key: r.key, author: r.author, mentions: r.mentions, calls: r.calls }))
    };
  }

  async function importAll(data) {
    if (!data || data.format !== 'kolibri-backup' || !Array.isArray(data.kols)) throw new Error('Not a Kolibri backup file');
    let n = 0;
    for (const r of data.kols) {
      if (!r || !r.key || !Array.isArray(r.mentions)) continue;
      await withLock('kol:' + r.key, async () => {
        const rec = (await getKol(r.key)) || L.emptyRecord(r.key, r.author);
        rec.author = mergeAuthor(rec.author, r.author);
        const prevCalls = (rec.calls || []).concat(r.calls || []);
        L.addMentions(rec, r.mentions);
        rec.calls = L.groupCalls(rec.mentions, prevCalls);
        await saveKol(rec);
      });
      n++;
    }
    return n;
  }

  K.store = {
    DEFAULT_SETTINGS, withLock, get, getSettings, setSettings, getKol, saveKol, ingest, mergeKol, removeKol,
    getSummaries, allSummaries, getTgMap, setTgAlias, setJob, getMarketCache, setMarketCache, clearAll,
    exportAll, importAll, resummarizeAll, visibleCalls, summaryEntry
  };
})(globalThis);
