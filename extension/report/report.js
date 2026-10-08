/* Kolibri full report: every call of one KOL, or (without ?key) the full leaderboard. */
(function () {
  'use strict';
  const K = globalThis.Kolibri;
  const F = K.format;
  const S = K.score;
  const CFG = K.config;
  const kit = K.kit;
  const esc = kit.esc;
  const isNum = F.isNum;
  const $ = (sel) => document.querySelector(sel);

  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  const state = { data: null, view: null, filter: 'all', sort: { field: 'postedAt', dir: -1 } };

  // ---------------------------------------------------------------- helpers

  function source() {
    const d = state.data;
    if (!d) return null;
    return state.view === 'network' ? d.network : d.local;
  }

  function reason(call) {
    switch (call.status) {
      case 'too-old': return 'older than the free price history';
      case 'no-entry': return 'not trading at the time of the post';
      case 'unresolved': return 'no market found';
      default: return 'no price';
    }
  }

  function retCell(call, field, horizon) {
    const r = call[field];
    if (isNum(r)) return `<td class="${F.tone(r)}">${esc(F.ret(r))}</td>`;
    if (call.status === 'new' || call.status === 'error') return '<td><span class="muted" title="Fetching prices">…</span></td>';
    if (call.status === 'partial' && horizon) return `<td><span class="muted" title="Result not due yet">${esc(F.until(call.postedAt + horizon))}</span></td>`;
    if (call.status === 'partial') return '<td><span class="muted">—</span></td>';
    return `<td><span class="muted" title="${esc(reason(call))}">n/a</span></td>`;
  }

  function filterCalls(calls) {
    switch (state.filter) {
      case 'up': return calls.filter((c) => S.counted(c) && isNum(c.r7) && c.r7 > 0);
      case 'down': return calls.filter((c) => S.counted(c) && isNum(c.r7) && c.r7 <= 0);
      case 'wait': return calls.filter((c) => S.counted(c) && !isNum(c.r7));
      case 'na': return calls.filter((c) => !S.counted(c));
      default: return calls;
    }
  }

  function sortCalls(calls) {
    const { field, dir } = state.sort;
    return calls.slice().sort((a, b) => {
      const va = a[field];
      const vb = b[field];
      const na = !isNum(va);
      const nb = !isNum(vb);
      if (na && nb) return b.postedAt - a.postedAt;
      if (na) return 1;
      if (nb) return -1;
      return (va - vb) * dir;
    });
  }

  // ---------------------------------------------------------------- KOL report

  function renderHeader(author, summary) {
    const url = kit.profileUrl(author);
    const meta = summary && summary.grade
      ? `<div class="meta"><b>Score ${summary.score}</b>from ${F.plural(summary.priced7, 'call')}</div>`
      : `<div class="meta"><b>No grade yet</b>${summary ? summary.priced7 : 0} of ${CFG.MIN_CALLS_FOR_GRADE} calls with a 7-day result</div>`;
    $('#who').innerHTML = `${kit.avatar(author, 'lg')}
      <div class="text"><h1>${esc(author.name || author.handle || 'Unknown')}</h1>
      <p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${kit.where(author)}</a>` : kit.where(author)}</p></div>
      <div class="grade-box">${meta}${kit.stamp(summary, 'lg')}</div>`;
    document.title = `${author.name || author.handle || 'KOL'} — Kolibri report`;
  }

  function renderStats(s, calls) {
    const r7 = calls.filter((c) => S.counted(c) && isNum(c.r7));
    const roi = r7.length ? r7.reduce((a, c) => a + c.r7, 0) / r7.length : null;
    const stat = (v, k, cls, title) => `<div class="stat"${title ? ` title="${esc(title)}"` : ''}><div class="v ${cls || ''}">${v}</div><div class="k">${k}</div></div>`;
    $('#stats').innerHTML = [
      stat(s.calls, 'calls'),
      stat(F.share(s.win24), 'up after 24h', '', 'Share of calls that were up 24 hours after the post'),
      stat(F.share(s.win7), 'up after 7d', '', 'Share of calls that were up 7 days after the post'),
      stat(F.pct(s.med7), 'median 7d', F.tone(s.med7), 'Median return 7 days after the post'),
      stat(F.ret(s.medPeak), 'median peak in 7d', F.tone(s.medPeak), 'Median of the best close within 7 days'),
      stat(F.pct(roi), '$100 in every call', F.tone(roi), 'Return of buying the same amount of every call and selling 7 days later')
    ].join('');
  }

  /** Same visual scale as the in-page card: symmetric log, capped at ±300%. */
  function scaled(r) {
    const v = Math.min(1, Math.log(1 + 4 * Math.abs(r)) / Math.log(13));
    return r >= 0 ? v : -v;
  }

  function renderChart(calls) {
    const pts = calls.filter((c) => S.counted(c) && isNum(c.r7)).sort((a, b) => a.postedAt - b.postedAt);
    $('#chartWrap').hidden = pts.length < 2;
    if (pts.length < 2) return;
    const W = 1000;
    const H = 240;
    const left = 52;
    const right = 6;
    const top = 10;
    const bottom = 24;
    const mid = top + (H - top - bottom) / 2;
    const half = (H - top - bottom) / 2;
    const y = (r) => mid - scaled(r) * half;
    const grid = [[3, '+300%'], [1, '+100%'], [0.25, '+25%'], [0, '0%'], [-0.25, '−25%'], [-1, '−100%']]
      .map(([r, label]) => `<line class="${r === 0 ? 'zero' : 'grid'}" x1="${left}" x2="${W - right}" y1="${y(r)}" y2="${y(r)}"/><text class="lbl" x="${left - 8}" y="${y(r) + 4}" text-anchor="end">${label}</text>`)
      .join('');
    const n = pts.length;
    const span = W - left - right - 8;
    const slot = span / n;
    const bw = Math.max(1.5, Math.min(40, slot * 0.62));
    const bars = pts.map((c, i) => {
      const yy = y(c.r7);
      const h = Math.max(1.5, Math.abs(yy - mid));
      const x = left + 8 + i * slot + (slot - bw) / 2;
      return `<rect class="${c.r7 >= 0 ? 'u' : 'd'}" x="${x.toFixed(1)}" y="${(c.r7 >= 0 ? mid - h : mid).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(F.tokenLabel(c))}: ${esc(F.ret(c.r7))} after 7 days, called ${esc(F.date(c.postedAt))}</title></rect>`;
    }).join('');
    const dates = `<text class="lbl" x="${left + 8}" y="${H - 6}">${esc(F.date(pts[0].postedAt))}</text><text class="lbl" x="${W - right}" y="${H - 6}" text-anchor="end">${esc(F.date(pts[n - 1].postedAt))}</text>`;
    $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="7-day result of each call, oldest to newest">${grid}${bars}${dates}</svg>`;
  }

  function renderRows(calls) {
    const list = sortCalls(filterCalls(calls));
    $('#rows').innerHTML = list.map((c) => {
      const m = c.market;
      const addr = c.token && c.token.address ? `<small title="${esc(c.token.address)}">${esc(F.shortAddr(c.token.address))}${m && m.chain ? ' on ' + esc(m.chain) : ''}</small>` : '';
      const market = m
        ? `<a href="${esc(F.safeUrl(m.url))}" target="_blank" rel="noopener">${esc(m.label)}</a><small>${esc(m.venue || '')}${m.source === 'dex' && m.match === 'ticker' ? ', matched by ticker' : ''}</small>`
        : '<span class="muted">—</span>';
      return `<tr>
        <td class="when l" title="${esc(c.snippet || '')}">${esc(F.dateTime(c.postedAt))}</td>
        <td class="tok l"><b>${esc(F.tokenLabel(c))}</b>${c.mentions > 1 ? ` <span class="muted" title="Mentioned ${c.mentions} times within 7 days">×${c.mentions}</span>` : ''}${addr}</td>
        <td class="mkt l">${market}</td>
        <td>${isNum(c.entry) ? esc(F.price(c.entry)) : '<span class="muted">—</span>'}</td>
        ${retCell(c, 'r24', CFG.H24)}${retCell(c, 'r7', CFG.D7)}
        <td class="${isNum(c.rPeak) ? F.tone(c.rPeak) : ''}">${isNum(c.rPeak) ? esc(F.ret(c.rPeak)) : '<span class="muted">—</span>'}</td>
        <td class="${isNum(c.rLow) ? F.tone(c.rLow) : ''}">${isNum(c.rLow) ? esc(F.ret(c.rLow)) : '<span class="muted">—</span>'}</td>
        <td class="post l"><a href="${esc(F.safeUrl(c.url))}" target="_blank" rel="noopener">Open post</a></td>
      </tr>`;
    }).join('') || `<tr><td class="l" colspan="9"><span class="muted">No calls in this view.</span></td></tr>`;
    for (const th of document.querySelectorAll('th[data-sort]')) {
      if (th.dataset.sort === state.sort.field) th.setAttribute('aria-sort', state.sort.dir < 0 ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    }
  }

  function renderKol() {
    const d = state.data;
    const hasNet = Boolean(d.network && d.network.summary && d.network.summary.calls > 0);
    const hasLocal = Boolean(d.local && d.local.total);
    if (!state.view) state.view = hasNet ? 'network' : 'local';
    if (state.view === 'network' && !hasNet) state.view = 'local';
    $('#source').hidden = !(hasNet && hasLocal);
    for (const b of document.querySelectorAll('#source button')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));

    const src = source();
    const parsed = key.split(':');
    const fallbackAuthor = { platform: parsed[0], handle: parsed[1] && !parsed[1].startsWith('#') ? parsed.slice(1).join(':') : null, name: parsed.slice(1).join(':') };
    const author = Object.assign({}, fallbackAuthor, (d.local && d.local.author) || {}, (src && src.author) || {});
    const summary = src && src.summary;
    renderHeader(author, summary);

    if (!src || !summary || !src.calls || !src.calls.length) {
      $('#stats').innerHTML = '';
      $('#chartWrap').hidden = true;
      $('#callsWrap').hidden = true;
      $('#empty').hidden = false;
      $('#empty').innerHTML = `<img src="../assets/kolibri.svg" alt="" width="72" height="72"><h2>No calls for this account yet</h2>
        <p>Kolibri records a call when this account posts a $ticker or a contract address on a page you open. ${author.platform === 'tg' ? 'Open the channel in Telegram Web to load its public history.' : 'Open their X profile and press Scan timeline on the Kolibri badge.'}</p>`;
      $('#delete').hidden = !hasLocal;
      return;
    }
    $('#empty').hidden = true;
    $('#callsWrap').hidden = false;
    const calls = src.calls;
    renderStats(summary, calls);
    renderChart(calls);
    renderRows(calls);

    const isNet = state.view === 'network';
    const pro = d.plan === 'pro';
    const exportLocked = isNet ? !pro : d.gateLocal && !pro;
    $('#export').disabled = exportLocked;
    $('#export').title = exportLocked ? 'CSV export is part of Kolibri Pro' : 'Download every call as a CSV file';
    $('#recheck').hidden = isNet || !calls.some((c) => !S.counted(c) || c.status === 'error');
    $('#delete').hidden = isNet || !hasLocal;

    const lock = $('#lock');
    if (isNet && d.network.truncated) {
      lock.hidden = false;
      lock.innerHTML = `<img src="../assets/kolibri.svg" alt="" width="34" height="34"><p>Showing the ${calls.length} most recent of ${d.network.total} calls. <b>Full history and CSV export</b> of network data are part of Kolibri Pro.</p><a class="btn primary" href="../options/options.html#license" target="_blank">Enter a license key</a>`;
    } else lock.hidden = true;

    const pricing = isNet ? 0 : (d.local.pricing || 0);
    $('#footNote').textContent = isNet
      ? 'Kolibri network data.'
      : `Collected on this device from posts you opened.${pricing ? ' Checking prices for ' + F.plural(pricing, 'call') + '…' : ''}`;
  }

  // ---------------------------------------------------------------- leaderboard (no ?key)

  async function renderBoard() {
    document.title = 'Kolibri leaderboard';
    $('#source').hidden = true;
    $('#callsWrap').hidden = true;
    $('#chartWrap').hidden = true;
    $('#who').innerHTML = `<div class="text"><h1>Leaderboard</h1><p>Every account Kolibri has seen calls from, best grades first.</p></div>`;
    const board = await kit.send('leaderboard', { scope: 'local' });
    const items = board.items || [];
    if (!items.length) {
      $('#empty').hidden = false;
      $('#empty').innerHTML = `<img src="../assets/kolibri.svg" alt="" width="72" height="72"><h2>No report cards yet</h2><p>Open X or Telegram Web and read as usual. Kolibri notes every $ticker and contract address and checks the price a day and a week later.</p>`;
      return;
    }
    let rank = 0;
    $('#stats').outerHTML = `<section class="table-scroll"><table><thead><tr><th class="l">#</th><th class="l">Account</th><th>Calls</th><th>Up after 24h</th><th>Up after 7d</th><th>Median 7d</th><th>Grade</th></tr></thead><tbody>${
      items.map((it) => {
        const s = it.summary || {};
        const a = it.author || {};
        return `<tr><td class="l muted">${s.grade ? ++rank : ''}</td>
          <td class="l"><a href="?key=${encodeURIComponent(it.key)}" style="display:flex;align-items:center;gap:10px;text-decoration:none">${kit.avatar(a)}<span><b>${esc(a.name || a.handle || it.key)}</b><br><span class="muted">${kit.where(a)}</span></span></a></td>
          <td>${s.calls || 0}</td><td>${F.share(s.win24)}</td><td>${F.share(s.win7)}</td><td class="${F.tone(s.med7)}">${F.pct(s.med7)}</td><td>${kit.stamp(s)}</td></tr>`;
      }).join('')}</tbody></table></section>`;
  }

  // ---------------------------------------------------------------- wiring

  async function load() {
    try {
      state.data = await kit.send('report', { key });
      $('#error').hidden = true;
      renderKol();
    } catch (err) {
      $('#error').textContent = err.message;
      $('#error').hidden = false;
    }
  }

  let reloadTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !key || !changes['sum:' + key]) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 1500);
  });

  $('#home').addEventListener('click', (e) => { e.preventDefault(); location.href = location.pathname; });
  $('#source').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    renderKol();
  });
  $('#filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    state.filter = b.dataset.f;
    for (const x of document.querySelectorAll('#filter button')) x.setAttribute('aria-pressed', String(x === b));
    renderRows(source().calls);
  });
  document.querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    state.sort = state.sort.field === field ? { field, dir: -state.sort.dir } : { field, dir: -1 };
    renderRows(source().calls);
  });
  $('#export').addEventListener('click', async () => {
    try {
      const csv = await kit.send('exportCsv', { key, source: state.view });
      const name = key.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
      kit.download(`kolibri-${name}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    } catch (err) {
      alert(err.message);
    }
  });
  $('#recheck').addEventListener('click', async () => {
    await kit.send('reprice', { key });
    $('#recheck').textContent = 'Checking…';
    $('#recheck').disabled = true;
  });
  $('#delete').addEventListener('click', async () => {
    if (!confirm('Delete every call Kolibri stored for this account on this device?')) return;
    await kit.send('deleteKol', { key });
    load();
  });

  if (key) load(); else renderBoard().catch((err) => { $('#error').textContent = err.message; $('#error').hidden = false; });
})();
