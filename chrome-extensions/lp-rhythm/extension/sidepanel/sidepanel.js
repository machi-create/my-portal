/*
 * LP抑揚グラフ：サイドパネル
 */
(() => {
  'use strict';
  const { ui, bridge: B, panel } = window.WDT;
  const { $, h, snack, busy } = ui;
  const R = window.LR.rhythm;
  const CH = window.LR.chart;

  B.configure({ files: ['shared/page.js', 'content/content.js'] });

  const MAX_COMPARE = 3;
  const state = { m: null, saved: [], selected: new Set(), table: false };

  // ================================================================ このLP
  async function measure({ quiet } = {}) {
    if (!panel.usable()) return;
    const done = busy($('measureBtn'), '計測中…');
    try {
      state.m = await B.call(panel.tabId, 'measure');
      render();
    } catch (e) {
      if (!quiet) snack(B.friendlyError(e), 5000);
    } finally {
      done();
    }
  }

  function screensToPx(z) {
    return { from: z.from * state.m.vh, to: z.to * state.m.vh };
  }

  async function syncZones(list) {
    if (!panel.usable()) return;
    const zones = $('showZones').checked ? list.filter((x) => x.zone && x.severity === 'warn').map((x) => ({ ...screensToPx(x.zone), label: shortLabel(x) })) : [];
    await B.callIfLoaded(panel.tabId, 'showZones', { zones }).catch(() => {});
  }

  function shortLabel(x) {
    if (x.id === 'gap') return 'ボタンがない区間';
    if (x.id.startsWith('wall')) return '文字が続く区間';
    if (x.id.startsWith('fv')) return 'ファーストビュー';
    return '気になる区間';
  }

  function render() {
    const m = state.m;
    $('lpResult').hidden = !m;
    $('lpEmpty').hidden = !!m;
    if (!m) return;
    const k = R.metrics(m);
    const list = R.insights(m);
    $('viewport').textContent = `${m.vw}×${m.vh}px の画面で計測`;

    const tiles = $('tiles');
    tiles.textContent = '';
    for (const [v, label] of [
      [`${k.screens}`, '画面の長さ'],
      [`${k.ctaCount}`, 'ボタン'],
      [k.firstCta == null ? 'なし' : `${k.firstCta}`, '最初のボタン（画面目）'],
      [`${k.headingCount}`, '見出し'],
    ]) tiles.append(h('div', { class: 'tile' }, h('b', null, v), h('span', null, label)));

    const ul = $('insights');
    ul.textContent = '';
    const SEV = { warn: ['!', '注意'], info: ['i', '情報'], good: ['✓', 'OK'] };
    for (const x of list) {
      const li = h(
        'li',
        { class: `insight${x.zone ? ' clickable' : ''}`, tabindex: x.zone ? '0' : null, role: x.zone ? 'button' : null },
        h('span', { class: `sev ${x.severity}`, 'aria-hidden': 'true' }, SEV[x.severity][0]),
        h('span', { class: 'insight-title' }, h('span', { class: 'sr-only' }, `${SEV[x.severity][1]}：`), x.title),
        x.detail ? h('span', { class: 'insight-detail' }, x.detail) : null
      );
      if (x.zone) {
        const go = () => B.call(panel.tabId, 'scrollToRange', screensToPx(x.zone)).catch((e) => snack(B.friendlyError(e)));
        li.addEventListener('click', go);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            go();
          }
        });
      }
      ul.append(li);
    }

    const zones = list.filter((x) => x.zone && x.severity === 'warn').map((x) => x.zone);
    CH.renderSingle($('chart'), m, {
      zones,
      onRow: (i) => B.call(panel.tabId, 'scrollToRange', { from: i * m.binH, to: (i + 1) * m.binH }).catch((e) => snack(B.friendlyError(e))),
    });
    const tw = $('tableWrap');
    tw.textContent = '';
    tw.append(CH.table(m));
    tw.hidden = !state.table;
    $('toggleTable').textContent = state.table ? 'グラフだけにする' : '表で見る';
    $('toggleTable').setAttribute('aria-pressed', String(state.table));

    const fv = $('firstView');
    fv.textContent = '';
    for (const [on, label] of [
      [m.firstView.heading, '大きな見出し'],
      [m.firstView.cta, '申し込みボタン'],
      [m.firstView.image, 'メインの画像'],
      [m.firstView.chars <= 200, `文字は控えめ（${m.firstView.chars}字）`],
    ]) fv.append(h('li', { class: on ? '' : 'off' }, h('b', null, on ? '✓' : '!'), label));

    if (!$('saveName').value) $('saveName').placeholder = `名前（例：${m.title ? ui.clip(m.title, 14) : m.host}）`;
    syncZones(list);
  }

  // ================================================================ 保存と比較
  async function loadSaved() {
    state.saved = (await chrome.storage.local.get('lr.saved'))['lr.saved'] || [];
    for (const id of [...state.selected]) if (!state.saved.some((x) => x.id === id)) state.selected.delete(id);
    $('savedCount').hidden = !state.saved.length;
    $('savedCount').textContent = String(state.saved.length);
  }

  async function save() {
    if (!state.m) return;
    const name = $('saveName').value.trim() || ui.clip(state.m.title || state.m.host, 20);
    const item = { id: ui.uid('lp'), name, m: state.m, savedAt: Date.now() };
    const list = [item, ...state.saved].slice(0, 20);
    await chrome.storage.local.set({ 'lr.saved': list });
    if (state.selected.size < MAX_COMPARE) state.selected.add(item.id);
    $('saveName').value = '';
    await loadSaved();
    renderCompare();
    snack(`「${name}」を保存しました。「比較」タブで並べて見られます`);
  }

  function renderCompare() {
    const ul = $('savedList');
    ul.textContent = '';
    $('savedEmpty').hidden = state.saved.length > 0;
    for (const x of state.saved) {
      const cb = h('input', { type: 'checkbox', 'aria-label': `${x.name}を比べる` });
      cb.checked = state.selected.has(x.id);
      cb.disabled = !cb.checked && state.selected.size >= MAX_COMPARE;
      cb.addEventListener('change', () => {
        if (cb.checked) state.selected.add(x.id);
        else state.selected.delete(x.id);
        renderCompare();
      });
      const k = R.metrics(x.m);
      ul.append(
        h(
          'li',
          null,
          cb,
          h('span', { class: 'name', title: x.m.url }, x.name),
          h('button', {
            class: 'icon-btn',
            type: 'button',
            title: '削除',
            onclick: async () => {
              await chrome.storage.local.set({ 'lr.saved': state.saved.filter((y) => y.id !== x.id) });
              state.selected.delete(x.id);
              await loadSaved();
              renderCompare();
            },
          }, '✕'),
          h('span', { class: 'meta' }, `${x.m.host} ・ ${k.screens}画面 ・ ボタン${k.ctaCount} ・ ${ui.formatDate(x.savedAt)}`)
        )
      );
    }
    const list = [];
    if (state.m) list.push({ name: 'このLP', m: state.m });
    for (const x of state.saved) if (state.selected.has(x.id)) list.push({ name: x.name, m: x.m });
    const show = list.length >= 2;
    $('cmpCard').hidden = !show;
    $('cmpTableCard').hidden = !show;
    if (!show) return;
    CH.renderCompare($('cmpChart'), list);
    const t = R.compareRows(list);
    const table = $('cmpTable');
    table.textContent = '';
    table.append(h('thead', null, h('tr', null, t.header.map((x) => h('th', { scope: 'col' }, x)))));
    table.append(h('tbody', null, t.rows.map((r) => h('tr', null, h('th', { scope: 'row' }, r[0]), r.slice(1).map((c) => h('td', null, c))))));
  }

  // ================================================================ 初期化
  function bind() {
    ui.setupTabs('lr.tab', (id) => {
      if (id === 'tab-cmp') renderCompare();
      if (id === 'tab-lp' && state.m) render();
    });
    $('measureBtn').addEventListener('click', () => measure());
    $('saveBtn').addEventListener('click', save);
    $('saveName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    $('toggleTable').addEventListener('click', () => {
      state.table = !state.table;
      render();
    });
    $('showZones').addEventListener('change', () => state.m && syncZones(R.insights(state.m)));
    let resizeTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.m && !$('panel-lp').hidden) render();
        if (!$('panel-cmp').hidden) renderCompare();
      }, 200);
    });
    const onTarget = () => {
      $('targetUrl').textContent = panel.label();
      $('targetUrl').title = panel.url;
      $('unavailable').hidden = panel.usable() || !panel.url;
      $('measureBtn').disabled = !panel.usable();
      state.m = null;
      render();
      // ページの表示が落ち着いてから計測する
      setTimeout(() => measure({ quiet: true }), 400);
    };
    panel.on('target', onTarget);
    panel.on('reload', onTarget);
  }

  async function init() {
    bind();
    await loadSaved();
    await panel.init();
  }

  init().catch((e) => snack(B.friendlyError(e), 6000));
})();
