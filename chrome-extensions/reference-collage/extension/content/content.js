/*
 * 参考サイト・コラージュ：ページ側の処理
 * セクションを選ぶと、中の見出し・文章・画像・ボタン・入力欄の位置と大きさを取り出し、
 * ワイヤーフレーム用のデータ（nodes）と、種類の推定に使う特徴（features）を返します。
 */
(() => {
  'use strict';
  const WDT = globalThis.WDT;
  if (!WDT || !WDT.page || !WDT.picker || !globalThis.RC || !globalThis.RC.classify) return;
  if (WDT.api) return;
  const P = WDT.page;
  const MAX_NODES = 220;

  let current = null;

  const num = (v) => parseFloat(v) || 0;

  function directText(el) {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.data;
    return s.replace(/\s+/g, ' ').trim();
  }

  function looksButton(el, cs) {
    if (el.tagName === 'BUTTON') return true;
    if (el.tagName === 'INPUT' && /^(?:submit|button|reset)$/i.test(el.type)) return true;
    if (el.getAttribute('role') === 'button') return true;
    if (el.tagName !== 'A') return false;
    if (/\b(?:btn|button|cta)\b/i.test(el.className || '')) return true;
    const filled = cs.backgroundColor && !/rgba?\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
    const bordered = num(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none';
    return (filled || bordered) && num(cs.paddingLeft) >= 8 && P.text(el.textContent).length <= 30;
  }

  function mediaType(el) {
    const tag = el.tagName;
    if (tag === 'VIDEO') return 'video';
    if (tag === 'IFRAME') {
      const src = el.getAttribute('src') || '';
      if (/youtube|youtu\.be|vimeo|player/i.test(src)) return 'video';
      if (/google\.[^/]+\/maps|maps\.google|openstreetmap|mapbox/i.test(src)) return 'map';
      return 'image';
    }
    if (tag === 'IMG' || tag === 'PICTURE' || tag === 'CANVAS' || tag.toLowerCase() === 'svg') return 'image';
    return null;
  }

  function signature(el) {
    return `${el.tagName}.${[...el.classList].slice(0, 1).join('.')}`;
  }

  /** 同じ形の子要素が3つ以上並んでいる箇所（カードの一覧など）を探す */
  function findRepeated(root) {
    let best = { repeated: 0, columns: 0, items: [] };
    const candidates = [root, ...root.querySelectorAll('*')].slice(0, 1500);
    for (const el of candidates) {
      const kids = [...el.children].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 40 && r.height > 40 && !P.isHidden(c);
      });
      if (kids.length < 3) continue;
      const counts = new Map();
      for (const k of kids) counts.set(signature(k), (counts.get(signature(k)) || 0) + 1);
      const [sig, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (n < 3) continue;
      const items = kids.filter((k) => signature(k) === sig);
      const top = items[0].getBoundingClientRect().top;
      const columns = items.filter((k) => Math.abs(k.getBoundingClientRect().top - top) < 12).length;
      if (n > best.repeated || (n === best.repeated && columns > best.columns)) best = { repeated: n, columns, items };
    }
    return best;
  }

  function analyze(root) {
    const R = root.getBoundingClientRect();
    const nodes = [];
    const consumed = new WeakSet();
    const stats = { headings: 0, texts: 0, images: 0, buttons: 0, inputs: 0, icons: 0, links: 0, details: 0, bigNumbers: 0, smallImages: 0, columns: 0, repeated: 0 };

    const inConsumed = (el) => {
      for (let cur = el.parentElement; cur && cur !== root.parentElement; cur = cur.parentElement) if (consumed.has(cur)) return true;
      return false;
    };
    const add = (el, type, rect, extra) => {
      const x = rect.left - R.left;
      const y = rect.top - R.top;
      if (x + rect.width < 0 || y + rect.height < 0 || x > R.width || y > R.height) return;
      nodes.push(Object.assign({ type, x: Math.round(x), y: Math.round(y), w: Math.round(rect.width), h: Math.round(rect.height) }, extra));
    };

    const all = [root, ...root.querySelectorAll('*')].slice(0, 4000);
    for (const el of all) {
      if (P.isOurs(el) || inConsumed(el)) continue;
      const tag = el.tagName;
      if (/^(?:SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BR|HR|SOURCE|TRACK|META|LINK)$/.test(tag)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (el !== root && P.isHidden(el)) {
        consumed.add(el);
        continue;
      }
      const cs = getComputedStyle(el);

      // 背景画像（セクション全体の背景も含む）は、中身の下に敷く画像として扱う
      if (/url\(/.test(cs.backgroundImage) && rect.width >= 80 && rect.height >= 60) {
        add(el, 'image', rect, { bg: true });
        stats.images++;
      }
      if (el === root) continue;

      const media = mediaType(el);
      if (media) {
        const small = rect.width <= 48 && rect.height <= 48;
        if (small) {
          add(el, 'icon', rect);
          stats.icons++;
        } else {
          add(el, media, rect);
          stats.images++;
          if (tag === 'IMG' && rect.width <= 220 && rect.height <= 130) stats.smallImages++;
        }
        consumed.add(el);
        continue;
      }
      if ((tag === 'INPUT' && !/^(?:hidden|submit|button|reset|checkbox|radio|image)$/i.test(el.type)) || tag === 'TEXTAREA' || tag === 'SELECT') {
        add(el, 'input', rect, { label: el.getAttribute('placeholder') || '' });
        stats.inputs++;
        consumed.add(el);
        continue;
      }
      if (looksButton(el, cs)) {
        add(el, 'button', rect, { text: P.clip(P.text(el.value || el.textContent), 16) });
        stats.buttons++;
        consumed.add(el);
        continue;
      }
      const own = directText(el);
      const fs = num(cs.fontSize);
      if (/^H[1-6]$/.test(tag) || (own && fs >= 26 && own.length <= 60 && num(cs.fontWeight) >= 500)) {
        const level = /^H[1-6]$/.test(tag) ? Number(tag[1]) : null; // 見出しタグでない大きな文字（価格など）は階層なし
        add(el, 'heading', rect, { level, text: P.clip(P.text(el.textContent), 24) });
        stats.headings++;
        if (/^[\d,.]+\s?(?:%|％|件|社|人|名|年|万|億|倍|\+)?$/.test(P.text(el.textContent)) && fs >= 28) stats.bigNumbers++;
        consumed.add(el);
        continue;
      }
      if (own.length >= 1) {
        if (/^[\d,.]+\s?(?:%|％|件|社|人|名|年|万|億|倍|\+)?$/.test(own) && fs >= 28) stats.bigNumbers++;
        const lh = cs.lineHeight === 'normal' ? fs * 1.5 : num(cs.lineHeight);
        add(el, 'text', rect, { lines: Math.max(1, Math.round(rect.height / Math.max(8, lh))) });
        stats.texts++;
        consumed.add(el);
      }
    }

    stats.links = root.querySelectorAll('a[href]').length;
    stats.details = root.querySelectorAll('details').length;
    const rep = findRepeated(root);
    stats.repeated = rep.repeated;
    stats.columns = rep.columns;
    // 繰り返しのカード（枠線や背景があるもの）は、枠として描く
    for (const item of rep.items) {
      const cs = getComputedStyle(item);
      const framed = num(cs.borderTopWidth) > 0 || !/rgba?\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.boxShadow !== 'none';
      if (framed) add(item, 'box', item.getBoundingClientRect(), { box: true });
    }

    // 背景画像 → カードの枠 → 中身 の順に描き、多すぎるときは大きいものから残す
    const layer = (n) => (n.bg ? 0 : n.box ? 1 : 2);
    nodes.sort((a, b) => layer(a) - layer(b));
    let kept = nodes;
    if (nodes.length > MAX_NODES) {
      const priority = (n) => (n.type === 'heading' || n.type === 'button' ? 1e9 : 0) + n.w * n.h;
      const keep = new Set([...nodes].sort((a, b) => priority(b) - priority(a)).slice(0, MAX_NODES));
      kept = nodes.filter((n) => keep.has(n));
    }

    const features = {
      tag: root.tagName.toLowerCase(),
      role: root.getAttribute('role') || '',
      top: Math.round(R.top + scrollY),
      height: Math.round(R.height),
      docHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
      viewportH: innerHeight,
      text: P.text(root.innerText || root.textContent).slice(0, 4000),
      stats,
      hasH1: !!(root.tagName === 'H1' || root.querySelector('h1')),
    };
    return {
      kind: globalThis.RC.classify(features),
      size: { w: Math.round(R.width), h: Math.round(R.height) },
      nodes: kept,
      stats,
      source: { url: location.href, title: document.title, host: location.host },
    };
  }

  WDT.api = {
    async pickSection() {
      const el = await WDT.picker.pick({ mode: 'section', message: '参考にしたいセクションをクリック' });
      if (!el) return { cancelled: true };
      current = el;
      return { cancelled: false, section: analyze(el) };
    },
    cancelPick() {
      return WDT.picker.cancel();
    },
    /** スクリーンショット用：セクションの上端を画面の上に合わせ、写る範囲を返す */
    async prepareCapture() {
      if (!current || !current.isConnected) return null;
      const top = current.getBoundingClientRect().top + scrollY;
      scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      const { host } = P.overlay();
      host.style.setProperty('visibility', 'hidden', 'important');
      await P.wait(300);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = current.getBoundingClientRect();
      const left = Math.max(0, r.left);
      const t = Math.max(0, r.top);
      return {
        rect: { left, top: t, width: Math.min(innerWidth - left, r.width), height: Math.min(innerHeight - t, r.bottom - t) },
        dpr: devicePixelRatio,
      };
    },
    endCapture() {
      const { host } = P.overlay();
      host.style.setProperty('visibility', 'visible', 'important');
      return true;
    },
    clear() {
      WDT.picker.cancel();
      current = null;
      return true;
    },
  };
})();
