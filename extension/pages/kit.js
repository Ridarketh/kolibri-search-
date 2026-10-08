/* Kolibri — helpers shared by the popup, options and report pages. */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const F = K.format;
  const esc = F.escapeHtml;

  async function send(type, payload) {
    const res = await chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
    if (!res) throw new Error('Kolibri did not answer. Reload the extension and try again.');
    if (!res.ok) throw new Error(res.error || 'Something went wrong');
    return res.data;
  }

  function initials(name) {
    const s = String(name || '?').replace(/^@/, '').trim();
    return esc((Array.from(s)[0] || '?').toUpperCase());
  }

  function avatar(author, cls) {
    const c = 'ava' + (cls ? ' ' + cls : '');
    if (author && author.avatar && /^https:\/\//.test(author.avatar)) {
      return `<img class="${c}" src="${esc(author.avatar)}" alt="" referrerpolicy="no-referrer" loading="lazy">`;
    }
    return `<span class="${c}" aria-hidden="true">${initials(author && (author.name || author.handle))}</span>`;
  }

  function where(author) {
    if (!author) return '';
    if (author.platform === 'tg') return author.handle ? `t.me/${esc(author.handle)} on Telegram` : 'Telegram channel';
    return `@${esc(author.handle || '')} on X`;
  }

  function profileUrl(author) {
    if (!author) return null;
    if (author.platform === 'tg') return author.handle ? 'https://t.me/' + encodeURIComponent(author.handle) : null;
    return author.handle ? 'https://x.com/' + encodeURIComponent(author.handle) : null;
  }

  function stamp(summary, cls) {
    const c = 'stamp' + (cls ? ' ' + cls : '');
    if (summary && summary.grade) {
      return `<span class="${c} tone-${summary.tone}" title="Score ${summary.score} of 100">${esc(summary.grade)}</span>`;
    }
    return `<span class="${c} tone-none" title="Not enough calls with a 7-day result yet">?</span>`;
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  K.kit = { send, avatar, where, profileUrl, stamp, download, esc };
})(globalThis);
