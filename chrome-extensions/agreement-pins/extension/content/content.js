/*
 * 合意ピン：ページ側の処理
 * - ピンの表示（要素の右上に番号）、ホバーで履歴、クリックでサイドパネルの該当ピンへ
 * - ピンを付ける要素を選ぶ
 */
(() => {
  'use strict';
  const WDT = globalThis.WDT;
  if (!WDT || !WDT.page || !WDT.picker || !WDT.selector) return;
  if (WDT.api) return;
  const P = WDT.page;

  const COLORS = { agreed: '#16a34a', pending: '#d97706', question: '#2563eb', rejected: '#6b7280' };
  const LABELS = { agreed: '合意', pending: '保留', question: '要確認', rejected: '却下' };

  P.css(`
    .pin { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; pointer-events: auto; cursor: pointer;
      display: grid; place-items: center; border-radius: 50%; border: 2px solid #fff; color: #fff;
      font: 800 12px/1 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
      box-shadow: 0 3px 10px rgba(0,0,0,.28); transition: transform .12s ease; }
    .pin:hover, .pin.active { transform: scale(1.18); z-index: 2; }
    .pin.rejected { opacity: .75; }
    .outline { position: absolute; pointer-events: none; border: 2px dashed; border-radius: 4px; }
    .card { position: absolute; width: 280px; pointer-events: none; padding: 10px 12px; border-radius: 10px; background: #fff; color: #191c28;
      box-shadow: 0 12px 32px rgba(15,23,42,.24), 0 2px 6px rgba(15,23,42,.12); z-index: 3;
      font: 12.5px/1.55 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif; }
    .card .head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .card .st { padding: 0 6px; border-radius: 4px; color: #fff; font-weight: 700; font-size: 11px; line-height: 18px; }
    .card .target { color: #646b80; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .card .what { font-weight: 700; white-space: pre-wrap; }
    .card .meta { margin-top: 2px; color: #646b80; font-size: 11px; }
    .card .note { margin-top: 4px; color: #444; font-size: 11.5px; white-space: pre-wrap; }
    .card ol { margin: 6px 0 0; padding: 6px 0 0 16px; border-top: 1px solid #eceef4; color: #646b80; font-size: 11px; }
    .card .other { margin-top: 4px; color: #b45309; font-size: 11px; }
  `);

  let pins = [];
  let resolved = new Map(); // id → { el, confidence }
  let visible = true;
  let activeId = null;
  let hoverId = null;

  function resolveAll() {
    resolved = new Map();
    for (const p of pins) resolved.set(p.id, WDT.selector.resolve(p.anchor));
  }

  function latest(p) {
    return p.entries[p.entries.length - 1] || { status: 'pending', what: '' };
  }

  function placeAt(el, x, y) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  const placed = new Map(); // id → 表示位置など（ホバー表示用）

  function render() {
    const L = P.layer('pins');
    L.textContent = '';
    placed.clear();
    if (!visible) {
      renderHover();
      return;
    }
    const used = new Map();
    pins.forEach((p, i) => {
      const r = resolved.get(p.id);
      if (!r || !r.el || !r.el.isConnected || P.isHidden(r.el)) return;
      const rect = r.el.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const e = latest(p);
      const color = COLORS[e.status] || COLORS.pending;
      // 同じ要素に複数のピンがあれば横にずらす
      const n = used.get(r.el) || 0;
      used.set(r.el, n + 1);
      const x = rect.right + scrollX - 4 - n * 28;
      const y = rect.top + scrollY + 4;
      placed.set(p.id, { p, i, x, y, rect, color, confidence: r.confidence });

      const dot = document.createElement('div');
      dot.className = `pin ${e.status}${p.id === activeId ? ' active' : ''}`;
      dot.style.background = color;
      dot.textContent = String(i + 1);
      dot.dataset.id = p.id;
      placeAt(dot, x, y);
      dot.addEventListener('mouseenter', () => {
        hoverId = p.id;
        renderHover();
      });
      dot.addEventListener('mouseleave', () => {
        hoverId = null;
        renderHover();
      });
      dot.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        activeId = p.id;
        L.querySelectorAll('.pin.active').forEach((d) => d.classList.remove('active'));
        dot.classList.add('active');
        renderHover();
        try {
          chrome.runtime.sendMessage({ type: 'wdt-pin-open', id: p.id, path: p.path });
        } catch (err) {
          /* 拡張機能が更新された直後などは送れない */
        }
      });
      L.appendChild(dot);
    });
    renderHover();
  }

  /** ホバー中・選択中のピンの枠線と、ホバー中のカード */
  function renderHover() {
    const H = P.layer('pin-hover');
    H.textContent = '';
    if (!visible) return;
    for (const id of new Set([activeId, hoverId])) {
      const info = id && placed.get(id);
      if (!info) continue;
      const outline = document.createElement('div');
      outline.className = 'outline';
      outline.style.borderColor = info.color;
      P.place(outline, info.rect, 4);
      H.appendChild(outline);
    }
    const info = hoverId && placed.get(hoverId);
    if (info) H.appendChild(cardFor(info.p, info.i, info.x, info.y, info.color, info.confidence));
  }

  function cardFor(p, i, x, y, color, confidence) {
    const e = latest(p);
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'head';
    const st = document.createElement('span');
    st.className = 'st';
    st.style.background = color;
    st.textContent = `${i + 1}. ${LABELS[e.status] || e.status}`;
    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = p.target || '';
    head.append(st, target);
    const what = document.createElement('div');
    what.className = 'what';
    what.textContent = e.what || '（内容なし）';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [e.who, e.date ? e.date.replace(/-/g, '/') : ''].filter(Boolean).join(' ・ ');
    card.append(head, what, meta);
    if (e.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = `※ ${e.note}`;
      card.append(note);
    }
    if (p.entries.length > 1) {
      const ol = document.createElement('ol');
      for (const h of p.entries.slice(0, -1).slice(-4)) {
        const li = document.createElement('li');
        li.textContent = `${(h.date || '').slice(5).replace('-', '/')} ${LABELS[h.status] || h.status}：${h.what}${h.who ? `（${h.who}）` : ''}`;
        ol.append(li);
      }
      card.append(ol);
    }
    if (p.origin && p.origin !== location.origin) {
      const other = document.createElement('div');
      other.className = 'other';
      other.textContent = `別の環境（${p.origin.replace(/^https?:\/\//, '')}）で記録したピンです`;
      card.append(other);
    } else if (confidence < 0.6) {
      const other = document.createElement('div');
      other.className = 'other';
      other.textContent = '要素の位置が変わった可能性があります。必要なら位置を付け直してください';
      card.append(other);
    }
    // 画面の右端・下端からはみ出さないように置く
    const left = Math.min(x + 18, scrollX + innerWidth - 296);
    card.style.left = `${Math.max(scrollX + 8, left)}px`;
    card.style.top = `${y - 6}px`;
    return card;
  }

  const schedule = P.onLayout(render);
  // 遅れて表示される要素（画像の読み込み・アニメーション）に合わせて、数回だけ探し直す
  let retries = 0;
  function retryResolve() {
    if (retries++ > 4) return;
    const missing = pins.some((p) => !(resolved.get(p.id) || {}).el);
    if (!missing) return;
    resolveAll();
    render();
    setTimeout(retryResolve, 1200);
  }

  function labelFor(el) {
    const tag = el.tagName;
    let kind = 'エリア';
    if (/^H[1-6]$/.test(tag)) kind = '見出し';
    else if (tag === 'BUTTON' || (tag === 'INPUT' && /submit|button/i.test(el.type)) || /\b(?:btn|button|cta)\b/i.test(el.className || '')) kind = 'ボタン';
    else if (tag === 'A') kind = 'リンク';
    else if (tag === 'IMG' || tag === 'PICTURE' || tag === 'VIDEO' || tag.toLowerCase() === 'svg') kind = '画像';
    else if (['P', 'SPAN', 'LI', 'TD', 'TH', 'DT', 'DD', 'LABEL'].includes(tag)) kind = '文章';
    else if (['SECTION', 'HEADER', 'FOOTER', 'NAV', 'ARTICLE', 'ASIDE', 'FORM'].includes(tag)) kind = 'セクション';
    const text = WDT.selector.textOf(el);
    return text ? `${kind}「${P.clip(text, 24)}」` : kind;
  }

  WDT.api = {
    render(args) {
      pins = (args && args.pins) || [];
      if (args && typeof args.visible === 'boolean') visible = args.visible;
      if (args && 'activeId' in args) activeId = args.activeId;
      resolveAll();
      render();
      retries = 0;
      setTimeout(retryResolve, 800);
      return pins.map((p) => {
        const r = resolved.get(p.id) || {};
        return { id: p.id, found: !!r.el, confidence: r.confidence || 0, hidden: r.el ? P.isHidden(r.el) : false };
      });
    },
    setVisible(args) {
      visible = !!(args && args.visible);
      render();
      return visible;
    },
    setActive(args) {
      activeId = (args && args.id) || null;
      render();
      return true;
    },
    async pick() {
      const el = await WDT.picker.pick({ mode: 'element', message: 'ピンを付ける要素をクリック' });
      if (!el) return { cancelled: true };
      return { cancelled: false, anchor: WDT.selector.anchor(el), target: labelFor(el) };
    },
    cancelPick() {
      return WDT.picker.cancel();
    },
    async focus(args) {
      const r = resolved.get(args && args.id);
      if (!r || !r.el) return { ok: false, reason: 'notfound' };
      activeId = args.id;
      const res = await P.reveal(r.el);
      render();
      return res;
    },
    clear() {
      pins = [];
      resolved = new Map();
      WDT.picker.cancel();
      render();
      return true;
    },
  };
  schedule();
})();
