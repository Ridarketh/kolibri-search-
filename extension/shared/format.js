/* Kolibri — display formatting shared by the in-page card, popup and report.
 * Exposes globalThis.Kolibri.format (and module.exports in Node). */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  (root.Kolibri = root.Kolibri || {}).format = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MINUS = '−';
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Return as "+12%", "−8.4%", or "4.1x" once it at least doubled. */
  function ret(r) {
    if (!isNum(r)) return '—';
    if (r >= 1) {
      const x = 1 + r;
      return (x >= 100 ? Math.round(x).toLocaleString('en-US') : x >= 10 ? x.toFixed(0) : x.toFixed(1)) + 'x';
    }
    const p = r * 100;
    const abs = Math.abs(p);
    const body = abs < 10 ? abs.toFixed(1) : abs.toFixed(0);
    if (body === '0.0') return '0%';
    return (p > 0 ? '+' : MINUS) + body + '%';
  }

  /** Always a percentage: "+12%", "−8%". */
  function pct(r, digits) {
    if (!isNum(r)) return '—';
    const p = r * 100;
    const d = digits === undefined ? (Math.abs(p) < 10 ? 1 : 0) : digits;
    const body = Math.abs(p).toFixed(d);
    if (+body === 0) return '0%';
    return (p > 0 ? '+' : MINUS) + Number(body).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  }

  /** Share 0..1 as "61%". */
  function share(v) {
    return isNum(v) ? Math.round(v * 100) + '%' : '—';
  }

  function tone(r) {
    if (!isNum(r)) return 'none';
    if (r > 0.0005) return 'up';
    if (r < -0.0005) return 'down';
    return 'flat';
  }

  function sub(n) {
    return String(n).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
  }

  /** Token price; tiny memecoin prices use DEX-style zero compression: 0.0₅1234. */
  function price(p) {
    if (!isNum(p) || p <= 0) return '—';
    if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (p >= 0.0001) return '$' + p.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '');
    const s = p.toFixed(20);
    const m = /^0\.(0+)(\d{1,4})/.exec(s);
    if (!m) return '$' + p.toExponential(2);
    return '$0.0' + sub(m[1].length) + m[2].replace(/0+$/, '');
  }

  function money(v) {
    if (!isNum(v)) return '—';
    const sign = v < 0 ? MINUS : '';
    const a = Math.abs(v);
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return sign + '$' + (a / 1e3).toFixed(1) + 'k';
    return sign + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function date(ms, now) {
    if (!isNum(ms)) return '—';
    const d = new Date(ms);
    const n = new Date(isNum(now) ? now : Date.now());
    const base = MONTHS[d.getMonth()] + ' ' + d.getDate();
    return d.getFullYear() === n.getFullYear() ? base : base + ', ' + d.getFullYear();
  }

  function dateTime(ms) {
    if (!isNum(ms)) return '—';
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${hh}:${mm}`;
  }

  function ago(ms, now) {
    if (!isNum(ms)) return '—';
    const s = Math.max(0, ((isNum(now) ? now : Date.now()) - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 60) return Math.floor(s / 86400) + 'd ago';
    return date(ms, now);
  }

  /** Time until a horizon is reached: "in 5h", "in 3d". */
  function until(ms, now) {
    if (!isNum(ms)) return '';
    const s = (ms - (isNum(now) ? now : Date.now())) / 1000;
    if (s <= 0) return 'soon';
    if (s < 3600) return 'in ' + Math.max(1, Math.round(s / 60)) + 'm';
    if (s < 86400) return 'in ' + Math.round(s / 3600) + 'h';
    return 'in ' + Math.round(s / 86400) + 'd';
  }

  function shortAddr(a) {
    if (!a) return '';
    return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a;
  }

  function tokenLabel(call) {
    if (!call) return '';
    if (call.symbol) return '$' + call.symbol;
    if (call.token && call.token.symbol) return '$' + call.token.symbol;
    if (call.token && call.token.symbolHint) return '$' + call.token.symbolHint;
    return call.token ? shortAddr(call.token.address) : '';
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  /** Only http(s) links from outside data are ever rendered; anything else becomes inert. */
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    return /^https?:\/\//i.test(s) ? s : '#';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { ret, pct, share, tone, price, money, date, dateTime, ago, until, shortAddr, tokenLabel, plural, escapeHtml, safeUrl, isNum };
});
