/* Kolibri — loads a public Telegram channel's history from t.me/s/<channel> (no login needed). */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const TG = K.tgPreview;
  const X = K.extract;
  const L = K.ledger;
  const Store = K.store;
  const Net = K.net;

  const MAX_PAGES = 25;
  const active = new Set();

  async function loadTelegram(username, opts) {
    const o = opts || {};
    if (!TG.isValidUsername(username)) throw new Error('Not a valid channel username');
    const key = L.authorKey('tg', username);
    if (active.has(key)) return { key, started: false };
    active.add(key);
    const settings = await Store.getSettings();
    const cutoff = Date.now() - (o.depthDays || settings.historyDepthDays || 120) * 86400000;
    const job = { type: 'history', state: 'running', pages: 0, posts: 0, mentions: 0, startedAt: Date.now() };
    await Store.setJob(key, job);

    (async () => {
      let before = null;
      let author = { platform: 'tg', handle: username, name: o.title || username, channelId: o.channelId || null };
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const html = await Net.fetchText(TG.pageUrl(username, before));
          const parsed = TG.parseChannelPage(html, username);
          if (!parsed.ok) {
            if (page === 0) throw new Error('This channel has no public preview on t.me');
            break;
          }
          if (page === 0 && parsed.channel) {
            author = Object.assign(author, {
              handle: parsed.channel.username || username,
              name: parsed.channel.title || author.name,
              avatar: parsed.channel.avatar || undefined
            });
          }
          const mentions = [];
          for (const post of parsed.posts) {
            if (post.postedAt < cutoff) continue;
            const { tokens } = X.extractTokens(post.text, post.links, { includeMajors: true });
            if (!tokens.length) continue;
            mentions.push(...L.mentionsFromPost({
              postId: post.id,
              postedAt: post.postedAt,
              url: post.url,
              snippet: X.snippet(post.text)
            }, tokens));
          }
          const res = await Store.ingest(key, author, mentions);
          job.pages += 1;
          job.posts += parsed.posts.length;
          job.mentions += res.added;
          job.oldestAt = parsed.posts.length ? parsed.posts[0].postedAt : job.oldestAt;
          await Store.setJob(key, job);
          if (!parsed.hasMore || !parsed.posts.length || parsed.posts[0].postedAt < cutoff) break;
          before = parsed.minId;
        }
        if (o.channelId) await Store.setTgAlias(String(o.channelId), author.handle);
        job.state = 'done';
      } catch (err) {
        job.state = 'error';
        job.error = String((err && err.message) || err);
      } finally {
        job.finishedAt = Date.now();
        await Store.setJob(key, job);
        active.delete(key);
        if (o.onDone) o.onDone(key, job);
      }
    })();
    return { key, started: true };
  }

  K.history = { loadTelegram };
})(globalThis);
