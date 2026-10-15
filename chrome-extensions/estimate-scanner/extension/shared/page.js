/*
 * 共通：ページ側（コンテンツスクリプト）のヘルパー
 * ※ 正本は chrome-extensions/_shared/ です。
 *
 * ページの見た目に影響されないよう、表示物は Shadow DOM の中に置きます。
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});
  if (WDT.page) return;

  const HOST_ID = 'wdt-overlay-host';
  let host = null;
  let shadow = null;
  const sheets = [];

  const BASE_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: absolute; top: 0; left: 0; }
    .focus-box {
      position: absolute; border: 3px solid #4f5bff; border-radius: 6px; pointer-events: none;
      box-shadow: 0 0 0 4px rgba(79, 91, 255, 0.28); animation: wdt-pulse 0.9s ease-out 3;
    }
    @keyframes wdt-pulse { 0% { box-shadow: 0 0 0 0 rgba(79,91,255,.55); } 100% { box-shadow: 0 0 0 14px rgba(79,91,255,0); } }
    .ui { font: 13px/1.5 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif; color: #191c28; }
  `;

  function overlay() {
    if (host && host.isConnected) return { host, shadow };
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.setAttribute('aria-hidden', 'true');
      const s = host.style;
      s.setProperty('all', 'initial', 'important');
      s.setProperty('position', 'absolute', 'important');
      s.setProperty('top', '0', 'important');
      s.setProperty('left', '0', 'important');
      s.setProperty('width', '0', 'important');
      s.setProperty('height', '0', 'important');
      s.setProperty('overflow', 'visible', 'important');
      s.setProperty('z-index', '2147483646', 'important');
      s.setProperty('pointer-events', 'none', 'important');
      document.documentElement.appendChild(host);
    }
    shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    applySheets();
    return { host, shadow };
  }

  function applySheets() {
    if (!shadow) return;
    try {
      const all = [BASE_CSS, ...sheets].map((css) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        return sheet;
      });
      shadow.adoptedStyleSheets = all;
    } catch (e) {
      // 古い環境向け：<style> 要素で代用する
      shadow.querySelectorAll('style[data-wdt]').forEach((n) => n.remove());
      for (const css of [BASE_CSS, ...sheets]) {
        const st = document.createElement('style');
        st.dataset.wdt = '1';
        st.textContent = css;
        shadow.prepend(st);
      }
    }
  }

  /** Shadow DOM 内のスタイルを追加する */
  function css(text) {
    sheets.push(text);
    if (shadow) applySheets();
  }

  /** 名前付きのレイヤー（div）を取得・作成する */
  function layer(name) {
    const { shadow: sr } = overlay();
    let el = sr.querySelector(`[data-layer="${name}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'layer ui';
      el.dataset.layer = name;
      sr.appendChild(el);
    }
    return el;
  }

  function isOurs(node) {
    return !!node && (node === host || (host && host.contains(node)));
  }

  function rectOf(target) {
    const list = Array.isArray(target) ? target : [target];
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    for (const x of list) {
      if (!x) continue;
      if (x instanceof Element && !x.isConnected) continue;
      const rects = x instanceof Range ? x.getClientRects() : [x.getBoundingClientRect()];
      for (const rc of rects) {
        if (!rc.width && !rc.height) continue;
        l = Math.min(l, rc.left);
        t = Math.min(t, rc.top);
        r = Math.max(r, rc.right);
        b = Math.max(b, rc.bottom);
      }
    }
    if (l === Infinity) return null;
    return { left: l, top: t, width: r - l, height: b - t };
  }

  /** ビューポート座標の rect を、ページ座標で要素に配置する */
  function place(el, rect, pad) {
    pad = pad || 0;
    el.style.left = `${rect.left + scrollX - pad}px`;
    el.style.top = `${rect.top + scrollY - pad}px`;
    el.style.width = `${rect.width + pad * 2}px`;
    el.style.height = `${rect.height + pad * 2}px`;
  }

  function isHidden(el) {
    let cur = el;
    while (cur && cur.nodeType === 1 && getComputedStyle(cur).display === 'contents') cur = cur.parentElement;
    if (!cur || cur.nodeType !== 1) return false;
    if (typeof cur.checkVisibility === 'function') return !cur.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
    return getComputedStyle(cur).visibility === 'hidden' || cur.getClientRects().length === 0;
  }

  let flashTimer = 0;
  function flash(target, ms) {
    const fl = layer('flash');
    fl.textContent = '';
    const rect = rectOf(target);
    if (!rect) return;
    const box = document.createElement('div');
    box.className = 'focus-box';
    place(box, rect, 5);
    fl.appendChild(box);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      fl.textContent = '';
    }, ms || 2600);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 対象までスクロールして点滅させる。非表示なら { hidden: true } */
  async function reveal(target) {
    const list = (Array.isArray(target) ? target : [target]).filter(Boolean);
    const first = list[0];
    const node = first instanceof Range ? first.startContainer : first;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || !el.isConnected) return { ok: false, reason: 'gone' };
    if (isHidden(el)) return { ok: true, hidden: true };
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = rectOf(list);
    if (rect) {
      const top = scrollY + rect.top - Math.max(80, (innerHeight - rect.height) / 2);
      scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    await wait(450);
    flash(list);
    return { ok: true, hidden: false };
  }

  /** 表示用の文字列整形（改行・インデントを詰める） */
  function text(s) {
    return String(s == null ? '' : s)
      .replace(/[\t\f\v  ]*[\r\n][\s ]*/g, '\n')
      .replace(/[\t\f\v  ]+/g, ' ')
      .replace(/\n(?=[^\x00-\x7f])|(?<=[^\x00-\x7f])\n/g, '')
      .replace(/\n/g, ' ')
      .trim();
  }

  const clip = (s, n = 40) => {
    const a = Array.from(String(s == null ? '' : s));
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  };

  /** 再描画をまとめる（スクロール・リサイズ時の追従用） */
  function onLayout(fn) {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        fn();
      });
    };
    addEventListener('scroll', schedule, { passive: true, capture: true });
    addEventListener('resize', schedule, { passive: true });
    return schedule;
  }

  WDT.page = { overlay, css, layer, isOurs, rectOf, place, isHidden, flash, reveal, text, clip, wait, onLayout, HOST_ID };
})(typeof globalThis !== 'undefined' ? globalThis : this);
