# Kolibri network server

A small Node.js service that collects KOL calls around the clock, prices them with the same code as the extension ([`../extension/shared`](../extension/shared)) and serves report cards, a public leaderboard and Pro features.

- **Zero dependencies.** Node 22.13+ (`node:sqlite`, `node:http`, global `fetch`). No `npm install`.
- **Telegram:** public channels are read from `https://t.me/s/<channel>` — no Telegram account or API keys.
- **X:** extension users who turn on sharing send post links; the server re-reads every post through X's public oEmbed endpoint and credits it to the author X reports, so a client cannot invent posts or misattribute them. With `X_BEARER_TOKEN` it can also pull tracked timelines through the X API v2.
- **Prices:** Binance market data, DexScreener, GeckoTerminal (optionally a CoinGecko Demo key).

## Run

```bash
# from the repository root
PRO_KEYS=KOLIBRI-DEV-0000-0000 TRACK=some_channel,another_channel node server/src/index.js
# → Kolibri server on http://0.0.0.0:8787
```

Open `http://localhost:8787/` for the public leaderboard. In the extension, set **Settings → Kolibri network → Server URL** to `http://localhost:8787`.

To keep settings in a file, copy [`.env.example`](.env.example) to `server/.env` and run `node --env-file=server/.env server/src/index.js`.

With Docker (build from the repository root, the server uses `extension/shared`):

```bash
docker build -t kolibri-server .
docker run -d -p 8787:8787 -v kolibri-data:/app/server/data \
  -e PRO_KEYS=... -e ADMIN_TOKEN=... -e TRACK=some_channel kolibri-server
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Where to listen. |
| `DB_PATH` | `server/data/kolibri.db` | SQLite file. |
| `PUBLIC_NAME` | `Kolibri network` | Shown on the leaderboard page and in `/v1/health`. |
| `TRACK` | | Comma-separated Telegram channel usernames to collect. |
| `KOLS_FILE` | `server/kols.json` | More accounts to track, e.g. `[{"platform":"tg","handle":"channel"},{"platform":"x","handle":"someone"}]` (see `kols.example.json`). X accounts need `X_BEARER_TOKEN`. |
| `X_BEARER_TOKEN` | | X API v2 app token for collecting tracked X accounts. |
| `COINGECKO_DEMO_KEY` | | Raises GeckoTerminal limits for DEX pricing. |
| `PRO_KEYS` | | Comma-separated license keys that unlock Pro (simple setups). |
| `ADMIN_TOKEN` | | Enables the admin endpoints below. |
| `HISTORY_DAYS` | `180` | How far back to collect. |
| `COLLECT_EVERY_MIN` | `30` | How often tracked accounts are re-read. |
| `INGEST_PER_MINUTE` | `120` | Per-IP limit for `/v1/ingest`. |
| `WORKERS` | `1` | `0` serves the API without background collection and pricing. |

## API

All responses are JSON unless noted. Send `Authorization: Bearer <license key>` to get Pro responses.

| Method | Path | |
| --- | --- | --- |
| `GET` | `/` | Public leaderboard page (HTML). |
| `GET` | `/v1/health` | `{ok, name, version, kols, calls, tracked, queued}` |
| `GET` | `/v1/leaderboard?platform=x\|tg&limit=100` | `{items: [{key, author, summary}]}`, graded first, best score first. |
| `GET` | `/v1/summaries?keys=x:handle,tg:channel` | `{items: {key: {key, author, summary}}}` for badges. |
| `GET` | `/v1/kols/{x\|tg}/{handle}` | Report card: `{author, summary, calls, total, truncated, plan}`. Free: 10 most recent calls. Pro: every call. |
| `GET` | `/v1/kols/{x\|tg}/{handle}/export.csv` | CSV of every call. Pro only (`402` otherwise). |
| `POST` | `/v1/license/verify` | `{key}` → `{valid, plan, expiresAt}` |
| `POST` | `/v1/ingest` | `{posts: [{platform, handle, postId, url}]}` → `{queued, channels}`. X posts are verified before counting; Telegram channels are added to the tracked list. |
| `POST` | `/v1/admin/track` | `{platform, handle}` — start tracking an account. Needs `ADMIN_TOKEN`. |
| `POST` | `/v1/admin/licenses` | `{key, plan, expiresAt, note}` — issue or update a license (call it from your checkout webhook). Needs `ADMIN_TOKEN`. |

`summary` has the same shape everywhere (see [`score.js`](../extension/shared/score.js)): `calls, priced7, win24, win7, med24, med7, avg7, medPeak, best, worst, score, grade, tone, firstAt, lastAt`.

## Notes

- Keyless GeckoTerminal allows about 10 requests a minute and six months of candles. The server spaces requests per host and keeps every call's state in SQLite, so a restart resumes where it stopped.
- The X oEmbed endpoint and `t.me/s/` are public pages. Be polite: the defaults keep well under their limits.
