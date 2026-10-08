/* Kolibri — shared constants.
 * Loaded as a classic script in the extension (content scripts, service worker, pages)
 * and via require() in Node (tests, server). Exposes globalThis.Kolibri.config. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  (root.Kolibri = root.Kolibri || {}).config = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  return Object.freeze({
    VERSION: '0.1.0',
    MIN, HOUR, DAY,

    // What happened to a call after these horizons.
    H24: DAY,
    D7: 7 * DAY,

    // A token mentioned again by the same KOL within this window of the first
    // mention is the same call, not a new one.
    REPEAT_WINDOW_MS: 7 * DAY,

    // Posts that list more distinct tokens than this are commentary
    // ("top 10 coins this week"), not calls.
    MAX_TOKENS_PER_POST: 6,

    // A grade is shown once this many calls have a 7-day result.
    MIN_CALLS_FOR_GRADE: 3,

    // Free tier: how many recent calls a network card shows.
    FREE_RECENT_CALLS: 10,
    // When false, everything collected on this device is free (it is the user's own data);
    // Pro gates the network's full history and export. Flip to gate local data too.
    GATE_LOCAL_DATA: false,

    // Keyless GeckoTerminal only serves the last ~6 months of OHLCV.
    DEX_HISTORY_DAYS: 180,

    // Tickers that are not "calls" by default.
    MAJORS: [
      'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'TON', 'AVAX', 'DOT', 'LINK',
      'LTC', 'BCH', 'XLM', 'XMR', 'ETC', 'ATOM', 'HBAR', 'MATIC', 'POL', 'WBTC', 'WETH',
      'STETH', 'WSOL', 'CBBTC'
    ],
    STABLES: [
      'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDE', 'USDD', 'PYUSD', 'USDS', 'FRAX',
      'LUSD', 'GUSD', 'USDP', 'EURC', 'EURT', 'USD1', 'RLUSD', 'USDB', 'USDY', 'SUSDE', 'CRVUSD'
    ],
    // Cashtags that are fiat, indices or stocks, not crypto.
    NOT_CRYPTO: [
      'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CNH', 'RUB', 'CAD', 'AUD', 'CHF', 'HKD', 'KRW', 'INR',
      'SPX', 'SPY', 'QQQ', 'NDX', 'DXY', 'VIX', 'DJI', 'IWM', 'TLT', 'GLD', 'SLV',
      'TSLA', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSTR', 'COIN', 'HOOD',
      'GME', 'AMC', 'PLTR', 'AMD', 'INTC', 'NFLX', 'SMCI', 'ARM', 'IBIT', 'ETHA', 'FBTC', 'GBTC',
      'CRCL', 'SBET', 'BMNR', 'CEP', 'NAKA', 'GLXY'
    ],

    ENDPOINTS: Object.freeze({
      binance: 'https://data-api.binance.vision/api/v3',
      dexscreener: 'https://api.dexscreener.com',
      gecko: 'https://api.geckoterminal.com/api/v2',
      // With a free CoinGecko "Demo" key the same on-chain data is served here (higher limits).
      geckoDemo: 'https://api.coingecko.com/api/v3/onchain',
      telegramPreview: 'https://t.me/s/'
    }),

    // Requests per minute we allow ourselves per host (kept under the published limits).
    RATE_LIMITS: Object.freeze({
      'data-api.binance.vision': 300,
      'api.dexscreener.com': 120,
      'api.geckoterminal.com': 9,
      'api.coingecko.com': 25,
      't.me': 20
    }),

    // DexScreener chain ids -> GeckoTerminal network ids.
    DEX_TO_GECKO: Object.freeze({
      solana: 'solana', ethereum: 'eth', bsc: 'bsc', base: 'base', arbitrum: 'arbitrum',
      polygon: 'polygon_pos', avalanche: 'avax', optimism: 'optimism', fantom: 'ftm',
      cronos: 'cro', blast: 'blast', linea: 'linea', zksync: 'zksync', sui: 'sui-network',
      ton: 'ton', tron: 'tron', mantle: 'mantle', scroll: 'scroll', celo: 'celo',
      pulsechain: 'pulsechain', berachain: 'berachain', sonic: 'sonic', abstract: 'abstract',
      unichain: 'unichain', hyperevm: 'hyperevm', apechain: 'apechain', aptos: 'aptos',
      sei: 'sei-evm', metis: 'metis', mode: 'mode', ink: 'ink', gnosischain: 'xdai'
    }),

    // Chain names as they appear in explorer/terminal links -> DexScreener chain ids.
    CHAIN_ALIASES: Object.freeze({
      sol: 'solana', solana: 'solana', eth: 'ethereum', ether: 'ethereum', ethereum: 'ethereum',
      mainnet: 'ethereum', bsc: 'bsc', bnb: 'bsc', base: 'base', arbitrum: 'arbitrum', arb: 'arbitrum',
      polygon: 'polygon', matic: 'polygon', avalanche: 'avalanche', avax: 'avalanche',
      optimism: 'optimism', op: 'optimism', blast: 'blast', tron: 'tron', ton: 'ton', sui: 'sui',
      sonic: 'sonic', abstract: 'abstract', berachain: 'berachain', hyperevm: 'hyperevm',
      linea: 'linea', zksync: 'zksync', mantle: 'mantle', unichain: 'unichain'
    })
  });
});
