/* Kolibri — styles and artwork for the in-page badge and report card (rendered in shadow roots). */
(function (root) {
  'use strict';
  const K = root.Kolibri;
  const UI = (K.ui = K.ui || {});

  let birdSeq = 0;
  /** The Kolibri hummingbird. Gradient ids must be unique per shadow root/document. */
  UI.bird = function bird(size, cls) {
    const id = 'kb' + (++birdSeq);
    return `<svg class="${cls || 'bird'}" width="${size}" height="${size}" viewBox="6 8 112 110" aria-hidden="true" focusable="false">
<defs><linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5EEAD4"/><stop offset=".55" stop-color="#22C55E"/><stop offset="1" stop-color="#0E9F6E"/></linearGradient>
<linearGradient id="${id}w" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#34D399"/><stop offset="1" stop-color="#B6F7DA"/></linearGradient></defs>
<path d="M60 50C68 30 86 16 114 12C108 32 92 50 70 62Z" fill="url(#${id}w)"/><path d="M80 86L104 114L98 92Z" fill="#0E9F6E"/><path d="M84 84L116 100L98 88Z" fill="#12B27B"/>
<path d="M38 46C40 70 58 88 84 94C92 96 96 90 92 84C82 66 70 52 58 38C50 32 40 36 38 46Z" fill="url(#${id}p)"/>
<path d="M38 50C40 60 46 66 54 68C52 60 48 54 40 48Z" fill="#F43F5E"/><path d="M10 57L39 44L41 50Z" fill="#94A3B8"/><circle cx="48" cy="44" r="3.4" fill="#0B1220"/></svg>`;
  };

  const TOKENS = `
:host { all: initial; }
.kl {
  --bg: #ffffff; --surface: #f3f7f6; --ink: #0f1b2d; --muted: #5b6b7f; --faint: #8a99ab; --line: #e3eaee; --hover: #f6faf9;
  --up: #087f5b; --up-bg: #dcf5ea; --down: #c81e43; --down-bg: #fde4ea; --mid: #a4660f; --mid-bg: #fbefd9;
  --none: #4f5f73; --none-bg: #e7edf2; --accent: #0e9f6e; --accent-ink: #ffffff;
  --shadow: 0 18px 40px -12px rgba(15, 27, 45, .28), 0 2px 6px rgba(15, 27, 45, .08);
  --serif: Charter, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--ink); -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;
}
.kl.dark {
  --bg: #0e1726; --surface: #142033; --ink: #e6edf5; --muted: #8a9bb0; --faint: #61728a; --line: #22324a; --hover: #132035;
  --up: #3dd9a0; --up-bg: rgba(61, 217, 160, .13); --down: #ff6b8a; --down-bg: rgba(255, 107, 138, .13); --mid: #f2b84b; --mid-bg: rgba(242, 184, 75, .13);
  --none: #b6c3d3; --none-bg: rgba(138, 155, 176, .16); --accent: #3dd9a0; --accent-ink: #062418;
  --shadow: 0 22px 48px -12px rgba(0, 0, 0, .7), 0 2px 8px rgba(0, 0, 0, .4);
}
.tone-good { color: var(--up); background: var(--up-bg); }
.tone-mid { color: var(--mid); background: var(--mid-bg); }
.tone-bad { color: var(--down); background: var(--down-bg); }
.tone-none { color: var(--none); background: var(--none-bg); }
.up { color: var(--up); } .down { color: var(--down); } .flat, .none { color: var(--muted); }
`;

  UI.BADGE_CSS = TOKENS + `
:host { display: inline-flex; vertical-align: middle; align-items: center; flex-shrink: 0; margin: 0 4px; line-height: 1; }
.b {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 6px 0 3px;
  border-radius: 9px; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap;
}
.b:hover { box-shadow: inset 0 0 0 1px currentColor; }
.b:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.b .bird { width: 14px; height: 14px; flex: none; }
.b .g { font-family: var(--serif); font-size: 12.5px; font-weight: 700; }
.b .w { font-weight: 600; opacity: .8; margin-left: 3px; }
.b.big { height: 22px; padding: 0 8px 0 4px; border-radius: 11px; font-size: 12.5px; }
.b.big .bird { width: 16px; height: 16px; }
.b.big .g { font-size: 14.5px; }
/* after the reset above: the grade colour */
.b.tone-good { color: var(--up); background: var(--up-bg); }
.b.tone-mid { color: var(--mid); background: var(--mid-bg); }
.b.tone-bad { color: var(--down); background: var(--down-bg); }
.b.tone-none { color: var(--none); background: var(--none-bg); }
`;

  UI.CARD_CSS = TOKENS + `
:host { position: fixed; z-index: 2147483646; top: 0; left: 0; }
.card {
  box-sizing: border-box; width: 372px; max-height: min(640px, calc(100vh - 24px)); overflow: auto; overscroll-behavior: contain;
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
  font-size: 13px; line-height: 1.4; text-align: left;
}
@media (prefers-reduced-motion: no-preference) { .card { animation: in .14s ease-out; } }
@keyframes in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.card * { box-sizing: border-box; }
a { color: inherit; text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 2px; }
button { font: inherit; }
.head { display: flex; align-items: center; gap: 11px; padding: 14px 14px 12px; }
.ava { width: 42px; height: 42px; border-radius: 50%; flex: none; background: var(--surface); object-fit: cover; display: grid; place-items: center; font-weight: 700; color: var(--muted); font-size: 16px; overflow: hidden; }
.who { min-width: 0; flex: 1; }
.name { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { color: var(--muted); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grade { flex: none; min-width: 50px; height: 50px; padding: 0 6px; border-radius: 12px; display: grid; place-items: center; text-align: center; }
.grade b { font-family: var(--serif); font-size: 28px; line-height: 1; display: block; font-weight: 700; }
.grade small { font-size: 10px; font-weight: 600; opacity: .85; display: block; margin-top: 1px; }
.seg { display: flex; gap: 2px; margin: 0 14px 12px; padding: 3px; border-radius: 9px; background: var(--surface); }
.seg button { all: unset; flex: 1; text-align: center; padding: 5px 0; border-radius: 7px; font-size: 12px; font-weight: 600; color: var(--muted); cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--bg); color: var(--ink); box-shadow: 0 1px 2px rgba(15, 27, 45, .14); }
.seg button:focus-visible { outline: 2px solid var(--accent); }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); margin: 0 14px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.stat { padding: 9px 0 8px 10px; min-width: 0; border-left: 1px solid var(--line); }
.stat:first-child { border-left: 0; padding-left: 0; }
.stat .v { font-size: 17px; font-weight: 700; white-space: nowrap; letter-spacing: -.01em; }
.stat .k { font-size: 11px; color: var(--muted); white-space: nowrap; margin-top: 1px; }
.spark { display: block; margin: 12px 14px 0; width: calc(100% - 28px); height: 44px; }
.spark .axis { stroke: var(--line); }
.spark .u { fill: var(--up); } .spark .d { fill: var(--down); }
.legend { margin: 3px 14px 0; display: flex; justify-content: space-between; font-size: 10.5px; color: var(--faint); }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th { font-size: 11px; color: var(--muted); font-weight: 600; text-align: right; padding: 5px 8px; border-bottom: 1px solid var(--line); }
th:first-child, td:first-child { text-align: left; padding-left: 14px; }
th:last-child, td:last-child { padding-right: 14px; }
td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; font-weight: 600; }
tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: var(--hover); }
td.tok { max-width: 112px; overflow: hidden; text-overflow: ellipsis; font-weight: 700; }
td.tok .rep { font-size: 10.5px; color: var(--muted); font-weight: 600; margin-left: 3px; }
td.when { color: var(--muted); font-weight: 500; }
.muted { color: var(--muted); font-weight: 500; }
.lock { display: flex; align-items: center; gap: 9px; margin: 10px 14px 0; padding: 9px 10px; border-radius: 10px; background: var(--surface); font-size: 12px; color: var(--muted); }
.lock b { color: var(--ink); }
.follow { margin: 10px 14px 0; font-size: 12.5px; color: var(--muted); }
.follow b { color: var(--ink); font-weight: 700; }
.follow b.up { color: var(--up); } .follow b.down { color: var(--down); }
.empty { padding: 2px 14px 0; color: var(--muted); font-size: 13px; }
.empty p { margin: 0 0 8px; }
.empty p:first-child { color: var(--ink); font-weight: 600; }
.note { margin: 10px 14px 0; color: var(--faint); font-size: 11.5px; }
.progress { margin: 10px 14px 0; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
@media (prefers-reduced-motion: no-preference) { .dot { animation: pulse 1s ease-in-out infinite; } }
@keyframes pulse { 50% { opacity: .25; } }
.actions { display: flex; align-items: center; gap: 6px; padding: 11px 14px; border-top: 1px solid var(--line); margin-top: 12px; }
.btn { all: unset; cursor: pointer; padding: 7px 11px; border-radius: 8px; font-size: 12.5px; font-weight: 650; background: var(--surface); color: var(--ink); }
.btn:hover { box-shadow: inset 0 0 0 1px var(--line); }
.btn.primary { background: var(--accent); color: var(--accent-ink); }
.btn.primary:hover { box-shadow: none; filter: brightness(1.06); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.brand { margin-left: auto; display: flex; align-items: center; gap: 5px; color: var(--faint); font-size: 11.5px; font-weight: 600; }
.brand .bird { width: 16px; height: 16px; }
input.link { all: unset; flex: 1; min-width: 0; padding: 6px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font-size: 12.5px; }
input.link:focus-visible { border-color: var(--accent); }
.row { display: flex; gap: 6px; margin: 4px 14px 0; }
.err { margin: 10px 14px 0; color: var(--down); font-size: 12px; }
.skeleton { height: 12px; border-radius: 6px; background: var(--surface); margin: 10px 14px; }
@media (prefers-reduced-motion: no-preference) { .skeleton { animation: pulse 1.2s ease-in-out infinite; } }
`;
})(globalThis);
