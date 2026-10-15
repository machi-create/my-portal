/*
 * ペルソナ憑依モード：ページ側の処理
 * - 見え方の再現（ぼかし・色覚・コントラスト・セピア）と、親指の届く範囲の表示
 * - つまずきの計測（文字の大きさ・色の差・押せる大きさ・色だけのリンク・固定バー・ページの重さ など）
 */
(() => {
  'use strict';
  const WDT = globalThis.WDT;
  if (!WDT || !WDT.page || !WDT.color || !globalThis.PM) return;
  if (WDT.api) return;
  const P = WDT.page;
  const C = WDT.color;
  const DEFS_ID = 'wdt-persona-defs';

  P.css(`
    .thumb { position: fixed; inset: 0; pointer-events: none; }
    .thumb svg { width: 100%; height: 100%; display: block; }
    .thumb text { font: 700 12px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; fill: #1f2330; }
    .mark { position: absolute; pointer-events: none; border: 2px solid #d03b3b; border-radius: 4px; background: rgba(208, 59, 59, 0.08); }
  `);

  // ================================================================ 見え方の再現
  let savedFilter = null;

  function ensureDefs() {
    if (document.getElementById(DEFS_ID)) return;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.id = DEFS_ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important';
    for (const [k, m] of Object.entries(globalThis.PM.personas.CVD_MATRIX)) {
      const f = document.createElementNS(NS, 'filter');
      f.id = `wdt-cvd-${k}`;
      f.setAttribute('color-interpolation-filters', 'linearRGB');
      const cm = document.createElementNS(NS, 'feColorMatrix');
      cm.setAttribute('type', 'matrix');
      cm.setAttribute('values', `${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0`);
      f.appendChild(cm);
      svg.appendChild(f);
    }
    document.documentElement.appendChild(svg);
  }

  function applyEffects(e) {
    e = e || {};
    // 前のペルソナで付けた枠や強調は消す
    P.layer('marks').textContent = '';
    if (typeof Highlight === 'function' && CSS.highlights) CSS.highlights.delete('wdt-find');
    const html = document.documentElement;
    const parts = [];
    if (e.cvd) {
      ensureDefs();
      parts.push(`url(#wdt-cvd-${e.cvd})`);
    }
    if (e.blur) parts.push(`blur(${e.blur}px)`);
    if (e.contrast && e.contrast !== 1) parts.push(`contrast(${e.contrast})`);
    if (e.sepia) parts.push(`sepia(${e.sepia})`);
    if (parts.length) {
      if (!savedFilter) savedFilter = { value: html.style.getPropertyValue('filter'), priority: html.style.getPropertyPriority('filter') };
      html.style.setProperty('filter', parts.join(' '), 'important');
    } else restoreFilter();
    renderThumb(e.thumb ? e.hand || 'right' : null);
    return { filter: parts.join(' ') };
  }

  function restoreFilter() {
    if (!savedFilter) return;
    const html = document.documentElement;
    if (savedFilter.value) html.style.setProperty('filter', savedFilter.value, savedFilter.priority);
    else html.style.removeProperty('filter');
    savedFilter = null;
  }

  /** 片手持ちで親指が届く範囲（画面の下の角を中心にした3段階） */
  function renderThumb(hand) {
    const L = P.layer('thumb');
    L.textContent = '';
    if (!hand) return;
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const base = Math.min(vw, 480);
    const right = hand === 'right';
    const cx = right ? vw - base * 0.1 : base * 0.1;
    const cy = vh + base * 0.05;
    const NS = 'http://www.w3.org/2000/svg';
    const box = document.createElement('div');
    box.className = 'thumb';
    const svg = document.createElementNS(NS, 'svg');
    const mk = (tag, attrs, text) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (text) el.textContent = text;
      return el;
    };
    // ラベルは、親指の付け根から斜め上（画面の内側）に向かって置く
    const at = (r) => {
      const d = r * base * Math.SQRT1_2;
      const x = Math.max(70, Math.min(vw - 70, right ? cx - d : cx + d));
      const y = Math.max(28, Math.min(vh - 12, cy - d));
      return { x, y };
    };
    const label = (pos, text) => mk('text', { x: pos.x, y: pos.y, 'text-anchor': 'middle', stroke: '#ffffff', 'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, text);
    svg.append(
      mk('rect', { x: 0, y: 0, width: vw, height: vh, fill: 'rgba(208, 59, 59, 0.10)' }),
      mk('circle', { cx, cy, r: base * 1.05, fill: 'rgba(250, 178, 25, 0.16)' }),
      mk('circle', { cx, cy, r: base * 0.68, fill: 'rgba(12, 163, 12, 0.18)' }),
      label({ x: right ? Math.min(vw / 2, 110) : Math.max(vw / 2, vw - 110), y: Math.round(vh * 0.22) }, '親指が届きにくい'),
      label(at(0.87), '少し伸ばせば届く'),
      label(at(0.38), 'らくに届く')
    );
    box.appendChild(svg);
    L.appendChild(box);
  }

  // ================================================================ 計測
  const refs = new Map();
  let seq = 0;
  const ref = (el) => {
    const id = `r${++seq}`;
    refs.set(id, el);
    return id;
  };

  const num = (v) => parseFloat(v) || 0;
  const VAGUE_RE = /^(?:こちら|ここ|こちらから|詳しくはこちら|詳細はこちら|くわしくはこちら|こちらをクリック|クリック|詳細|詳しく|もっと見る|more|read more|click here|here|view more|see more)$/i;

  function bgOf(el) {
    const layers = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const c = C.parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.01) {
        layers.push(c);
        if (c.a >= 0.99) break;
      }
      cur = cur.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = C.blend(layers[i], base);
    return base;
  }

  function directText(el) {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.data;
    return s.replace(/\s+/g, ' ').trim();
  }

  function fixedOf() {
    const cache = new Map();
    return (el) => {
      for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
        if (cache.has(cur)) return cache.get(cur);
        const pos = getComputedStyle(cur).position;
        if (pos === 'fixed' || pos === 'sticky') {
          cache.set(cur, true);
          return true;
        }
      }
      return false;
    };
  }

  function looksButton(el) {
    if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /^(?:submit|button)$/i.test(el.type))) return true;
    if (el.tagName !== 'A') return false;
    if (/\b(?:btn|button|cta)\b/i.test(el.className || '')) return true;
    const cs = getComputedStyle(el);
    const filled = cs.backgroundColor && !/rgba?\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
    return filled && num(cs.paddingLeft) >= 8 && P.text(el.textContent).length <= 30;
  }

  function accessibleName(el) {
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (label.trim()) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      if (t) return t;
    }
    if (el.tagName === 'INPUT') return (el.type === 'image' ? el.alt : el.value) || '';
    const text = P.text(el.textContent);
    if (text) return text;
    const img = el.querySelector('img[alt]:not([alt=""]), svg[aria-label], [role="img"][aria-label]');
    return img ? img.getAttribute('alt') || img.getAttribute('aria-label') : '';
  }

  function inlineLink(el) {
    if (el.tagName !== 'A') return false;
    if (getComputedStyle(el).display !== 'inline') return false;
    const block = el.parentElement && el.parentElement.closest('p, li, dd, td, th, figcaption, blockquote, div, span');
    if (!block) return false;
    return P.text(block.textContent).length > P.text(el.textContent).length + 8;
  }

  function weight() {
    const res = performance.getEntriesByType('resource');
    const nav = performance.getEntriesByType('navigation')[0];
    let bytes = nav ? nav.transferSize || nav.encodedBodySize || 0 : 0;
    let unknown = 0;
    const list = [];
    let fonts = 0;
    for (const r of res) {
      const b = r.transferSize || r.encodedBodySize || 0;
      if (!b) unknown++;
      bytes += b;
      if (r.initiatorType === 'css' && /\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(r.name)) fonts++;
      list.push({ name: r.name.split('?')[0].split('/').slice(-2).join('/'), bytes: b });
    }
    list.sort((a, b) => b.bytes - a.bytes);
    const blocking = [...document.head.querySelectorAll('script[src]')].filter((s) => !s.async && !s.defer && s.type !== 'module').length + document.head.querySelectorAll('link[rel="stylesheet"]').length;
    let lcp = null;
    try {
      const e = performance.getEntriesByType('largest-contentful-paint');
      if (e.length) lcp = Math.round(e[e.length - 1].startTime);
    } catch (e) {
      lcp = null;
    }
    return {
      bytes,
      requests: res.length + 1,
      unknown,
      largest: list.slice(0, 10),
      blocking,
      fonts,
      autoplay: !!document.querySelector('video[autoplay]'),
      load: nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd || 0) : null,
      lcp,
    };
  }

  function measure() {
    refs.clear();
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const isFixed = fixedOf();
    const texts = [];
    const lines = [];
    const all = document.body ? [...document.body.querySelectorAll('*')].slice(0, 6000) : [];
    for (const el of all) {
      if (P.isOurs(el) || /^(?:SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|svg|OPTION)$/.test(el.tagName)) continue;
      const own = directText(el);
      if (!own) continue;
      if (P.isHidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      const bg = bgOf(el);
      const fg = C.blend(C.parse(cs.color) || { r: 0, g: 0, b: 0, a: 1 }, bg);
      texts.push({ refId: ref(el), text: P.clip(own, 30), size: Math.round(num(cs.fontSize) * 10) / 10, weight: num(cs.fontWeight), contrast: Math.round(C.contrast(fg, bg) * 100) / 100 });
      if (texts.length >= 3000) break;
    }
    // 文章（ブロックごと）
    for (const el of document.querySelectorAll('h1, h2, h3, h4, p, li, dt, dd, td, th, figcaption, blockquote, a, button, label')) {
      if (P.isOurs(el) || P.isHidden(el)) continue;
      if (el.parentElement && el.parentElement.closest('p, li, dt, dd, td, th, figcaption, blockquote, a, button, label')) continue;
      const t = P.text(el.innerText || el.textContent);
      if (t) lines.push(t);
    }

    const targets = [];
    const colorLinks = [];
    const vague = [];
    const unnamed = [];
    const ctas = [];
    for (const el of document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], summary')) {
      if (P.isOurs(el) || P.isHidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name = accessibleName(el);
      const inline = inlineLink(el);
      const id = ref(el);
      targets.push({ refId: id, label: P.clip(name || `<${el.tagName.toLowerCase()}>`, 20), w: r.width, h: r.height, inline });
      if (inline) {
        const cs = getComputedStyle(el);
        const underline = /underline/.test(cs.textDecorationLine) || num(cs.borderBottomWidth) > 0;
        if (!underline) {
          const pc = C.parse(getComputedStyle(el.parentElement).color);
          const lc = C.parse(cs.color);
          const ratio = pc && lc ? C.contrast(C.blend(lc, bgOf(el)), C.blend(pc, bgOf(el))) : 1;
          if (ratio < 3) colorLinks.push({ refId: id, text: P.clip(name, 24), ratio });
        }
      }
      const norm = P.text(name).replace(/[>＞→»›\s]+$/g, '').trim();
      if (norm && VAGUE_RE.test(norm)) vague.push({ refId: id, text: norm });
      const isButton = el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && /^(?:submit|button|image|reset)$/i.test(el.type));
      if (isButton && !name) {
        const cls = typeof el.className === 'string' ? el.className : '';
        unnamed.push({ refId: id, text: `<${el.tagName.toLowerCase()}${cls ? ` class="${P.clip(cls, 30)}"` : ''}>` });
      }
      if (looksButton(el)) {
        // 固定されたボタンは画面上の位置、それ以外はページ上端からの位置
        const fx = isFixed(el);
        ctas.push({ refId: id, label: P.clip(name || 'ボタン', 18), x: r.left, y: Math.round(fx ? r.top : r.top + scrollY), w: r.width, h: r.height, fixed: fx });
      }
    }

    // 固定されたバー・画面を覆う表示
    const fixed = { top: 0, bottom: 0, overlays: [] };
    for (const el of all) {
      if (P.isOurs(el)) continue;
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      if (P.isHidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.5 || r.height < 8 || r.bottom <= 0 || r.top >= vh) continue;
      const coverage = (Math.min(r.bottom, vh) - Math.max(r.top, 0)) * Math.min(r.width, vw) / (vw * vh);
      if (coverage > 0.4) fixed.overlays.push({ refId: ref(el), coverage, text: P.clip(P.text(el.textContent), 30) || `<${el.tagName.toLowerCase()}>` });
      else if (r.top <= 2) fixed.top = Math.max(fixed.top, r.bottom);
      else if (r.bottom >= vh - 2) fixed.bottom = Math.max(fixed.bottom, vh - r.top);
    }

    const h = [...document.querySelectorAll('h1, h2')].find((x) => !P.isHidden(x) && x.getBoundingClientRect().top + scrollY < vh);
    return {
      url: location.href,
      title: document.title,
      viewport: { w: vw, h: vh },
      texts,
      targets,
      colorLinks,
      vague,
      unnamed,
      fixed,
      ctas,
      firstView: { h1: h ? P.clip(P.text(h.textContent), 40) : '' },
      weight: weight(),
      text: lines.join('\n').slice(0, 200000),
    };
  }

  // ================================================================ 表示
  function mark(args) {
    const L = P.layer('marks');
    L.textContent = '';
    for (const id of (args && args.refIds) || []) {
      const el = refs.get(id);
      if (!el || !el.isConnected) continue;
      const rect = P.rectOf(el);
      if (!rect) continue;
      const box = document.createElement('div');
      box.className = 'mark';
      P.place(box, rect, 3);
      L.appendChild(box);
    }
    return true;
  }

  function findText(args) {
    const term = String((args && args.term) || '');
    if (!term || !document.body) return { found: 0 };
    const ranges = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && ranges.length < 30) {
      if (!node.parentElement || P.isOurs(node.parentElement) || P.isHidden(node.parentElement)) continue;
      let i = node.data.indexOf(term);
      while (i >= 0 && ranges.length < 30) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + term.length);
        ranges.push(r);
        i = node.data.indexOf(term, i + term.length);
      }
    }
    if (typeof Highlight === 'function' && CSS.highlights) {
      if (ranges.length) CSS.highlights.set('wdt-find', new Highlight(...ranges));
      else CSS.highlights.delete('wdt-find');
    }
    if (ranges.length) P.reveal(ranges[0]);
    return { found: ranges.length };
  }

  WDT.api = {
    measure,
    applyEffects,
    mark,
    findText,
    async focus(args) {
      const el = refs.get(args && args.refId);
      if (!el || !el.isConnected) return { ok: false };
      return P.reveal(el);
    },
    clear() {
      restoreFilter();
      renderThumb(null);
      P.layer('marks').textContent = '';
      if (typeof Highlight === 'function' && CSS.highlights) CSS.highlights.delete('wdt-find');
      return true;
    },
  };
})();
