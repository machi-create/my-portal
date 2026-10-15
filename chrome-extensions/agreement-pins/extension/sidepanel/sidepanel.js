/*
 * 合意ピン：サイドパネル
 */
(() => {
  'use strict';
  const { ui, bridge: B, panel } = window.WDT;
  const { $, h, clip, snack, busy } = ui;
  const D = window.PIN.data;

  B.configure({ files: ['shared/page.js', 'shared/picker.js', 'shared/selector.js', 'content/content.js'] });

  const state = {
    settings: { ...D.DEFAULT_SETTINGS },
    pins: [],
    all: [],
    found: new Map(),
    activeId: null,
    form: null,
    filter: 'all',
    search: '',
    confirmDelete: null,
  };

  const statusLabel = (st) => (D.STATUS[st] ? D.STATUS[st].label : st);

  // ================================================================ このページ
  async function refreshPage() {
    $('targetUrl').textContent = panel.label();
    $('targetUrl').title = panel.url;
    $('unavailable').hidden = panel.usable() || !panel.url;
    $('addBtn').disabled = !panel.usable();
    state.pins = panel.usable() ? D.filterForUrl(await D.loadPage(panel.url), panel.url, state.settings) : [];
    state.found = new Map();
    if (panel.usable() && (state.pins.length || (await B.isLoaded(panel.tabId).catch(() => false)))) {
      try {
        const res = await B.call(panel.tabId, 'render', { pins: state.pins, visible: $('showPins').checked, activeId: state.activeId });
        for (const r of res) state.found.set(r.id, r);
      } catch (e) {
        /* 表示できないページ */
      }
    }
    updateBadge();
    renderList();
  }

  function updateBadge() {
    if (panel.tabId == null) return;
    const n = state.pins.length;
    const open = state.pins.some((p) => ['pending', 'question'].includes(D.statusOf(p)));
    chrome.action.setBadgeText({ tabId: panel.tabId, text: n ? String(n) : '' }).catch(() => {});
    if (n) chrome.action.setBadgeBackgroundColor({ tabId: panel.tabId, color: open ? '#d97706' : '#16a34a' }).catch(() => {});
    const c = $('pageCount');
    c.hidden = !n;
    c.textContent = String(n);
  }

  function entryLine(e) {
    return [e.who, D.fmtDate(e.date)].filter(Boolean).join(' ・ ');
  }

  function pinCard(p, i) {
    const e = D.latest(p);
    const found = state.found.get(p.id);
    const li = h('li', { class: `pin-card${p.id === state.activeId ? ' active' : ''}`, 'data-id': p.id, tabindex: '0' });
    li.append(
      h('span', { class: `pin-no st-${e.status}` }, String(i + 1)),
      h('div', { class: 'pin-head' }, h('span', { class: `pin-status st-${e.status}` }, statusLabel(e.status)), h('span', { class: 'pin-target', title: p.target }, p.target)),
      h('div', { class: 'pin-what' }, e.what),
      h('div', { class: 'pin-meta' }, entryLine(e) || '—', e.by ? `（記録：${e.by}）` : '')
    );
    if (e.note) li.append(h('div', { class: 'pin-note' }, `※ ${e.note}`));
    if (found && !found.found) li.append(h('div', { class: 'pin-warn' }, '要素が見つかりません。ページが変わった可能性があります。「位置を付け直す」で選び直してください。'));
    else if (found && found.hidden) li.append(h('div', { class: 'pin-warn' }, '要素が非表示になっています（スマホ用の表示やメニューの中など）。'));
    if (p.origin && p.origin !== D.originOf(panel.url)) li.append(h('div', { class: 'pin-warn' }, `別の環境（${p.origin.replace(/^https?:\/\//, '')}）で記録したピンです。`));
    if (p.entries.length > 1) {
      const ol = h('ol');
      for (const x of p.entries.slice().reverse().slice(1)) {
        ol.append(h('li', { class: `st-dot-${x.status}` }, h('b', null, statusLabel(x.status)), '：', x.what, h('div', { class: 'h-meta' }, entryLine(x))));
      }
      li.append(h('details', { class: 'history' }, h('summary', null, `これまでの経緯（${p.entries.length - 1}件）`), ol));
    }
    const confirming = state.confirmDelete === p.id;
    li.append(
      h(
        'div',
        { class: 'pin-actions' },
        h('button', { class: 'link-btn', type: 'button', onclick: (ev) => { ev.stopPropagation(); openForm('entry', p); } }, '経緯を追加'),
        h('button', { class: 'link-btn', type: 'button', onclick: (ev) => { ev.stopPropagation(); openForm('edit', p); } }, '編集'),
        h('button', { class: 'link-btn', type: 'button', onclick: (ev) => { ev.stopPropagation(); reanchor(p); } }, '位置を付け直す'),
        h('button', { class: 'link-btn danger', type: 'button', onclick: (ev) => { ev.stopPropagation(); askDelete(p); } }, confirming ? '本当に削除する' : '削除')
      )
    );
    li.addEventListener('click', () => focusPin(p.id));
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target === li) focusPin(p.id);
    });
    return li;
  }

  function renderList() {
    const ul = $('pinList');
    ul.textContent = '';
    state.pins.forEach((p, i) => ul.append(pinCard(p, i)));
    $('pageEmpty').hidden = state.pins.length > 0 || !!state.form;
  }

  async function focusPin(id) {
    state.activeId = id;
    for (const el of document.querySelectorAll('.pin-card')) el.classList.toggle('active', el.dataset.id === id);
    try {
      const r = await B.call(panel.tabId, 'focus', { id });
      if (!r.ok) snack('ページ上で要素が見つかりません');
      else if (r.hidden) snack('要素が非表示になっています');
    } catch (e) {
      snack(B.friendlyError(e));
    }
  }

  async function askDelete(p) {
    if (state.confirmDelete !== p.id) {
      state.confirmDelete = p.id;
      renderList();
      setTimeout(() => {
        if (state.confirmDelete === p.id) {
          state.confirmDelete = null;
          renderList();
        }
      }, 4000);
      return;
    }
    state.confirmDelete = null;
    await D.removePin(p);
    snack('ピンを削除しました');
    await refreshPage();
  }

  // ================================================================ フォーム
  const today = () => ui.isoDate(new Date());

  function renderStatusSeg(current) {
    const seg = $('statusSeg');
    seg.textContent = '';
    for (const st of D.STATUS_ORDER) {
      seg.append(
        h('button', {
          type: 'button',
          role: 'radio',
          'data-st': st,
          'aria-checked': String(st === current),
          onclick: () => {
            state.form.status = st;
            renderStatusSeg(st);
          },
        }, statusLabel(st))
      );
    }
  }

  async function pickElement() {
    const done = busy($('addBtn'), 'ページ上で要素をクリック…');
    $('pickCancel').hidden = false;
    try {
      const res = await B.call(panel.tabId, 'pick');
      return res.cancelled ? null : res;
    } catch (e) {
      snack(B.friendlyError(e), 5000);
      return null;
    } finally {
      $('pickCancel').hidden = true;
      done();
    }
  }

  async function startAdd() {
    if (!panel.usable()) return;
    const picked = await pickElement();
    if (!picked) return;
    state.form = { mode: 'new', anchor: picked.anchor, target: picked.target, status: 'agreed' };
    showForm();
  }

  function openForm(mode, pin) {
    const e = D.latest(pin);
    state.form = {
      mode,
      pinId: pin.id,
      anchor: pin.anchor,
      target: pin.target,
      status: mode === 'entry' ? 'agreed' : e.status,
      what: mode === 'edit' ? e.what : '',
      who: mode === 'edit' ? e.who : e.who || '',
      date: mode === 'edit' ? e.date : today(),
      note: mode === 'edit' ? e.note || '' : '',
    };
    showForm();
  }

  async function fillWhoList() {
    const all = await D.loadAll();
    const names = [...new Set(all.flatMap((p) => p.entries.map((e) => e.who)).filter(Boolean))];
    const dl = $('whoList');
    dl.textContent = '';
    for (const n of names) dl.append(h('option', { value: n }));
  }

  function showForm() {
    const f = state.form;
    $('pinForm').hidden = false;
    $('formTitle').textContent = { new: '新しいピン', entry: '経緯を追加', edit: 'ピンを編集' }[f.mode];
    $('formTarget').textContent = f.target;
    $('formTarget').title = f.target;
    $('formRepick').hidden = f.mode === 'entry';
    renderStatusSeg(f.status);
    $('fWhat').value = f.what || '';
    $('fWho').value = f.who || '';
    $('fDate').value = f.date || today();
    $('fNote').value = f.note || '';
    $('formError').hidden = true;
    $('pageEmpty').hidden = true;
    fillWhoList();
    $('fWhat').focus();
    $('pinForm').scrollIntoView({ block: 'nearest' });
  }

  function closeForm() {
    state.form = null;
    $('pinForm').hidden = true;
    renderList();
  }

  async function saveForm(ev) {
    ev.preventDefault();
    const f = state.form;
    if (!f) return;
    const what = $('fWhat').value.trim();
    if (!what) {
      $('formError').textContent = '「決まったこと・内容」を入力してください';
      $('formError').hidden = false;
      $('fWhat').focus();
      return;
    }
    const entry = {
      id: ui.uid('e'),
      status: f.status,
      what,
      who: $('fWho').value.trim(),
      date: $('fDate').value || today(),
      note: $('fNote').value.trim(),
      by: state.settings.recorder || '',
      createdAt: Date.now(),
    };
    let pin;
    if (f.mode === 'new') {
      pin = {
        id: ui.uid('pin'),
        origin: D.originOf(panel.url),
        path: D.pathOf(panel.url),
        url: panel.url,
        pageTitle: panel.title,
        anchor: f.anchor,
        target: f.target,
        entries: [entry],
        createdAt: Date.now(),
      };
    } else {
      const list = await D.loadPage(panel.url);
      pin = list.find((p) => p.id === f.pinId);
      if (!pin) {
        snack('ピンが見つかりません（別の画面で削除された可能性があります）');
        closeForm();
        return;
      }
      pin.anchor = f.anchor;
      pin.target = f.target;
      if (f.mode === 'entry') pin.entries.push(entry);
      else {
        const last = pin.entries[pin.entries.length - 1];
        Object.assign(last, { status: entry.status, what: entry.what, who: entry.who, date: entry.date, note: entry.note, editedAt: Date.now() });
      }
    }
    await D.savePin(pin);
    state.activeId = pin.id;
    closeForm();
    snack(f.mode === 'new' ? 'ピンを追加しました' : '保存しました');
    await refreshPage();
  }

  async function reanchor(pin) {
    const picked = await pickElement();
    if (!picked) return;
    pin.anchor = picked.anchor;
    pin.target = picked.target;
    pin.url = panel.url;
    await D.savePin(pin);
    snack('位置を付け直しました');
    await refreshPage();
  }

  // ================================================================ すべての合意
  async function refreshAll() {
    state.all = await D.loadAll();
    renderAll();
  }

  function matches(p) {
    const e = D.latest(p);
    if (state.filter !== 'all' && e.status !== state.filter) return false;
    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    return [p.path, p.pageTitle, p.target, ...p.entries.flatMap((x) => [x.what, x.who, x.note])].join(' ').toLowerCase().includes(q);
  }

  function renderAll() {
    const filters = $('statusFilters');
    filters.textContent = '';
    const counts = { all: state.all.length };
    for (const st of D.STATUS_ORDER) counts[st] = state.all.filter((p) => D.statusOf(p) === st).length;
    for (const id of ['all', ...D.STATUS_ORDER]) {
      filters.append(
        h('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(state.filter === id),
          onclick: () => {
            state.filter = id;
            renderAll();
          },
        }, id === 'all' ? 'すべて' : statusLabel(id), h('b', null, counts[id]))
      );
    }
    const box = $('allGroups');
    box.textContent = '';
    const groups = D.groupByPage(state.all);
    let shown = 0;
    for (const g of groups) {
      const items = g.pins.map((p, i) => [p, i]).filter(([p]) => matches(p));
      if (!items.length) continue;
      shown += items.length;
      const sec = h('section', { class: 'group' }, h('div', { class: 'group-head' }, h('span', { class: 'group-path' }, g.path), h('span', { class: 'group-title' }, g.title)));
      for (const [p, i] of items) {
        const e = D.latest(p);
        sec.append(
          h(
            'div',
            { class: 'row-item', role: 'button', tabindex: '0', onclick: () => openPinPage(p) },
            h('span', { class: `pin-no st-${e.status}` }, String(i + 1)),
            h('div', { class: 'pin-what' }, e.what),
            h('div', { class: 'pin-meta' }, `${statusLabel(e.status)} ・ ${p.target} ・ ${entryLine(e) || '—'}`)
          )
        );
      }
      box.append(sec);
    }
    $('allEmpty').hidden = shown > 0;
    $('allEmpty').querySelector('.empty-title').textContent = state.all.length ? '条件に合うピンはありません' : 'まだピンはありません';
  }

  async function openPinPage(p) {
    if (D.pathOf(panel.url) === p.path && panel.usable()) {
      selectTab('tab-page');
      await refreshPage();
      focusPin(p.id);
      return;
    }
    state.activeId = p.id;
    await chrome.tabs.update(panel.tabId, { url: p.url });
    selectTab('tab-page');
  }

  // ================================================================ 書き出し・読み込み
  async function copyMarkdown() {
    const all = await D.loadAll();
    if (!all.length) return snack('書き出すピンがありません');
    await ui.copyText(D.toMarkdown(all), '合意事項一覧をMarkdownでコピーしました（議事録やBacklogに貼り付けできます）');
  }

  async function saveCsv() {
    const all = await D.loadAll();
    if (!all.length) return snack('書き出すピンがありません');
    ui.download(`合意事項_${ui.isoDate(new Date())}.csv`, ui.toCsv(D.toRows(all)), 'text/csv;charset=utf-8');
  }

  async function saveJson() {
    const all = await D.loadAll();
    if (!all.length) return snack('書き出すピンがありません');
    ui.download(`agreement-pins_${ui.isoDate(new Date())}.json`, JSON.stringify({ format: 'agreement-pins', version: 1, exportedAt: new Date().toISOString(), pins: all }, null, 2), 'application/json');
  }

  async function loadJson(file) {
    try {
      const data = JSON.parse(await file.text());
      const pins = Array.isArray(data) ? data : data.pins;
      if (!Array.isArray(pins)) throw new Error('形式が違います');
      const res = await D.importPins(pins);
      snack(`読み込みました：新しいピン ${res.added}件・更新 ${res.updated}件`);
      await refreshAll();
      await refreshPage();
    } catch (e) {
      snack(`読み込めませんでした（${e.message}）`, 5000);
    }
  }

  // ================================================================ 設定
  async function loadSettings() {
    state.settings = { ...D.DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(D.DEFAULT_SETTINGS)) };
    $('setAuto').checked = state.settings.autoShow;
    $('setShare').checked = state.settings.shareAcrossHosts;
    $('setRecorder').value = state.settings.recorder;
  }

  const saveSettings = ui.debounce(async () => {
    state.settings = { autoShow: $('setAuto').checked, shareAcrossHosts: $('setShare').checked, recorder: $('setRecorder').value.trim() };
    await chrome.storage.sync.set(state.settings);
    $('setSaved').textContent = '✓ 保存しました';
    setTimeout(() => ($('setSaved').textContent = ''), 1600);
    await refreshPage();
  }, 300);

  // ================================================================ 初期化
  let selectTab = () => {};

  function bind() {
    selectTab = ui.setupTabs('pins.tab', (id) => {
      if (id === 'tab-all') refreshAll();
    });
    $('addBtn').addEventListener('click', startAdd);
    $('pickCancel').addEventListener('click', () => B.callIfLoaded(panel.tabId, 'cancelPick').catch(() => {}));
    $('showPins').addEventListener('change', () => B.callIfLoaded(panel.tabId, 'setVisible', { visible: $('showPins').checked }).catch(() => {}));
    $('pinForm').addEventListener('submit', saveForm);
    $('formClose').addEventListener('click', closeForm);
    $('formCancel').addEventListener('click', closeForm);
    $('formRepick').addEventListener('click', async () => {
      const picked = await pickElement();
      if (!picked || !state.form) return;
      state.form.anchor = picked.anchor;
      state.form.target = picked.target;
      $('formTarget').textContent = picked.target;
    });
    $('search').addEventListener('input', () => {
      state.search = $('search').value;
      renderAll();
    });
    $('copyMd').addEventListener('click', copyMarkdown);
    $('saveCsv').addEventListener('click', saveCsv);
    $('saveJson').addEventListener('click', saveJson);
    $('loadJson').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (f) loadJson(f);
    });
    for (const id of ['setAuto', 'setShare']) $(id).addEventListener('change', saveSettings);
    $('setRecorder').addEventListener('input', saveSettings);

    // ページ上のピンがクリックされたら、そのピンを一覧で開く
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (!msg || msg.type !== 'wdt-pin-open') return;
      if (sender.tab && sender.tab.id !== panel.tabId) return;
      selectTab('tab-page');
      state.activeId = msg.id;
      for (const el of document.querySelectorAll('.pin-card')) el.classList.toggle('active', el.dataset.id === msg.id);
      const card = document.querySelector(`.pin-card[data-id="${CSS.escape(msg.id)}"]`);
      if (card) {
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const det = card.querySelector('details');
        if (det) det.open = true;
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('pins:'))) {
        if (!$('panel-all').hidden) refreshAll();
      }
    });

    panel.on('target', () => {
      closeForm();
      refreshPage();
    });
    panel.on('reload', () => refreshPage());
  }

  async function init() {
    bind();
    await loadSettings();
    await panel.init();
  }

  init().catch((e) => snack(B.friendlyError(e), 6000));
})();
