/* Kolibri — in-page UI: the grade badge next to a name and the hover report card. */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const C = K.content;
  const F = K.format;
  const S = K.score;
  const UI = K.ui;
  const CFG = K.config;
  const esc = F.escapeHtml;
  const isNum = F.isNum;

  // ------------------------------------------------------------------ badge

  const badges = new Set();

  function badgeLabel(best, empty) {
    if (!best) return { html: empty ? 'No calls yet' : '', tone: 'none', title: 'Kolibri: no calls seen yet. Click for details.' };
    const s = best.summary;
    if (s.grade) {
      return {
        html: `<span class="g">${esc(s.grade)}</span><span class="w">${F.share(s.win7)}</span>`,
        tone: s.tone,
        title: `Kolibri grade ${s.grade}: ${F.share(s.win7)} of ${s.priced7} calls were up 7 days later (median ${F.pct(s.med7)})`
      };
    }
    const pending = s.calls - s.priced7;
    return {
      html: `${s.calls}<span class="w">${s.calls === 1 ? 'call' : 'calls'}</span>`,
      tone: 'none',
      title: `Kolibri: ${F.plural(s.calls, 'call')} tracked` + (pending ? `, ${pending} waiting for a 7-day result` : '')
    };
  }

  /**
   * Create a badge host. opts: {key, big, always (show even without data), context(): card context}
   */
  UI.createBadge = function (opts) {
    const host = document.createElement('span');
    host.className = 'kolibri-badge-host';
    host.dataset.kolibriKey = opts.key;
    host.style.display = 'none';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${UI.BADGE_CSS}</style><span class="kl"><button class="b${opts.big ? ' big' : ''}" type="button">${UI.bird(14)}<span class="t"></span></button></span>`;
    host._kolibri = opts;
    const btn = shadow.querySelector('.b');

    const stop = (e) => { e.stopPropagation(); };
    for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'dblclick']) host.addEventListener(ev, stop);
    host.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      UI.card.open(host, opts, true);
    });
    host.addEventListener('mouseenter', () => UI.card.hoverIn(host, opts));
    host.addEventListener('mouseleave', () => UI.card.hoverOut());
    btn.addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.card.close(); });

    badges.add(host);
    UI.updateBadge(host);
    return host;
  };

  UI.updateBadge = function (host) {
    const opts = host._kolibri;
    if (!opts) return;
    const best = C.bestSummary(opts.key);
    const visible = Boolean(best && best.summary.calls > 0) || opts.always || C.settings.showEmpty;
    const label = badgeLabel(best && best.summary.calls > 0 ? best : null, true);
    const kl = host.shadowRoot.querySelector('.kl');
    kl.className = 'kl' + (C.theme(host.parentElement) === 'dark' ? ' dark' : '');
    const btn = host.shadowRoot.querySelector('.b');
    btn.className = 'b' + (opts.big ? ' big' : '') + ' tone-' + label.tone;
    btn.setAttribute('aria-label', label.title);
    btn.title = label.title;
    host.shadowRoot.querySelector('.t').innerHTML = label.html;
    host.style.display = visible ? '' : 'none';
  };

  UI.rekeyBadge = function (host, opts) {
    host._kolibri = opts;
    host.dataset.kolibriKey = opts.key;
    UI.updateBadge(host);
  };

  C.onSummaries((keys) => {
    const set = new Set(keys);
    for (const host of badges) {
      if (!host.isConnected) { badges.delete(host); continue; }
      if (set.has(host._kolibri.key)) UI.updateBadge(host);
    }
  });

  UI.refreshAllBadges = function () {
    for (const host of badges) {
      if (!host.isConnected) { badges.delete(host); continue; }
      UI.updateBadge(host);
    }
  };

  // ------------------------------------------------------------------ card

  const card = {
    host: null,
    shadow: null,
    anchor: null,
    opts: null,
    pinned: false,
    data: null,
    view: null,
    error: null,
    hoverTimer: null,
    leaveTimer: null,
    frozen: false,
    reqSeq: 0,
    linkError: null
  };
  UI.card = {};

  function ensureHost() {
    if (card.host && card.host.isConnected) return;
    card.host = document.createElement('div');
    card.host.id = 'kolibri-card-host';
    card.shadow = card.host.attachShadow({ mode: 'open' });
    card.shadow.innerHTML = `<style>${UI.CARD_CSS}</style><div class="kl"><div class="card" role="dialog" aria-label="Kolibri report card"></div></div>`;
    // keep the page (X shortcuts, Telegram's "type to reply") from reacting to our input
    for (const ev of ['keydown', 'keyup', 'keypress', 'input', 'paste', 'wheel']) {
      card.host.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (e.type === 'keydown' && e.key === 'Escape') UI.card.close();
      });
    }
    for (const ev of ['pointerdown', 'mousedown', 'click', 'mouseup']) card.host.addEventListener(ev, (e) => e.stopPropagation());
    card.host.addEventListener('mouseenter', () => clearTimeout(card.leaveTimer));
    card.host.addEventListener('mouseleave', () => UI.card.hoverOut());
    card.shadow.addEventListener('click', onCardClick);
    card.shadow.addEventListener('submit', (e) => { e.preventDefault(); handleAct('link'); });
    document.documentElement.appendChild(card.host);
  }

  function place() {
    if (!card.host || !card.anchor) return;
    if (!card.anchor.isConnected) { UI.card.close(); return; }
    const r = card.anchor.getBoundingClientRect();
    const el = card.shadow.querySelector('.card');
    const w = el.offsetWidth || 372;
    const h = el.offsetHeight || 300;
    let top = r.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - 8 - h);
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    card.host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  UI.card.hoverIn = function (anchor, opts) {
    clearTimeout(card.leaveTimer);
    clearTimeout(card.hoverTimer);
    if (card.host && card.anchor === anchor && card.host.isConnected) return;
    if (card.pinned) return;
    card.hoverTimer = setTimeout(() => UI.card.open(anchor, opts, false), 280);
  };

  UI.card.hoverOut = function () {
    clearTimeout(card.hoverTimer);
    if (card.pinned) return;
    clearTimeout(card.leaveTimer);
    card.leaveTimer = setTimeout(() => UI.card.close(), 260);
  };

  UI.card.isOpenFor = (key) => Boolean(card.host && card.host.isConnected && card.opts && card.opts.key === key);

  UI.card.open = function (anchor, opts, pin) {
    clearTimeout(card.hoverTimer);
    clearTimeout(card.leaveTimer);
    const same = card.host && card.host.isConnected && card.anchor === anchor;
    if (same && pin && card.pinned) { UI.card.close(); return; }
    ensureHost();
    card.pinned = Boolean(pin) || (same && card.pinned);
    if (!same || !card.opts || card.opts.key !== opts.key) {
      card.anchor = anchor;
      card.opts = opts;
      card.data = null;
      card.error = null;
      card.view = null;
      card.linkError = null;
    }
    card.shadow.querySelector('.kl').className = 'kl' + (C.theme(anchor.parentElement) === 'dark' ? ' dark' : '');
    render();
    place();
    load();
  };

  UI.card.close = function () {
    clearTimeout(card.hoverTimer);
    clearTimeout(card.leaveTimer);
    if (card.host) card.host.remove();
    card.host = null;
    card.anchor = null;
    card.opts = null;
    card.pinned = false;
    card.frozen = false;
  };

  /** While frozen (e.g. during a timeline scan) the card stays put instead of following the page. */
  UI.card.freeze = function (on) {
    card.frozen = Boolean(on);
    if (!on) place();
  };

  UI.card.refresh = function () {
    if (card.host && card.host.isConnected) { render(); place(); }
  };

  async function load() {
    const opts = card.opts;
    if (!opts) return;
    const seq = ++card.reqSeq;
    try {
      const data = await C.send('card', { key: opts.key });
      if (seq !== card.reqSeq || card.opts !== opts) return;
      card.data = data;
      card.error = null;
      if (!card.view) card.view = data.network && data.network.summary && data.network.summary.calls > 0 ? 'network' : 'local';
    } catch (err) {
      if (seq !== card.reqSeq) return;
      card.error = String(err.message || err);
    }
    render();
    place();
  }
  UI.card.reload = load;

  const reloadSoon = C.throttle(() => { if (card.host && card.host.isConnected) load(); }, 900);
  C.onStorage((changes) => {
    if (!card.opts) return;
    const k = card.opts.key;
    if (changes['sum:' + k] || changes['job:' + k]) reloadSoon();
  });

  document.addEventListener('mousedown', (e) => {
    if (!card.host || !card.pinned) return;
    const path = e.composedPath();
    if (path.includes(card.host) || (card.anchor && path.includes(card.anchor))) return;
    UI.card.close();
  }, true);
  window.addEventListener('scroll', () => {
    if (!card.host || card.frozen) return;
    if (card.pinned) place(); else UI.card.close();
  }, { capture: true, passive: true });
  window.addEventListener('resize', () => place(), { passive: true });

  // ------------------------------------------------------------------ rendering

  function initials(name) {
    const s = String(name || '?').replace(/^@/, '').trim();
    return esc(Array.from(s)[0] || '?').toUpperCase();
  }

  function avatarHtml(author) {
    if (author && author.avatar && /^https:\/\//.test(author.avatar)) {
      return `<img class="ava" src="${esc(author.avatar)}" alt="" referrerpolicy="no-referrer">`;
    }
    return `<div class="ava">${initials(author && (author.name || author.handle))}</div>`;
  }

  function subLine(author, opts) {
    const a = author || opts.author || {};
    if (a.platform === 'tg' || opts.platform === 'tg') {
      return a.handle ? `t.me/${esc(a.handle)} on Telegram` : 'Telegram channel';
    }
    return `@${esc(a.handle || '')} on X`;
  }

  function cellRet(call, field, horizonMs) {
    const r = call[field];
    if (isNum(r)) return `<td class="${F.tone(r)}">${F.ret(r)}</td>`;
    if (call.status === 'new' || call.status === 'error') return '<td class="muted" title="Fetching prices…">…</td>';
    if (call.status === 'partial' && horizonMs) return `<td class="muted" title="Result pending">${esc(F.until(call.postedAt + horizonMs))}</td>`;
    return '<td class="muted" title="No price data">n/a</td>';
  }

  function rowsHtml(calls, limit) {
    const rows = calls.filter(S.counted).slice(0, limit);
    if (!rows.length) return '';
    const body = rows.map((c) => {
      const label = esc(F.tokenLabel(c));
      const chart = F.safeUrl(c.market && c.market.url ? c.market.url : c.url);
      const rep = c.mentions > 1 ? `<span class="rep" title="Mentioned ${c.mentions} times within 7 days">×${c.mentions}</span>` : '';
      const tokTitle = esc((c.market ? `${c.market.label} on ${c.market.venue}${c.market.source === 'dex' && c.market.match === 'ticker' ? ' (matched by ticker)' : ''}` : 'Waiting for a market') + (c.token && c.token.address ? `\n${c.token.address}` : ''));
      return `<tr>
        <td class="tok"><a href="${esc(chart)}" target="_blank" rel="noopener noreferrer" title="${tokTitle}">${label}</a>${rep}</td>
        <td class="when"><a href="${esc(F.safeUrl(c.url))}" target="_blank" rel="noopener noreferrer" title="${esc(F.dateTime(c.postedAt) + '\n' + (c.snippet || ''))}">${esc(F.date(c.postedAt))}</a></td>
        ${cellRet(c, 'r24', CFG.H24)}${cellRet(c, 'r7', CFG.D7)}
        <td class="${isNum(c.rPeak) ? F.tone(c.rPeak) : 'muted'}">${isNum(c.rPeak) ? F.ret(c.rPeak) : '—'}</td>
      </tr>`;
    }).join('');
    return `<table><thead><tr><th>Token</th><th>Called</th><th>24h</th><th>7d</th><th title="Best close within 7 days">Peak</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  /** Visual scale for returns: symmetric log, so +15% and −15% are visible and 4x does not flatten the rest. */
  UI.barScale = function (r) {
    const v = Math.min(1, Math.log(1 + 4 * Math.abs(r)) / Math.log(13));
    return r >= 0 ? v : -v;
  };

  /** Bars of every call's 7-day result, oldest to newest. */
  function sparkHtml(calls) {
    const pts = calls.filter((c) => S.counted(c) && isNum(c.r7)).sort((a, b) => a.postedAt - b.postedAt).slice(-60);
    if (pts.length < 2) return '';
    const W = 344;
    const H = 44;
    const mid = H / 2;
    const slot = W / pts.length;
    const bw = Math.max(2, Math.min(22, slot * 0.62));
    const bars = pts.map((c, i) => {
      const r = c.r7;
      const h = Math.max(1.5, Math.abs(UI.barScale(r)) * (mid - 2));
      const x = i * slot + (slot - bw) / 2;
      const y = r >= 0 ? mid - h : mid;
      return `<rect class="${r >= 0 ? 'u' : 'd'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${esc(F.tokenLabel(c))} ${esc(F.ret(r))} after 7 days, called ${esc(F.date(c.postedAt))}</title></rect>`;
    }).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="7-day result of each call, oldest to newest"><line class="axis" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>${bars}</svg>
      <div class="legend"><span>${esc(F.date(pts[0].postedAt))}</span><span>7-day result of each call</span><span>${esc(F.date(pts[pts.length - 1].postedAt))}</span></div>`;
  }

  function followHtml(summary, calls) {
    const r7 = calls.filter((c) => S.counted(c) && isNum(c.r7));
    if (r7.length < 2) return '';
    const value = r7.reduce((a, c) => a + 100 * (1 + c.r7), 0);
    const roi = value / (100 * r7.length) - 1;
    return `<div class="follow">$100 in each of these ${r7.length} calls would be <b>${esc(F.money(value))}</b> a week later (<b class="${F.tone(roi)}">${esc(F.pct(roi))}</b>).</div>`;
  }

  function progressHtml(d, opts) {
    const parts = [];
    const job = d && d.job;
    if (job && job.state === 'running') {
      parts.push(`Reading channel history… ${F.plural(job.pages, 'page')}, ${F.plural(job.posts, 'post')}`);
    }
    const scan = opts.scanState ? opts.scanState() : null;
    if (scan && scan.running) parts.push(`Scanning timeline… ${F.plural(scan.posts, 'post')} read, ${F.plural(scan.calls, 'call')} found`);
    const local = d && d.local;
    if (local && local.pricing) parts.push(`Checking prices for ${F.plural(local.pricing, 'call')}…`);
    if (!parts.length) return '';
    return parts.map((p) => `<div class="progress"><span class="dot"></span>${esc(p)}</div>`).join('');
  }

  function actionsHtml(opts, d, view) {
    const btns = [];
    const scan = opts.scanState ? opts.scanState() : null;
    if (opts.canScan && opts.canScan()) {
      btns.push(scan && scan.running
        ? '<button class="btn" data-act="scan-stop">Stop scan</button>'
        : '<button class="btn" data-act="scan">Scan timeline</button>');
    }
    if (opts.platform === 'tg' && opts.tgUsername && opts.tgUsername()) {
      const running = d && d.job && d.job.state === 'running';
      if (!running) btns.push('<button class="btn" data-act="history">Load history</button>');
    }
    const hasData = d && ((d.local && d.local.total) || (d.network && d.network.summary && d.network.summary.calls > 0));
    if (hasData) btns.unshift(`<button class="btn primary" data-act="report">Full report</button>`);
    return `<div class="actions">${btns.join('')}<span class="brand">${UI.bird(15)}Kolibri</span></div>`;
  }

  function linkFormHtml() {
    return `<form class="row" data-form="link"><input class="link" name="u" placeholder="t.me/channel" aria-label="Channel link" autocomplete="off" spellcheck="false"><button class="btn" type="submit">Load history</button></form>
      ${card.linkError ? `<div class="err">${esc(card.linkError)}</div>` : ''}`;
  }

  function needsLink(opts) {
    return opts.platform === 'tg' && !(opts.tgUsername && opts.tgUsername());
  }

  function emptyHtml(opts, d) {
    const a = opts.author || {};
    if (opts.platform === 'tg') {
      const user = opts.tgUsername && opts.tgUsername();
      if (user) {
        return `<div class="empty"><p>No calls seen in this channel yet.</p><p><b>Load history</b> reads the public preview at t.me/${esc(user)} and checks every $ticker and contract address it posted.</p></div>`;
      }
      return `<div class="empty"><p>No calls seen in this channel yet.</p>
        <p>Kolibri reads posts as you scroll. If the channel is public, paste its link to read its history:</p></div>${linkFormHtml()}`;
    }
    const canScan = opts.canScan && opts.canScan();
    return `<div class="empty"><p>No calls seen for @${esc(a.handle || '')} yet.</p>
      <p>Kolibri logs every $ticker and contract address they post while you browse, then checks the price 24&nbsp;hours and 7&nbsp;days later.${canScan ? ' <b>Scan timeline</b> reads their recent posts now.' : ' Open their profile to scan it.'}</p></div>`;
  }

  function render() {
    if (!card.host) return;
    const el = card.shadow.querySelector('.card');
    const opts = card.opts;
    const d = card.data;
    const hasNet = Boolean(d && d.network && d.network.summary && d.network.summary.calls > 0);
    const hasLocal = Boolean(d && d.local && d.local.total);
    let view = card.view || (hasNet ? 'network' : 'local');
    if (view === 'network' && !hasNet) view = 'local';
    const src = d ? (view === 'network' ? d.network : d.local) : null;
    const author = Object.assign({}, opts.author || {}, (src && src.author) || {});
    if (opts.author && opts.author.avatar && !author.avatar) author.avatar = opts.author.avatar;
    const s = src && src.summary;

    let gradeBox;
    if (s && s.grade) {
      gradeBox = `<div class="grade tone-${s.tone}" title="Kolibri score ${s.score} of 100, from ${F.plural(s.priced7, 'call')} with a 7-day result"><div><b>${esc(s.grade)}</b><small>score ${s.score}</small></div></div>`;
    } else {
      const n = s ? s.priced7 : 0;
      gradeBox = `<div class="grade tone-none" title="A grade needs ${CFG.MIN_CALLS_FOR_GRADE} calls with a 7-day result"><div><b>${s && s.calls ? '?' : '–'}</b><small>${n} of ${CFG.MIN_CALLS_FOR_GRADE}</small></div></div>`;
    }

    let html = `<div class="head">${avatarHtml(author)}<div class="who"><div class="name">${esc(author.name || author.handle || 'Unknown')}</div><div class="sub">${subLine(author, opts)}</div></div>${gradeBox}</div>`;

    if (hasNet && hasLocal) {
      html += `<div class="seg" role="group" aria-label="Data source">
        <button data-act="view-network" aria-pressed="${view === 'network'}">Kolibri network</button>
        <button data-act="view-local" aria-pressed="${view === 'local'}">This device</button></div>`;
    }

    if (!d && !card.error) {
      html += '<div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:85%"></div>';
    } else if (card.error && !d) {
      html += `<div class="err">${esc(card.error)}</div>`;
    } else if (!s || !s.calls) {
      html += emptyHtml(opts, d);
    } else {
      html += `<div class="stats">
        <div class="stat"><div class="v">${s.calls}</div><div class="k">calls</div></div>
        <div class="stat" title="Share of calls that were up 24 hours later"><div class="v">${F.share(s.win24)}</div><div class="k">up after 24h</div></div>
        <div class="stat" title="Share of calls that were up 7 days later"><div class="v">${F.share(s.win7)}</div><div class="k">up after 7d</div></div>
        <div class="stat" title="Median return 7 days after the call"><div class="v ${F.tone(s.med7)}">${F.pct(s.med7)}</div><div class="k">median 7d</div></div>
      </div>`;
      const calls = (src && src.calls) || [];
      html += sparkHtml(calls);
      html += rowsHtml(calls, 8);
      html += followHtml(s, calls);
      if (view === 'network' && d.network.truncated) {
        const total = d.network.total || s.calls;
        html += `<div class="lock">${UI.bird(16)}<span>Showing ${Math.min(calls.length, CFG.FREE_RECENT_CALLS)} of ${total} calls. <b>Full history &amp; CSV export</b> with Kolibri Pro.</span></div>`;
      }
      if (needsLink(opts)) html += `<div class="note">Public channel? Paste its link to read its full history from t.me.</div>${linkFormHtml()}`;
      html += `<div class="note">${view === 'network'
        ? 'Kolibri network data, collected and verified by the Kolibri server.'
        : (opts.platform === 'tg'
          ? `Collected on this device from the channel's posts${author.handle ? ' at t.me/' + esc(author.handle) : ''}. Stablecoins and majors are not counted.`
          : 'Collected on this device from posts you opened. Stablecoins and majors are not counted.')}</div>`;
    }
    if (card.error && d) html += `<div class="err">${esc(card.error)}</div>`;
    if (d && d.network && d.network.error && view === 'local') html += `<div class="note">Kolibri network unavailable (${esc(d.network.error)}).</div>`;
    html += progressHtml(d, opts);
    html += actionsHtml(opts, d, view);
    el.innerHTML = html;
  }

  function onCardClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    handleAct(btn.dataset.act);
  }

  async function handleAct(act) {
    const opts = card.opts;
    if (!opts) return;
    card.pinned = true;
    try {
      if (act === 'view-network' || act === 'view-local') {
        card.view = act === 'view-network' ? 'network' : 'local';
        render();
        place();
      } else if (act === 'report') {
        await C.send('openReport', { key: opts.key });
      } else if (act === 'scan') {
        opts.startScan && opts.startScan();
        render();
      } else if (act === 'scan-stop') {
        opts.stopScan && opts.stopScan();
        render();
      } else if (act === 'history') {
        await opts.loadHistory();
        load();
      } else if (act === 'link') {
        const input = card.shadow.querySelector('input.link');
        const m = /(?:t(?:elegram)?\.me\/(?:s\/)?|@|^)([A-Za-z][A-Za-z0-9_]{3,31})\/?$/.exec((input && input.value || '').trim());
        if (!m) { card.linkError = 'Enter a public channel link like t.me/channel'; render(); return; }
        card.linkError = null;
        await opts.linkUsername(m[1]);
      }
    } catch (err) {
      card.error = String(err.message || err);
      render();
    }
  }
})(globalThis);
