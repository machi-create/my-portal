/*
 * フィードバック翻訳機：ページ側の処理
 * - 要素を選ぶ（picker）と、見た目の情報（文字サイズ・色・余白など）を集める
 * - 修正案をその場で当ててプレビューする／元に戻す
 */
(() => {
  'use strict';
  const WDT = globalThis.WDT;
  if (!WDT || !WDT.page || !WDT.picker || !WDT.selector) return;
  if (WDT.api) return;
  const P = WDT.page;

  P.css(`
    .selected { position: absolute; pointer-events: none; border: 2px dashed #f2620f; border-radius: 4px; }
    .selected-label { position: absolute; left: -2px; top: -22px; padding: 2px 7px; border-radius: 4px 4px 4px 0;
      background: #f2620f; color: #fff; font: 700 11px/1.5 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; white-space: nowrap; }
    .selected.previewing { border-style: solid; border-color: #16a34a; }
    .selected.previewing .selected-label { background: #16a34a; }
  `);

  let current = null;
  let preview = null; // { el, saved: Map(prop → {value, priority}) }
  let showSelection = true;

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  function rgba(str) {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
  }

  /** 要素の見た目上の背景色（半透明の重なりを合成。背景画像は考慮しない） */
  function effectiveBackground(el) {
    const layers = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const c = rgba(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.01) {
        layers.push(c);
        if (c.a >= 0.99) break;
      }
      cur = cur.parentElement;
    }
    let base = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const c = layers[i];
      base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
    }
    return `rgb(${Math.round(base.r)}, ${Math.round(base.g)}, ${Math.round(base.b)})`;
  }

  function roleOf(el, cs) {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'BUTTON' || (tag === 'INPUT' && /^(?:submit|button|reset)$/i.test(el.type))) return 'button';
    if (tag === 'IMG' || tag === 'PICTURE' || tag === 'SVG' || tag === 'svg' || tag === 'VIDEO' || tag === 'CANVAS') return 'image';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return 'input';
    const bg = cs.backgroundColor;
    const filled = bg && !/rgba?\(0, 0, 0, 0\)|transparent/.test(bg);
    const looksButton = el.getAttribute('role') === 'button' || /\b(?:btn|button|cta)\b/i.test(el.className || '') || (filled && num(cs.paddingLeft) >= 8 && /inline-block|inline-flex|flex|block/.test(cs.display) && el.textContent.trim().length < 40);
    if (tag === 'A') return looksButton ? 'button' : 'link';
    if (looksButton && el.textContent.trim().length < 40) return 'button';
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
    if (hasText || ['P', 'SPAN', 'LI', 'DT', 'DD', 'LABEL', 'SMALL', 'STRONG', 'EM', 'B', 'TD', 'TH', 'FIGCAPTION', 'BLOCKQUOTE'].includes(tag)) return 'text';
    return 'block';
  }

  function describe(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const lh = cs.lineHeight === 'normal' ? null : num(cs.lineHeight);
    const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing);
    return {
      selector: WDT.selector.cssPath(el),
      tag: el.tagName.toLowerCase(),
      role: roleOf(el, cs),
      text: P.clip(P.text(el.tagName === 'IMG' ? el.alt || el.getAttribute('src') || '' : el.textContent), 80),
      rect: { width: Math.round(r.width), height: Math.round(r.height) },
      styles: {
        fontSize: num(cs.fontSize),
        fontWeight: num(cs.fontWeight) || 400,
        lineHeight: lh,
        letterSpacing: ls,
        fontFamily: cs.fontFamily,
        color: cs.color,
        background: effectiveBackground(el),
        ownBackground: (() => {
          const c = rgba(cs.backgroundColor);
          return !!c && c.a >= 0.99;
        })(),
        textAlign: cs.textAlign,
        textDecorationLine: cs.textDecorationLine,
        textShadow: cs.textShadow,
        paddingTop: num(cs.paddingTop),
        paddingRight: num(cs.paddingRight),
        paddingBottom: num(cs.paddingBottom),
        paddingLeft: num(cs.paddingLeft),
        marginTop: num(cs.marginTop),
        marginRight: num(cs.marginRight),
        marginBottom: num(cs.marginBottom),
        marginLeft: num(cs.marginLeft),
        borderRadius: num(cs.borderTopLeftRadius),
        boxShadow: cs.boxShadow,
        display: cs.display,
      },
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      url: location.href,
      title: document.title,
    };
  }

  // ---------------------------------------------------------------- 選択中の要素の表示
  function renderSelection() {
    const L = P.layer('selected');
    L.textContent = '';
    if (!showSelection || !current || !current.isConnected) return;
    const rect = P.rectOf(current);
    if (!rect) return;
    const box = document.createElement('div');
    box.className = 'selected' + (preview ? ' previewing' : '');
    P.place(box, rect, 4);
    const tag = document.createElement('span');
    tag.className = 'selected-label';
    tag.textContent = preview ? 'プレビュー中' : '修正対象';
    box.appendChild(tag);
    L.appendChild(box);
  }
  const scheduleRender = P.onLayout(renderSelection);

  // ---------------------------------------------------------------- プレビュー
  function revert() {
    if (!preview) return false;
    for (const [prop, saved] of preview.saved) {
      if (saved.value) preview.el.style.setProperty(prop, saved.value, saved.priority);
      else preview.el.style.removeProperty(prop);
    }
    if (!preview.hadStyle && !preview.el.style.length) preview.el.removeAttribute('style');
    preview = null;
    renderSelection();
    return true;
  }

  function applyPreview(args) {
    if (!current || !current.isConnected) throw new Error('要素が見つかりません。もう一度選んでください');
    revert();
    const styles = (args && args.styles) || {};
    const hadStyle = current.hasAttribute('style');
    const saved = new Map();
    for (const [prop, value] of Object.entries(styles)) {
      saved.set(prop, { value: current.style.getPropertyValue(prop), priority: current.style.getPropertyPriority(prop) });
      current.style.setProperty(prop, value, 'important');
    }
    preview = { el: current, saved, hadStyle };
    requestAnimationFrame(renderSelection);
    return { ok: true, after: describe(current) };
  }

  // ---------------------------------------------------------------- API
  WDT.api = {
    async pick() {
      revert();
      const el = await WDT.picker.pick({ mode: 'element', message: '修正したい要素をクリック' });
      if (!el) return { cancelled: true };
      current = el;
      renderSelection();
      return { cancelled: false, info: describe(el) };
    },
    cancelPick() {
      return WDT.picker.cancel();
    },
    refresh() {
      if (!current || !current.isConnected) return null;
      return describe(current);
    },
    preview: applyPreview,
    revert,
    /** スクリーンショット用：要素を画面内に入れて、ビューポート上の位置を返す */
    async prepareCapture() {
      if (!current || !current.isConnected) return null;
      current.scrollIntoView({ block: 'center', inline: 'nearest' });
      await P.wait(250);
      showSelection = false;
      renderSelection();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = current.getBoundingClientRect();
      const pad = 24;
      const left = Math.max(0, r.left - pad);
      const top = Math.max(0, r.top - pad);
      return {
        rect: { left, top, width: Math.min(innerWidth - left, r.width + pad * 2), height: Math.min(innerHeight - top, r.height + pad * 2) },
        dpr: devicePixelRatio,
      };
    },
    endCapture() {
      showSelection = true;
      renderSelection();
      return true;
    },
    focus() {
      if (!current) return { ok: false };
      return P.reveal(current);
    },
    clear() {
      revert();
      WDT.picker.cancel();
      current = null;
      renderSelection();
      return true;
    },
  };
  scheduleRender();
})();
