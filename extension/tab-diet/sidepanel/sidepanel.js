/**
 * Tab Diet サイドパネル
 * 「よく使うページへの即アクセス」と「タブのメモリ整理」をまとめたUI。
 */
import {
  getSettings,
  saveSettings,
  getLinks,
  saveLinks,
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
const DEFAULT_GROUP = 'よく使う';
/** スリープ1本あたりのメモリ削減量の目安(MB)。実測値ではなく概算表示用 */
const MB_PER_TAB = 100;

const state = {
  settings: { ...DEFAULT_SETTINGS },
  links: [],
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
 * リンク(よく使うページ)
 * ------------------------------------------------------------------ */

function groupedLinks() {
  const query = state.linkQuery.trim().toLowerCase();
  const filtered = query
    ? state.links.filter((link) =>
        `${link.title} ${link.url} ${link.group || ''}`.toLowerCase().includes(query))
    : state.links;

  const groups = new Map();
  for (const link of filtered) {
    const name = link.group || DEFAULT_GROUP;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(link);
  }
  return groups;
}

function renderLinks() {
  const list = $('#link-list');
  list.replaceChildren();
  $('#link-empty').hidden = state.links.length > 0;

  const openUrls = state.tabs.map((tab) => tab.url).filter(Boolean);

  for (const [groupName, links] of groupedLinks()) {
    list.append(el('div', { class: 'group-head', text: groupName }));
    for (const link of links) {
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
            title: '名前とグループを編集',
            text: '✎',
            onclick: (event) => { event.stopPropagation(); editLink(link); },
          }),
          el('button', {
            class: 'icon-btn danger',
            title: 'このリンクを削除',
            text: '✕',
            onclick: async (event) => {
              event.stopPropagation();
              state.links = state.links.filter((item) => item.id !== link.id);
              await saveLinks(state.links);
              renderLinks();
              toast('削除しました');
            },
          }),
        ]),
      ]);
      attachDragHandlers(row, link);
      list.append(row);
    }
  }
}

/** ドラッグ&ドロップでの並べ替え(グループをまたぐと所属も変わる) */
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
    moved.group = link.group || DEFAULT_GROUP; // ドロップ先のグループに移す
    const to = state.links.findIndex((item) => item.id === link.id);
    state.links.splice(after ? to + 1 : to, 0, moved);
    await saveLinks(state.links);
    renderLinks();
  });
}

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after')
    .forEach((node) => node.classList.remove('drop-before', 'drop-after'));
}

async function addLink({ title, url, group }) {
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
    group: (group || '').trim() || DEFAULT_GROUP,
    hits: 0,
    createdAt: Date.now(),
  });
  await saveLinks(state.links);
  renderLinks();
  return true;
}

function editLink(link) {
  const titleInput = el('input', { class: 'field', type: 'text', value: link.title });
  const groupInput = el('input', { class: 'field', type: 'text', value: link.group || DEFAULT_GROUP });
  const close = () => overlay.remove();

  const overlay = el('div', {
    class: 'modal',
    onclick: (event) => { if (event.target === overlay) close(); },
  }, [
    el('div', { class: 'modal-card glass' }, [
      el('div', { class: 'modal-head' }, [
        el('strong', { text: 'リンクを編集' }),
        el('button', { class: 'icon-btn', text: '✕', onclick: close }),
      ]),
      el('div', { class: 'modal-body' }, [
        el('label', { class: 'col' }, [el('span', { text: '表示名' }), titleInput]),
        el('label', { class: 'col' }, [el('span', { text: 'グループ' }), groupInput]),
        el('p', { class: 'note', text: link.url }),
      ]),
      el('div', { class: 'modal-foot' }, [
        el('button', {
          class: 'pill-btn primary',
          text: '保存する',
          style: 'flex:1',
          onclick: async () => {
            link.title = titleInput.value.trim() || link.title;
            link.group = groupInput.value.trim() || DEFAULT_GROUP;
            await saveLinks(state.links);
            close();
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

  $('#picker-group').value = '';
  $('#picker').hidden = false;
  $('#picker-ok').onclick = async () => {
    const group = $('#picker-group').value;
    let added = 0;
    for (const tab of candidates) {
      if (!picked.has(tab.id)) continue;
      if (await addLink({ title: tab.title, url: tab.url, group })) added += 1;
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
      if (tab.pinned) badges.push(el('span', { class: 'badge', text: '📌' }));
      if (tab.audible) badges.push(el('span', { class: 'badge', text: '🔊' }));
      if (tab.discarded) badges.push(el('span', { class: 'badge sleep', text: '💤 スリープ中' }));
      else if (!tab.active) badges.push(el('span', { class: 'badge', text: formatAgo(idleMs) }));

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
            text: '💤',
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
          }) : null,
          el('button', {
            class: 'icon-btn danger',
            title: 'このタブを閉じる',
            text: '✕',
            onclick: async (event) => {
              event.stopPropagation();
              await chrome.tabs.remove(tab.id);
              await bumpStats({ closedTotal: 1 });
              state.selected.delete(tab.id);
              refreshTabs();
            },
          }),
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
      text: '▾',
      title: '中身を見る',
      onclick: () => {
        links.hidden = !links.hidden;
        toggle.textContent = links.hidden ? '▾' : '▴';
      },
    });

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
                  el('button', { class: 'icon-btn', text: '✕', onclick: close }),
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
      else if (kind === 'lines') {
        value = input.value.split('\n').map((line) => line.trim()).filter(Boolean);
      } else {
        const parsed = Number(input.value);
        value = Number.isFinite(parsed) ? parsed : DEFAULT_SETTINGS[key];
      }
      state.settings = await saveSettings({ [key]: value });
      chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
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
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
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
      `リンク ${data.links.length}件 / 退避 ${(data.stashes || []).length}件 を読み込みます。\n今の内容は置き換わります。`,
      '読み込む',
    );
    if (!ok) return;
    state.links = data.links;
    state.stashes = Array.isArray(data.stashes) ? data.stashes : [];
    state.settings = await saveSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
    await Promise.all([saveLinks(state.links), saveStashes(state.stashes)]);
    fillSettings();
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
  const [settings, links, stashes, currentWindow] = await Promise.all([
    getSettings(),
    getLinks(),
    getStashes(),
    chrome.windows.getCurrent(),
  ]);
  state.settings = settings;
  state.links = links;
  state.stashes = stashes;
  state.currentWindowId = currentWindow.id;

  fillSettings();
  bindEvents();
  renderStashes();
  await Promise.all([refreshTabs(), renderStats()]);
}

init();
