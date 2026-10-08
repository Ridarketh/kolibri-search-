/* Kolibri — report-card math: win rates, medians, follow-every-call ROI, score and grade.
 * Exposes globalThis.Kolibri.score (and module.exports in Node). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.Kolibri.config;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  (root.Kolibri = root.Kolibri || {}).score = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cfg) {
  'use strict';

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  function median(values) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function mean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  function share(values, pred) {
    return values.length ? values.filter(pred).length / values.length : null;
  }

  const GRADES = [
    { min: 75, grade: 'A', tone: 'good' },
    { min: 62, grade: 'B', tone: 'good' },
    { min: 50, grade: 'C', tone: 'mid' },
    { min: 38, grade: 'D', tone: 'bad' },
    { min: -Infinity, grade: 'F', tone: 'bad' }
  ];

  /**
   * Score 0..100 from 7-day results. 60% weight on (Laplace-smoothed) win rate, 40% on the
   * median 7-day return (clamped to ±100%), shrunk towards 50 when there are few calls.
   */
  function scoreFrom(r7s) {
    const n = r7s.length;
    if (!n) return null;
    const wins = r7s.filter((r) => r > 0).length;
    const adjWin = (wins + 1) / (n + 2);
    const med = Math.max(-1, Math.min(1, median(r7s)));
    const raw = 0.6 * adjWin + 0.4 * ((med + 1) / 2);
    const weight = n / (n + 5);
    return Math.round(100 * (0.5 + weight * (raw - 0.5)));
  }

  function gradeFor(score, n) {
    if (score == null || n < cfg.MIN_CALLS_FOR_GRADE) return { grade: null, tone: 'none' };
    const g = GRADES.find((x) => score >= x.min);
    return { grade: g.grade, tone: g.tone };
  }

  function counted(c) {
    return c && c.status !== 'unresolved' && c.status !== 'no-entry' && c.status !== 'too-old';
  }

  /** Summary of a KOL's calls (calls carry r24 / r7 / rPeak when priced). */
  function summarize(calls, opts) {
    const now = (opts && opts.now) || Date.now();
    const all = Array.isArray(calls) ? calls : [];
    const live = all.filter(counted);
    const r24 = live.filter((c) => isNum(c.r24)).map((c) => c.r24);
    const r7Calls = live.filter((c) => isNum(c.r7));
    const r7 = r7Calls.map((c) => c.r7);
    const peaks = live.filter((c) => isNum(c.rPeak)).map((c) => c.rPeak);

    let best = null;
    let worst = null;
    for (const c of r7Calls) {
      if (!best || c.r7 > best.r7) best = c;
      if (!worst || c.r7 < worst.r7) worst = c;
    }
    const score = scoreFrom(r7);
    const g = gradeFor(score, r7.length);
    const times = all.map((c) => c.postedAt).filter(isNum);
    const brief = (c) => c && { id: c.id, symbol: c.symbol || null, r7: c.r7, postedAt: c.postedAt };

    return {
      calls: live.length,
      tracked: all.length,
      priced24: r24.length,
      priced7: r7.length,
      pending: live.filter((c) => !isNum(c.r7)).length,
      skipped: all.length - live.length,
      win24: share(r24, (r) => r > 0),
      win7: share(r7, (r) => r > 0),
      med24: median(r24),
      med7: median(r7),
      // Average 7-day return = ROI of putting the same amount into every call and selling after a week.
      avg7: mean(r7),
      medPeak: median(peaks),
      best: brief(best),
      worst: brief(worst),
      score,
      grade: g.grade,
      tone: g.tone,
      firstAt: times.length ? Math.min(...times) : null,
      lastAt: times.length ? Math.max(...times) : null,
      computedAt: now
    };
  }

  /** Sort key for leaderboards: graded first, then by score, then by sample size. */
  function rankCompare(a, b) {
    const ga = a.summary && a.summary.grade ? 1 : 0;
    const gb = b.summary && b.summary.grade ? 1 : 0;
    if (ga !== gb) return gb - ga;
    const sa = (a.summary && a.summary.score) || 0;
    const sb = (b.summary && b.summary.score) || 0;
    if (sa !== sb) return sb - sa;
    return ((b.summary && b.summary.priced7) || 0) - ((a.summary && a.summary.priced7) || 0);
  }

  return { summarize, scoreFrom, gradeFor, median, mean, rankCompare, isNum, counted };
});
