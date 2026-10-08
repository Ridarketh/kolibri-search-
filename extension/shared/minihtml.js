/* Kolibri — a tiny, forgiving HTML parser for places without DOMParser
 * (the extension service worker and the Node server). Good enough for t.me / oEmbed markup.
 * Exposes globalThis.Kolibri.html (and module.exports in Node). */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  (root.Kolibri = root.Kolibri || {}).html = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript']);
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

  function decode(s) {
    if (!s || s.indexOf('&') === -1) return s || '';
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent) => {
      if (ent[0] === '#') {
        const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (_) { return m; }
      }
      const v = NAMED[ent.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  const RE_TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?)*)\s*(\/?)>/g;
  const RE_ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/g;

  function parseAttrs(src) {
    const attrs = {};
    if (!src) return attrs;
    for (const m of src.matchAll(RE_ATTR)) {
      const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
      attrs[m[1].toLowerCase()] = decode(value);
    }
    return attrs;
  }

  function el(tag, attrs, parent) {
    return { type: 'el', tag, attrs, children: [], parent };
  }

  /** Parse HTML into a tree of {type:'el', tag, attrs, children, parent} / {type:'text', text}. */
  function parse(html) {
    const rootNode = el('#root', {}, null);
    const stack = [rootNode];
    const src = String(html || '');
    let lower = null;
    let last = 0;
    RE_TAG.lastIndex = 0;
    let m;
    const pushText = (s) => {
      if (!s) return;
      const top = stack[stack.length - 1];
      top.children.push({ type: 'text', text: decode(s), parent: top });
    };
    while ((m = RE_TAG.exec(src))) {
      pushText(src.slice(last, m.index));
      last = RE_TAG.lastIndex;
      const name = m[1] && m[1].toLowerCase();
      if (!name) continue; // comment, doctype, cdata
      const closing = m[0][1] === '/';
      if (closing) {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === name) { stack.length = i; break; }
        }
        continue;
      }
      const top = stack[stack.length - 1];
      const node = el(name, parseAttrs(m[2]), top);
      top.children.push(node);
      if (VOID.has(name) || m[3] === '/') continue;
      if (RAW.has(name)) {
        if (lower === null) lower = src.toLowerCase();
        const end = lower.indexOf('</' + name, last);
        const stop = end === -1 ? src.length : end;
        if (stop > last) node.children.push({ type: 'text', text: name === 'title' || name === 'textarea' ? decode(src.slice(last, stop)) : src.slice(last, stop), parent: node });
        const close = end === -1 ? src.length : src.indexOf('>', end) + 1;
        last = close > 0 ? close : src.length;
        RE_TAG.lastIndex = last;
        continue;
      }
      stack.push(node);
    }
    pushText(src.slice(last));
    return rootNode;
  }

  function hasClass(node, cls) {
    if (!node || node.type !== 'el' || !node.attrs.class) return false;
    return (' ' + node.attrs.class.replace(/\s+/g, ' ') + ' ').indexOf(' ' + cls + ' ') !== -1;
  }

  /** Depth-first search for elements matching pred. */
  function findAll(node, pred, out) {
    const res = out || [];
    for (const child of node.children || []) {
      if (child.type !== 'el') continue;
      if (pred(child)) res.push(child);
      findAll(child, pred, res);
    }
    return res;
  }

  function find(node, pred) {
    for (const child of node.children || []) {
      if (child.type !== 'el') continue;
      if (pred(child)) return child;
      const hit = find(child, pred);
      if (hit) return hit;
    }
    return null;
  }

  function byClass(cls) { return (n) => hasClass(n, cls); }
  function byTag(tag) { return (n) => n.tag === tag; }

  function closest(node, pred) {
    let cur = node;
    while (cur) {
      if (cur.type === 'el' && pred(cur)) return cur;
      cur = cur.parent;
    }
    return null;
  }

  /** Text content; <br> and block ends become newlines. */
  function text(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text;
    if (node.tag === 'br') return '\n';
    if (RAW.has(node.tag) && node.tag !== 'title') return '';
    let s = '';
    for (const c of node.children) s += text(c);
    if (node.tag === 'p' || node.tag === 'div' || node.tag === 'li') s += '\n';
    return s;
  }

  return { parse, decode, hasClass, findAll, find, closest, text, byClass, byTag };
});
