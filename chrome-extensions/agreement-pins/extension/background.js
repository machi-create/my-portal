/*
 * 合意ピン：バックグラウンド
 * - ピンのあるページを開いたら、自動でピンを表示してアイコンに件数を出す
 */
importScripts('shared/background.js', 'shared/bridge.js', 'lib/pins.js');

const B = self.WDT.bridge;
const D = self.PIN.data;
B.configure({ files: ['shared/page.js', 'shared/picker.js', 'shared/selector.js', 'content/content.js'] });

self.WDT.bg.enablePanelOnClick();

async function settings() {
  return { ...D.DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(D.DEFAULT_SETTINGS)) };
}

async function showPins(tabId, url) {
  if (!/^(?:https?|file):/i.test(url || '')) return;
  const s = await settings();
  const pins = D.filterForUrl(await D.loadPage(url), url, s);
  const open = pins.some((p) => ['pending', 'question'].includes(D.statusOf(p)));
  await chrome.action.setBadgeText({ tabId, text: pins.length ? String(pins.length) : '' }).catch(() => {});
  if (pins.length) await chrome.action.setBadgeBackgroundColor({ tabId, color: open ? '#d97706' : '#16a34a' }).catch(() => {});
  if (!s.autoShow || !pins.length) return;
  try {
    await B.call(tabId, 'render', { pins, visible: true });
  } catch (e) {
    /* 表示できないページ */
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') showPins(tabId, tab.url);
});

// サイドパネルを閉じたら、自動表示がオフのときだけピンを片付ける
self.WDT.bg.onPanelClosed(async (tabId) => {
  const s = await settings();
  if (!s.autoShow) return B.callIfLoaded(tabId, 'clear');
  return B.callIfLoaded(tabId, 'setActive', { id: null });
});
