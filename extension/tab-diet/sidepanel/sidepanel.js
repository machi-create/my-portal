/**
 * Tab Diet サイドパネル
 * 「よく使うページへの即アクセス」と「タブのメモリ整理」をまとめたUI。
 */
import {
  getSettings,
  saveSettings,
  saveLinks,
  saveCategories,
  ensureCategories,
  getStashes,
  saveStashes,
  getStats,
  bumpStats,
  uid,
  sameTarget,
  hostOf,
  isProtectedUrl,
  faviconUrl,
  findDuplicateGroups,
  getLastActiveMap,
  lastUsedAt,
  canSleep,
  DEFAULT_SETTINGS,
} from '../common.js';

const $ = (selector) => document.querySelector(selector);
/** スリープ1本あたりのメモリ削減量の目安(MB)。実測値ではなく概算表示用 */
const MB_PER_TAB = 100;

const state = {
  settings: { ...DEFAULT_SETTINGS },
  links: [],
  categories: [],
  activeCategory: 'all',
  stashes: [],
  tabs: [],
  lastActive: {},
  currentWindowId: null,
  selected: new Set(),
  linkQuery: '',
  tabQuery: '',
  view: 'links',
};

/* ------------------------------------------------------------------ *
 * 小物
 * ------------------------------------------------------------------ */

/** 線画アイコン(24pxグリッドのSVGパス) */
const ICON_PATHS = {
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 1.5v2', 'M12 20.5v2', 'M4.2 4.2l1.4 1.4',
    'M18.4 18.4l1.4 1.4', 'M1.5 12h2', 'M20.5 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4',
  ],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  plus: ['M12 5v14', 'M5 12h14'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronUp: ['M18 15l-6-6-6 6'],
  arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
  arrowDown: ['M12 5v14', 'M19 12l-7 7-7-7'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  volume: ['M11 5 6 9H2v6h4l5 4z', 'M19.1 4.9a10 10 0 0 1 0 14.2', 'M15.5 8.5a5 5 0 0 1 0 7'],
  bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
};

/** アイコンを <svg> として作る(色は currentColor でテーマに追従) */
function icon(name, size = 14) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICON_PATHS[name] || []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** 設定値(auto/light/dark)から実際に使うテーマを決める */
function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme() {
  const resolved = resolveTheme(state.settings.theme);
  document.documentElement.dataset.theme = resolved;
  const button = $('#btn-theme');
  if (!button) return;
  // ボタンには「切り替え先」のアイコンを出す
  button.replaceChildren(icon(resolved === 'light' ? 'moon' : 'sun', 15));
  button.title = resolved === 'light' ? 'ダークに切り替える' : 'ライトに切り替える';
}

/** textContent 経由でのみ文字を入れる安全なDOM生成ヘルパー */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

let toastTimer;
function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
}

/** 確認ダイアログ(window.confirm を使わず自前で出す) */
function confirmDialog(message, okLabel = '実行する') {
  return new Promise((resolve) => {
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    const cancel = el('button', { class: 'pill-btn', text: 'やめる', style: 'flex:1', onclick: () => close(false) });
    const ok = el('button', { class: 'pill-btn primary', text: okLabel, style: 'flex:1', onclick: () => close(true) });
    const overlay = el('div', {
      class: 'modal',
      onclick: (event) => { if (event.target === overlay) close(false); },
    }, [
      el('div', { class: 'modal-card glass' }, [
        el('div', { class: 'modal-head' }, [el('strong', { text: '確認' })]),
        el('div', { class: 'modal-body' }, [
          el('p', { text: message, style: 'margin:0;font-size:12.5px;line-height:1.8;white-space:pre-line' }),
        ]),
        el('div', { class: 'modal-foot' }, [cancel, ok]),
      ]),
    ]);
    document.body.append(overlay);
    ok.focus();
  });
}

/** 1行入力ダイアログ(window.prompt を使わず自前で出す) */
function promptDialog(title, initial = '', placeholder = '') {
  return new Promise((resolve) => {
    const input = el('input', { class: 'field', type: 'text', value: initial, placeholder });
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    const decide = () => close(input.value.trim() || null);
    const overlay = el('div', {
      class: 'modal',
      onclick: (event) => { if (event.target === overlay) close(null); },
    }, [
      el('div', { class: 'modal-card glass' }, [
        el('div', { class: 'modal-head' }, [
          el('strong', { text: title }),
          el('button', { class: 'icon-btn', title: '閉じる', onclick: () => close(null) }, [icon('close')]),
        ]),
        el('div', { class: 'modal-body' }, [input]),
        el('div', { class: 'modal-foot' }, [
          el('button', { class: 'pill-btn', text: 'やめる', style: 'flex:1', onclick: () => close(null) }),
          el('button', { class: 'pill-btn primary', text: '決定', style: 'flex:1', onclick: decide }),
        ]),
      ]),
    ]);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') decide(); });
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}

function formatAgo(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

function iconFor(url, fallback) {
  const img = el('img', { class: 'row-icon', alt: '', src: fallback || faviconUrl(url) });
  img.addEventListener('error', () => { img.src = faviconUrl(url); }, { once: true });
  return img;
}

/* ------------------------------------------------------------------ *
 * タブを開く / 切り替える
 * ------------------------------------------------------------------ */

/** 同じページのタブが既にあればそこへ切り替え、無ければ新しく開く */
async function openOrFocus(url) {
  const tabs = await chrome.tabs.query({});
  const hit = tabs.find((tab) => tab.url && sameTarget(tab.url, url, state.settings.ignoreHash));
  if (hit) {
    await chrome.tabs.update(hit.id, { active: true });
    await chrome.windows.update(hit.windowId, { focused: true });
    return true;
  }
  await chrome.tabs.create({ url });
  return false;
}

/* ------------------------------------------------------------------ *
 * ヘッダーのメーター
 * ------------------------------------------------------------------ */

async function updateMeter() {
  const sleeping = state.tabs.filter((tab) => tab.discarded).length;
  $('#stat-tabs').textContent = String(state.tabs.length);
  $('#stat-sleeping').textContent = String(sleeping);
  $('#stat-saved').textContent = String(sleeping * MB_PER_TAB);

  try {
    const info = await chrome.system.memory.getInfo();
    const ratio = (info.capacity - info.availableCapacity) / info.capacity;
    const percent = Math.round(ratio * 100);
    $('#meter-value').textContent = `${percent}%`;
    const fill = $('#meter-fill');
    fill.style.width = `${Math.min(percent, 100)}%`;
    fill.classList.toggle('is-warn', percent >= 80);
  } catch {
    $('#meter-value').textContent = '—';
  }
}

/* ------------------------------------------------------------------ *
 * ジャンル(カテゴリ)
 * ------------------------------------------------------------------ */

/** 「すべて」タブを表す擬似カテゴリID */
const ALL = 'all';

function categoryById(id) {
  return state.categories.find((category) => category.id === id) || null;
}

function linkCountOf(categoryId) {
  return state.links.filter((link) => link.categoryId === categoryId).length;
}

/** 新しいリンクの追加先(「すべて」表示中は先頭のジャンル) */
function targetCategoryId() {
  if (state.activeCategory !== ALL && categoryById(state.activeCategory)) {
    return state.activeCategory;
  }
  return state.categories[0]?.id;
}

function renderCategoryBar() {
  const bar = $('#cat-bar');
  bar.replaceChildren();

  const chip = (label, count, active, onclick, extra = {}) => el('button', {
    class: `cat-chip${active ? ' is-active' : ''}${extra.class ? ` ${extra.class}` : ''}`,
    title: extra.title,
    onclick,
  }, [
    typeof label === 'string' ? el('span', { text: label }) : label,
    count === null ? null : el('span', { class: 'count', text: String(count) }),
  ]);

  bar.append(chip('すべて', state.links.length, state.activeCategory === ALL, () => {
    state.activeCategory = ALL;
    renderCategoryBar();
    renderLinks();
  }));

  for (const category of state.categories) {
    const node = chip(
      category.name,
      linkCountOf(category.id),
      state.activeCategory === category.id,
      () => {
        state.activeCategory = category.id;
        renderCategoryBar();
        renderLinks();
      },
      { title: `${category.name}（リンクをここへドラッグすると移動できます）` },
    );
    attachCategoryDrop(node, category);
    bar.append(node);
  }

  bar.append(chip(icon('plus', 13), null, false, () => addCategory(), {
    class: 'icon-chip', title: 'ジャンルを追加',
  }));
  bar.append(chip(icon('sliders', 13), null, false, openCategoryManager, {
    class: 'icon-chip', title: 'ジャンルの名前変更・並べ替え・削除',
  }));
}

/** ジャンルのタブにリンクをドロップして移動できるようにする */
function attachCategoryDrop(node, category) {
  node.addEventListener('dragover', (event) => {
    if (!dragLinkId) return;
    event.preventDefault();
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
  node.addEventListener('drop', async (event) => {
    event.preventDefault();
    node.classList.remove('drop-target');
    const link = state.links.find((item) => item.id === dragLinkId);
    if (!link || link.categoryId === category.id) return;
    link.categoryId = category.id;
    await saveLinks(state.links);
    renderCategoryBar();
    renderLinks();
    toast(`「${category.name}」へ移動しました`);
  });
}

async function addCategory() {
  const name = await promptDialog('ジャンルを追加', '', '例: 経理、案件A、日報');
  if (!name) return;
  const category = { id: uid(), name };
  state.categories.push(category);
  await saveCategories(state.categories);
  state.activeCategory = category.id;
  renderCategoryBar();
  renderLinks();
  toast(`「${name}」を追加しました`);
}

async function moveCategory(index, delta) {
  const to = index + delta;
  if (to < 0 || to >= state.categories.length) return;
  const [moved] = state.categories.splice(index, 1);
  state.categories.splice(to, 0, moved);
  await saveCategories(state.categories);
}

async function removeCategory(category) {
  if (state.categories.length <= 1) {
    toast('ジャンルは1つ以上必要です');
    return;
  }
  const count = linkCountOf(category.id);
  const fallback = state.categories.find((item) => item.id !== category.id);
  const ok = await confirmDialog(
    count > 0
      ? `「${category.name}」を削除します。\n登録済みの ${count}件 のリンクは「${fallback.name}」へ移動します。`
      : `「${category.name}」を削除します。`,
    '削除する',
  );
  if (!ok) return;

  for (const link of state.links) {
    if (link.categoryId === category.id) link.categoryId = fallback.id;
  }
  state.categories = state.categories.filter((item) => item.id !== category.id);
  if (state.activeCategory === category.id) state.activeCategory = ALL;
  await Promise.all([saveCategories(state.categories), saveLinks(state.links)]);
  toast('削除しました');
}

/** ジャンルの名前変更・並べ替え・追加・削除をまとめて行うモーダル */
function openCategoryManager() {
  const body = el('div', { class: 'modal-body' });
  const close = () => {
    overlay.remove();
    renderCategoryBar();
    renderLinks();
  };

  const draw = () => {
    body.replaceChildren();
    state.categories.forEach((category, index) => {
      const nameInput = el('input', { class: 'field', type: 'text', value: category.name });
      nameInput.addEventListener('change', async () => {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.value = category.name;
          return;
        }
        category.name = name;
        await saveCategories(state.categories);
        toast('名前を変更しました');
      });

      body.append(el('div', { class: 'cat-manage-row' }, [
        nameInput,
        el('span', { class: 'count-note', text: `${linkCountOf(category.id)}件` }),
        el('button', {
          class: 'icon-btn', title: '上へ',
          onclick: async () => { await moveCategory(index, -1); draw(); },
        }, [icon('arrowUp', 13)]),
        el('button', {
          class: 'icon-btn', title: '下へ',
          onclick: async () => { await moveCategory(index, 1); draw(); },
        }, [icon('arrowDown', 13)]),
        el('button', {
          class: 'icon-btn danger', title: 'このジャンルを削除',
          onclick: async () => { await removeCategory(category); draw(); },
        }, [icon('close', 13)]),
      ]));
    });

    body.append(el('button', {
      class: 'pill-btn primary',
      style: 'margin-top:6px;justify-content:center',
      onclick: async () => { await addCategory(); draw(); },
    }, [icon('plus', 13), el('span', { text: 'ジャンルを追加' })]));
    body.append(el('p', {
      class: 'note',
      style: 'margin-top:8px',
      text: 'ジャンルはいくつでも作れます。リンクはタブへドラッグしても移動できます。',
    }));
  };
  draw();

  const overlay = el('div', {
    class: 'modal',
    onclick: (event) => { if (event.target === overlay) close(); },
  }, [
    el('div', { class: 'modal-card glass' }, [
      el('div', { class: 'modal-head' }, [
        el('strong', { text: 'ジャンルの管理' }),
        el('button', { class: 'icon-btn', title: '閉じる', onclick: close }, [icon('close')]),
      ]),
      body,
      el('div', { class: 'modal-foot' }, [
        el('button', { class: 'pill-btn primary', text: '閉じる', style: 'flex:1', onclick: close }),
      ]),
    ]),
  ]);
  document.body.append(overlay);
}

/* ------------------------------------------------------------------ *
 * リンク(よく使うページ)
 * ------------------------------------------------------------------ */

/** いま表示すべきリンク(ジャンル絞り込み + 検索) */
function visibleLinks() {
  const query = state.linkQuery.trim().toLowerCase();
  return state.links.filter((link) => {
    if (state.activeCategory !== ALL && link.categoryId !== state.activeCategory) return false;
    if (!query) return true;
    const category = categoryById(link.categoryId);
    return `${link.title} ${link.url} ${category?.name || ''}`.toLowerCase().includes(query);
  });
}

function linkRow(link, openUrls) {
  const isOpen = openUrls.some((url) => sameTarget(url, link.url, state.settings.ignoreHash));
  const row = el('div', {
    class: `row-item${isOpen ? ' is-active-tab' : ''}`,
    draggable: 'true',
    title: link.url,
    dataset: { id: link.id },
    onclick: async () => {
      const focused = await openOrFocus(link.url);
      link.hits = (link.hits || 0) + 1;
      await saveLinks(state.links);
      toast(focused ? '開いているタブに切り替えました' : '新しいタブで開きました');
    },
  }, [
    iconFor(link.url),
    el('div', { class: 'row-main' }, [
      el('span', { class: 'row-title', text: link.title }),
      el('span', { class: 'row-sub' }, [
        el('span', { text: hostOf(link.url) || link.url }),
        isOpen ? el('span', { class: 'badge open', text: '開いています' }) : null,
      ]),
    ]),
    el('div', { class: 'row-actions' }, [
      el('button', {
        class: 'icon-btn',
        title: '名前とジャンルを編集',
        onclick: (event) => { event.stopPropagation(); editLink(link); },
      }, [icon('edit')]),
      el('button', {
        class: 'icon-btn danger',
        title: 'このリンクを削除',
        onclick: async (event) => {
          event.stopPropagation();
          state.links = state.links.filter((item) => item.id !== link.id);
          await saveLinks(state.links);
          renderCategoryBar();
          renderLinks();
          toast('削除しました');
        },
      }, [icon('close')]),
    ]),
  ]);
  attachDragHandlers(row, link);
  return row;
}

function renderLinks() {
  const list = $('#link-list');
  list.replaceChildren();
  $('#link-empty').hidden = state.links.length > 0;

  const openUrls = state.tabs.map((tab) => tab.url).filter(Boolean);
  const links = visibleLinks();

  if (state.activeCategory === ALL) {
    // 「すべて」ではジャンルごとに見出しを付けて並べる
    for (const category of state.categories) {
      const rows = links.filter((link) => link.categoryId === category.id);
      if (rows.length === 0) continue;
      list.append(el('div', { class: 'group-head', text: category.name }));
      for (const link of rows) list.append(linkRow(link, openUrls));
    }
    const known = new Set(state.categories.map((category) => category.id));
    const orphans = links.filter((link) => !known.has(link.categoryId));
    if (orphans.length > 0) {
      list.append(el('div', { class: 'group-head', text: '未分類' }));
      for (const link of orphans) list.append(linkRow(link, openUrls));
    }
  } else {
    for (const link of links) list.append(linkRow(link, openUrls));
  }

  if (links.length === 0 && state.links.length > 0) {
    list.append(el('p', {
      class: 'empty',
      text: state.linkQuery.trim()
        ? '一致するリンクがありません'
        : 'このジャンルにはまだリンクがありません',
    }));
  }
}

/** ドラッグ&ドロップでの並べ替え(別ジャンルのリンクに重ねると所属も変わる) */
let dragLinkId = null;

function attachDragHandlers(row, link) {
  row.addEventListener('dragstart', (event) => {
    dragLinkId = link.id;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', link.id);
  });

  row.addEventListener('dragend', () => {
    dragLinkId = null;
    row.classList.remove('is-dragging');
    clearDropMarks();
  });

  row.addEventListener('dragover', (event) => {
    if (!dragLinkId || dragLinkId === link.id) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });

  row.addEventListener('dragleave', () => {
    row.classList.remove('drop-before', 'drop-after');
  });

  row.addEventListener('drop', async (event) => {
    event.preventDefault();
    const after = row.classList.contains('drop-after');
    clearDropMarks();
    if (!dragLinkId || dragLinkId === link.id) return;

    const from = state.links.findIndex((item) => item.id === dragLinkId);
    if (from < 0) return;
    const [moved] = state.links.splice(from, 1);
    moved.categoryId = link.categoryId; // ドロップ先のジャンルに移す
    const to = state.links.findIndex((item) => item.id === link.id);
    state.links.splice(after ? to + 1 : to, 0, moved);
    await saveLinks(state.links);
    renderCategoryBar();
    renderLinks();
  });
}

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after, .drop-target')
    .forEach((node) => node.classList.remove('drop-before', 'drop-after', 'drop-target'));
}

async function addLink({ title, url, categoryId }) {
  if (!url || isProtectedUrl(url)) {
    toast('このページは登録できません');
    return false;
  }
  if (state.links.some((link) => sameTarget(link.url, url, state.settings.ignoreHash))) {
    toast('すでに登録済みです');
    return false;
  }
  state.links.push({
    id: uid(),
    title: (title || hostOf(url) || url).slice(0, 120),
    url,
    categoryId: categoryId || targetCategoryId(),
    hits: 0,
    createdAt: Date.now(),
  });
  await saveLinks(state.links);
  renderCategoryBar();
  renderLinks();
  return true;
}

/** ジャンル選択用の <select> を作る */
function categorySelect(selectedId) {
  return el('select', { class: 'field' }, state.categories.map((category) => el('option', {
    value: category.id,
    selected: category.id === selectedId,
    text: category.name,
  })));
}

function editLink(link) {
  const titleInput = el('input', { class: 'field', type: 'text', value: link.title });
  const select = categorySelect(link.categoryId);
  const close = () => overlay.remove();

  const overlay = el('div', {
    class: 'modal',
    onclick: (event) => { if (event.target === overlay) close(); },
  }, [
    el('div', { class: 'modal-card glass' }, [
      el('div', { class: 'modal-head' }, [
        el('strong', { text: 'リンクを編集' }),
        el('button', { class: 'icon-btn', title: '閉じる', onclick: close }, [icon('close')]),
      ]),
      el('div', { class: 'modal-body' }, [
        el('label', { class: 'col' }, [el('span', { text: '表示名' }), titleInput]),
        el('label', { class: 'col' }, [el('span', { text: 'ジャンル' }), select]),
        el('p', { class: 'note', text: link.url }),
      ]),
      el('div', { class: 'modal-foot' }, [
        el('button', {
          class: 'pill-btn primary',
          text: '保存する',
          style: 'flex:1',
          onclick: async () => {
            link.title = titleInput.value.trim() || link.title;
            link.categoryId = select.value;
            await saveLinks(state.links);
            close();
            renderCategoryBar();
            renderLinks();
            toast('保存しました');
          },
        }),
      ]),
    ]),
  ]);
  document.body.append(overlay);
  titleInput.focus();
}

/** 開いているタブから複数選んでリンク登録する */
function openTabPicker() {
  const picked = new Set();
  const list = $('#picker-list');
  list.replaceChildren();

  const candidates = state.tabs.filter((tab) => tab.url && !isProtectedUrl(tab.url));
  if (candidates.length === 0) {
    toast('登録できるタブがありません');
    return;
  }

  for (const tab of candidates) {
    const check = el('input', { class: 'row-check', type: 'checkbox' });
    check.addEventListener('change', () => {
      if (check.checked) picked.add(tab.id);
      else picked.delete(tab.id);
    });
    list.append(el('label', { class: 'row-item' }, [
      check,
      iconFor(tab.url, tab.favIconUrl),
      el('div', { class: 'row-main' }, [
        el('span', { class: 'row-title', text: tab.title || tab.url }),
        el('span', { class: 'row-sub', text: hostOf(tab.url) }),
      ]),
    ]));
  }

  const select = $('#picker-category');
  select.replaceChildren(...state.categories.map((category) => el('option', {
    value: category.id,
    text: category.name,
  })));
  select.value = targetCategoryId();

  $('#picker').hidden = false;
  $('#picker-ok').onclick = async () => {
    const categoryId = select.value;
    let added = 0;
    for (const tab of candidates) {
      if (!picked.has(tab.id)) continue;
      if (await addLink({ title: tab.title, url: tab.url, categoryId })) added += 1;
    }
    $('#picker').hidden = true;
    toast(added > 0 ? `${added}件を登録しました` : '登録できるタブがありませんでした');
  };
}

/* ------------------------------------------------------------------ *
 * 開いているタブ
 * ------------------------------------------------------------------ */

function renderTabs() {
  const list = $('#tab-list');
  list.replaceChildren();

  const query = state.tabQuery.trim().toLowerCase();
  const visible = state.tabs.filter((tab) =>
    !query || `${tab.title || ''} ${tab.url || ''}`.toLowerCase().includes(query));

  // 重複タブの件数をボタンに出す
  const dupeCount = findDuplicateGroups(state.tabs, state.settings.ignoreHash, state.lastActive)
    .reduce((sum, group) => sum + group.close.length, 0);
  const dupeBtn = $('#btn-dupes');
  dupeBtn.textContent = dupeCount > 0 ? `重複を整理 (${dupeCount})` : '重複なし';
  dupeBtn.disabled = dupeCount === 0;

  // ウィンドウごとにまとめ、いま操作中のウィンドウを先頭に
  const byWindow = new Map();
  for (const tab of visible) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }
  const windowIds = [...byWindow.keys()].sort((a, b) => {
    if (a === state.currentWindowId) return -1;
    if (b === state.currentWindowId) return 1;
    return a - b;
  });

  const now = Date.now();
  for (const windowId of windowIds) {
    const tabs = byWindow.get(windowId);
    const label = windowId === state.currentWindowId
      ? `このウィンドウ (${tabs.length})`
      : `別のウィンドウ (${tabs.length})`;
    list.append(el('div', { class: 'group-head', text: label }));

    for (const tab of tabs) {
      const idleMs = now - lastUsedAt(tab, state.lastActive, now);
      const sleepable = canSleep(tab, state.settings, Infinity).ok;
      const check = el('input', {
        class: 'row-check',
        type: 'checkbox',
        checked: state.selected.has(tab.id),
        onclick: (event) => event.stopPropagation(),
        onchange: (event) => {
          if (event.target.checked) state.selected.add(tab.id);
          else state.selected.delete(tab.id);
          renderBulkBar();
        },
      });

      const badges = [];
      if (tab.pinned) {
        badges.push(el('span', { class: 'badge', title: 'ピン留め' }, [icon('bookmark', 10)]));
      }
      if (tab.audible) {
        badges.push(el('span', { class: 'badge', title: '音声を再生中' }, [icon('volume', 10)]));
      }
      if (tab.discarded) {
        badges.push(el('span', { class: 'badge sleep' }, [
          icon('moon', 10), el('span', { text: 'スリープ中' }),
        ]));
      } else if (!tab.active) {
        badges.push(el('span', { class: 'badge', text: formatAgo(idleMs) }));
      }

      list.append(el('div', {
        class: `row-item${tab.discarded ? ' is-sleeping' : ''}${tab.active ? ' is-active-tab' : ''}`,
        title: tab.url || '',
        onclick: async () => {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
        },
      }, [
        check,
        iconFor(tab.url, tab.favIconUrl),
        el('div', { class: 'row-main' }, [
          el('span', { class: 'row-title', text: tab.title || tab.url || '(無題)' }),
          el('span', { class: 'row-sub' }, [el('span', { text: hostOf(tab.url) }), ...badges]),
        ]),
        el('div', { class: 'row-actions' }, [
          sleepable ? el('button', {
            class: 'icon-btn',
            title: 'このタブをスリープ',
            onclick: async (event) => {
              event.stopPropagation();
              try {
                await chrome.tabs.discard(tab.id);
                await bumpStats({ sleptTotal: 1 });
                toast('スリープしました');
              } catch {
                toast('このタブはスリープできませんでした');
              }
              refreshTabs();
            },
          }, [icon('moon')]) : null,
          el('button', {
            class: 'icon-btn danger',
            title: 'このタブを閉じる',
            onclick: async (event) => {
              event.stopPropagation();
              await chrome.tabs.remove(tab.id);
              await bumpStats({ closedTotal: 1 });
              state.selected.delete(tab.id);
              refreshTabs();
            },
          }, [icon('close')]),
        ]),
      ]));
    }
  }
  renderBulkBar();
}

function renderBulkBar() {
  // 閉じられたタブのIDが選択に残らないように掃除する
  const alive = new Set(state.tabs.map((tab) => tab.id));
  for (const id of state.selected) {
    if (!alive.has(id)) state.selected.delete(id);
  }
  const count = state.selected.size;
  $('#bulkbar').hidden = count === 0;
  $('#bulk-count').textContent = `${count}件選択`;
}

function selectedTabs() {
  return state.tabs.filter((tab) => state.selected.has(tab.id));
}

async function closeTabs(tabs, message) {
  const targets = tabs.filter((tab) => !tab.pinned);
  if (targets.length === 0) {
    toast('対象のタブがありません(ピン留めは閉じません)');
    return;
  }
  if (state.settings.confirmClose) {
    const ok = await confirmDialog(message || `${targets.length}本のタブを閉じます。よろしいですか？`, '閉じる');
    if (!ok) return;
  }
  await chrome.tabs.remove(targets.map((tab) => tab.id));
  await bumpStats({ closedTotal: targets.length });
  state.selected.clear();
  toast(`${targets.length}本を閉じました`);
  refreshTabs();
}

async function sleepTabs(tabs) {
  let count = 0;
  for (const tab of tabs) {
    if (!canSleep(tab, state.settings, Infinity).ok) continue;
    try {
      await chrome.tabs.discard(tab.id);
      count += 1;
    } catch {
      // Chromeが拒否した場合は飛ばす
    }
  }
  if (count > 0) await bumpStats({ sleptTotal: count });
  toast(count > 0 ? `${count}本をスリープしました` : 'スリープできるタブがありませんでした');
  refreshTabs();
}

async function cleanDuplicates() {
  const groups = findDuplicateGroups(state.tabs, state.settings.ignoreHash, state.lastActive);
  const targets = groups.flatMap((group) => group.close).filter((tab) => !tab.pinned);
  if (targets.length === 0) {
    toast('重複したタブはありません');
    return;
  }
  const sample = groups.slice(0, 3)
    .map((group) => `・${(group.keep.title || group.key).slice(0, 34)}`).join('\n');
  const ok = await confirmDialog(
    `同じページを開いているタブ ${targets.length}本 を閉じます。\n各ページは最後に見たタブを1本ずつ残します。\n\n${sample}`,
    `${targets.length}本を閉じる`,
  );
  if (!ok) return;
  await chrome.tabs.remove(targets.map((tab) => tab.id));
  await bumpStats({ closedTotal: targets.length });
  toast(`${targets.length}本の重複を整理しました`);
  refreshTabs();
}

/* ------------------------------------------------------------------ *
 * 退避(スタッシュ)
 * ------------------------------------------------------------------ */

async function stashTabs(tabs, name) {
  const targets = tabs.filter((tab) => tab.url && !isProtectedUrl(tab.url));
  if (targets.length === 0) {
    toast('退避できるタブがありません');
    return;
  }
  if (state.settings.confirmClose) {
    const ok = await confirmDialog(
      `${targets.length}本のタブをURLだけ保存して閉じます。\nあとから「退避」タブで開き直せます。`,
      '退避する',
    );
    if (!ok) return;
  }

  state.stashes.unshift({
    id: uid(),
    name: name || `${new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} の退避`,
    createdAt: Date.now(),
    tabs: targets.map((tab) => ({ title: tab.title || tab.url, url: tab.url })),
  });
  await saveStashes(state.stashes);

  // 最後の1本まで閉じるとウィンドウごと消えるので、空タブを用意しておく
  const windowIds = new Set(targets.map((tab) => tab.windowId));
  for (const windowId of windowIds) {
    const remaining = state.tabs.filter(
      (tab) => tab.windowId === windowId && !targets.some((target) => target.id === tab.id));
    if (remaining.length === 0) {
      await chrome.tabs.create({ windowId, active: true });
    }
  }

  await chrome.tabs.remove(targets.map((tab) => tab.id));
  await bumpStats({ closedTotal: targets.length });
  state.selected.clear();
  toast(`${targets.length}本を退避しました`);
  await refreshTabs();
  renderStashes();
}

function renderStashes() {
  const list = $('#stash-list');
  list.replaceChildren();
  $('#stash-empty').hidden = state.stashes.length > 0;

  for (const stash of state.stashes) {
    const links = el('div', { class: 'stash-links' },
      stash.tabs.map((item) => el('div', {
        class: 'stash-link',
        title: item.url,
        onclick: async () => {
          await openOrFocus(item.url);
          toast('開きました');
        },
      }, [iconFor(item.url), el('span', { text: item.title || item.url })])));
    links.hidden = true;

    const toggle = el('button', {
      class: 'icon-btn',
      title: '中身を見る',
      onclick: () => {
        links.hidden = !links.hidden;
        toggle.replaceChildren(icon(links.hidden ? 'chevronDown' : 'chevronUp'));
      },
    }, [icon('chevronDown')]);

    list.append(el('div', { class: 'stash-card' }, [
      el('div', { class: 'stash-head' }, [
        el('span', { class: 'stash-title', text: stash.name }),
        el('span', { class: 'stash-meta', text: `${stash.tabs.length}件` }),
        toggle,
      ]),
      links,
      el('div', { class: 'stash-foot' }, [
        el('button', {
          class: 'pill-btn primary',
          text: 'まとめて開く',
          onclick: async () => {
            const ok = await confirmDialog(
              `${stash.tabs.length}本を新しいウィンドウで開きます。\n本数が多いとメモリを使うので、必要なものだけ個別に開くのもおすすめです。`,
              'まとめて開く',
            );
            if (!ok) return;
            await chrome.windows.create({ url: stash.tabs.map((item) => item.url) });
          },
        }),
        el('button', {
          class: 'pill-btn',
          text: '名前を変更',
          onclick: async () => {
            const input = el('input', { class: 'field', type: 'text', value: stash.name });
            const close = () => overlay.remove();
            const overlay = el('div', {
              class: 'modal',
              onclick: (event) => { if (event.target === overlay) close(); },
            }, [
              el('div', { class: 'modal-card glass' }, [
                el('div', { class: 'modal-head' }, [
                  el('strong', { text: '名前を変更' }),
                  el('button', { class: 'icon-btn', title: '閉じる', onclick: close }, [icon('close')]),
                ]),
                el('div', { class: 'modal-body' }, [input]),
                el('div', { class: 'modal-foot' }, [
                  el('button', {
                    class: 'pill-btn primary',
                    text: '保存する',
                    style: 'flex:1',
                    onclick: async () => {
                      stash.name = input.value.trim() || stash.name;
                      await saveStashes(state.stashes);
                      close();
                      renderStashes();
                    },
                  }),
                ]),
              ]),
            ]);
            document.body.append(overlay);
            input.focus();
          },
        }),
        el('button', {
          class: 'pill-btn danger',
          text: '削除',
          onclick: async () => {
            const ok = await confirmDialog(`「${stash.name}」を削除します。`, '削除する');
            if (!ok) return;
            state.stashes = state.stashes.filter((item) => item.id !== stash.id);
            await saveStashes(state.stashes);
            renderStashes();
          },
        }),
      ]),
    ]));
  }
}

/* ------------------------------------------------------------------ *
 * 設定
 * ------------------------------------------------------------------ */

const SETTING_FIELDS = [
  ['theme', 'select'],
  ['autoSleep', 'checkbox'],
  ['sleepAfterMin', 'number'],
  ['keepPinned', 'checkbox'],
  ['keepAudible', 'checkbox'],
  ['excludeList', 'lines'],
  ['tabWarn', 'number'],
  ['showBadge', 'checkbox'],
  ['ignoreHash', 'checkbox'],
  ['confirmClose', 'checkbox'],
];

function fillSettings() {
  for (const [key, kind] of SETTING_FIELDS) {
    const input = $(`#set-${key}`);
    if (!input) continue;
    const value = state.settings[key];
    if (kind === 'checkbox') input.checked = !!value;
    else if (kind === 'lines') input.value = (value || []).join('\n');
    else input.value = String(value);
  }
}

function bindSettings() {
  for (const [key, kind] of SETTING_FIELDS) {
    const input = $(`#set-${key}`);
    if (!input) continue;
    const event = kind === 'lines' ? 'change' : 'input';
    input.addEventListener(event, async () => {
      let value;
      if (kind === 'checkbox') value = input.checked;
      else if (kind === 'select') value = input.value;
      else if (kind === 'lines') {
        value = input.value.split('\n').map((line) => line.trim()).filter(Boolean);
      } else {
        const parsed = Number(input.value);
        value = Number.isFinite(parsed) ? parsed : DEFAULT_SETTINGS[key];
      }
      state.settings = await saveSettings({ [key]: value });
      chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
      if (key === 'theme') applyTheme();
      if (key === 'ignoreHash') refreshTabs();
    });
  }
}

async function renderStats() {
  const stats = await getStats();
  $('#stat-slept-total').textContent = String(stats.sleptTotal || 0);
  $('#stat-closed-total').textContent = String(stats.closedTotal || 0);
}

async function exportData() {
  const payload = {
    app: 'tab-diet',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    categories: state.categories,
    links: state.links,
    stashes: state.stashes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: `tab-diet-backup-${Date.now()}.json` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('バックアップを書き出しました');
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'tab-diet' || !Array.isArray(data.links)) {
      toast('Tab Diet のバックアップファイルではありません');
      return;
    }
    const ok = await confirmDialog(
      `ジャンル ${(data.categories || []).length}件 / リンク ${data.links.length}件 / `
      + `退避 ${(data.stashes || []).length}件 を読み込みます。\n今の内容は置き換わります。`,
      '読み込む',
    );
    if (!ok) return;
    state.stashes = Array.isArray(data.stashes) ? data.stashes : [];
    state.settings = await saveSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
    await Promise.all([
      saveLinks(data.links),
      saveStashes(state.stashes),
      saveCategories(Array.isArray(data.categories) ? data.categories : []),
    ]);
    // 旧形式(グループ名の文字列)で書き出したファイルもここでジャンルに変換される
    const store = await ensureCategories();
    state.categories = store.categories;
    state.links = store.links;
    state.activeCategory = ALL;
    fillSettings();
    renderCategoryBar();
    renderLinks();
    renderStashes();
    toast('読み込みました');
  } catch {
    toast('読み込めませんでした');
  }
}

/* ------------------------------------------------------------------ *
 * 更新とイベント配線
 * ------------------------------------------------------------------ */

async function refreshTabs() {
  const [tabs, lastActive] = await Promise.all([chrome.tabs.query({}), getLastActiveMap()]);
  state.tabs = tabs;
  state.lastActive = lastActive;
  renderTabs();
  renderLinks();
  await updateMeter();
}

let refreshTimer;
function scheduleRefresh() {
  if (dragLinkId) return; // 並べ替え中は再描画しない
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshTabs, 250);
}

function bindEvents() {
  // ビュー切り替え
  document.querySelectorAll('.seg').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      document.querySelectorAll('.seg').forEach((item) => {
        item.classList.toggle('is-active', item === button);
      });
      document.querySelectorAll('.view').forEach((view) => {
        view.classList.toggle('is-active', view.id === `view-${state.view}`);
      });
      if (state.view === 'settings') renderStats();
    });
  });

  // ヘッダー
  $('#btn-theme').addEventListener('click', async () => {
    const next = resolveTheme(state.settings.theme) === 'light' ? 'dark' : 'light';
    state.settings = await saveSettings({ theme: next });
    $('#set-theme').value = next;
    applyTheme();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.settings.theme === 'auto') applyTheme();
  });

  $('#btn-sleep-now').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'sleep-now', force: true });
    toast(response?.count ? `${response.count}本をスリープしました` : 'スリープできるタブがありませんでした');
    refreshTabs();
  });

  // リンク
  $('#link-search').addEventListener('input', (event) => {
    state.linkQuery = event.target.value;
    renderLinks();
  });
  $('#btn-add-current').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return;
    if (await addLink({ title: tab.title, url: tab.url })) toast('登録しました');
  });
  $('#btn-add-from-tabs').addEventListener('click', openTabPicker);
  $('#picker-close').addEventListener('click', () => { $('#picker').hidden = true; });

  // タブ
  $('#tab-search').addEventListener('input', (event) => {
    state.tabQuery = event.target.value;
    renderTabs();
  });
  $('#btn-dupes').addEventListener('click', cleanDuplicates);
  $('#btn-sleep-idle').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'sleep-now', force: false });
    toast(response?.count
      ? `${response.count}本をスリープしました`
      : `${state.settings.sleepAfterMin}分以上放置されたタブはありません`);
    refreshTabs();
  });
  $('#btn-bulk-sleep').addEventListener('click', () => sleepTabs(selectedTabs()));
  $('#btn-bulk-stash').addEventListener('click', () => stashTabs(selectedTabs()));
  $('#btn-bulk-close').addEventListener('click', () => closeTabs(selectedTabs()));

  // 退避
  $('#btn-stash-window').addEventListener('click', () => {
    const targets = state.tabs.filter((tab) => tab.windowId === state.currentWindowId && !tab.pinned);
    stashTabs(targets);
  });
  $('#btn-stash-others').addEventListener('click', () => {
    const targets = state.tabs.filter(
      (tab) => tab.windowId === state.currentWindowId && !tab.pinned && !tab.active);
    stashTabs(targets);
  });

  // 設定
  bindSettings();
  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) importData(file);
    event.target.value = '';
  });

  // タブの状態が変わったら描画し直す
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onMoved.addListener(scheduleRefresh);
  chrome.tabs.onActivated.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener(scheduleRefresh);
  chrome.windows.onFocusChanged.addListener(scheduleRefresh);
}

async function init() {
  const [settings, stashes, currentWindow, store] = await Promise.all([
    getSettings(),
    getStashes(),
    chrome.windows.getCurrent(),
    ensureCategories(),
  ]);
  state.settings = settings;
  state.stashes = stashes;
  state.currentWindowId = currentWindow.id;
  state.categories = store.categories;
  state.links = store.links;

  applyTheme();
  $('#btn-add-current').replaceChildren(icon('plus', 13), el('span', { text: '今のページ' }));

  fillSettings();
  bindEvents();
  renderCategoryBar();
  renderStashes();
  await Promise.all([refreshTabs(), renderStats()]);
}

init();
