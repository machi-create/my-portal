/**
 * Tab Diet / service worker
 * - 放置タブの自動スリープ
 * - タブの最終利用時刻の記録
 * - ツールバーバッジの更新
 */
import {
  getSettings,
  refreshBadge,
  sleepIdleTabs,
  touchTab,
  forgetTab,
} from './common.js';

const SWEEP_ALARM = 'tab-diet-sweep';

/** 定期チェック用のアラームを用意する(既にあれば作り直さない) */
async function ensureAlarm() {
  const existing = await chrome.alarms.get(SWEEP_ALARM);
  if (!existing) {
    await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
  }
}

/** 起動時に、いま開いているタブの利用時刻を埋めておく */
async function seedLastActive() {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const map = {};
  for (const tab of tabs) map[tab.id] = tab.lastAccessed || now;
  await chrome.storage.session.set({ lastActive: map });
}

chrome.runtime.onInstalled.addListener(async () => {
  // ツールバーアイコンのクリックでサイドパネルを開く
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // 非対応バージョンでは無視(サイドパネルは手動で開ける)
  }
  await ensureAlarm();
  await seedLastActive();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await seedLastActive();
  await refreshBadge();
});

/* --- タブの利用状況を追跡 --- */

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await touchTab(tabId);
  await refreshBadge();
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await touchTab(tab.id);
  await refreshBadge();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // 読み込み完了 / 音声再生の変化を「使われた」とみなす
  if (changeInfo.status === 'complete' || changeInfo.audible) {
    await touchTab(tabId);
  }
  if (changeInfo.discarded !== undefined || changeInfo.status === 'complete') {
    await refreshBadge();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await forgetTab(tabId);
  await refreshBadge();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) await touchTab(tab.id);
});

/* --- 定期スイープ --- */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SWEEP_ALARM) return;
  const settings = await getSettings();
  if (settings.autoSleep) {
    await sleepIdleTabs();
  }
  await refreshBadge();
});

/* --- サイドパネルからの依頼 --- */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'sleep-now': {
        const count = await sleepIdleTabs({ force: !!message.force });
        await refreshBadge();
        sendResponse({ ok: true, count });
        break;
      }
      case 'refresh-badge':
        await refreshBadge();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // 非同期で応答する
});
