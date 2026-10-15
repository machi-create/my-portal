/*
 * 共通：色の計算（コントラスト比・明暗の調整）
 * ※ 正本は chrome-extensions/_shared/ です。
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});

  /** "rgb(…)" / "rgba(…)" / "#abc" / "#aabbcc" → {r,g,b,a} */
  function parse(str) {
    str = String(str || '').trim().toLowerCase();
    let m = str.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (m) {
      let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    m = str.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let hex = m[1];
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
      const n = (i) => parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (str === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (str === 'black') return { r: 0, g: 0, b: 0, a: 1 };
    return null;
  }

  function toHex(c) {
    const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  }

  /** 半透明の色 fg を背景 bg の上に重ねた色 */
  function blend(fg, bg) {
    const a = fg.a == null ? 1 : fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }

  function luminance(c) {
    const ch = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  /** WCAG のコントラスト比（1〜21） */
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function mix(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
  }

  /** 文字色 fg を、背景 bg に対してコントラスト比 target 以上になるまで黒か白に近づける */
  function ensureContrast(fg, bg, target) {
    if (contrast(fg, bg) >= target) return fg;
    const toward = luminance(bg) > 0.4 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(mix(fg, toward, mid), bg) >= target) hi = mid;
      else lo = mid;
    }
    return mix(fg, toward, hi);
  }

  /** 文字色 fg を背景に近づけて、コントラスト比を target まで下げる（下げすぎない） */
  function softenContrast(fg, bg, target) {
    if (contrast(fg, bg) <= target) return fg;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(mix(fg, bg, mid), bg) >= target) lo = mid;
      else hi = mid;
    }
    return mix(fg, bg, lo);
  }

  WDT.color = { parse, toHex, blend, luminance, contrast, mix, ensureContrast, softenContrast };
  if (typeof module === 'object' && module.exports) module.exports = WDT.color;
})(typeof globalThis !== 'undefined' ? globalThis : this);
