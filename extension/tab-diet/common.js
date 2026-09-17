/**
 * Tab Diet 共通モジュール
 * service worker とサイドパネルの両方から import して使う。
 */

/** 既定の設定値 */
export const DEFAULT_SETTINGS = {
  theme: 'auto',          // 表示テーマ: auto(OSに追従) / light / dark
  autoSleep: true,        // 放置タブの自動スリープ
  sleepAfterMin: 30,      // 何分放置でスリープさせるか
  keepPinned: true,       // ピン留めタブは対象外
  keepAudible: true,      // 音が鳴っているタブは対象外
  excludeList: [],        // 除外するURL/ドメインの部分文字列
  tabWarn: 25,            // この本数を超えたらバッジを警告色にする
  showBadge: true,        // ツールバーアイコンにタブ数を出す
  ignoreHash: true,       // クイックリンクの一致判定で #以降 を無視する
  confirmClose: true,     // タブをまとめて閉じる前に確認する
};

/** スリープ(discard)できないURLスキーム */
const PROTECTED_SCHEMES = [
  'chrome:', 'chrome-extension:', 'chrome-untrusted:',
  'devtools:', 'edge:', 'about:', 'view-source:',
];

export const STORE = {
  settings: 'settings',
  links: 'links',
  categories: 'categories',
  stashes: 'stashes',
  stats: 'stats',
};

/** リンクの初期ジャンル。名前の変更・追加・削除はUIから自由に行える */
export const DEFAULT_CATEGORIES = [
  { id: 'cat-sheet', name: '管理シート' },
  { id: 'cat-tool', name: '業務ツール' },
  { id: 'cat-info', name: '情報収集' },
  { id: 'cat-other', name: 'その他' },
];

/* ------------------------------------------------------------------ *
 * ストレージ
 * ------------------------------------------------------------------ */

export async function getSettings() {
  const { settings } = await chrome.storage.local.get(STORE.settings);
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [STORE.settings]: next });
  return next;
}

export async function getLinks() {
  const { links } = await chrome.storage.local.get(STORE.links);
  return Array.isArray(links) ? links : [];
}

export async function saveLinks(links) {
  await chrome.storage.local.set({ [STORE.links]: links });
}

export async function getCategories() {
  const { categories } = await chrome.storage.local.get(STORE.categories);
  return Array.isArray(categories) ? categories : [];
}

export async function saveCategories(categories) {
  await chrome.storage.local.set({ [STORE.categories]: categories });
}

/**
 * ジャンル(カテゴリ)を使える状態に整える。
 * - 未設定なら既定の4ジャンルを作る
 * - 旧形式(link.group の文字列)のリンクを categoryId 方式へ移行する
 * - 参照先が消えたリンクは先頭のジャンルへ寄せる
 */
export async function ensureCategories() {
  const categories = await getCategories();
  const links = await getLinks();
  let categoriesChanged = false;
  let linksChanged = false;

  if (categories.length === 0) {
    categories.push(...DEFAULT_CATEGORIES.map((category) => ({ ...category })));
    categoriesChanged = true;
  }

  const byName = new Map(categories.map((category) => [category.name, category]));
  const ids = new Set(categories.map((category) => category.id));

  for (const link of links) {
    if (link.categoryId && ids.has(link.categoryId)) {
      if ('group' in link) {
        delete link.group;
        linksChanged = true;
      }
      continue;
    }
    const name = String(link.group || '').trim();
    let category = name ? byName.get(name) : null;
    if (name && !category) {
      category = { id: uid(), name };
      categories.push(category);
      byName.set(name, category);
      ids.add(category.id);
      categoriesChanged = true;
    }
    link.categoryId = (category || categories[0]).id;
    delete link.group;
    linksChanged = true;
  }

  if (categoriesChanged) await saveCategories(categories);
  if (linksChanged) await saveLinks(links);
  return { categories, links };
}

export async function getStashes() {
  const { stashes } = await chrome.storage.local.get(STORE.stashes);
  return Array.isArray(stashes) ? stashes : [];
}

export async function saveStashes(stashes) {
  await chrome.storage.local.set({ [STORE.stashes]: stashes });
}

export async function getStats() {
  const { stats } = await chrome.storage.local.get(STORE.stats);
  return { sleptTotal: 0, closedTotal: 0, ...(stats || {}) };
}

export async function bumpStats(patch) {
  const stats = await getStats();
  for (const [key, value] of Object.entries(patch)) {
    stats[key] = (stats[key] || 0) + value;
  }
  await chrome.storage.local.set({ [STORE.stats]: stats });
  return stats;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ------------------------------------------------------------------ *
 * URL まわり
 * ------------------------------------------------------------------ */

/** 比較用にURLを正規化する(末尾スラッシュと必要に応じてハッシュを落とす) */
export function normalizeUrl(url, ignoreHash = true) {
  try {
    const u = new URL(url);
    if (ignoreHash) u.hash = '';
    u.searchParams.delete('usp'); // Googleの共有リンクに付く余計なパラメータ
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return url || '';
  }
}

/** 2つのURLを「同じページ」とみなすか */
export function sameTarget(a, b, ignoreHash = true) {
  return normalizeUrl(a, ignoreHash) === normalizeUrl(b, ignoreHash);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** chrome の内部ページなど、触ってはいけないURLか */
export function isProtectedUrl(url = '') {
  return PROTECTED_SCHEMES.some((scheme) => url.startsWith(scheme));
}

/** 除外リスト(部分一致)に該当するか */
export function isExcluded(url = '', excludeList = []) {
  const target = url.toLowerCase();
  return excludeList.some((raw) => {
    const needle = String(raw).trim().toLowerCase();
    return needle.length > 0 && target.includes(needle);
  });
}

/** favicon はブラウザのキャッシュから取り出す(追加の通信をしない) */
export function faviconUrl(pageUrl, size = 32) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl || '');
  url.searchParams.set('size', String(size));
  return url.toString();
}

/* ------------------------------------------------------------------ *
 * タブの最終利用時刻
 * ------------------------------------------------------------------ */

const LAST_ACTIVE_KEY = 'lastActive';

export async function getLastActiveMap() {
  const data = await chrome.storage.session.get(LAST_ACTIVE_KEY);
  return data[LAST_ACTIVE_KEY] || {};
}

export async function touchTab(tabId, at = Date.now()) {
  const map = await getLastActiveMap();
  map[tabId] = at;
  await chrome.storage.session.set({ [LAST_ACTIVE_KEY]: map });
}

export async function forgetTab(tabId) {
  const map = await getLastActiveMap();
  if (tabId in map) {
    delete map[tabId];
    await chrome.storage.session.set({ [LAST_ACTIVE_KEY]: map });
  }
}

/**
 * タブが最後に使われた時刻(ms)。
 * Chrome 121+ の tab.lastAccessed を優先し、無ければ自前の記録を使う。
 */
export function lastUsedAt(tab, lastActiveMap, fallback = Date.now()) {
  if (typeof tab.lastAccessed === 'number' && tab.lastAccessed > 0) {
    return tab.lastAccessed;
  }
  return lastActiveMap[tab.id] ?? fallback;
}

/* ------------------------------------------------------------------ *
 * スリープ判定
 * ------------------------------------------------------------------ */

/**
 * このタブをスリープさせてよいか判定する。
 * @returns {{ok: boolean, reason?: string}}
 */
export function canSleep(tab, settings, idleMs) {
  if (tab.discarded) return { ok: false, reason: 'すでにスリープ中' };
  if (tab.active) return { ok: false, reason: '表示中のタブ' };
  if (isProtectedUrl(tab.url || tab.pendingUrl || '')) return { ok: false, reason: 'ブラウザの内部ページ' };
  if (settings.keepPinned && tab.pinned) return { ok: false, reason: 'ピン留め' };
  if (settings.keepAudible && tab.audible) return { ok: false, reason: '音声を再生中' };
  if (isExcluded(tab.url || '', settings.excludeList)) return { ok: false, reason: '除外リスト' };
  if (idleMs < settings.sleepAfterMin * 60_000) return { ok: false, reason: 'まだ放置時間に達していない' };
  return { ok: true };
}

/**
 * 条件を満たす放置タブをまとめてスリープさせる。
 * @param {{force?: boolean}} options force=true なら放置時間を無視する
 * @returns {Promise<number>} スリープさせた本数
 */
export async function sleepIdleTabs(options = {}) {
  const settings = await getSettings();
  const [tabs, lastActiveMap] = await Promise.all([
    chrome.tabs.query({}),
    getLastActiveMap(),
  ]);
  const now = Date.now();
  let count = 0;

  for (const tab of tabs) {
    const idleMs = now - lastUsedAt(tab, lastActiveMap, now);
    const check = canSleep(tab, settings, options.force ? Infinity : idleMs);
    if (!check.ok) continue;
    try {
      await chrome.tabs.discard(tab.id);
      count += 1;
    } catch {
      // 編集中のフォームがある等、Chrome側が拒否するケースは黙って飛ばす
    }
  }

  if (count > 0) await bumpStats({ sleptTotal: count });
  return count;
}

/* ------------------------------------------------------------------ *
 * 重複タブ
 * ------------------------------------------------------------------ */

/**
 * 同じページを開いているタブをグループ化して返す(2本以上のものだけ)。
 * 各グループの先頭は「残す1本」(最後に使ったタブ)。
 */
export function findDuplicateGroups(tabs, ignoreHash = true, lastActiveMap = {}) {
  const buckets = new Map();
  for (const tab of tabs) {
    if (!tab.url || isProtectedUrl(tab.url)) continue;
    const key = normalizeUrl(tab.url, ignoreHash);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tab);
  }
  const groups = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    // ピン留め > アクティブ > 最近使った順 で残す1本を決める
    const sorted = [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.active !== b.active) return a.active ? -1 : 1;
      const aAt = a.lastAccessed || lastActiveMap[a.id] || 0;
      const bAt = b.lastAccessed || lastActiveMap[b.id] || 0;
      return bAt - aAt;
    });
    groups.push({ key, keep: sorted[0], close: sorted.slice(1) });
  }
  return groups;
}

/* ------------------------------------------------------------------ *
 * バッジ
 * ------------------------------------------------------------------ */

export async function refreshBadge() {
  const settings = await getSettings();
  if (!settings.showBadge) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const tabs = await chrome.tabs.query({});
  const sleeping = tabs.filter((t) => t.discarded).length;
  const total = tabs.length;

  await chrome.action.setBadgeText({ text: String(total) });
  await chrome.action.setBadgeBackgroundColor({
    color: total > settings.tabWarn ? '#ff6b8b' : '#4c7dff',
  });
  await chrome.action.setTitle({
    title: `Tab Diet — ${total}本 (スリープ中 ${sleeping}本)`,
  });
}
