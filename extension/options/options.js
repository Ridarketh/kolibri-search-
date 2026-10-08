/* Kolibri options page. */
(function () {
  'use strict';
  const K = globalThis.Kolibri;
  const F = K.format;
  const kit = K.kit;
  const $ = (sel) => document.querySelector(sel);

  let settings = {};

  function setStatus(el, text, tone) {
    el.textContent = text;
    el.classList.toggle('ok', tone === 'ok');
    el.classList.toggle('bad', tone === 'bad');
  }

  async function save(patch) {
    settings = await kit.send('setSettings', { patch });
    return settings;
  }

  function wireSettings() {
    for (const input of document.querySelectorAll('[data-setting]')) {
      const name = input.dataset.setting;
      input.addEventListener('change', () => {
        const value = input.type === 'checkbox' ? input.checked : input.dataset.type === 'number' ? Number(input.value) : input.value;
        save({ [name]: value }).catch((err) => alert(err.message));
      });
    }
  }

  function bindSettings() {
    for (const input of document.querySelectorAll('[data-setting]')) {
      const name = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = Boolean(settings[name]);
      else input.value = String(settings[name] ?? '');
    }
    $('#geckoKey').value = settings.geckoKey || '';
    $('#apiUrl').value = settings.apiUrl || '';
    const contribute = document.querySelector('[data-setting="contribute"]');
    contribute.disabled = !settings.apiUrl;
  }

  async function connectApi() {
    const raw = $('#apiUrl').value.trim();
    const status = $('#apiStatus');
    if (!raw) {
      await save({ apiUrl: '', contribute: false });
      setStatus(status, 'Not connected. Kolibri works fully on this device without a server.');
      bindSettings();
      return;
    }
    let url;
    try {
      url = new URL(raw);
      if (!/^https?:$/.test(url.protocol)) throw new Error('bad protocol');
    } catch (_) {
      setStatus(status, 'Enter a full URL, like https://api.example.com', 'bad');
      return;
    }
    const origin = url.origin + '/*';
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [origin] });
    } catch (err) {
      setStatus(status, 'Chrome refused access to ' + url.origin + ': ' + err.message, 'bad');
      return;
    }
    if (!granted) {
      setStatus(status, 'Kolibri needs permission to talk to ' + url.origin + '.', 'bad');
      return;
    }
    setStatus(status, 'Checking ' + url.origin + '…');
    const base = url.origin + url.pathname.replace(/\/+$/, '');
    try {
      const health = await kit.send('testApi', { url: base });
      await save({ apiUrl: base });
      setStatus(status, `Connected to ${health && health.name ? health.name : 'Kolibri server'}${health && health.kols !== undefined ? ', ' + F.plural(health.kols, 'KOL') + ' tracked' : ''}.`, 'ok');
    } catch (err) {
      setStatus(status, 'No Kolibri server answered at ' + base + ' (' + err.message + ').', 'bad');
    }
    bindSettings();
  }

  async function showPlan() {
    const o = await chrome.storage.local.get('license');
    const lic = o.license;
    const el = $('#planStatus');
    if (lic && lic.valid) {
      $('#license').value = lic.key;
      $('#deactivate').hidden = false;
      const until = lic.expiresAt ? ' until ' + F.date(Date.parse(lic.expiresAt)) : '';
      setStatus(el, `Kolibri Pro is active${until}.`, 'ok');
    } else {
      $('#deactivate').hidden = true;
      setStatus(el, lic && lic.key ? 'That key is not valid on this server.' : 'Free plan.', lic && lic.key ? 'bad' : null);
    }
  }

  async function activate() {
    const key = $('#license').value.trim();
    if (!key) return;
    setStatus($('#planStatus'), 'Checking the key…');
    try {
      await kit.send('verifyLicense', { key });
    } catch (err) {
      setStatus($('#planStatus'), err.message, 'bad');
      return;
    }
    showPlan();
  }

  async function dataStats() {
    try {
      const st = await kit.send('status');
      const board = await kit.send('leaderboard', { scope: 'local' });
      const calls = (board.items || []).reduce((n, it) => n + ((it.summary && it.summary.calls) || 0), 0);
      $('#dataStats').textContent = `${F.plural(st.kols, 'account')} and ${F.plural(calls, 'call')} stored in this browser. Nothing leaves it unless you connect a network server.`;
    } catch (_) { /* ignore */ }
  }

  $('#saveGecko').addEventListener('click', async () => {
    await save({ geckoKey: $('#geckoKey').value.trim() });
    $('#saveGecko').textContent = 'Saved';
    setTimeout(() => { $('#saveGecko').textContent = 'Save key'; }, 1500);
  });
  $('#saveApi').addEventListener('click', connectApi);
  $('#activate').addEventListener('click', activate);
  $('#deactivate').addEventListener('click', async () => {
    await kit.send('clearLicense');
    $('#license').value = '';
    showPlan();
  });
  $('#exportAll').addEventListener('click', async () => {
    const data = await kit.send('exportAll');
    kit.download(`kolibri-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
  });
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const n = await kit.send('importAll', { data: JSON.parse(await file.text()) });
      $('#dataMsg').textContent = `Restored ${F.plural(n, 'account')}.`;
      dataStats();
    } catch (err) {
      $('#dataMsg').textContent = 'Could not restore: ' + err.message;
    }
    e.target.value = '';
  });
  $('#clearAll').addEventListener('click', async () => {
    if (!confirm('Delete every call and report card Kolibri has stored in this browser? Settings stay.')) return;
    await kit.send('clearAll');
    $('#dataMsg').textContent = 'All data deleted.';
    dataStats();
  });

  (async function init() {
    $('#version').textContent = 'v' + chrome.runtime.getManifest().version;
    $('#welcome').hidden = !new URLSearchParams(location.search).has('welcome');
    settings = await kit.send('getSettings');
    wireSettings();
    bindSettings();
    if (settings.apiUrl) setStatus($('#apiStatus'), 'Connected to ' + settings.apiUrl + '.', 'ok');
    showPlan();
    dataStats();
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  })();
})();
