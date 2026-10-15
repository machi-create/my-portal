/*
 * LP抑揚グラフ：グラフの描画（サイドパネル用・縦向き）
 *   上がページの上端、下がページの下端。1行＝画面の半分。
 *   - 文字量と画像の割合は単位が違うので、同じ縦軸を共有する2つのグラフに分ける（2軸にしない）
 *   - 比較は、同じ目盛りで並べた小さなグラフ（スモールマルチプル）
 */
(function (root) {
  'use strict';
  const LR = (root.LR = root.LR || {});
  const { svg, h } = root.WDT.ui;
  const R = LR.rhythm;

  const ROW = 12; // 棒の太さ
  const GAP = 2; // 棒と棒の間（背景色のすき間）
  const PITCH = ROW + GAP;
  const AXIS_W = 40;
  const LANE_W = 26;
  const HEAD_H = 34;

  /** 右端だけ角丸の横棒（根元は四角） */
  function barPath(x, y, w, hgt, r) {
    if (w <= 0) return '';
    r = Math.min(r, w, hgt / 2);
    return `M${x} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + hgt - r}Q${x + w} ${y + hgt} ${x + w - r} ${y + hgt}H${x}Z`;
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
    return 10 * p;
  }

  function tooltip(container) {
    let tip = container.querySelector('.lr-tip');
    if (!tip) {
      tip = h('div', { class: 'lr-tip', role: 'status' });
      container.append(tip);
    }
    return tip;
  }

  function showTip(container, tip, x, y, rows) {
    tip.textContent = '';
    for (const r of rows) {
      if (r.head) tip.append(h('div', { class: 'lr-tip-head' }, r.head));
      else tip.append(h('div', { class: 'lr-tip-row' }, r.key ? h('i', { class: `lr-key ${r.key}` }) : null, h('b', null, r.value), h('span', null, r.label)));
    }
    tip.hidden = false;
    const cw = container.clientWidth;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(cw - tw - 4, x + 12))}px`;
    tip.style.top = `${y + 14}px`;
  }

  function binItems(m, i) {
    const a = i * m.binH;
    const b = (i + 1) * m.binH;
    return {
      ctas: m.ctas.filter((c) => c.y >= a && c.y < b),
      headings: m.headings.filter((x) => x.y >= a && x.y < b),
    };
  }

  /** 1つのLPの抑揚グラフ */
  function renderSingle(container, m, opts) {
    const o = Object.assign({ zones: [], onRow: null }, opts);
    container.textContent = '';
    container.classList.add('lr-chart');
    const W = Math.max(280, container.clientWidth || 340);
    const n = m.bins.length;
    const colGap = 14;
    const colW = Math.floor((W - AXIS_W - LANE_W - colGap * 2) / 2);
    const x1 = AXIS_W + LANE_W + colGap;
    const x2 = x1 + colW + colGap;
    const H = HEAD_H + n * PITCH + 6;
    const maxChars = niceMax(Math.max(...m.bins.map((b) => b.chars), 1));
    const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'ページ位置ごとの文字量と画像の割合' });

    // 見出し（各グラフのタイトルと目盛りの範囲）
    s.append(
      svg('text', { x: AXIS_W, y: 13, class: 'lr-col-title' }, 'CTA'),
      svg('text', { x: x1, y: 13, class: 'lr-col-title' }, '文字量'),
      svg('text', { x: x1, y: 27, class: 'lr-col-sub' }, `0〜${maxChars.toLocaleString('ja-JP')}字`),
      svg('text', { x: x2, y: 13, class: 'lr-col-title' }, '画像の割合'),
      svg('text', { x: x2, y: 27, class: 'lr-col-sub' }, '0〜100%')
    );

    // 気づきの区間（背景の帯）
    for (const z of o.zones) {
      const y0 = HEAD_H + (z.from / R.BIN_SCREENS) * PITCH;
      const y1 = HEAD_H + (z.to / R.BIN_SCREENS) * PITCH;
      // 棒を見やすく保つため、帯は左の目印の列だけに引く
      s.append(svg('rect', { x: AXIS_W - 4, y: y0, width: LANE_W + 4, height: Math.max(PITCH, y1 - y0), class: 'lr-zone' }));
      s.append(svg('rect', { x: AXIS_W - 4, y: y0, width: 3, height: Math.max(PITCH, y1 - y0), class: 'lr-zone-edge' }));
    }

    // 1画面ごとの目盛り線と軸ラベル
    for (let i = 0; i <= n; i += 2) {
      const y = HEAD_H + i * PITCH - GAP / 2;
      s.append(svg('line', { x1: AXIS_W, x2: W, y1: y, y2: y, class: i === 0 ? 'lr-base' : 'lr-grid' }));
      if (i < n) s.append(svg('text', { x: AXIS_W - 8, y: y + PITCH + 1, class: 'lr-tick', 'text-anchor': 'end' }, `${i / 2}`));
    }
    s.append(svg('text', { x: AXIS_W - 8, y: 27, class: 'lr-col-sub', 'text-anchor': 'end' }, '画面'));
    s.append(svg('line', { x1: x1, x2: x1, y1: HEAD_H - 2, y2: H - 4, class: 'lr-base' }));
    s.append(svg('line', { x1: x2, x2: x2, y1: HEAD_H - 2, y2: H - 4, class: 'lr-base' }));

    // 棒
    m.bins.forEach((b, i) => {
      const y = HEAD_H + i * PITCH;
      s.append(svg('path', { d: barPath(x1, y, (b.chars / maxChars) * colW, ROW, 4), class: 'lr-text' }));
      s.append(svg('path', { d: barPath(x2, y, b.image * colW, ROW, 4), class: 'lr-image' }));
    });

    // 見出しの位置（短い線）と CTA の位置（点）
    for (const hd of m.headings) {
      const y = HEAD_H + (hd.y / m.binH) * PITCH;
      if (y > H) continue;
      s.append(svg('line', { x1: AXIS_W + 4, x2: AXIS_W + 4 + (hd.level === 1 ? 14 : hd.level === 2 ? 10 : 6), y1: y, y2: y, class: 'lr-heading' }));
    }
    for (const c of m.ctas) {
      const y = HEAD_H + (c.y / m.binH) * PITCH;
      if (y > H) continue;
      s.append(svg('circle', { cx: AXIS_W + LANE_W - 6, cy: y, r: 4.5, class: 'lr-cta' }));
    }

    // ホバーとクリックの当たり判定（行全体）
    const tip = tooltip(container);
    const hit = svg('rect', { x: 0, y: HEAD_H, width: W, height: n * PITCH, class: 'lr-hit' });
    const hover = svg('rect', { x: AXIS_W, y: HEAD_H, width: W - AXIS_W, height: PITCH, class: 'lr-hover', visibility: 'hidden' });
    s.append(hover, hit);
    const rowAt = (ev) => {
      const pt = s.getBoundingClientRect();
      return Math.max(0, Math.min(n - 1, Math.floor((ev.clientY - pt.top - HEAD_H) / PITCH)));
    };
    hit.addEventListener('pointermove', (ev) => {
      const i = rowAt(ev);
      const b = m.bins[i];
      const it = binItems(m, i);
      hover.setAttribute('y', HEAD_H + i * PITCH - GAP / 2);
      hover.setAttribute('visibility', 'visible');
      const rows = [{ head: R.binLabel(i) }, { key: 'text', value: `${b.chars.toLocaleString('ja-JP')}字`, label: '文字量' }, { key: 'image', value: `${Math.round(b.image * 100)}%`, label: '画像の割合' }];
      for (const c of it.ctas) rows.push({ key: 'cta', value: c.label, label: 'ボタン' });
      for (const x of it.headings) rows.push({ key: 'heading', value: x.text, label: `H${x.level}` });
      const box = container.getBoundingClientRect();
      showTip(container, tip, ev.clientX - box.left, ev.clientY - box.top, rows);
    });
    hit.addEventListener('pointerleave', () => {
      hover.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    });
    hit.addEventListener('click', (ev) => {
      if (o.onRow) o.onRow(rowAt(ev));
    });
    container.append(s);
    tip.hidden = true;
  }

  /** 比較：同じ目盛りで並べた文字量のグラフ（CTAは点） */
  function renderCompare(container, list) {
    container.textContent = '';
    container.classList.add('lr-chart');
    const W = Math.max(280, container.clientWidth || 340);
    const k = list.length;
    const n = Math.max(...list.map((x) => x.m.bins.length));
    const gap = 10;
    const colW = Math.floor((W - AXIS_W - gap * (k - 1)) / k);
    const H = HEAD_H + n * PITCH + 6;
    const maxChars = niceMax(Math.max(...list.flatMap((x) => x.m.bins.map((b) => b.chars)), 1));
    const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'LPごとの文字量と申し込みボタンの位置の比較' });
    for (let i = 0; i <= n; i += 2) {
      const y = HEAD_H + i * PITCH - GAP / 2;
      s.append(svg('line', { x1: AXIS_W, x2: W, y1: y, y2: y, class: i === 0 ? 'lr-base' : 'lr-grid' }));
      if (i < n) s.append(svg('text', { x: AXIS_W - 8, y: y + PITCH + 1, class: 'lr-tick', 'text-anchor': 'end' }, `${i / 2}`));
    }
    s.append(svg('text', { x: AXIS_W - 8, y: 27, class: 'lr-col-sub', 'text-anchor': 'end' }, '画面'));
    list.forEach((x, j) => {
      const x0 = AXIS_W + j * (colW + gap);
      const name = Array.from(x.name).length > 9 ? Array.from(x.name).slice(0, 9).join('') + '…' : x.name;
      s.append(svg('text', { x: x0, y: 13, class: 'lr-col-title' }, name));
      s.append(svg('text', { x: x0, y: 27, class: 'lr-col-sub' }, `${R.metrics(x.m).screens}画面`));
      s.append(svg('line', { x1: x0, x2: x0, y1: HEAD_H - 2, y2: HEAD_H + x.m.bins.length * PITCH, class: 'lr-base' }));
      x.m.bins.forEach((b, i) => {
        s.append(svg('path', { d: barPath(x0, HEAD_H + i * PITCH, (b.chars / maxChars) * (colW - 12), ROW, 4), class: 'lr-text' }));
      });
      for (const c of x.m.ctas) {
        const y = HEAD_H + (c.y / x.m.binH) * PITCH;
        s.append(svg('circle', { cx: x0 + colW - 6, cy: y, r: 4.5, class: 'lr-cta' }));
      }
    });
    const tip = tooltip(container);
    const hit = svg('rect', { x: 0, y: HEAD_H, width: W, height: n * PITCH, class: 'lr-hit' });
    s.append(hit);
    hit.addEventListener('pointermove', (ev) => {
      const box = s.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor((ev.clientY - box.top - HEAD_H) / PITCH)));
      const rows = [{ head: R.binLabel(i) }];
      for (const x of list) {
        const b = x.m.bins[i];
        const it = b ? binItems(x.m, i) : { ctas: [] };
        rows.push({ key: 'text', value: b ? `${b.chars.toLocaleString('ja-JP')}字${it.ctas.length ? `・ボタン${it.ctas.length}` : ''}` : '—', label: x.name });
      }
      const cbox = container.getBoundingClientRect();
      showTip(container, tip, ev.clientX - cbox.left, ev.clientY - cbox.top, rows);
    });
    hit.addEventListener('pointerleave', () => (tip.hidden = true));
    container.append(s);
    tip.hidden = true;
  }

  /** 表で見る（グラフと同じ内容） */
  function table(m) {
    const t = h('table', { class: 'lr-table' });
    t.append(h('thead', null, h('tr', null, ['位置', '文字量', '画像', 'ボタン', '見出し'].map((x) => h('th', { scope: 'col' }, x)))));
    const tb = h('tbody');
    m.bins.forEach((b, i) => {
      const it = binItems(m, i);
      tb.append(
        h(
          'tr',
          null,
          h('th', { scope: 'row' }, R.binLabel(i)),
          h('td', null, `${b.chars.toLocaleString('ja-JP')}字`),
          h('td', null, `${Math.round(b.image * 100)}%`),
          h('td', null, it.ctas.map((c) => c.label).join('、')),
          h('td', null, it.headings.map((x) => `H${x.level} ${x.text}`).join('、'))
        )
      );
    });
    t.append(tb);
    return t;
  }

  LR.chart = { renderSingle, renderCompare, table, PITCH, HEAD_H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
