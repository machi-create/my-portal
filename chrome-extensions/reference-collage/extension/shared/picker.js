/*
 * 共通：ページ上の要素をクリックで選ぶ（コンテンツスクリプト）
 * ※ 正本は chrome-extensions/_shared/ です。page.js の後に読み込みます。
 *
 *   const el = await WDT.picker.pick({ mode: 'element' | 'section', message })
 *   → 選ばれた要素。Esc / キャンセルで null
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});
  if (WDT.picker) return;
  const P = WDT.page;

  P.css(`
    .pick-box { position: fixed; pointer-events: none; border: 2px solid var(--wdt-pick, #4f5bff); border-radius: 4px;
      background: rgba(79, 91, 255, 0.10); transition: all 0.06s ease-out; }
    .pick-label { position: fixed; pointer-events: none; padding: 3px 7px; border-radius: 5px; background: #191c28; color: #fff;
      font: 600 11px/1.3 ui-monospace, Menlo, Consolas, monospace; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
    .pick-bar { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); pointer-events: auto; display: flex; align-items: center; gap: 10px;
      padding: 8px 8px 8px 14px; border-radius: 999px; background: #191c28; color: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.28);
      font: 600 12.5px/1.4 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif; white-space: nowrap; }
    .pick-bar kbd { display: inline-block; padding: 0 5px; border-radius: 4px; background: rgba(255,255,255,.16); font: 600 11px/18px ui-monospace, Menlo, monospace; }
    .pick-bar button { all: unset; cursor: pointer; padding: 4px 12px; border-radius: 999px; background: rgba(255,255,255,.14); font-weight: 700; }
    .pick-bar button:hover { background: rgba(255,255,255,.26); }
    .pick-bar .muted { color: rgba(255,255,255,.7); font-weight: 500; }
  `);

  const SECTION_TAGS = new Set(['SECTION', 'HEADER', 'FOOTER', 'ARTICLE', 'ASIDE', 'NAV', 'FORM']);
  let active = null;

  function snapSection(el) {
    const docH = Math.max(document.documentElement.scrollHeight, innerHeight);
    let best = el;
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const r = cur.getBoundingClientRect();
      if (docH > innerHeight * 1.5 && r.height > docH * 0.85) break;
      if (r.width >= innerWidth * 0.5 && r.height >= 60) best = cur;
      if (SECTION_TAGS.has(cur.tagName) && r.width >= innerWidth * 0.5) {
        best = cur;
        break;
      }
      cur = cur.parentElement;
    }
    return best;
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return `${s}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  function pick(opts) {
    const o = Object.assign({ mode: 'element', message: '選びたい要素をクリック' }, opts);
    if (active) active.finish(null);
    const L = P.layer('picker');
    L.textContent = '';
    const box = document.createElement('div');
    box.className = 'pick-box';
    const label = document.createElement('div');
    label.className = 'pick-label';
    const bar = document.createElement('div');
    bar.className = 'pick-bar';
    const msg = document.createElement('span');
    msg.textContent = o.message;
    const keys = document.createElement('span');
    keys.className = 'muted';
    for (const part of [['↑', '↓', ' 範囲 ・ '], ['Enter', ' 決定 ・ '], ['Esc', ' 中止']]) {
      const words = part.slice(0, -1);
      for (const w of words) {
        const k = document.createElement('kbd');
        k.textContent = w;
        keys.append(k);
      }
      keys.append(part[part.length - 1]);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'キャンセル';
    bar.append(msg, keys, cancel);
    L.append(box, label, bar);
    box.style.display = 'none';
    label.style.display = 'none';

    let base = null;
    let current = null;
    const trail = [];

    const show = () => {
      if (!current || !current.isConnected) {
        box.style.display = 'none';
        label.style.display = 'none';
        return;
      }
      const r = current.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      label.style.display = 'block';
      label.textContent = describe(current);
      label.style.left = `${Math.max(4, r.left)}px`;
      label.style.top = `${r.top > 28 ? r.top - 24 : Math.min(innerHeight - 24, r.bottom + 4)}px`;
    };

    const setFrom = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el || P.isOurs(el) || el === document.documentElement) return;
      if (el === base) return;
      base = el;
      trail.length = 0;
      current = o.mode === 'section' ? snapSection(el) : el;
      show();
    };

    return new Promise((resolve) => {
      const block = (e) => {
        if (P.isOurs(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      const onMove = (e) => setFrom(e.clientX, e.clientY);
      const onClick = (e) => {
        if (P.isOurs(e.target)) return;
        block(e);
        if (current) finish(current);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          block(e);
          finish(null);
        } else if (e.key === 'Enter' && current) {
          block(e);
          finish(current);
        } else if (e.key === 'ArrowUp' && current) {
          block(e);
          const parent = current.parentElement;
          if (parent && parent !== document.documentElement && parent !== document.body) {
            trail.push(current);
            current = parent;
            show();
          }
        } else if (e.key === 'ArrowDown' && current) {
          block(e);
          if (trail.length) current = trail.pop();
          else {
            const child = [...current.children].find((c) => c.getBoundingClientRect().height > 0);
            if (child) current = child;
          }
          show();
        }
      };
      const onScroll = () => show();
      const events = [
        ['mousemove', onMove],
        ['click', onClick],
        ['mousedown', block],
        ['mouseup', block],
        ['pointerdown', block],
        ['pointerup', block],
        ['dblclick', block],
        ['contextmenu', block],
        ['submit', block],
        ['keydown', onKey],
        ['scroll', onScroll],
      ];
      for (const [type, fn] of events) addEventListener(type, fn, { capture: true, passive: false });
      const prevCursor = document.documentElement.style.cursor;
      document.documentElement.style.cursor = 'crosshair';

      function finish(el) {
        for (const [type, fn] of events) removeEventListener(type, fn, { capture: true });
        document.documentElement.style.cursor = prevCursor;
        L.textContent = '';
        active = null;
        resolve(el);
      }
      cancel.addEventListener('click', (e) => {
        e.preventDefault();
        finish(null);
      });
      active = { finish };
    });
  }

  function cancel() {
    if (active) active.finish(null);
    return true;
  }

  WDT.picker = { pick, cancel, snapSection, isActive: () => !!active };
})(typeof globalThis !== 'undefined' ? globalThis : this);
