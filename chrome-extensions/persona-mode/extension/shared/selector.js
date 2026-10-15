/*
 * 共通：要素を「あとから見つけ直せる形」で記録する（コンテンツスクリプト）
 * ※ 正本は chrome-extensions/_shared/ です。page.js の後に読み込みます。
 *
 *   const anchor = WDT.selector.anchor(el)  → { selector, tag, text, path }
 *   const { el, confidence } = WDT.selector.resolve(anchor)
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});
  if (WDT.selector) return;

  const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));

  // 状態やハッシュっぽいクラスは、見つけ直しの手がかりにしない
  const UNSTABLE_CLASS_RE = /^(?:is-|has-|js-|active|current|open|show|hover|focus|selected|visible|hidden|swiper-slide-|slick-|aos-|animate|wow|fade|css-|sc-|jsx-|_)|[0-9a-f]{5,}|\d{3,}/i;
  const UNSTABLE_ID_RE = /\d{3,}|^(?:ember|react|radix|headlessui|mui|:r)/i;

  function unique(sel, el) {
    try {
      const found = document.querySelectorAll(sel);
      return found.length === 1 && found[0] === el;
    } catch (e) {
      return false;
    }
  }

  function segment(el) {
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList].filter((c) => !UNSTABLE_CLASS_RE.test(c)).slice(0, 2);
    let seg = tag + classes.map((c) => '.' + esc(c)).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) seg += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return seg;
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id && !UNSTABLE_ID_RE.test(el.id) && unique(`#${esc(el.id)}`, el)) return `#${esc(el.id)}`;
    for (const attr of ['data-testid', 'data-id', 'data-section', 'name', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (v && v.length < 60) {
        const sel = `${el.tagName.toLowerCase()}[${attr}="${v.replace(/"/g, '\\"')}"]`;
        if (unique(sel, el)) return sel;
      }
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur !== el && cur.id && !UNSTABLE_ID_RE.test(cur.id) && unique(`#${esc(cur.id)}`, cur)) {
        parts.unshift(`#${esc(cur.id)}`);
        break;
      }
      parts.unshift(segment(cur));
      const sel = parts.join(' > ');
      if (unique(sel, el)) return sel;
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function textOf(el) {
    const t = el.tagName === 'IMG' ? el.getAttribute('alt') || el.getAttribute('src') || '' : el.textContent || '';
    return WDT.page.text(t).slice(0, 120);
  }

  function bigrams(s) {
    const m = new Map();
    for (let i = 0; i + 1 < s.length; i++) {
      const g = s.substr(i, 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  }

  /** 2つの文字列の似ている度合い（0〜1） */
  function similarity(a, b) {
    a = String(a || '').replace(/\s+/g, '');
    b = String(b || '').replace(/\s+/g, '');
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    const A = bigrams(a);
    const B = bigrams(b);
    let inter = 0;
    for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
    return (2 * inter) / (a.length - 1 + (b.length - 1));
  }

  function anchor(el) {
    const r = el.getBoundingClientRect();
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: textOf(el),
      y: Math.round(r.top + scrollY),
      x: Math.round(r.left + scrollX),
    };
  }

  /** 記録した手がかりから要素を探す */
  function resolve(a) {
    if (!a) return { el: null, confidence: 0 };
    let el = null;
    try {
      el = a.selector ? document.querySelector(a.selector) : null;
    } catch (e) {
      el = null;
    }
    if (el) {
      const sim = a.text ? similarity(textOf(el), a.text) : 1;
      if (sim >= 0.6) return { el, confidence: sim };
    }
    // 同じタグの中から文言が近いものを探す
    if (a.text && a.text.length >= 2) {
      let best = null;
      let bestScore = 0;
      for (const cand of document.getElementsByTagName(a.tag || '*')) {
        if (WDT.page.isOurs(cand)) continue;
        const s = similarity(textOf(cand), a.text);
        if (s > bestScore) {
          bestScore = s;
          best = cand;
        }
      }
      if (best && bestScore >= 0.7) return { el: best, confidence: bestScore * 0.9 };
    }
    if (el) return { el, confidence: 0.4 };
    return { el: null, confidence: 0 };
  }

  WDT.selector = { cssPath, anchor, resolve, similarity, textOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
