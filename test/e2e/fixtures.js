'use strict';
// Mock pages that reproduce the markup Kolibri hooks into on X, Telegram Web K / A and t.me/s,
// plus a simulated market, all anchored to the current time.

const { MarketSim, series, pair } = require('../helpers/market-sim.js');

const DAY = 86400000;
const HOUR = 3600000;

function snowflake(ms, seq) {
  return (((BigInt(ms) - 1288834974657n) << 22n) | BigInt(seq || 0)).toString();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function avatarSvg(letter, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="${color}"/><text x="48" y="62" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
}

// ---------------------------------------------------------------- addresses used across fixtures

const ADDR = {
  GIGA: '63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9',
  MOON: 'MoonDy4Q8wKcTz6pbAyuR7jhUGzN1kE3vFxrJ2Tpump',
  BRETT: '0x532f27101965dd16442E59d40670FaF5eBB142E4'
};

// ---------------------------------------------------------------- X

const X_CSS = `
  body { margin: 0; background: #fff; color: #0f1419; font: 15px/1.35 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  a { color: inherit; text-decoration: none; }
  .r-18u37iz { display: flex; flex-direction: row; align-items: center; min-width: 0; }
  .app { display: flex; justify-content: center; }
  .nav { width: 88px; border-right: 1px solid #eff3f4; min-height: 100vh; }
  [data-testid="primaryColumn"] { width: 600px; border-right: 1px solid #eff3f4; }
  .banner { height: 160px; background: linear-gradient(120deg, #1d9bf0 0%, #7856ff 100%); }
  .pfp { width: 120px; height: 120px; border-radius: 50%; border: 4px solid #fff; margin: -64px 0 0 16px; display: block; }
  .ph { padding: 8px 16px 14px; border-bottom: 1px solid #eff3f4; }
  [data-testid="UserName"] .name { font-size: 20px; font-weight: 800; }
  [data-testid="UserName"] .handle, .muted { color: #536471; }
  [data-testid="UserDescription"] { margin-top: 10px; }
  .tabs { display: flex; border-bottom: 1px solid #eff3f4; }
  .tabs div { padding: 14px 18px; font-weight: 600; color: #536471; }
  .tabs div.on { color: #0f1419; box-shadow: inset 0 -4px 0 #1d9bf0; }
  article { display: block; padding: 12px 16px; border-bottom: 1px solid #eff3f4; }
  .ctx { color: #536471; font-size: 13px; font-weight: 700; margin: 0 0 4px 52px; }
  .t { display: flex; gap: 12px; }
  .t img.av { width: 40px; height: 40px; border-radius: 50%; }
  .body { flex: 1; min-width: 0; }
  [data-testid="User-Name"] { gap: 4px; }
  [data-testid="User-Name"] .nm { font-weight: 700; white-space: nowrap; }
  [data-testid="User-Name"] .hn { color: #536471; white-space: nowrap; }
  [data-testid="tweetText"] { margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
  [data-testid="tweetText"] a { color: #1d9bf0; }
  .quote { border: 1px solid #cfd9de; border-radius: 16px; padding: 10px 12px; margin-top: 10px; }
  .actions { display: flex; gap: 56px; color: #536471; font-size: 13px; margin-top: 10px; }
`;

function xUserName(t, linked) {
  const nameEl = linked ? `<a href="/${t.handle}" role="link"><div dir="ltr"><span><span class="nm">${esc(t.name)}</span></span></div></a>` : `<div dir="ltr"><span><span class="nm">${esc(t.name)}</span></span></div>`;
  const handleEl = linked ? `<a href="/${t.handle}" role="link" tabindex="-1"><div dir="ltr"><span class="hn">@${t.handle}</span></div></a>` : `<div dir="ltr"><span class="hn">@${t.handle}</span></div>`;
  const time = new Date(t.at).toISOString();
  const timeEl = linked
    ? `<a href="${t.genericLink ? '/i/status/' + t.id : '/' + t.handle + '/status/' + t.id}" role="link"><time datetime="${time}">${new Date(t.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time></a>`
    : `<time datetime="${time}">${new Date(t.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time>`;
  return `<div data-testid="User-Name" class="r-18u37iz">
    <div class="nmwrap">${nameEl}</div>
    <div class="r-18u37iz"><div class="r-18u37iz"><div>${handleEl}</div><div aria-hidden="true" class="muted">·</div><div class="muted">${timeEl}</div></div></div>
  </div>`;
}

function richText(text) {
  return esc(text).replace(/\$([A-Za-z][A-Za-z0-9]{1,11})/g, (m, s) => `<a href="/search?q=%24${s}&amp;src=cashtag_click">$${s}</a>`);
}

function xTweet(t) {
  const quote = t.quote ? `<div aria-labelledby="q"><div role="link" tabindex="0" class="quote">
      ${xUserName(t.quote, false)}<div data-testid="tweetText" lang="en">${richText(t.quote.text)}</div></div></div>` : '';
  return `<div data-testid="cellInnerDiv"><article data-testid="tweet" role="article" tabindex="0">
    ${t.repostedBy ? `<div class="ctx"><span data-testid="socialContext">${esc(t.repostedBy)} reposted</span></div>` : ''}
    <div class="t">
      <div data-testid="Tweet-User-Avatar"><a href="/${t.handle}"><img class="av" src="https://pbs.twimg.com/profile_images/${t.handle}.svg" alt=""></a></div>
      <div class="body">
        ${xUserName(t, true)}
        <div data-testid="tweetText" lang="en">${richText(t.text)}</div>
        ${quote}
        <div class="actions"><span>12</span><span>48</span><span>310</span><span>21K</span></div>
      </div>
    </div>
  </article></div>`;
}

function xProfilePage(profile, tweets) {
  return `<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>${esc(profile.name)} (@${profile.handle}) / X</title><style>${X_CSS}</style></head>
  <body style="background-color: rgb(255, 255, 255);"><div id="react-root"><div class="app">
    <header class="nav"></header>
    <main role="main"><div data-testid="primaryColumn">
      <div class="banner"></div>
      <a href="/${profile.handle}/photo"><img class="pfp" src="https://pbs.twimg.com/profile_images/${profile.handle}.svg" alt=""></a>
      <div class="ph">
        <div data-testid="UserName"><div>
          <div class="r-18u37iz"><div dir="ltr"><span class="name"><span>${esc(profile.name)}</span></span></div></div>
          <div class="r-18u37iz"><div><div dir="ltr"><span class="handle">@${profile.handle}</span></div></div></div>
        </div></div>
        <div data-testid="UserDescription">${esc(profile.bio)}</div>
      </div>
      <div class="tabs"><div class="on">Posts</div><div>Replies</div><div>Media</div></div>
      <section><div aria-label="Timeline">${tweets.map(xTweet).join('')}</div></section>
    </div></main>
  </div></div></body></html>`;
}

function xFixture(now) {
  const profile = { handle: 'alphaguy', name: 'Alpha Guy', bio: 'Early on everything. Not financial advice.' };
  const mk = (daysAgo, text, extra) => {
    const at = now - daysAgo * DAY;
    return Object.assign({ handle: 'alphaguy', name: 'Alpha Guy', at, id: snowflake(at, Math.floor(daysAgo * 10)), text }, extra || {});
  };
  const other = (daysAgo, text) => {
    const at = now - daysAgo * DAY;
    return { handle: 'otherkol', name: 'Other KOL', at, id: snowflake(at, 7), text };
  };
  const tweets = [
    mk(0.125, '$WIF reloading here. Chart is ready.'),
    mk(1, 'watchlist for the week: $AAA $BBB $CCC $DDD $EEE $FFF $GGG'),
    mk(2, 'Market update: $BTC and $ETH looking weak, careful out there.'),
    mk(6, `$BRETT is the Base play.\n${ADDR.BRETT}`),
    mk(8, '$PEPE again, still holding my bag.'),
    mk(9, `Fresh launch, early.\nCA: ${ADDR.MOON}`),
    mk(10, '$POPCAT bid. Cats are back.'),
    mk(12, 'Told you so.', { quote: other(13, '$FLOKI is the one, trust me') }),
    // X sometimes links posts as /i/status/<id>: the author must come from the header link
    Object.assign(other(15, '$BONK is going to 10x from here'), { repostedBy: 'Alpha Guy', genericLink: true }),
    mk(18, `New gem, CA below\n$GIGA ${ADDR.GIGA}`),
    mk(21, '$WIF chart looks ready for a breakout'),
    mk(25, 'Loading up on $PEPE here. Not financial advice.')
  ];
  return { profile, tweets, html: xProfilePage(profile, tweets) };
}

/** A second, small profile used to check that new calls are shared with the network. */
function xFixtureNew(now) {
  const profile = { handle: 'newkol', name: 'New KOL', bio: 'Fresh account.' };
  const at = now - 2 * DAY;
  const tweets = [{ handle: 'newkol', name: 'New KOL', at, id: snowflake(at, 99), text: '$WIF to the moon' }];
  return { profile, tweets, html: xProfilePage(profile, tweets) };
}

// ---------------------------------------------------------------- t.me/s preview

function tmePost(username, p) {
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${username}/${p.id}">
    <div class="tgme_widget_message_bubble">
      <div class="tgme_widget_message_text js-message_text" dir="auto">${esc(p.text).replace(/\n/g, '<br/>')}</div>
      <div class="tgme_widget_message_footer compact js-message_footer"><div class="tgme_widget_message_info short js-message_info">
        <span class="tgme_widget_message_views">4.1K</span>
        <span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/${username}/${p.id}"><time datetime="${new Date(p.at).toISOString().replace('.000Z', '+00:00')}" class="time">12:00</time></a></span>
      </div></div>
    </div></div></div>`;
}

/** One t.me/s page: up to 20 posts with id < before (newest page when before is empty). */
function tmePage(channel, before) {
  const list = channel.posts.filter((p) => !before || p.id < before).sort((a, b) => a.id - b.id).slice(-20);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(channel.title)} – Telegram</title></head><body>
    <main class="tgme_main"><section class="tgme_channel_history js-message_history">
      <div class="tgme_channel_info"><div class="tgme_channel_info_header">
        <i class="tgme_page_photo_image"><img src="https://cdn4.cdn-telegram.org/file/${channel.username}.svg"></i>
        <div class="tgme_channel_info_header_title"><span dir="auto">${esc(channel.title)}</span></div>
        <div class="tgme_channel_info_header_username"><a href="https://t.me/${channel.username}">@${channel.username}</a></div>
      </div></div>
      ${list.map((p) => tmePost(channel.username, p)).join('\n')}
    </section></main></body></html>`;
}

function tgChannels(now) {
  const at = (d) => now - d * DAY;
  const alphacalls = {
    username: 'alphacalls',
    title: 'Alpha Calls',
    peerId: '-1234567890',
    posts: [
      { id: 101, at: at(30), text: `New call: $GIGA\nCA: ${ADDR.GIGA}` },
      { id: 103, at: at(28), text: '$WIF looks strong, adding.' },
      { id: 105, at: at(27.5), text: 'GM everyone. Patience pays.' },
      { id: 108, at: at(20), text: '$BONK breakout incoming' },
      { id: 112, at: at(16), text: '$POPCAT accumulation zone' },
      { id: 115, at: at(12), text: `Degen play\n${ADDR.MOON}` },
      { id: 118, at: at(10), text: '$PEPE reload' },
      { id: 119, at: at(9), text: '$FLOKI chart is clean' },
      { id: 121, at: at(2), text: 'Next one: $BONK' },
      { id: 122, at: now - 1 * HOUR, text: '$PEPE looks good for a bounce' }
    ]
  };
  const gemhunters = {
    username: 'gemhunters',
    title: 'Gem Hunters',
    peerId: '-1009876543210',
    posts: [
      { id: 40, at: at(26), text: `$GIGA early. ${ADDR.GIGA}` },
      { id: 44, at: at(22), text: '$WIF dip buy' },
      { id: 47, at: at(14), text: '$POPCAT is the cat coin' }
    ]
  };
  return { alphacalls, gemhunters };
}

// ---------------------------------------------------------------- Telegram Web K (dark)

const K_CSS = `
  body { margin: 0; background: #181818; color: #fff; font: 15px/1.35 Roboto, -apple-system, "Segoe UI", Arial, sans-serif; display: flex; height: 100vh; }
  #column-left { width: 340px; background: #212121; border-right: 1px solid #0f0f0f; }
  .chatlist-chat { display: flex; gap: 10px; align-items: center; padding: 8px 12px; color: #fff; text-decoration: none; border-radius: 10px; margin: 2px 6px; }
  .chatlist-chat.active { background: #766ac8; }
  .chatlist-chat .av { width: 48px; height: 48px; border-radius: 50%; background: #3f8; flex: none; }
  .user-caption { flex: 1; min-width: 0; }
  .dialog-title { display: flex; align-items: center; justify-content: space-between; }
  .user-title { font-weight: 600; white-space: nowrap; }
  .dialog-subtitle { color: #aaa; font-size: 14px; }
  #column-center { flex: 1; display: flex; flex-direction: column; background: #0f0f0f url() ; }
  .chat { display: none; flex: 1; flex-direction: column; } .chat.active { display: flex; }
  .topbar { display: flex; align-items: center; height: 56px; padding: 0 16px; background: #212121; }
  .chat-info .person { display: flex; gap: 10px; align-items: center; }
  .chat-info .av { width: 42px; height: 42px; border-radius: 50%; background: #e57; }
  .top { display: flex; align-items: center; }
  .top .user-title { font-size: 16px; }
  .bottom .info { color: #aaa; font-size: 14px; }
  .bubbles { flex: 1; overflow: auto; padding: 16px 0; background: #0e1621; }
  .bubbles-inner { max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; }
  .bubbles-date-group { display: flex; flex-direction: column; gap: 8px; }
  .bubble { align-self: flex-start; max-width: 480px; background: #212121; border-radius: 14px; padding: 8px 12px; }
  .message { white-space: pre-wrap; } .message a { color: #8774e1; }
  .time { float: right; color: #aaa; font-size: 12px; margin: 6px 0 0 10px; }
`;

function webKPage(channel, visiblePosts, otherChats) {
  const bubble = (p) => `<div class="bubble channel-post is-in" data-mid="${2 ** 32 + p.id}" data-peer-id="${channel.peerId.replace('-100', '-')}" data-timestamp="${Math.floor(p.at / 1000)}">
      <div class="bubble-content-wrapper"><div class="bubble-content"><div class="message spoilers-container" dir="auto">${esc(p.text)}<span class="time"><span class="i18n">${new Date(p.at).toISOString().slice(11, 16)}</span></span></div></div></div></div>`;
  const chatRow = (c, active) => `<a class="chatlist-chat${active ? ' active' : ''}" href="#${c.peerId}"><div class="av"></div><div class="user-caption">
      <div class="dialog-title"><span class="user-title"><span class="peer-title" dir="auto" data-peer-id="${c.peerId}" data-dialog="1">${esc(c.title)}</span></span><span class="dialog-title-details">12:30</span></div>
      <div class="dialog-subtitle">${esc(c.last || '')}</div></div></a>`;
  return `<!DOCTYPE html><html lang="en" class="night"><head><meta charset="utf-8"><title>Telegram Web</title><style>${K_CSS}</style></head>
  <body>
    <div id="column-left"><div class="chatlist">${[chatRow({ peerId: channel.peerId.replace('-100', '-'), title: channel.title, last: 'Next one: $BONK' }, true)].concat(otherChats.map((c) => chatRow(c, false))).join('')}</div></div>
    <div id="column-center"><div class="chats-container tabs-container">
      <div class="chat tabs-tab active" data-type="chat">
        <div class="sidebar-header topbar" data-floating="0"><div class="chat-info-container"><div class="chat-info"><div class="person">
          <div class="av"></div>
          <div class="content"><div class="top"><div class="user-title"><span class="peer-title" dir="auto" data-peer-id="${channel.peerId.replace('-100', '-')}" data-dialog="1">${esc(channel.title)}</span></div></div>
          <div class="bottom"><div class="info"><span class="i18n">12 480 subscribers</span></div></div></div>
        </div></div></div></div>
        <div class="bubbles"><div class="scrollable scrollable-y"><div class="bubbles-inner is-broadcast">
          <section class="bubbles-date-group">${visiblePosts.map(bubble).join('')}</section>
        </div></div></div>
      </div>
    </div></div>
  </body></html>`;
}

// ---------------------------------------------------------------- Telegram Web A (light)

const A_CSS = `
  body { margin: 0; background: #fff; color: #000; font: 15px/1.35 Roboto, -apple-system, "Segoe UI", Arial, sans-serif; }
  #Main { display: flex; height: 100vh; }
  #LeftColumn { width: 340px; border-right: 1px solid #dadce0; }
  .ListItem-button { display: flex; gap: 10px; align-items: center; padding: 8px 12px; color: inherit; text-decoration: none; }
  .ListItem-button .av { width: 48px; height: 48px; border-radius: 50%; background: #5ac; }
  .info-row { display: flex; align-items: center; } .title { display: flex; align-items: center; }
  .title h3 { margin: 0; font-size: 16px; font-weight: 600; }
  #MiddleColumn { flex: 1; display: flex; flex-direction: column; background: #e4edd9; }
  .MiddleHeader { height: 56px; background: #fff; display: flex; align-items: center; padding: 0 16px; }
  .ChatInfo { display: flex; gap: 10px; align-items: center; } .ChatInfo .av { width: 42px; height: 42px; border-radius: 50%; background: #c5a; }
  .ChatInfo .status { color: #707579; font-size: 14px; }
  .MessageList { flex: 1; overflow: auto; padding: 16px; }
  .message-date-group { display: flex; flex-direction: column; gap: 8px; max-width: 560px; margin: 0 auto 12px; }
  .sticky-date { align-self: center; background: rgba(0,0,0,.2); color: #fff; border-radius: 12px; padding: 2px 10px; font-size: 14px; }
  .Message .message-content { background: #fff; border-radius: 14px; padding: 8px 12px; max-width: 480px; }
  .MessageMeta { float: right; color: #707579; font-size: 12px; margin: 6px 0 0 10px; }
`;

function webAPage(channel, visible, now) {
  const fmt = (ms) => {
    const d = new Date(ms);
    const today = new Date(now);
    const dayDiff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
    if (dayDiff === 0) return 'Today';
    if (dayDiff === 1) return 'Yesterday';
    if (dayDiff < 7) return new Intl.DateTimeFormat('en', { weekday: 'long' }).format(d);
    if (d.getFullYear() === today.getFullYear()) return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(d);
    return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(d);
  };
  const groups = new Map();
  for (const p of visible) {
    const label = fmt(p.at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(p);
  }
  const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const msg = (p) => `<div id="message-${p.id}" class="Message message-list-item has-views allow-selection" data-message-id="${p.id}">
      <div class="bottom-marker" data-message-id="${p.id}"></div>
      <div class="message-content-wrapper"><div class="message-content text has-shadow"><div class="text-content clearfix with-meta" dir="auto">${esc(p.text)}<span class="MessageMeta" dir="ltr"><span class="message-views">1.2K</span><span class="message-time">${clock(p.at)}</span></span></div></div></div></div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Telegram Web</title><style>${A_CSS}</style></head><body>
    <div id="Main">
      <div id="LeftColumn"><div class="chat-list"><div class="ListItem Chat chat-item-clickable"><a class="ListItem-button" href="#${channel.peerId}"><div class="av"></div><div class="info"><div class="info-row"><div class="title"><h3 class="fullName" dir="auto">${esc(channel.title)}</h3></div></div></div></a></div></div></div>
      <div id="MiddleColumn">
        <div class="MiddleHeader"><div class="chat-info-wrapper"><div class="ChatInfo"><div class="av"></div><div class="info"><div class="title"><h3 dir="auto" class="fullName">${esc(channel.title)}</h3></div><span class="status"><span class="group-status">8 210 subscribers</span></span></div></div></div></div>
        <div class="MessageList custom-scroll"><div class="messages-container">
          ${[...groups.entries()].map(([label, ps]) => `<div class="message-date-group"><div class="sticky-date"><span dir="auto">${label}</span></div>${ps.map(msg).join('')}</div>`).join('')}
        </div></div>
      </div>
    </div></body></html>`;
}

// ---------------------------------------------------------------- simulated market

function market(now) {
  const sim = new MarketSim();
  const nowS = Math.floor(now / 1000);
  const start = nowS - 70 * 86400;
  const days = (t) => (t - start) / 86400;
  const d0 = (daysAgo) => nowS - daysAgo * 86400; // call times in seconds
  sim.binance.set('PEPEUSDT', series((t) => 0.00001 * Math.pow(1.02, days(t)), start, nowS, 900));
  sim.binance.set('WIFUSDT', series((t) => 2.4 * Math.pow(0.975, days(t)), start, nowS, 900));
  sim.binance.set('BONKUSDT', series((t) => 0.00002 * (1 + 0.35 * Math.sin(days(t) / 4)), start, nowS, 900));
  sim.binance.set('POPCATUSDT', series((t) => 0.8 * (1 + 0.25 * Math.sin(days(t) / 2.2)) * Math.pow(0.99, days(t)), start, nowS, 900));
  sim.binance.set('BTCUSDT', series((t) => 95000 * (1 + 0.03 * Math.sin(days(t) / 6)), start, nowS, 900));
  sim.binance.set('ETHUSDT', series((t) => 3500 * (1 + 0.04 * Math.sin(days(t) / 5)), start, nowS, 900));
  sim.binance.set('FLOKIUSDT', series((t) => 0.00013 * (1 + 0.04 * Math.sin(days(t))), start, nowS, 900));

  // GIGA: one Raydium pool, steady climb
  const gigaPool = 'GigaPoo1Raydium9xKq7wTzP4mN2bC8vYhRjL5sD3fGe';
  sim.dexTokens.set(ADDR.GIGA, [pair({ chain: 'solana', dex: 'raydium', pair: gigaPool, base: ADDR.GIGA, symbol: 'GIGA', liquidity: 2.4e6, createdAt: (start - 30 * 86400) * 1000 })]);
  sim.pools.set('solana/' + gigaPool, series((t) => 0.004 * Math.pow(1.045, days(t)), start, nowS, 900));

  // MOON: launchpad curve from shortly before the first call, migrates to an AMM pool 2 days after it
  const launch = d0(12) - 3600;
  const migrate = d0(9) + 2 * 86400;
  const curve = 'MoonCurve7pFqRz3xWkJ5hN8bT2vYcG4mD9sL6eA1uPp';
  const amm = 'MoonAmmPoo1Q2w3E4r5T6y7U8i9P1a2S3d4F5g6H7j8K';
  sim.dexTokens.set(ADDR.MOON, [
    pair({ chain: 'solana', dex: 'pumpswap', pair: amm, base: ADDR.MOON, symbol: 'MOON', liquidity: 380000, createdAt: migrate * 1000 }),
    pair({ chain: 'solana', dex: 'pumpfun', pair: curve, base: ADDR.MOON, symbol: 'MOON', liquidity: 0, createdAt: launch * 1000 })
  ]);
  // the AMM pool trades at 3x the curve's last price, so a missing stitch is easy to spot
  const moon = (t) => {
    const x = (t - launch) / 86400;
    const base = 0.00001 * (1 + 2.2 * x) * (x > 6 ? Math.pow(0.85, x - 6) : 1);
    return t >= migrate ? 3 * base : base;
  };
  sim.pools.set('solana/' + curve, series(moon, launch, migrate, 900));
  sim.pools.set('solana/' + amm, series(moon, migrate, nowS, 900));

  // BRETT on Base
  const brettPool = '0xba3f945812a83471d709bce9c3ca699a19fb46f7';
  sim.dexTokens.set(ADDR.BRETT.toLowerCase(), [
    pair({ chain: 'base', dex: 'aerodrome', pair: brettPool, base: ADDR.BRETT, symbol: 'BRETT', quote: 'WETH', liquidity: 9.1e6, createdAt: (start - 200 * 86400) * 1000 })
  ]);
  sim.pools.set('base/' + brettPool, series((t) => 0.07 * (1 + 0.012 * days(t)), start, nowS, 900));
  return sim;
}

module.exports = { xFixture, xFixtureNew, tmePage, tgChannels, webKPage, webAPage, market, avatarSvg, snowflake, ADDR, DAY, HOUR };
