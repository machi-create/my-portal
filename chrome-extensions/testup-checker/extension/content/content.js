/*
 * テストアップチェッカー：ページ側の処理
 * - 原稿照合（runManuscript）
 * - 公開前チェック（runAccident）
 * - ハイライト・枠線・スクロール・通知
 * サイドパネル / バックグラウンドから chrome.scripting 経由で TUC.api.* が呼ばれる
 */
(() => {
  'use strict';
  const TUC = globalThis.TUC;
  if (!TUC || !TUC.normalize || !TUC.diff || !TUC.settings) return;
  if (TUC.api) return;

  const { loose, canon, key, letterCount } = TUC.normalize;
  const { diffChars } = TUC.diff;
  const S = TUC.settings;

  const ROOT_ID = 'tuc-overlay-root';
  const TOAST_ID = 'tuc-toast';
  const MAX_ITEMS = 60;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'CANVAS', 'TEXTAREA',
    'VIDEO', 'AUDIO', 'RT', 'RP', 'HEAD', 'TITLE',
  ]);
  const SVG_SKIP = new Set(['title', 'desc', 'style', 'script', 'metadata', 'defs', 'symbol', 'clipPath', 'mask', 'pattern']);
  const CHROME_SEL = [
    'header:not(article header):not(section header):not(main header)',
    'nav',
    'footer:not(article footer):not(section footer):not(main footer)',
    '[role="banner"]',
    '[role="navigation"]',
    '[role="contentinfo"]',
  ].join(',');

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clip = (s, n = 40) => {
    const a = Array.from(String(s));
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  };

  // ================================================================ 参照（クリックでスクロールする対象）
  const refs = new Map();
  let refSeq = 0;
  function addRef(group, target) {
    const id = `${group}:${++refSeq}`;
    refs.set(id, { group, target });
    return id;
  }

  // ================================================================ ハイライト（CSS Custom Highlight API）
  const HL = {
    ok: { name: 'tuc-ok', group: 'manuscript', priority: 1 },
    extra: { name: 'tuc-extra', group: 'manuscript', priority: 2 },
    variant: { name: 'tuc-variant', group: 'manuscript', priority: 3 },
    diff: { name: 'tuc-diff', group: 'manuscript', priority: 3 },
    accidentWarn: { name: 'tuc-accident-warn', group: 'accident', priority: 4 },
    accident: { name: 'tuc-accident', group: 'accident', priority: 5 },
  };
  const hlStore = Object.fromEntries(Object.keys(HL).map((k) => [k, []]));
  const visible = { manuscript: true, ok: true, accident: true };
  const canHighlight = typeof Highlight === 'function' && typeof CSS !== 'undefined' && !!CSS.highlights;

  function applyHighlights() {
    if (!canHighlight) return;
    for (const [key, def] of Object.entries(HL)) {
      const ranges = hlStore[key];
      const show = visible[def.group] && (key !== 'ok' || visible.ok) && ranges.length > 0;
      if (!show) {
        CSS.highlights.delete(def.name);
        continue;
      }
      const h = new Highlight();
      for (const r of ranges) h.add(r);
      h.priority = def.priority;
      CSS.highlights.set(def.name, h);
    }
  }

  // ================================================================ 枠線（画像やリンクなど要素単位の指摘）
  let boxes = [];
  let rafId = 0;

  function overlayRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(root);
    }
    return root;
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

  function place(el, rect, pad) {
    el.style.left = `${rect.left + scrollX - pad}px`;
    el.style.top = `${rect.top + scrollY - pad}px`;
    el.style.width = `${rect.width + pad * 2}px`;
    el.style.height = `${rect.height + pad * 2}px`;
  }

  function renderBoxes() {
    const root = overlayRoot();
    let layer = root.querySelector('.tuc-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'tuc-layer';
      root.appendChild(layer);
    }
    layer.textContent = '';
    if (!visible.accident || !boxes.length) return;
    const frag = document.createDocumentFragment();
    for (const b of boxes) {
      const rect = rectOf(b.target);
      if (!rect) continue;
      const el = document.createElement('div');
      el.className = `tuc-box tuc-sev-${b.sev}`;
      place(el, rect, 3);
      if (b.label) {
        const tag = document.createElement('span');
        tag.className = 'tuc-box-label';
        if (rect.top + scrollY < 24) tag.classList.add('tuc-inside');
        tag.textContent = b.label;
        el.appendChild(tag);
      }
      frag.appendChild(el);
    }
    layer.appendChild(frag);
  }

  function scheduleRender() {
    if (rafId || !boxes.length) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderBoxes();
    });
  }
  addEventListener('scroll', scheduleRender, { passive: true, capture: true });
  addEventListener('resize', scheduleRender, { passive: true });

  function addBox(target, sev, label, group) {
    boxes.push({ target, sev, label: label || '', group });
  }

  // ================================================================ スクロールと点滅
  let flashTimer = 0;
  function flash(list) {
    const root = overlayRoot();
    root.querySelectorAll('.tuc-focus-box').forEach((n) => n.remove());
    const rect = rectOf(list);
    if (rect) {
      const el = document.createElement('div');
      el.className = 'tuc-focus-box';
      place(el, rect, 5);
      root.appendChild(el);
    }
    const ranges = list.filter((x) => x instanceof Range);
    if (canHighlight && ranges.length) {
      const h = new Highlight(...ranges);
      h.priority = 10;
      CSS.highlights.set('tuc-focus', h);
    }
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      root.querySelectorAll('.tuc-focus-box').forEach((n) => n.remove());
      if (canHighlight) CSS.highlights.delete('tuc-focus');
    }, 2600);
  }

  async function focus(args) {
    const ref = refs.get(args && args.refId);
    if (!ref) return { ok: false, reason: 'gone' };
    const list = (Array.isArray(ref.target) ? ref.target : [ref.target]).filter(Boolean);
    const first = list[0];
    const node = first instanceof Range ? first.startContainer : first;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || !el.isConnected) return { ok: false, reason: 'gone' };
    if (isHiddenNow(el)) return { ok: true, hidden: true };
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

  // ================================================================ ページのテキストモデル
  function parentComposed(n) {
    const p = n.parentNode;
    if (!p) return null;
    if (p.nodeType === 11) return p.host || null;
    return p.nodeType === 1 ? p : null;
  }

  function computeHidden(el, displayOf) {
    let cur = el;
    while (cur && displayOf(cur) === 'contents') cur = parentComposed(cur);
    if (!cur) return false;
    if (typeof cur.checkVisibility === 'function') {
      return !cur.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
    }
    const cs = getComputedStyle(cur);
    return cs.visibility === 'hidden' || cur.getClientRects().length === 0;
  }

  function makeCtx() {
    const displayCache = new Map();
    const hiddenCache = new Map();
    const displayOf = (el) => {
      let d = displayCache.get(el);
      if (d === undefined) {
        d = getComputedStyle(el).display;
        displayCache.set(el, d);
      }
      return d;
    };
    const hiddenOf = (el) => {
      let h = hiddenCache.get(el);
      if (h === undefined) {
        h = computeHidden(el, displayOf);
        hiddenCache.set(el, h);
      }
      return h;
    };
    return { displayOf, hiddenOf };
  }

  function isHiddenNow(el) {
    const cache = new Map();
    return computeHidden(el, (x) => {
      let d = cache.get(x);
      if (d === undefined) cache.set(x, (d = getComputedStyle(x).display));
      return d;
    });
  }

  function walkText(roots, visit) {
    const stack = [];
    for (let k = roots.length - 1; k >= 0; k--) stack.push(roots[k]);
    while (stack.length) {
      const n = stack.pop();
      const type = n.nodeType;
      if (type === 3) {
        visit(n);
        continue;
      }
      if (type === 1) {
        if (n.namespaceURI === SVG_NS ? SVG_SKIP.has(n.localName) : SKIP_TAGS.has(n.tagName)) continue;
        if (n.id === ROOT_ID || n.id === TOAST_ID) continue;
      } else if (type !== 11 && type !== 9) continue;
      const kids = n.childNodes;
      for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
      if (type === 1 && n.shadowRoot) {
        const sk = n.shadowRoot.childNodes;
        for (let k = sk.length - 1; k >= 0; k--) stack.push(sk[k]);
      }
    }
  }

  function blockOf(ctx, el) {
    let cur = el;
    while (cur) {
      const d = ctx.displayOf(cur);
      if (d !== 'inline' && d !== 'contents') return cur;
      cur = parentComposed(cur);
    }
    return el;
  }

  /** テキストノードを「ブロック要素」単位にまとめる */
  function buildModel(roots, includeHidden) {
    const ctx = makeCtx();
    const blocks = [];
    const byEl = new Map();
    walkText(roots, (tn) => {
      const data = tn.data;
      if (!data || !/\S/.test(data)) return;
      const parent = parentComposed(tn);
      if (!parent) return;
      const hidden = ctx.hiddenOf(parent);
      if (hidden && !includeHidden) return;
      const el = blockOf(ctx, parent);
      let b = byEl.get(el);
      if (!b) {
        b = { el, raw: '', segs: [], hidden: true };
        byEl.set(el, b);
        blocks.push(b);
      }
      b.segs.push({ node: tn, start: b.raw.length, len: data.length, hidden });
      b.raw += data;
      if (!hidden) b.hidden = false;
    });
    return { blocks, ctx };
  }

  function indexLoose(model) {
    let text = '';
    const starts = new Array(model.blocks.length);
    model.blocks.forEach((b, i) => {
      const L = loose(b.raw);
      b.loose = L.text;
      b.lmap = L.map;
      b.gStart = text.length;
      starts[i] = b.gStart;
      text += L.text;
    });
    model.text = text;
    model.starts = starts;
  }

  function blockAt(model, g) {
    const s = model.starts;
    let lo = 0;
    let hi = s.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= g) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  const TRAIL_MARK_RE = /[゙゚ﾞﾟ̀-ͯ]/;
  function rawEnd(raw, i) {
    let e = i + ((raw.codePointAt(i) || 0) > 0xffff ? 2 : 1);
    while (e < raw.length && TRAIL_MARK_RE.test(raw[e])) e++;
    return e;
  }

  function locate(b, idx, isEnd) {
    const segs = b.segs;
    let lo = 0;
    let hi = segs.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const ok = isEnd ? segs[mid].start < idx : segs[mid].start <= idx;
      if (ok) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const s = segs[ans];
    return { node: s.node, offset: Math.max(0, Math.min(s.len, idx - s.start)) };
  }

  function rangeFromRaw(b, rs, re) {
    try {
      const a = locate(b, rs, false);
      const z = locate(b, re, true);
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(z.node, z.offset);
      return r.collapsed ? null : r;
    } catch (e) {
      return null;
    }
  }

  function segsHidden(b, rs, re) {
    for (const s of b.segs) {
      if (s.start + s.len <= rs || s.start >= re) continue;
      if (!s.hidden) return false;
    }
    return true;
  }

  /** ゆるい正規化後の通し位置 [gs, ge) を、ブロックごとの Range とテキストに戻す */
  function piecesOf(model, gs, ge) {
    const out = [];
    let g = gs;
    while (g < ge) {
      const b = model.blocks[blockAt(model, g)];
      const ls = g - b.gStart;
      const le = Math.min(ge - b.gStart, b.loose.length);
      if (le <= ls) break;
      const rs = b.lmap[ls];
      const re = rawEnd(b.raw, b.lmap[le - 1]);
      out.push({ range: rangeFromRaw(b, rs, re), text: b.raw.slice(rs, re), hidden: segsHidden(b, rs, re) });
      g = b.gStart + le;
    }
    return out;
  }

  function resolveRoots(scope) {
    const base = document.body || document.documentElement;
    scope = String(scope || '').trim();
    if (!scope) return [base];
    let list;
    try {
      list = [...document.querySelectorAll(scope)];
    } catch (e) {
      throw new Error(`照合範囲のセレクタ「${scope}」が正しくありません`);
    }
    if (!list.length) throw new Error(`照合範囲「${scope}」に一致する要素がページ内にありません`);
    return list.filter((el) => !list.some((o) => o !== el && o.contains(el)));
  }

  // ================================================================ 原稿照合
  function findAll(text, pat, limit) {
    const out = [];
    let p = text.indexOf(pat);
    while (p !== -1 && out.length < limit) {
      out.push(p);
      p = text.indexOf(pat, p + pat.length);
    }
    return out;
  }

  function bigrams(s) {
    const set = new Set();
    for (let j = 0; j + 1 < s.length; j++) set.add(s.substr(j, 2));
    return set;
  }

  function buildBigramIndex(blocks) {
    const index = new Map();
    blocks.forEach((b, bi) => {
      for (const g of bigrams(b.loose)) {
        let arr = index.get(g);
        if (!arr) index.set(g, (arr = []));
        arr.push(bi);
      }
    });
    return index;
  }

  function candidateBlocks(index, pat, limit) {
    const grams = bigrams(pat);
    const counts = new Map();
    for (const g of grams) {
      const arr = index.get(g);
      if (!arr || arr.length > 3000) continue;
      for (const bi of arr) counts.set(bi, (counts.get(bi) || 0) + 1);
    }
    const min = Math.max(1, Math.ceil(grams.size * 0.4));
    return [...counts]
      .filter(([, c]) => c >= min)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([bi]) => bi);
  }

  /** 準大域アラインメント：pat 全体と、text の一部区間との編集距離が最小になる区間を探す */
  function semiGlobal(pat, text) {
    const m = pat.length;
    const n = text.length;
    let prevD = new Int32Array(n + 1);
    let prevS = new Int32Array(n + 1);
    let curD = new Int32Array(n + 1);
    let curS = new Int32Array(n + 1);
    for (let j = 0; j <= n; j++) prevS[j] = j;
    for (let i = 1; i <= m; i++) {
      curD[0] = i;
      curS[0] = 0;
      const pc = pat.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        let d = prevD[j - 1] + (pc === text.charCodeAt(j - 1) ? 0 : 1);
        let s = prevS[j - 1];
        const up = prevD[j] + 1;
        if (up < d) {
          d = up;
          s = prevS[j];
        }
        const left = curD[j - 1] + 1;
        if (left < d) {
          d = left;
          s = curS[j - 1];
        }
        curD[j] = d;
        curS[j] = s;
      }
      [prevD, curD] = [curD, prevD];
      [prevS, curS] = [curS, prevS];
    }
    let best = 0;
    for (let j = 1; j <= n; j++) if (prevD[j] < prevD[best]) best = j;
    return { dist: prevD[best], start: prevS[best], end: best };
  }

  function alignIn(pat, text) {
    const m = pat.length;
    const W = 2 * m + 40;
    let offset = 0;
    let t = text;
    if (t.length > W + m) {
      // 長いブロックは、共通の2文字組が最も多い窓に絞ってから比較する
      const grams = bigrams(pat);
      const hit = new Uint8Array(t.length);
      for (let j = 0; j + 1 < t.length; j++) hit[j] = grams.has(t.substr(j, 2)) ? 1 : 0;
      let sum = 0;
      for (let j = 0; j < W; j++) sum += hit[j];
      let bestSum = sum;
      let bestJ = 0;
      for (let j = W; j < t.length; j++) {
        sum += hit[j] - hit[j - W];
        if (sum > bestSum) {
          bestSum = sum;
          bestJ = j - W + 1;
        }
      }
      offset = Math.max(0, bestJ - 10);
      t = t.slice(offset, offset + W + 20);
    }
    const r = semiGlobal(pat, t);
    return { dist: r.dist, start: r.start + offset, end: r.end + offset };
  }

  function coveredRatio(covered, gs, ge) {
    if (ge <= gs) return 1;
    let c = 0;
    for (let k = gs; k < ge; k++) if (covered[k]) c++;
    return c / (ge - gs);
  }

  function collectVirtuals(roots, ctx, includeHidden) {
    const list = [];
    const push = (label, text, el, hidden) => {
      text = String(text || '').trim();
      if (!text) return;
      const L = loose(text);
      if (!L.text) return;
      list.push({ label, text, el: el || null, hidden: !!hidden, loose: L.text, lmap: L.map });
    };
    const meta = (sel) => {
      const m = document.querySelector(sel);
      return m ? m.getAttribute('content') : '';
    };
    push('title', document.title);
    push('description', meta('meta[name="description" i]'));
    push('og:title', meta('meta[property="og:title" i]'));
    push('og:description', meta('meta[property="og:description" i]'));
    for (const root of roots) {
      const scan = (sel, label, getText) => {
        for (const el of root.querySelectorAll(sel)) {
          const hidden = ctx.hiddenOf(el);
          if (hidden && !includeHidden) continue;
          push(label, getText(el), el, hidden);
        }
      };
      scan('img[alt], area[alt], input[type="image" i][alt]', '画像alt', (el) => el.getAttribute('alt'));
      scan('input[type="submit" i][value], input[type="button" i][value], input[type="reset" i][value]', 'ボタン', (el) => el.value);
      scan('input[placeholder], textarea[placeholder]', 'placeholder', (el) => el.getAttribute('placeholder'));
    }
    return list;
  }

  function virtualSlice(v, ls, le) {
    return v.text.slice(v.lmap[ls], rawEnd(v.text, v.lmap[le - 1]));
  }

  function clearGroup(group) {
    if (group === 'manuscript') {
      for (const k of ['ok', 'variant', 'diff', 'extra']) hlStore[k] = [];
    } else {
      hlStore.accident = [];
      hlStore.accidentWarn = [];
    }
    boxes = boxes.filter((b) => b.group !== group && !(group === 'accident' && b.group === 'links'));
    for (const [id, r] of refs) {
      if (r.group === group || (group === 'accident' && r.group === 'links')) refs.delete(id);
    }
    applyHighlights();
    renderBoxes();
  }

  function runManuscript(args) {
    const t0 = performance.now();
    const segments = (args && args.segments) || [];
    const opt = Object.assign(
      { scope: '', excludeHidden: false, detectExtras: true, excludeChrome: true, threshold: 0.6, minExtraLetters: 4 },
      args && args.options
    );
    clearGroup('manuscript');

    const roots = resolveRoots(opt.scope);
    const model = buildModel(roots, !opt.excludeHidden);
    indexLoose(model);
    const G = model.text;
    const covered = new Uint8Array(G.length);
    const virtuals = collectVirtuals(roots, model.ctx, !opt.excludeHidden);
    const items = [];
    const pending = [];

    const prepared = segments
      .map((s, i) => ({ idx: i, text: s.text, line: s.line, col: s.col, loose: loose(s.text).text, canon: canon(s.text), key: key(s.text) }))
      .filter((s) => s.loose.length > 0);

    const makeItem = (seg, status, extra) =>
      Object.assign({ id: seg.idx, status, text: seg.canon, line: seg.line, col: seg.col, where: 'page', hidden: false, count: 1, refId: null }, extra);

    // 1) 完全一致（ゆるい正規化で一致 → 厳密に一致なら「一致」、違えば「表記ゆれ」）
    for (const seg of prepared) {
      const occ = findAll(G, seg.loose, 200);
      if (occ.length) {
        let best = null;
        for (const p of occ) {
          const ps = piecesOf(model, p, p + seg.loose.length);
          const pageText = canon(ps.map((x) => x.text).join(''));
          const strict = key(pageText) === seg.key;
          const hidden = ps.every((x) => x.hidden);
          const ranges = ps.map((x) => x.range).filter(Boolean);
          covered.fill(1, p, p + seg.loose.length);
          (strict ? hlStore.ok : hlStore.variant).push(...ranges);
          const score = (strict ? 2 : 0) + (hidden ? 0 : 1);
          if (!best || score > best.score) best = { score, strict, hidden, pageText, ranges };
        }
        items.push(
          makeItem(seg, best.strict ? 'ok' : 'variant', {
            page: best.pageText,
            diff: best.strict ? null : diffChars(seg.canon, best.pageText),
            hidden: best.hidden,
            count: occ.length,
            refId: best.ranges.length ? addRef('manuscript', best.ranges) : null,
          })
        );
        continue;
      }
      const v = virtuals.find((x) => x.loose.includes(seg.loose));
      if (v) {
        const ls = v.loose.indexOf(seg.loose);
        const pageText = canon(virtualSlice(v, ls, ls + seg.loose.length));
        const strict = key(pageText) === seg.key;
        items.push(
          makeItem(seg, strict ? 'ok' : 'variant', {
            page: pageText,
            diff: strict ? null : diffChars(seg.canon, pageText),
            where: v.label,
            hidden: v.hidden,
            refId: v.el ? addRef('manuscript', v.el) : null,
          })
        );
        continue;
      }
      pending.push(seg);
    }

    // 2) あいまい一致（似ている箇所 → 「文言差分」）
    let index = null;
    for (const seg of pending) {
      let best = null;
      if (seg.loose.length >= 4 && seg.loose.length <= 2000) {
        index = index || buildBigramIndex(model.blocks);
        for (const bi of candidateBlocks(index, seg.loose, 4)) {
          const b = model.blocks[bi];
          const m = alignIn(seg.loose, b.loose);
          if (m.end <= m.start) continue;
          const gs = b.gStart + m.start;
          const ge = b.gStart + m.end;
          if (coveredRatio(covered, gs, ge) >= 0.5) continue;
          const sim = 1 - m.dist / seg.loose.length;
          if (!best || sim > best.sim) best = { sim, gs, ge };
        }
        for (const v of virtuals) {
          if (v.loose.length < 2) continue;
          const m = alignIn(seg.loose, v.loose);
          if (m.end <= m.start) continue;
          const sim = 1 - m.dist / seg.loose.length;
          if (!best || sim > best.sim) best = { sim, v, ls: m.start, le: m.end };
        }
      }
      if (best && best.sim >= opt.threshold) {
        if (best.v) {
          const pageText = canon(virtualSlice(best.v, best.ls, best.le));
          items.push(
            makeItem(seg, 'diff', {
              page: pageText,
              diff: diffChars(seg.canon, pageText),
              similarity: best.sim,
              where: best.v.label,
              hidden: best.v.hidden,
              refId: best.v.el ? addRef('manuscript', best.v.el) : null,
            })
          );
        } else {
          const ps = piecesOf(model, best.gs, best.ge);
          const pageText = canon(ps.map((x) => x.text).join(''));
          const ranges = ps.map((x) => x.range).filter(Boolean);
          covered.fill(2, best.gs, best.ge);
          hlStore.diff.push(...ranges);
          items.push(
            makeItem(seg, 'diff', {
              page: pageText,
              diff: diffChars(seg.canon, pageText),
              similarity: best.sim,
              hidden: ps.every((x) => x.hidden),
              refId: ranges.length ? addRef('manuscript', ranges) : null,
            })
          );
        }
      } else {
        let hint = null;
        if (best && best.sim >= 0.4 && !best.v) {
          const ps = piecesOf(model, best.gs, best.ge);
          const ranges = ps.map((x) => x.range).filter(Boolean);
          hint = { text: canon(ps.map((x) => x.text).join('')), refId: ranges.length ? addRef('manuscript', ranges) : null };
        }
        items.push(makeItem(seg, 'missing', { hint }));
      }
    }
    items.sort((a, b) => a.id - b.id);

    // 3) ページにあって原稿にない文言
    const extras = [];
    if (opt.detectExtras) {
      for (const b of model.blocks) {
        if (b.hidden || !b.loose.length || extras.length >= 300) continue;
        if (opt.excludeChrome && b.el.closest && b.el.closest(CHROME_SEL)) continue;
        const L = b.loose.length;
        let k = 0;
        while (k < L) {
          if (covered[b.gStart + k]) {
            k++;
            continue;
          }
          let e = k;
          while (e < L && !covered[b.gStart + e]) e++;
          if (letterCount(b.loose.slice(k, e)) >= opt.minExtraLetters) {
            const ps = piecesOf(model, b.gStart + k, b.gStart + e).filter((x) => !x.hidden);
            const text = canon(ps.map((x) => x.text).join(''));
            const ranges = ps.map((x) => x.range).filter(Boolean);
            if (text && ranges.length) {
              hlStore.extra.push(...ranges);
              extras.push({ id: `x${extras.length}`, status: 'extra', text, refId: addRef('manuscript', ranges) });
            }
          }
          k = e;
        }
      }
    }

    applyHighlights();
    const count = (st) => items.filter((i) => i.status === st).length;
    const summary = {
      total: items.length,
      ok: count('ok'),
      variant: count('variant'),
      diff: count('diff'),
      missing: count('missing'),
      extra: extras.length,
    };
    summary.found = summary.ok + summary.variant + summary.diff;
    summary.rate = summary.total ? Math.round((summary.found / summary.total) * 1000) / 10 : 0;
    return {
      url: location.href,
      title: document.title,
      summary,
      items,
      extras,
      blocks: model.blocks.length,
      elapsed: Math.round(performance.now() - t0),
      highlightSupported: canHighlight,
    };
  }

  // ================================================================ 公開前チェック
  const SEV_ORDER = { error: 0, warn: 1, info: 2, ok: 3 };

  const DUMMY_STRONG = [
    { re: /テキスト(?:[\s　]*テキスト)+/g, label: 'ダミー文言' },
    { re: /ダミー(?:テキスト|文章|コピー|原稿|画像)/g, label: 'ダミーテキスト' },
    { re: /仮(?:テキスト|原稿|コピー|タイトル|見出し|文言|画像)|[（(【[]\s*仮\s*[）)】\]]/g, label: '「仮」の表記' },
    { re: /lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipiscing/gi, label: 'Lorem ipsum' },
    { re: /[○◯〇]{2,}|[×✕]{2,}|△{2,}|□{3,}/g, label: '伏せ字' },
    { re: /(?<![A-Za-z0-9])[XxＸｘ]{3,}(?![A-Za-z0-9])/g, label: '伏せ字（XXX）' },
    { re: /\b(?:hoge|fuga|piyo)\b/gi, label: 'hoge / fuga' },
    { re: /テスト(?:投稿|記事|ページ|です|テキスト)|\btest\s+(?:post|page|text)\b/gi, label: 'テスト用の文言' },
    { re: /Hello world!|Sample Page|サンプルページ|Just another WordPress (?:site|サイト)|これは最初の投稿です/gi, label: 'WordPressの初期コンテンツ' },
    { re: /(?:TODO|FIXME)\b|要確認|要差し?替え?|差し?替え?予定|後日差し?替え?|あとで差し?替え?|※修正|※仮/g, label: '作業メモの消し忘れ' },
    { re: /([あアaａ])\1{3,}/g, label: '仮入力（ああああ等）' },
    { re: /(?<![\d-])0\d{1,4}-0{2,4}-0{3,4}(?![\d-])|(?<![\d-])0{3}-0{4}-0{4}(?![\d-])/g, label: 'ダミーの電話番号' },
    { re: /〒\s*000-0000|(?<![\d-])000-0000(?![\d-])/g, label: 'ダミーの郵便番号' },
    { re: /\b(?:test|sample|dummy|hoge|foo)\d*@[\w.-]+|[\w.+-]+@(?:[\w-]+\.)*example\.(?:com|net|org|jp|co\.jp)\b/gi, label: 'ダミーのメールアドレス' },
  ];
  const DUMMY_WEAK = [
    { re: /ダミー/g, label: '「ダミー」' },
    { re: /準備中|工事中|近日公開|coming\s*soon|under\s*construction/gi, label: '準備中・近日公開' },
    { re: /(?<![\d-])(?:0\d{1,3}-)?1234-5678(?![\d-])|(?<![\d-])012-345-6789(?![\d-])|〒\s*123-4567/g, label: '仮っぽい番号' },
  ];
  const PLACEHOLDER_HOST_RE =
    /(?:^|\.)(?:placehold\.(?:co|it|jp)|placeholder\.com|dummyimage\.(?:com|jp)|picsum\.photos|loremflickr\.com|placekitten\.com|placeimg\.com|fakeimg\.pl|lorempixel\.com|unsplash\.it|source\.unsplash\.com|placebear\.com|baconmockup\.com|placecats\.com)$/i;
  const PLACEHOLDER_FILE_RE =
    /(?:^|[_\-.])(?:dummy|kari|tmp|temp|sample|placeholder|noimage|no[_-]?image|now[_-]?printing|test)(?=[_\-.\d]|$)/i;
  const URL_ATTRS = [
    ['a[href]', 'href'],
    ['area[href]', 'href'],
    ['img[src]', 'src'],
    ['img[srcset]', 'srcset'],
    ['source[src]', 'src'],
    ['source[srcset]', 'srcset'],
    ['script[src]', 'src'],
    ['link[href]', 'href'],
    ['iframe[src]', 'src'],
    ['form[action]', 'action'],
    ['video[src]', 'src'],
    ['video[poster]', 'poster'],
    ['audio[src]', 'src'],
    ['embed[src]', 'src'],
    ['object[data]', 'data'],
    ['meta[property="og:url" i]', 'content'],
    ['meta[property="og:image" i]', 'content'],
    ['meta[name="twitter:image" i]', 'content'],
  ];

  function compactify(b) {
    if (b.compact !== undefined) return;
    let s = '';
    const map = [];
    for (let i = 0; i < b.raw.length; i++) {
      const c = b.raw[i];
      if (c === '\n' || c === '\r' || c === '\t' || c === '\f') continue;
      if (c === ' ' && s.endsWith(' ')) continue;
      s += c;
      map.push(i);
    }
    b.compact = s;
    b.cmap = map;
  }

  function scanBlocks(ctx, re, fn) {
    for (const b of ctx.model.blocks) {
      compactify(b);
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(b.compact))) {
        if (!m[0]) {
          re.lastIndex++;
          continue;
        }
        const cs = m.index;
        const ce = m.index + m[0].length;
        const rs = b.cmap[cs];
        const rEnd = b.cmap[ce - 1] + 1;
        fn(b, m, rangeFromRaw(b, rs, rEnd), segsHidden(b, rs, rEnd), cs, ce);
      }
    }
  }

  function shortUrl(u) {
    if (/^data:/i.test(u)) return '（埋め込み画像 data:）';
    if (/^blob:/i.test(u)) return '（blob画像）';
    try {
      const x = new URL(u, location.href);
      return x.host === location.host ? x.pathname + x.search : x.host + x.pathname + x.search;
    } catch (e) {
      return String(u);
    }
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return `画像 ${clip(shortUrl(el.currentSrc || el.getAttribute('src') || ''), 60)}`;
    if (tag === 'a' || tag === 'area') {
      const label = canon(el.textContent) || el.getAttribute('aria-label') || el.getAttribute('title') || (el.querySelector('img[alt]') || {}).alt || '（テキストなし）';
      return `リンク「${clip(label, 24)}」`;
    }
    if (tag === 'meta') return `<meta ${el.getAttribute('property') || el.getAttribute('name') || ''}>`;
    if (tag === 'link') return `<link rel="${el.getAttribute('rel') || ''}">`;
    if (tag === 'script') return '<script>';
    if (tag === 'form') return 'フォームの送信先';
    return `<${tag}>`;
  }

  function isRendered(el) {
    return el.isConnected && !['HEAD', 'META', 'LINK', 'SCRIPT', 'STYLE', 'TITLE'].includes(el.tagName) && !!el.closest('body');
  }

  function makeChecker(ctx) {
    const item = {
      el(el, text, sev, label) {
        const rendered = isRendered(el);
        const hidden = rendered ? ctx.model.ctx.hiddenOf(el) : false;
        if (!ctx.silent && rendered && !hidden && (sev === 'error' || sev === 'warn')) addBox(el, sev, label, 'accident');
        return { text: text + (hidden ? '（非表示の要素）' : ''), refId: !ctx.silent && rendered ? addRef('accident', el) : null, hidden };
      },
      range(range, text, sev, hidden) {
        if (range && !ctx.silent) (sev === 'error' ? hlStore.accident : hlStore.accidentWarn).push(range);
        return { text: text + (hidden ? '（非表示の要素）' : ''), refId: !ctx.silent && range ? addRef('accident', range) : null, hidden: !!hidden };
      },
      text(text) {
        return { text, refId: null, hidden: false };
      },
    };
    const add = (c) => {
      const items = c.items || [];
      ctx.checks.push(Object.assign({ msg: '', total: items.length }, c, { items: items.slice(0, MAX_ITEMS) }));
    };
    return { item, add };
  }

  async function headRequest(url, timeout) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout || 4000);
    try {
      return await fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'include', signal: ac.signal });
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- SEO・メタ情報
  async function checkMeta(ctx, { item, add }) {
    const env = ctx.env;
    const metaContent = (sel) => {
      const m = document.querySelector(sel);
      return m ? (m.getAttribute('content') || '').trim() : null;
    };

    // robots / noindex
    const robots = [...document.querySelectorAll('meta[name]')].filter((m) => /^(?:robots|googlebot)$/i.test(m.getAttribute('name')));
    const content = robots.map((m) => (m.getAttribute('content') || '').toLowerCase()).join(',');
    const res = await headRequest(location.href);
    const header = res ? (res.headers.get('x-robots-tag') || '').toLowerCase() : '';
    const noindex = /\bnoindex\b|\bnone\b/.test(content) || /\bnoindex\b|\bnone\b/.test(header);
    const nofollow = /\bnofollow\b|\bnone\b/.test(`${content},${header}`);
    const where = [];
    if (content) where.push(item.text(`<meta name="robots" content="${content}">`));
    if (header) where.push(item.text(`X-Robots-Tag: ${header}`));
    if (env === 'production') {
      if (noindex) add({ id: 'robots', cat: 'meta', sev: 'error', title: 'noindex が設定されています', msg: '本番環境では検索結果に表示されなくなります。公開時に削除してください。', items: where });
      else if (nofollow) add({ id: 'robots', cat: 'meta', sev: 'warn', title: 'nofollow が設定されています', msg: '意図した設定か確認してください。', items: where });
      else add({ id: 'robots', cat: 'meta', sev: 'ok', title: 'noindex は設定されていません' });
    } else if (env === 'staging') {
      if (noindex) add({ id: 'robots', cat: 'meta', sev: 'ok', title: 'テスト環境に noindex が設定されています', items: where });
      else add({ id: 'robots', cat: 'meta', sev: 'warn', title: 'テスト環境に noindex がありません', msg: 'Basic認証などで保護されていない場合、検索エンジンに登録されるおそれがあります。' });
    } else if (noindex) {
      add({ id: 'robots', cat: 'meta', sev: 'warn', title: 'noindex が設定されています', msg: '本番公開時は削除が必要です（テスト環境なら問題ありません）。設定でドメインを登録すると正確に判定できます。', items: where });
    } else {
      add({ id: 'robots', cat: 'meta', sev: 'ok', title: 'noindex は設定されていません' });
    }

    // title
    const title = (document.title || '').trim();
    if (!title) add({ id: 'title', cat: 'meta', sev: 'error', title: 'title が設定されていません', msg: 'ブラウザのタブや検索結果に表示されるページ名です。' });
    else add({ id: 'title', cat: 'meta', sev: 'ok', title: `title：${clip(title, 48)}`, items: [item.text(`${Array.from(title).length}文字`)] });

    // description
    const desc = metaContent('meta[name="description" i]');
    if (!desc) add({ id: 'description', cat: 'meta', sev: 'warn', title: 'meta description が設定されていません', msg: '検索結果に表示される説明文です。' });
    else add({ id: 'description', cat: 'meta', sev: 'ok', title: 'meta description が設定されています', items: [item.text(`${clip(desc, 80)}（${Array.from(desc).length}文字）`)] });

    // OGP
    const og = {
      'og:title': metaContent('meta[property="og:title" i]'),
      'og:description': metaContent('meta[property="og:description" i]'),
      'og:image': metaContent('meta[property="og:image" i]'),
      'og:url': metaContent('meta[property="og:url" i]'),
    };
    const missing = Object.keys(og).filter((k) => !og[k]);
    const relativeImage = !!og['og:image'] && !/^https?:\/\//i.test(og['og:image']);
    const ogItems = [];
    if (relativeImage) ogItems.push(item.text(`og:image が相対パスです：${og['og:image']}`));
    if (!metaContent('meta[name="twitter:card" i]')) ogItems.push(item.text('twitter:card がありません（Xでのカード表示）'));
    if (missing.length) {
      add({ id: 'ogp', cat: 'meta', sev: 'warn', title: `OGPが不足しています（${missing.join(' / ')}）`, msg: 'SNSでシェアされたときのタイトル・説明・画像になります。', items: ogItems });
    } else if (relativeImage) {
      add({ id: 'ogp', cat: 'meta', sev: 'warn', title: 'og:image は絶対URLで指定してください', msg: '相対パスだとSNSで画像が表示されないことがあります。', items: ogItems });
    } else {
      add({ id: 'ogp', cat: 'meta', sev: 'ok', title: 'OGP（title / description / image / url）が設定されています', items: ogItems });
    }

    // canonical / og:url の参照先
    const canonEl = document.querySelector('link[rel="canonical" i]');
    const targets = [];
    if (canonEl && canonEl.getAttribute('href')) targets.push(['canonical', canonEl.getAttribute('href')]);
    if (og['og:url']) targets.push(['og:url', og['og:url']]);
    if (!canonEl) add({ id: 'canonical-missing', cat: 'meta', sev: 'info', title: 'canonical が設定されていません', msg: '同じ内容のURLが複数ある場合は設定をおすすめします。' });
    const curLevel = S.stagingLevel(location.hostname, ctx.settings, location.port);
    for (const [label, value] of targets) {
      let u;
      try {
        u = new URL(value, document.baseURI);
      } catch (e) {
        add({ id: `ref-${label}`, cat: 'meta', sev: 'warn', title: `${label} のURLが正しくありません`, items: [item.text(value)] });
        continue;
      }
      const lvl = S.stagingLevel(u.hostname, ctx.settings, u.port);
      if (S.isExampleHost(u.hostname)) {
        add({ id: `ref-${label}`, cat: 'meta', sev: 'error', title: `${label} がダミーのURL（example）です`, items: [item.text(u.href)] });
      } else if (u.host !== location.host) {
        if (lvl >= 2) add({ id: `ref-${label}`, cat: 'meta', sev: env === 'production' ? 'error' : 'warn', title: `${label} がテスト環境のURLを指しています`, msg: '本番では本番URLになっているか確認してください。', items: [item.text(u.href)] });
        else if (env === 'production') add({ id: `ref-${label}`, cat: 'meta', sev: 'warn', title: `${label} が別のドメインを指しています`, msg: '意図した設定か確認してください。', items: [item.text(u.href)] });
        else add({ id: `ref-${label}`, cat: 'meta', sev: 'info', title: `${label} は ${u.host} を指しています`, msg: '本番のURLであれば問題ありません。', items: [item.text(u.href)] });
      } else if (env === 'staging' || curLevel >= 2) {
        add({ id: `ref-${label}`, cat: 'meta', sev: 'warn', title: `${label} がテスト環境のURLのままです`, msg: '公開時に本番URLへ置き換わるか確認してください。', items: [item.text(u.href)] });
      } else {
        add({ id: `ref-${label}`, cat: 'meta', sev: 'ok', title: `${label} は現在のドメインを指しています`, items: [item.text(u.href)] });
      }
    }

    // 基本タグ
    const basics = [];
    if (!document.documentElement.getAttribute('lang')) basics.push(item.text('<html lang="ja"> の lang がありません'));
    if (!document.querySelector('meta[name="viewport" i]')) basics.push(item.text('meta viewport がありません（スマホで縮小表示になります）'));
    if (basics.length) add({ id: 'basics', cat: 'meta', sev: 'warn', title: '基本のタグが不足しています', items: basics });
    else add({ id: 'basics', cat: 'meta', sev: 'ok', title: 'lang・viewport が設定されています' });

    // favicon
    if (document.querySelector('link[rel~="icon" i], link[rel="apple-touch-icon" i]')) {
      add({ id: 'favicon', cat: 'meta', sev: 'ok', title: 'ファビコンが設定されています' });
    } else {
      const fav = await headRequest(new URL('/favicon.ico', location.origin).href);
      const ok = fav && fav.ok && /image|icon|octet/i.test(fav.headers.get('content-type') || '');
      if (ok) add({ id: 'favicon', cat: 'meta', sev: 'ok', title: 'ファビコン（/favicon.ico）があります' });
      else add({ id: 'favicon', cat: 'meta', sev: 'warn', title: 'ファビコンが見つかりません', msg: 'タブやブックマークに表示されるアイコンです。' });
    }

    // h1
    const h1s = [...document.querySelectorAll('h1')];
    if (!h1s.length) add({ id: 'h1', cat: 'meta', sev: 'warn', title: 'h1 がありません', msg: 'ページの主見出しを h1 でマークアップすることをおすすめします。' });
    else if (h1s.length > 1) add({ id: 'h1', cat: 'meta', sev: 'info', title: `h1 が${h1s.length}個あります`, msg: '意図した構成か確認してください。', items: h1s.map((h) => item.el(h, clip(canon(h.textContent) || '（空）', 40), 'info')) });
    else add({ id: 'h1', cat: 'meta', sev: 'ok', title: `h1：${clip(canon(h1s[0].textContent) || '（空）', 40)}`, items: [item.el(h1s[0], 'h1 の位置を表示', 'ok')] });
  }

  // ---------------------------------------------------------------- ダミー・仮素材
  function checkDummy(ctx, { item, add }) {
    const strong = [];
    const weak = [];
    const taken = new Map();
    for (const p of DUMMY_STRONG) {
      scanBlocks(ctx, p.re, (b, m, range, hidden, cs, ce) => {
        const list = taken.get(b) || [];
        if (list.some(([s, e]) => cs < e && ce > s)) return;
        list.push([cs, ce]);
        taken.set(b, list);
        strong.push(item.range(range, `${p.label}：「${clip(m[0], 30)}」`, 'error', hidden));
      });
    }
    for (const p of DUMMY_WEAK) {
      scanBlocks(ctx, p.re, (b, m, range, hidden, cs, ce) => {
        const list = taken.get(b) || [];
        if (list.some(([s, e]) => cs < e && ce > s)) return;
        list.push([cs, ce]);
        taken.set(b, list);
        weak.push(item.range(range, `${p.label}：「${clip(m[0], 30)}」`, 'warn', hidden));
      });
    }
    // 属性やメタ情報に入ったダミー
    const attrTargets = [];
    const meta = (sel, label) => {
      const m = document.querySelector(sel);
      if (m && m.getAttribute('content')) attrTargets.push({ label, text: m.getAttribute('content'), el: null });
    };
    attrTargets.push({ label: 'title', text: document.title || '', el: null });
    meta('meta[name="description" i]', 'description');
    meta('meta[property="og:title" i]', 'og:title');
    meta('meta[property="og:description" i]', 'og:description');
    for (const el of document.querySelectorAll('[alt], [title], [placeholder], [aria-label]')) {
      for (const attr of ['alt', 'title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(attr);
        if (v) attrTargets.push({ label: attr, text: v, el });
      }
    }
    for (const t of attrTargets) {
      for (const p of DUMMY_STRONG) {
        p.re.lastIndex = 0;
        const m = p.re.exec(t.text);
        if (!m) continue;
        const text = `${p.label}（${t.label}）：「${clip(m[0], 30)}」`;
        strong.push(t.el ? item.el(t.el, text, 'error', 'ダミー') : item.text(text));
        break;
      }
    }
    if (strong.length) add({ id: 'dummy-text', cat: 'dummy', sev: 'error', title: `ダミー・仮の文言が${strong.length}件あります`, msg: '公開前に正式な原稿へ差し替えてください。', items: strong });
    else add({ id: 'dummy-text', cat: 'dummy', sev: 'ok', title: 'ダミー・仮の文言は見つかりませんでした' });
    if (weak.length) add({ id: 'dummy-weak', cat: 'dummy', sev: 'warn', title: `確認が必要な文言が${weak.length}件あります`, msg: '「準備中」「ダミー」など、意図して載せているものか確認してください。', items: weak });
  }

  // ---------------------------------------------------------------- 画像
  function checkImages(ctx, { item, add }) {
    const placeholder = [];
    const dummyName = [];
    const noAlt = [];
    const broken = [];
    const heavy = [];
    const srcsOf = (img) => {
      const list = [img.currentSrc, img.getAttribute('src')];
      const srcset = img.getAttribute('srcset');
      if (srcset) for (const part of srcset.split(',')) list.push(part.trim().split(/\s+/)[0]);
      return list.filter(Boolean);
    };
    const classify = (src) => {
      try {
        const u = new URL(src, document.baseURI);
        if (u.protocol === 'data:' || u.protocol === 'blob:') return null;
        if (PLACEHOLDER_HOST_RE.test(u.hostname)) return 'host';
        const file = decodeURIComponent(u.pathname.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
        if (PLACEHOLDER_FILE_RE.test(file)) return 'file';
      } catch (e) {
        /* 解析できないURLは無視 */
      }
      return null;
    };
    for (const img of document.querySelectorAll('img')) {
      const kinds = srcsOf(img).map(classify);
      const name = describe(img);
      if (kinds.includes('host')) placeholder.push(item.el(img, name, 'error', '仮画像'));
      else if (kinds.includes('file')) dummyName.push(item.el(img, name, 'warn', '仮画像?'));
      const decorative = img.getAttribute('aria-hidden') === 'true' || /^(?:presentation|none)$/i.test(img.getAttribute('role') || '');
      const tiny = img.complete && img.naturalWidth <= 2 && img.naturalHeight <= 2 && img.naturalWidth > 0;
      if (!img.hasAttribute('alt') && !decorative && !tiny) noAlt.push(item.el(img, name, 'warn', 'altなし'));
      if (img.complete && img.naturalWidth === 0 && (img.currentSrc || img.getAttribute('src'))) broken.push(item.el(img, name, 'error', '表示されない画像'));
      else if (img.complete && img.naturalWidth >= 1600 && !/\.svg(?:[?#]|$)/i.test(img.currentSrc || '')) {
        const w = img.getBoundingClientRect().width;
        if (w > 0 && img.naturalWidth > w * Math.max(2, devicePixelRatio) * 1.5) {
          heavy.push(item.el(img, `${name}（${img.naturalWidth}px の画像を ${Math.round(w)}px で表示）`, 'info'));
        }
      }
    }
    for (const el of document.querySelectorAll('[style*="url("]')) {
      const style = el.getAttribute('style') || '';
      for (const m of style.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
        const kind = classify(m[2]);
        if (kind === 'host') placeholder.push(item.el(el, `背景画像 ${clip(shortUrl(m[2]), 60)}`, 'error', '仮画像'));
        else if (kind === 'file') dummyName.push(item.el(el, `背景画像 ${clip(shortUrl(m[2]), 60)}`, 'warn', '仮画像?'));
      }
    }
    for (const v of document.querySelectorAll('video[poster]')) {
      const kind = classify(v.getAttribute('poster'));
      if (kind === 'host') placeholder.push(item.el(v, `動画のポスター画像 ${clip(shortUrl(v.getAttribute('poster')), 60)}`, 'error', '仮画像'));
    }

    if (placeholder.length) add({ id: 'img-placeholder', cat: 'image', sev: 'error', title: `仮画像サービスの画像が${placeholder.length}件あります`, msg: 'placehold.jp・dummyimage.com などのダミー画像です。', items: placeholder });
    else add({ id: 'img-placeholder', cat: 'image', sev: 'ok', title: '仮画像サービスの画像はありません' });
    if (dummyName.length) add({ id: 'img-dummy-name', cat: 'image', sev: 'warn', title: `仮っぽいファイル名の画像が${dummyName.length}件あります`, msg: 'dummy・sample・noimage・nowprinting などを含むファイル名です。', items: dummyName });
    if (broken.length) add({ id: 'img-broken', cat: 'image', sev: 'error', title: `表示されていない画像が${broken.length}件あります`, msg: '画像のパスが間違っているか、ファイルがアップロードされていません。', items: broken });
    else add({ id: 'img-broken', cat: 'image', sev: 'ok', title: '読み込みに失敗した画像はありません' });
    if (noAlt.length) add({ id: 'img-alt', cat: 'image', sev: 'warn', title: `alt属性のない画像が${noAlt.length}件あります`, msg: '装飾目的なら alt="" を、意味のある画像なら内容を表す文言を入れてください。', items: noAlt });
    else add({ id: 'img-alt', cat: 'image', sev: 'ok', title: 'すべての画像に alt 属性があります' });
    if (heavy.length) add({ id: 'img-heavy', cat: 'image', sev: 'info', title: `表示サイズに対して大きすぎる画像が${heavy.length}件あります`, msg: '書き出しサイズを見直すと表示が速くなります。', items: heavy });
  }

  // ---------------------------------------------------------------- リンク・URL
  function checkLinks(ctx, { item, add }) {
    const env = ctx.env;
    const curHost = location.host;
    const curLevel = S.stagingLevel(location.hostname, ctx.settings, location.port);
    const stagingRefs = [];
    const exampleRefs = [];
    const absolute = [];
    const mixed = [];
    let maxStagingSev = 'info';
    const seen = new Set();

    for (const [sel, attr] of URL_ATTRS) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest(`#${ROOT_ID}, #${TOAST_ID}`)) continue;
        const raw = el.getAttribute(attr);
        if (!raw) continue;
        const urls = attr === 'srcset' ? raw.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) : [raw.trim()];
        for (const r of urls) {
          if (/^(?:data|blob|about|javascript|mailto|tel|sms|#)/i.test(r)) continue;
          let u;
          try {
            u = new URL(r, document.baseURI);
          } catch (e) {
            continue;
          }
          if (!/^https?:$/.test(u.protocol)) continue;
          const key = `${attr}|${u.href}`;
          const firstTime = !seen.has(key);
          seen.add(key);
          const label = `${describe(el)} → ${clip(u.href, 70)}`;
          const isAbs = /^(?:https?:)?\/\//i.test(r);
          if (u.host !== curHost) {
            if (S.isExampleHost(u.hostname)) {
              if (firstTime || isRendered(el)) exampleRefs.push(item.el(el, label, 'error', 'example'));
            } else {
              const lvl = S.stagingLevel(u.hostname, ctx.settings, u.port);
              if (lvl >= 1) {
                let sev;
                if (env === 'production') sev = lvl >= 2 ? 'error' : 'warn';
                else sev = lvl >= 2 ? 'warn' : 'info';
                if (SEV_ORDER[sev] < SEV_ORDER[maxStagingSev]) maxStagingSev = sev;
                stagingRefs.push(item.el(el, label, sev, 'テスト環境URL'));
              }
            }
          } else if (isAbs && curLevel >= 2 && firstTime) {
            absolute.push(item.text(`${describe(el)} → ${clip(u.href, 70)}`));
          }
          if (location.protocol === 'https:' && u.protocol === 'http:' && (u.host === curHost || !['A', 'AREA'].includes(el.tagName))) {
            mixed.push(item.el(el, label, 'warn', 'http://'));
          }
        }
      }
    }

    // 未設定のリンク
    const empty = [];
    for (const a of document.querySelectorAll('a')) {
      if (a.closest(`#${ROOT_ID}, #${TOAST_ID}`)) continue;
      const isToggle =
        a.hasAttribute('aria-controls') || a.hasAttribute('aria-expanded') || a.hasAttribute('aria-haspopup') ||
        a.getAttribute('role') === 'button' || a.hasAttribute('data-toggle') || a.hasAttribute('data-bs-toggle') || a.hasAttribute('data-target');
      if (isToggle) continue;
      const href = a.getAttribute('href');
      if (href === null) {
        if (a.hasAttribute('name') || a.id || !canon(a.textContent)) continue;
        empty.push(item.el(a, `${describe(a)}（href なし）`, 'warn', 'リンク未設定'));
      } else {
        const h = href.trim();
        if (h === '' || h === '#' || /^javascript:\s*(?:void\s*\(\s*0\s*\)\s*;?|;)?\s*$/i.test(h)) {
          empty.push(item.el(a, `${describe(a)}（href="${clip(h, 20)}"）`, 'warn', 'リンク未設定'));
        }
      }
    }

    // 電話番号・メールアドレスのリンク
    const tel = [];
    let telSev = 'ok';
    let telCount = 0;
    for (const a of document.querySelectorAll('a[href^="tel:" i]')) {
      telCount++;
      let num = a.getAttribute('href').slice(4);
      try {
        num = decodeURIComponent(num);
      } catch (e) {
        /* そのまま使う */
      }
      const digits = num.normalize('NFKC').replace(/\D/g, '');
      const shown = canon(a.textContent).normalize('NFKC').replace(/\D/g, '');
      if (/^0+$/.test(digits.slice(-8)) || /0000-?0000/.test(num)) {
        tel.push(item.el(a, `ダミーの電話番号：tel:${num}`, 'error', '電話番号'));
        telSev = 'error';
      } else if (!/^[\d+\-()]+$/.test(num)) {
        tel.push(item.el(a, `全角・空白などが含まれています：tel:${num}`, 'warn', '電話番号'));
        if (telSev !== 'error') telSev = 'warn';
      } else if (shown.length >= 9 && digits && shown !== digits) {
        tel.push(item.el(a, `表示「${clip(canon(a.textContent), 20)}」とリンク先 tel:${num} が違います`, 'warn', '電話番号'));
        if (telSev !== 'error') telSev = 'warn';
      }
    }
    const mail = [];
    let mailCount = 0;
    for (const a of document.querySelectorAll('a[href^="mailto:" i]')) {
      mailCount++;
      let addr = a.getAttribute('href').slice(7).split('?')[0];
      try {
        addr = decodeURIComponent(addr);
      } catch (e) {
        /* そのまま使う */
      }
      for (const one of addr.split(',')) {
        const [local, domain] = one.trim().toLowerCase().split('@');
        if (!domain) continue;
        if (/^(?:test|sample|dummy|hoge|foo)\d*$/.test(local) || S.isExampleHost(domain)) {
          mail.push(item.el(a, `ダミーのメールアドレス：${one.trim()}`, 'error', 'メール'));
        }
      }
      const shown = canon(a.textContent);
      if (/@/.test(shown) && addr && shown.toLowerCase() !== addr.trim().toLowerCase()) {
        mail.push(item.el(a, `表示「${clip(shown, 30)}」とリンク先 ${addr} が違います`, 'warn', 'メール'));
      }
    }

    if (stagingRefs.length) {
      add({ id: 'link-staging', cat: 'link', sev: maxStagingSev, title: `テスト環境・ローカルのURLが${stagingRefs.length}件あります`, msg: env === 'production' ? '本番ページからテスト環境やローカルを参照しています。本番URLに差し替えてください。' : '本番公開時に本番URLへ切り替わるか確認してください。', items: stagingRefs });
    } else {
      add({ id: 'link-staging', cat: 'link', sev: 'ok', title: 'テスト環境・ローカルのURLは含まれていません' });
    }
    if (exampleRefs.length) add({ id: 'link-example', cat: 'link', sev: 'error', title: `ダミーのURL（example.com など）が${exampleRefs.length}件あります`, items: exampleRefs });
    else add({ id: 'link-example', cat: 'link', sev: 'ok', title: 'ダミーのURL（example.com など）はありません' });
    if (empty.length) add({ id: 'link-empty', cat: 'link', sev: 'warn', title: `リンク先が未設定のリンクが${empty.length}件あります`, msg: 'href="#" や href の無いリンクです。JavaScriptで動くボタンなら問題ありません。', items: empty });
    else add({ id: 'link-empty', cat: 'link', sev: 'ok', title: 'リンク先が未設定のリンクはありません' });
    if (telCount) {
      if (tel.length) add({ id: 'link-tel', cat: 'link', sev: telSev, title: `電話番号リンクに問題が${tel.length}件あります`, items: tel });
      else add({ id: 'link-tel', cat: 'link', sev: 'ok', title: `電話番号リンク（${telCount}件）に問題はありません` });
    }
    if (mailCount) {
      if (mail.length) add({ id: 'link-mail', cat: 'link', sev: mail.some((m) => m.text.startsWith('ダミー')) ? 'error' : 'warn', title: `メールアドレスのリンクに問題が${mail.length}件あります`, items: mail });
      else add({ id: 'link-mail', cat: 'link', sev: 'ok', title: `メールアドレスのリンク（${mailCount}件）に問題はありません` });
    }
    if (location.protocol === 'https:') {
      if (mixed.length) add({ id: 'link-mixed', cat: 'link', sev: 'warn', title: `http:// の読み込み・リンクが${mixed.length}件あります`, msg: 'HTTPSのページで http:// の画像やスクリプトを読み込むと、表示されなかったり警告が出たりします。', items: mixed });
      else add({ id: 'link-mixed', cat: 'link', sev: 'ok', title: 'http:// の混在はありません' });
    }
    if (absolute.length) {
      add({ id: 'link-absolute', cat: 'link', sev: 'info', title: `テスト環境のドメインが絶対URLで${absolute.length}件書かれています`, msg: '本番への移行時にドメインが置き換わる仕組みになっているか確認してください。', items: absolute });
    }
  }

  // ---------------------------------------------------------------- 計測タグ
  function checkTags(ctx, { item, add }) {
    const found = new Map();
    const sources = [];
    for (const s of document.scripts) sources.push(s.src || (s.textContent || '').slice(0, 60000));
    for (const n of document.querySelectorAll('noscript')) sources.push((n.textContent || '').slice(0, 5000));
    for (const f of document.querySelectorAll('iframe[src]')) sources.push(f.src);
    const text = sources.join('\n');
    const google = sources.filter((s) => /gtag|googletagmanager|google-analytics|dataLayer/i.test(s)).join('\n');
    const rules = [
      ['GA4', /\bG-[A-Z0-9]{6,12}\b/g, google],
      ['GTM', /\bGTM-[A-Z0-9]{4,9}\b/g, google],
      ['UA（旧GA）', /\bUA-\d{4,10}-\d{1,4}\b/g, google],
      ['Google広告', /\bAW-\d{6,12}\b/g, google],
      ['Metaピクセル', /fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g, text, 1],
      ['Microsoft Clarity', /clarity\.ms\/tag\/([a-z0-9]{6,14})/gi, text, 1],
    ];
    for (const [kind, re, src, group] of rules) {
      for (const m of src.matchAll(re)) found.set(group ? m[group] : m[0], kind);
    }
    if (/yjads|ytag\(|s\.yimg\.jp\/images\/listing\/tool\/cv/i.test(text)) found.set('（ID不明）', 'Yahoo!広告');
    const list = [...found].map(([id, kind]) => item.text(`${kind}：${id}`));
    const hasGoogle = [...found.values()].some((k) => k === 'GA4' || k === 'GTM' || k === 'UA（旧GA）');
    ctx.tags = [...found].map(([id, kind]) => ({ id, kind }));

    if ([...found.values()].includes('UA（旧GA）')) {
      add({ id: 'tag-ua', cat: 'tag', sev: 'warn', title: '旧Googleアナリティクス（UA）のタグが残っています', msg: 'UAは計測を終了しています。GA4に移行済みなら削除してください。', items: list.filter((i) => i.text.startsWith('UA')) });
    }
    if (ctx.env === 'production') {
      if (!hasGoogle) add({ id: 'tag-ga', cat: 'tag', sev: 'warn', title: '計測タグ（GA4 / GTM）が見つかりません', msg: 'アクセス解析を入れる予定なら、設置漏れがないか確認してください。', items: list });
      else add({ id: 'tag-ga', cat: 'tag', sev: 'ok', title: '計測タグが設置されています', msg: '本番用のIDになっているか確認してください。', items: list });
    } else if (ctx.env === 'staging') {
      if (found.size) add({ id: 'tag-ga', cat: 'tag', sev: 'info', title: 'テスト環境で計測タグが動いています', msg: '本番用のIDの場合、テスト中のアクセスが本番データに混ざります。', items: list });
      else add({ id: 'tag-ga', cat: 'tag', sev: 'info', title: '計測タグは見つかりませんでした', msg: '本番公開時に設置が必要か確認してください。' });
    } else if (found.size) {
      add({ id: 'tag-ga', cat: 'tag', sev: 'info', title: `計測タグを${found.size}件検出しました`, msg: '意図したIDか確認してください。', items: list });
    } else {
      add({ id: 'tag-ga', cat: 'tag', sev: 'info', title: '計測タグは見つかりませんでした' });
    }
  }

  // ---------------------------------------------------------------- 表記・誤字
  function checkText(ctx, { item, add }) {
    const zenkaku = [];
    const hankakuKana = [];
    const typo = [];
    const visibleBlocks = { model: { blocks: ctx.model.blocks.filter((b) => !b.hidden) } };
    scanBlocks(visibleBlocks, /[Ａ-Ｚａ-ｚ０-９]+/g, (b, m, range, hidden) => {
      zenkaku.push(item.range(range, `「${clip(m[0], 20)}」`, 'info', hidden));
    });
    scanBlocks(visibleBlocks, /[ｦ-ﾟ]+/g, (b, m, range, hidden) => {
      hankakuKana.push(item.range(range, `「${clip(m[0], 20)}」`, 'warn', hidden));
    });
    scanBlocks(visibleBlocks, /。。|、、|，，|．．|をを|がが/g, (b, m, range, hidden) => {
      const ctxText = b.compact.slice(Math.max(0, m.index - 8), m.index + m[0].length + 8);
      typo.push(item.range(range, `「${m[0]}」… ${clip(ctxText, 24)}`, 'warn', hidden));
    });
    const all = visibleBlocks.model.blocks.map((b) => b.compact).join('\n');
    const mix = [];
    if (/、/.test(all) && /，/.test(all)) mix.push(item.text('読点「、」と「，」が混在しています'));
    if (/。/.test(all) && /．/.test(all)) mix.push(item.text('句点「。」と「．」が混在しています'));

    if (typo.length) add({ id: 'text-typo', cat: 'text', sev: 'warn', title: `誤字の可能性がある箇所が${typo.length}件あります`, msg: '「。。」「をを」など、同じ文字の重複です。', items: typo });
    else add({ id: 'text-typo', cat: 'text', sev: 'ok', title: '重複した句読点・助詞は見つかりませんでした' });
    if (hankakuKana.length) add({ id: 'text-hankaku-kana', cat: 'text', sev: 'warn', title: `半角カタカナが${hankakuKana.length}件あります`, msg: '全角カタカナへの統一をおすすめします。', items: hankakuKana });
    if (zenkaku.length) add({ id: 'text-zenkaku', cat: 'text', sev: 'info', title: `全角の英数字が${zenkaku.length}件あります`, msg: '表記ルールで半角に統一している場合は修正してください。', items: zenkaku });
    if (mix.length) add({ id: 'text-punct', cat: 'text', sev: 'info', title: '句読点の種類が混在しています', items: mix });
  }

  // ---------------------------------------------------------------- 表示・法務
  function checkLegal(ctx, { item, add }) {
    // ©の年
    let last = null;
    scanBlocks(ctx, /(?:©|ⓒ|\([cC]\)|copyright)[^\d\n]{0,24}((?:19|20)\d{2})(?:\s*[-–—~〜‐]\s*((?:19|20)\d{2}))?/gi, (b, m, range, hidden) => {
      last = { year: Math.max(Number(m[1]), Number(m[2] || 0)), text: m[0], range, hidden };
    });
    if (last) {
      if (last.year < ctx.year) add({ id: 'legal-copyright', cat: 'legal', sev: 'info', title: `©の年表記が${last.year}年です`, msg: '最新の年にするか確認してください（創業年などを意図的に表記しているなら問題ありません）。', items: [item.range(last.range, clip(canon(last.text), 40), 'info', last.hidden)] });
      else add({ id: 'legal-copyright', cat: 'legal', sev: 'ok', title: `©の年表記は${last.year}年です` });
    } else {
      add({ id: 'legal-copyright', cat: 'legal', sev: 'info', title: 'コピーライト表記が見つかりません' });
    }

    // No.1・最上級表記
    const claims = [];
    scanBlocks(ctx, /No\.?\s?[1１](?![0-9０-９])|ナンバー?ワン|(?<![0-9０-９])[1１]位|満足度\s?[0-9０-９.]+\s?[%％]|業界(?:初|最大|最安|No\.?\s?1|トップ)|(?:日本|世界)初|地域最安|最安値/gi, (b, m, range, hidden) => {
      claims.push(item.range(range, `「${clip(m[0], 20)}」… ${clip(b.compact, 36)}`, 'warn', hidden));
    });
    if (claims.length) {
      const all = ctx.model.blocks.map((b) => b.compact).join('\n');
      const hasNote = /※[^\n]{0,80}?(?:調査|調べ|出典|期間|対象|当社比|(?:19|20)\d{2}年)/.test(all);
      add({
        id: 'legal-no1',
        cat: 'legal',
        sev: hasNote ? 'info' : 'warn',
        title: `No.1・最上級の表記が${claims.length}件あります`,
        msg: hasNote
          ? '根拠の注釈（※〇〇調べ・調査期間など）が近くにあるか確認してください。'
          : '根拠を示す注釈（※調査機関・調査期間など）が見当たりません。景品表示法の観点で確認してください。',
        items: claims,
      });
    }

    // フォームとプライバシーポリシー
    const hasForm = [...document.querySelectorAll('form')].some(
      (f) => f.getAttribute('role') !== 'search' && f.querySelector('input:not([type="hidden" i]):not([type="search" i]):not([type="submit" i]):not([type="button" i]), textarea, select')
    );
    if (hasForm) {
      const privacy = [...document.querySelectorAll('a[href]')].some((a) => /privacy|プライバシー|個人情報/i.test(`${a.textContent} ${a.getAttribute('href')}`));
      if (privacy) add({ id: 'legal-privacy', cat: 'legal', sev: 'ok', title: 'フォームとプライバシーポリシーへのリンクがあります' });
      else add({ id: 'legal-privacy', cat: 'legal', sev: 'warn', title: 'フォームがありますが、プライバシーポリシーへのリンクが見つかりません', msg: '個人情報を取得するフォームには、取り扱い方針への導線を置くのが一般的です。' });
    }
  }

  async function runAccident(args) {
    const t0 = performance.now();
    const opt = Object.assign({ env: 'unknown', settings: S.DEFAULTS, silent: false, year: new Date().getFullYear() }, args);
    // silent（バックグラウンドの自動チェック）はページ上の表示に触れない
    if (!opt.silent) clearGroup('accident');
    const ctx = {
      env: opt.env,
      settings: Object.assign({}, S.DEFAULTS, opt.settings),
      silent: !!opt.silent,
      year: opt.year,
      model: buildModel([document.body || document.documentElement], true),
      checks: [],
      tags: [],
    };
    const checker = makeChecker(ctx);
    checkDummy(ctx, checker);
    checkLinks(ctx, checker);
    checkImages(ctx, checker);
    checkTags(ctx, checker);
    checkText(ctx, checker);
    checkLegal(ctx, checker);
    await checkMeta(ctx, checker);

    ctx.checks.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
    const summary = { error: 0, warn: 0, info: 0, ok: 0 };
    for (const c of ctx.checks) summary[c.sev]++;
    if (!ctx.silent) {
      applyHighlights();
      renderBoxes();
    }
    return {
      url: location.href,
      title: document.title,
      env: ctx.env,
      checks: ctx.checks,
      summary,
      tags: ctx.tags,
      elapsed: Math.round(performance.now() - t0),
    };
  }

  // ================================================================ リンク切れチェック用
  function collectLinks(args) {
    const limit = (args && args.limit) || 150;
    const map = new Map();
    for (const a of document.querySelectorAll('a[href], area[href]')) {
      if (a.closest(`#${ROOT_ID}, #${TOAST_ID}`)) continue;
      let u;
      try {
        u = new URL(a.getAttribute('href'), document.baseURI);
      } catch (e) {
        continue;
      }
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = '';
      if (u.href === location.href.split('#')[0]) continue;
      if (!map.has(u.href)) map.set(u.href, { url: u.href, label: describe(a), refId: addRef('links', a), internal: u.host === location.host });
    }
    const all = [...map.values()];
    all.sort((a, b) => Number(b.internal) - Number(a.internal));
    return { links: all.slice(0, limit), total: all.length };
  }

  function mark(args) {
    for (const m of (args && args.items) || []) {
      const ref = refs.get(m.refId);
      if (ref && ref.target instanceof Element && isRendered(ref.target)) addBox(ref.target, m.sev, m.label, 'links');
    }
    renderBoxes();
    return true;
  }

  // ================================================================ 通知
  function showToast(args) {
    const opt = Object.assign({ title: '', message: '', sev: 'error' }, args);
    const old = document.getElementById(TOAST_ID);
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = TOAST_ID;
    el.className = `tuc-sev-${opt.sev}`;
    el.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'tuc-toast-icon';
    icon.textContent = '!';
    const body = document.createElement('span');
    body.className = 'tuc-toast-body';
    const strong = document.createElement('span');
    strong.className = 'tuc-toast-title';
    strong.textContent = opt.title;
    const p = document.createElement('span');
    p.className = 'tuc-toast-msg';
    p.textContent = opt.message;
    body.append(strong, p);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tuc-toast-close';
    close.setAttribute('aria-label', '閉じる');
    close.textContent = '×';
    close.addEventListener('click', () => el.remove());
    el.append(icon, body, close);
    document.documentElement.appendChild(el);
    requestAnimationFrame(() => el.classList.add('tuc-show'));
    setTimeout(() => el.remove(), 15000);
    return true;
  }

  // ================================================================ API
  TUC.api = {
    ping() {
      return { url: location.href, title: document.title, highlightSupported: canHighlight };
    },
    runManuscript,
    runAccident,
    focus,
    collectLinks,
    mark,
    showToast,
    setVisibility(args) {
      Object.assign(visible, args || {});
      applyHighlights();
      renderBoxes();
      return { ...visible };
    },
    clear(args) {
      const group = args && args.group;
      if (!group || group === 'manuscript') clearGroup('manuscript');
      if (!group || group === 'accident') clearGroup('accident');
      if (!group) {
        const toast = document.getElementById(TOAST_ID);
        if (toast) toast.remove();
      }
      return true;
    },
  };
})();
