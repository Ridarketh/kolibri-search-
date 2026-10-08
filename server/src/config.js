'use strict';
const path = require('path');

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/** Server settings, all from environment variables (see server/.env.example). */
function loadConfig(env) {
  const e = env || process.env;
  return {
    port: Number(e.PORT || 8787),
    host: e.HOST || '0.0.0.0',
    name: e.PUBLIC_NAME || 'Kolibri network',
    dbPath: e.DB_PATH || path.join(__dirname, '..', 'data', 'kolibri.db'),
    kolsFile: e.KOLS_FILE || path.join(__dirname, '..', 'kols.json'),
    adminToken: e.ADMIN_TOKEN || '',
    proKeys: list(e.PRO_KEYS),
    track: list(e.TRACK),
    xBearer: e.X_BEARER_TOKEN || '',
    geckoKey: e.COINGECKO_DEMO_KEY || '',
    historyDays: Number(e.HISTORY_DAYS || 180),
    collectEveryMin: Number(e.COLLECT_EVERY_MIN || 30),
    verifyEverySec: Number(e.VERIFY_EVERY_SEC || 2),
    priceEverySec: Number(e.PRICE_EVERY_SEC || 5),
    ingestPerMinute: Number(e.INGEST_PER_MINUTE || 120),
    workers: e.WORKERS !== '0'
  };
}

module.exports = { loadConfig };
