/*
 * LP抑揚グラフ：ページ側の処理
 * ページを「画面の半分」ごとに区切り、文字数・画像の面積・申し込みボタン・見出しの位置を測ります。
 */
(() => {
  'use strict';
  const WDT = globalThis.WDT;
  if (!WDT || !WDT.page) return;
  if (WDT.api) return;
  const P = WDT.page;

  P.css(`
    .band { position: absolute; left: 0; pointer-events: none; border-left: 6px solid #f2a20c; background: rgba(250, 178, 25, 0.12); }
    .band span { position: absolute; left: 8px; top: 6px; padding: 2px 8px; border-radius: 4px; background: #1f2330; color: #fff;
      font: 700 11px/1.5 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; white-space: nowrap; }
    .row-flash { position: absolute; left: 0; pointer-events: none; background: rgba(42, 120, 214, 0.16); border-top: 2px solid #2a78d6; border-bottom: 2px solid #2a78d6;
      animation: lr-fade 2.4s ease-out forwards; }
    @keyframes lr-fade { 0%, 60% { opacity: 1; } 100% { opacity: 0; } }
  `);

  const num = (v) => parseFloat(v) || 0;

  function fixedChecker() {
    const cache = new Map();
    return function isFixed(el) {
      const chain = [];
      let cur = el;
      let result = false;
      while (cur && cur.nodeType === 1) {
        if (cache.has(cur)) {
          result = cache.get(cur);
          break;
        }
        chain.push(cur);
        const pos = getComputedStyle(cur).position;
        if (pos === 'fixed' || pos === 'sticky') {
          result = true;
          break;
        }
        cur = cur.parentElement;
      }
      for (const c of chain) cache.set(c, result);
      return result;
    };
  }

  function looksButton(el) {
    if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /^(?:submit|button)$/i.test(el.type))) return true;
    if (el.tagName !== 'A') return false;
    if (/\b(?:btn|button|cta)\b/i.test(el.className || '')) return true;
    const cs = getComputedStyle(el);
    const filled = cs.backgroundColor && !/rgba?\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
    const bordered = num(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none';
    return (filled || bordered) && num(cs.paddingLeft) >= 8 && P.text(el.textContent).length <= 30;
  }

  function measure() {
    const vh = innerHeight;
    const vw = innerWidth;
    const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, vh);
    const binH = vh / 2;
    const n = Math.max(1, Math.ceil(docH / binH));
    const chars = new Array(n).fill(0);
    const image = new Array(n).fill(0);
    const isFixed = fixedChecker();
    const sy = scrollY;

    const spread = (top, height, amount, arr, perPx) => {
      // top〜top+height の範囲に amount を、ビンの重なりに応じて配る
      const a = Math.max(0, top);
      const b = Math.min(docH, top + Math.max(1, height));
      for (let i = Math.floor(a / binH); i <= Math.min(n - 1, Math.floor((b - 0.01) / binH)); i++) {
        const overlap = Math.min(b, (i + 1) * binH) - Math.max(a, i * binH);
        if (overlap <= 0) continue;
        arr[i] += perPx ? overlap * perPx : (amount * overlap) / Math.max(1, b - a);
      }
    };

    // 文字
    if (document.body) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const rectCache = new Map();
      let node;
      while ((node = walker.nextNode())) {
        const len = node.data.replace(/\s+/g, '').length;
        if (!len) continue;
        const el = node.parentElement;
        if (!el || P.isOurs(el) || /^(?:SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName)) continue;
        let r = rectCache.get(el);
        if (r === undefined) {
          r = P.isHidden(el) || isFixed(el) ? null : el.getBoundingClientRect();
          rectCache.set(el, r);
        }
        if (!r || (!r.width && !r.height)) continue;
        spread(r.top + sy, r.height, len, chars, 0);
      }
    }

    // 画像（img・動画・背景画像など）。重なりは気にせず面積を足し、最後に1を上限にする
    const media = [...document.querySelectorAll('img, video, canvas, iframe, svg, section, div, header, figure, li, a')].slice(0, 6000);
    for (const el of media) {
      if (P.isOurs(el)) continue;
      const tag = el.tagName.toLowerCase();
      let isMedia = tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'iframe' || tag === 'svg';
      if (!isMedia) {
        const bg = getComputedStyle(el).backgroundImage;
        isMedia = /url\(/.test(bg);
      }
      if (!isMedia) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40 || isFixed(el) || P.isHidden(el)) continue;
      const share = Math.min(1, r.width / vw);
      spread(r.top + sy, r.height, 0, image, share / binH);
    }

    // 申し込みボタン・見出し
    const ctas = [];
    const fixedCtas = [];
    for (const el of document.querySelectorAll('a, button, input[type="submit"], input[type="button"]')) {
      if (P.isOurs(el) || !looksButton(el) || P.isHidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const label = P.clip(P.text(el.value || el.textContent || el.getAttribute('aria-label') || ''), 18) || 'ボタン';
      if (isFixed(el)) {
        if (!fixedCtas.includes(label)) fixedCtas.push(label);
        continue;
      }
      ctas.push({ y: Math.round(r.top + sy + r.height / 2), label });
    }
    const headings = [];
    for (const el of document.querySelectorAll('h1, h2, h3')) {
      if (P.isHidden(el) || isFixed(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      headings.push({ y: Math.round(r.top + sy), level: Number(el.tagName[1]), text: P.clip(P.text(el.textContent), 30) });
    }

    const firstViewTop = 0;
    const inFirst = (y) => y >= firstViewTop && y < vh;
    return {
      url: location.href,
      title: document.title,
      host: location.host,
      vw,
      vh,
      docH,
      binH,
      bins: chars.map((c, i) => ({ chars: Math.round(c), image: Math.round(Math.min(1, image[i]) * 100) / 100 })),
      ctas,
      headings,
      fixedCtas,
      firstView: {
        heading: headings.some((x) => inFirst(x.y) && x.level <= 2),
        cta: ctas.some((x) => inFirst(x.y)) || fixedCtas.length > 0,
        image: image[0] + (image[1] || 0) > 0.3,
        chars: Math.round(chars[0] + (chars[1] || 0)),
      },
    };
  }

  WDT.api = {
    measure,
    /** ページ上の位置（px）までスクロールして、その範囲を光らせる */
    async scrollToRange(args) {
      const from = Math.max(0, Number(args.from) || 0);
      const to = Math.max(from + 20, Number(args.to) || from + innerHeight / 2);
      scrollTo({ top: Math.max(0, from - 60), behavior: 'smooth' });
      const L = P.layer('flash-row');
      L.textContent = '';
      const band = document.createElement('div');
      band.className = 'row-flash';
      band.style.top = `${from}px`;
      band.style.height = `${to - from}px`;
      band.style.width = `${document.documentElement.clientWidth}px`;
      L.appendChild(band);
      setTimeout(() => band.remove(), 2600);
      return true;
    },
    /** 気づきの区間をページの左端に帯で表示する */
    showZones(args) {
      const L = P.layer('zones');
      L.textContent = '';
      for (const z of (args && args.zones) || []) {
        const band = document.createElement('div');
        band.className = 'band';
        band.style.top = `${z.from}px`;
        band.style.height = `${Math.max(24, z.to - z.from)}px`;
        band.style.width = '14px';
        const tag = document.createElement('span');
        tag.textContent = z.label;
        band.appendChild(tag);
        L.appendChild(band);
      }
      return true;
    },
    clear() {
      P.layer('zones').textContent = '';
      P.layer('flash-row').textContent = '';
      return true;
    },
  };
})();
