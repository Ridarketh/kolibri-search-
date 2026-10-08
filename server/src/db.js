'use strict';
// SQLite storage on Node's built-in node:sqlite (Node 22.13+). No native modules to install.

const fs = require('fs');
const path = require('path');

// node:sqlite prints an ExperimentalWarning once; keep server logs clean.
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if (String(warning && warning.message ? warning.message : warning).includes('SQLite')) return;
  return origEmit.call(process, warning, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kols (
  key TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  name TEXT,
  avatar TEXT,
  tracked INTEGER NOT NULL DEFAULT 0,
  collected_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mentions (
  kol_key TEXT NOT NULL,
  post_id TEXT NOT NULL,
  token_key TEXT NOT NULL,
  token TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  url TEXT,
  snippet TEXT,
  PRIMARY KEY (kol_key, post_id, token_key)
);
CREATE TABLE IF NOT EXISTS calls (
  kol_key TEXT NOT NULL,
  id TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  due_at INTEGER,
  data TEXT NOT NULL,
  PRIMARY KEY (kol_key, id)
);
CREATE INDEX IF NOT EXISTS calls_due ON calls (due_at) WHERE due_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS summaries (
  kol_key TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  graded INTEGER NOT NULL,
  score INTEGER,
  calls INTEGER NOT NULL,
  priced7 INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS markets (
  cache_key TEXT PRIMARY KEY,
  data TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS licenses (
  key TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'pro',
  expires_at TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS queue (
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  post_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  PRIMARY KEY (platform, post_id)
);
`;

class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.q = {};
  }

  stmt(sql) {
    if (!this.q[sql]) this.q[sql] = this.db.prepare(sql);
    return this.q[sql];
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() { this.db.close(); }

  // ---------------------------------------------------------------- kols

  upsertKol(key, author, now) {
    this.stmt(`INSERT INTO kols (key, platform, handle, name, avatar, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET handle = excluded.handle,
        name = COALESCE(excluded.name, kols.name), avatar = COALESCE(excluded.avatar, kols.avatar), updated_at = excluded.updated_at`)
      .run(key, author.platform, author.handle, author.name || null, author.avatar || null, now);
  }

  getKol(key) {
    const r = this.stmt('SELECT * FROM kols WHERE key = ?').get(key);
    return r ? { key: r.key, platform: r.platform, handle: r.handle, name: r.name, avatar: r.avatar, tracked: Boolean(r.tracked), collectedAt: r.collected_at } : null;
  }

  setTracked(key, on) {
    this.stmt('UPDATE kols SET tracked = ? WHERE key = ?').run(on ? 1 : 0, key);
  }

  tracked(platform) {
    return this.stmt('SELECT key, platform, handle, collected_at FROM kols WHERE tracked = 1 AND platform = ? ORDER BY COALESCE(collected_at, 0)').all(platform)
      .map((r) => ({ key: r.key, platform: r.platform, handle: r.handle, collectedAt: r.collected_at }));
  }

  setCollected(key, at) {
    this.stmt('UPDATE kols SET collected_at = ? WHERE key = ?').run(at, key);
  }

  // ---------------------------------------------------------------- mentions & calls

  addMentions(key, mentions) {
    const ins = this.stmt(`INSERT OR IGNORE INTO mentions (kol_key, post_id, token_key, token, posted_at, url, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let added = 0;
    for (const m of mentions) {
      const r = ins.run(key, String(m.postId), m.tokenKey, JSON.stringify(m.token), m.postedAt, m.url || null, (m.snippet || '').slice(0, 200));
      added += Number(r.changes || 0);
    }
    return added;
  }

  mentions(key) {
    return this.stmt('SELECT * FROM mentions WHERE kol_key = ?').all(key).map((r) => ({
      postId: r.post_id, tokenKey: r.token_key, token: JSON.parse(r.token), postedAt: r.posted_at, url: r.url, snippet: r.snippet
    }));
  }

  knownPostIds(key) {
    return new Set(this.stmt('SELECT DISTINCT post_id FROM mentions WHERE kol_key = ?').all(key).map((r) => r.post_id));
  }

  calls(key) {
    return this.stmt('SELECT data FROM calls WHERE kol_key = ? ORDER BY posted_at DESC').all(key).map((r) => JSON.parse(r.data));
  }

  static dueAt(call) {
    if (call.status === 'new') return 0;
    if ((call.status === 'partial' || call.status === 'error') && call.nextCheckAt) return call.nextCheckAt;
    return null;
  }

  replaceCalls(key, calls) {
    this.stmt('DELETE FROM calls WHERE kol_key = ?').run(key);
    const ins = this.stmt('INSERT INTO calls (kol_key, id, posted_at, status, due_at, data) VALUES (?, ?, ?, ?, ?, ?)');
    for (const c of calls) ins.run(key, c.id, c.postedAt, c.status, Store.dueAt(c), JSON.stringify(c));
  }

  saveCall(key, call) {
    this.stmt('UPDATE calls SET status = ?, due_at = ?, data = ? WHERE kol_key = ? AND id = ?')
      .run(call.status, Store.dueAt(call), JSON.stringify(call), key, call.id);
  }

  dueCalls(now, limit) {
    return this.stmt('SELECT kol_key, data FROM calls WHERE due_at IS NOT NULL AND due_at <= ? ORDER BY due_at, posted_at DESC LIMIT ?')
      .all(now, limit).map((r) => ({ key: r.kol_key, call: JSON.parse(r.data) }));
  }

  // ---------------------------------------------------------------- summaries

  saveSummary(key, platform, entry, now) {
    const s = entry.summary;
    this.stmt(`INSERT INTO summaries (kol_key, platform, graded, score, calls, priced7, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kol_key) DO UPDATE SET graded = excluded.graded, score = excluded.score, calls = excluded.calls,
        priced7 = excluded.priced7, data = excluded.data, updated_at = excluded.updated_at`)
      .run(key, platform, s.grade ? 1 : 0, s.score == null ? null : s.score, s.calls, s.priced7, JSON.stringify(entry), now);
  }

  summary(key) {
    const r = this.stmt('SELECT data FROM summaries WHERE kol_key = ?').get(key);
    return r ? JSON.parse(r.data) : null;
  }

  leaderboard(platform, limit) {
    const rows = platform
      ? this.stmt('SELECT data FROM summaries WHERE calls > 0 AND platform = ? ORDER BY graded DESC, score DESC, priced7 DESC LIMIT ?').all(platform, limit)
      : this.stmt('SELECT data FROM summaries WHERE calls > 0 ORDER BY graded DESC, score DESC, priced7 DESC LIMIT ?').all(limit);
    return rows.map((r) => JSON.parse(r.data));
  }

  // ---------------------------------------------------------------- markets

  market(cacheKey, now) {
    const r = this.stmt('SELECT data, at FROM markets WHERE cache_key = ?').get(cacheKey);
    if (!r) return undefined;
    const market = r.data ? JSON.parse(r.data) : null;
    const ttl = market ? 14 * 86400000 : 86400000;
    return now - r.at < ttl ? market : undefined;
  }

  setMarket(cacheKey, market, now) {
    this.stmt('INSERT INTO markets (cache_key, data, at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, at = excluded.at')
      .run(cacheKey, market ? JSON.stringify(market) : null, now);
  }

  // ---------------------------------------------------------------- licenses

  license(key) {
    const r = this.stmt('SELECT * FROM licenses WHERE key = ?').get(key);
    return r ? { key: r.key, plan: r.plan, expiresAt: r.expires_at, note: r.note } : null;
  }

  upsertLicense(key, plan, expiresAt, note, now) {
    this.stmt(`INSERT INTO licenses (key, plan, expires_at, note, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET plan = excluded.plan, expires_at = excluded.expires_at, note = excluded.note`)
      .run(key, plan || 'pro', expiresAt || null, note || null, now);
  }

  // ---------------------------------------------------------------- verification queue (crowd-sourced X posts)

  enqueue(platform, handle, postId, now) {
    const r = this.stmt('INSERT OR IGNORE INTO queue (platform, handle, post_id, received_at, next_at) VALUES (?, ?, ?, ?, ?)')
      .run(platform, handle, String(postId), now, now);
    return Number(r.changes || 0);
  }

  nextQueued(now, limit) {
    return this.stmt('SELECT * FROM queue WHERE next_at <= ? ORDER BY next_at LIMIT ?').all(now, limit)
      .map((r) => ({ platform: r.platform, handle: r.handle, postId: r.post_id, attempts: r.attempts }));
  }

  dequeue(platform, postId) {
    this.stmt('DELETE FROM queue WHERE platform = ? AND post_id = ?').run(platform, String(postId));
  }

  retryLater(platform, postId, attempts, nextAt) {
    this.stmt('UPDATE queue SET attempts = ?, next_at = ? WHERE platform = ? AND post_id = ?').run(attempts, nextAt, platform, String(postId));
  }

  // ---------------------------------------------------------------- stats

  stats() {
    return {
      kols: this.stmt('SELECT count(*) AS n FROM summaries WHERE calls > 0').get().n,
      calls: this.stmt('SELECT count(*) AS n FROM calls').get().n,
      tracked: this.stmt('SELECT count(*) AS n FROM kols WHERE tracked = 1').get().n,
      queued: this.stmt('SELECT count(*) AS n FROM queue').get().n
    };
  }
}

module.exports = { Store };
