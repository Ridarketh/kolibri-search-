/* Kolibri popup: the leaderboard of KOLs seen on this device (and the network, if configured). */
(function () {
  'use strict';
  const K = globalThis.Kolibri;
  const F = K.format;
  const kit = K.kit;
  const esc = kit.esc;

  const $ = (sel) => document.querySelector(sel);
  const state = { scope: 'local', platform: 'all', q: '', items: [], hasApi: false };

  function row(item, rank) {
    const s = item.summary || {};
    const a = item.author || {};
    const nums = s.grade
      ? `<span class="n">${F.share(s.win7)}</span><span class="k">up after 7d</span>`
      : `<span class="n">${F.plural(s.calls || 0, 'call')}</span><span class="k">${s.priced7 ? s.priced7 + ' with 7d result' : 'waiting for 7d'}</span>`;
    return `<li><button class="row" type="button" data-key="${esc(item.key)}" title="Open the full report">
      <span class="rank">${s.grade ? rank : ''}</span>
      ${kit.avatar(a)}
      <span class="who"><span class="name">${esc(a.name || a.handle || item.key)}</span><span class="sub">${kit.where(a)}</span></span>
      <span class="nums">${nums}</span>
      ${kit.stamp(s)}
    </button></li>`;
  }

  function render() {
    const q = state.q.trim().toLowerCase();
    const items = state.items.filter((it) => {
      if (state.platform !== 'all' && (!it.author || it.author.platform !== state.platform)) return false;
      if (!q) return true;
      const a = it.author || {};
      return [a.name, a.handle, it.key].some((v) => v && String(v).toLowerCase().includes(q));
    });
    let rank = 0;
    $('#list').innerHTML = items.map((it) => row(it, it.summary && it.summary.grade ? ++rank : 0)).join('');
    const none = !state.items.length;
    $('#empty').hidden = !none || state.scope !== 'local';
    $('#nomatch').hidden = none || items.length > 0;
  }

  async function load() {
    $('#error').hidden = true;
    try {
      const data = await kit.send('leaderboard', { scope: state.scope, platform: 'all' });
      state.items = (data && data.items) || [];
    } catch (err) {
      state.items = [];
      $('#error').textContent = state.scope === 'network'
        ? 'The Kolibri network is unreachable: ' + err.message
        : err.message;
      $('#error').hidden = false;
    }
    render();
  }

  async function loadStatus() {
    try {
      const st = await kit.send('status');
      const parts = [F.plural(st.kols, 'KOL') + ' tracked'];
      if (st.queued) parts.push('checking prices');
      if (st.plan === 'pro') parts.push('Pro');
      $('#status').textContent = parts.join(', ');
    } catch (_) {
      $('#status').textContent = '';
    }
  }

  function press(group, attr, value) {
    for (const b of document.querySelectorAll(`${group} button`)) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
  }

  $('#list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    kit.send('openReport', { key: btn.dataset.key }).then(() => window.close());
  });
  $('#platform').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    state.platform = b.dataset.p;
    press('#platform', 'p', state.platform);
    render();
  });
  $('#scope').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scope]');
    if (!b) return;
    state.scope = b.dataset.scope;
    press('#scope', 'scope', state.scope);
    load();
  });
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('#settings').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
  $('#how').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#method') });
    window.close();
  });

  (async function init() {
    try {
      const settings = await kit.send('getSettings');
      state.hasApi = Boolean(settings.apiUrl);
      $('#scope').hidden = !state.hasApi;
    } catch (_) { /* first run */ }
    await load();
    loadStatus();
    $('#q').focus();
  })();
})();
