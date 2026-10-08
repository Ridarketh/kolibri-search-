/* Kolibri — parser for Telegram's public channel preview (https://t.me/s/<channel>).
 * Works without a Telegram account; used by the extension's "Load history" and by the server collector.
 * Exposes globalThis.Kolibri.tgPreview (and module.exports in Node). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const H = isNode ? require('./minihtml.js') : root.Kolibri.html;
  const mod = factory(H);
  if (isNode) module.exports = mod;
  (root.Kolibri = root.Kolibri || {}).tgPreview = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (H) {
  'use strict';

  const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

  function pageUrl(username, beforeId) {
    const base = 'https://t.me/s/' + encodeURIComponent(username);
    return beforeId ? base + '?before=' + encodeURIComponent(beforeId) : base;
  }

  function isValidUsername(u) {
    return typeof u === 'string' && USERNAME_RE.test(u);
  }

  /**
   * @returns {{ok: boolean, channel: {username, title, avatar}|null, posts: Array<{id, postedAt, url, text, links, forwarded}>, minId: number|null, hasMore: boolean}}
   */
  function parseChannelPage(html, username) {
    const doc = H.parse(html);
    const titleEl = H.find(doc, H.byClass('tgme_channel_info_header_title'));
    const photoWrap = H.find(doc, H.byClass('tgme_page_photo_image'));
    const photo = photoWrap && (photoWrap.tag === 'img' ? photoWrap : H.find(photoWrap, H.byTag('img')));
    const userEl = H.find(doc, H.byClass('tgme_channel_info_header_username'));
    let canonical = username;
    const userText = userEl ? H.text(userEl).trim().replace(/^@/, '') : '';
    if (isValidUsername(userText)) canonical = userText;

    const posts = [];
    for (const msg of H.findAll(doc, (n) => H.hasClass(n, 'tgme_widget_message') && n.attrs['data-post'])) {
      const [postUser, idStr] = String(msg.attrs['data-post']).split('/');
      const id = Number(idStr);
      if (!Number.isFinite(id)) continue;
      if (isValidUsername(postUser) && !userText) canonical = postUser;

      const dateLink = H.find(msg, H.byClass('tgme_widget_message_date'));
      const time = dateLink && H.find(dateLink, H.byTag('time'));
      const postedAt = time && Date.parse(time.attrs.datetime);
      if (!Number.isFinite(postedAt)) continue;

      const inReply = (n) => H.closest(n, H.byClass('tgme_widget_message_reply'));
      const textEls = H.findAll(msg, (n) => H.hasClass(n, 'tgme_widget_message_text') && !inReply(n));
      const text = textEls.map((n) => H.text(n)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      const links = [];
      for (const t of textEls) {
        for (const a of H.findAll(t, H.byTag('a'))) if (a.attrs.href) links.push(a.attrs.href.replace(/&amp;/g, '&'));
      }
      const preview = H.find(msg, H.byClass('tgme_widget_message_link_preview'));
      if (preview && preview.attrs.href) links.push(preview.attrs.href.replace(/&amp;/g, '&'));

      posts.push({
        id,
        postedAt,
        url: (dateLink && dateLink.attrs.href) || `https://t.me/${postUser || username}/${id}`,
        text,
        links,
        forwarded: Boolean(H.find(msg, H.byClass('tgme_widget_message_forwarded_from')))
      });
    }
    posts.sort((a, b) => a.id - b.id);
    const minId = posts.length ? posts[0].id : null;
    const ok = Boolean(titleEl || posts.length);
    return {
      ok,
      channel: ok ? {
        username: canonical,
        title: titleEl ? H.text(titleEl).trim() : canonical,
        avatar: photo && photo.attrs.src ? photo.attrs.src : null
      } : null,
      posts,
      minId,
      hasMore: Boolean(minId && minId > 1)
    };
  }

  return { parseChannelPage, pageUrl, isValidUsername };
});
