#!/usr/bin/env node
'use strict';
// Kolibri network server: `node server/src/index.js` (Node 22.13+, no npm install needed).

const fs = require('fs');
const http = require('http');
const { loadConfig } = require('./config');
const { Store } = require('./db');
const { createApp } = require('./core');
const { createHandler } = require('./http');

function loadTrackedFile(file) {
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(list) ? list : [];
}

function main() {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const app = createApp({ config, store });

  const tracked = [
    ...config.track.map((handle) => ({ platform: 'tg', handle })),
    ...loadTrackedFile(config.kolsFile)
  ];
  for (const t of tracked) {
    try { app.track(t.platform, t.handle); } catch (err) { console.warn(`skip ${t.platform}/${t.handle}: ${err.message}`); }
  }

  const server = http.createServer(createHandler(app, config));
  server.listen(config.port, config.host, () => {
    console.log(`Kolibri server on http://${config.host}:${config.port}  (db: ${config.dbPath})`);
    console.log(`Tracking ${tracked.length} account(s). Pro keys from env: ${config.proKeys.length}.`);
  });
  if (config.workers) app.start();

  const shutdown = () => {
    app.stop();
    server.close(() => { store.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = { main };
