/*
 * テストアップチェッカー：バックグラウンド（Service Worker）
 * - アイコンのクリックでサイドパネルを開く
 * - 登録ドメインのページを開いたら公開前チェックを自動実行し、アイコンに件数を表示する
 * - サイドパネルを閉じたらページ上のハイライトを消す
 */
importScripts('lib/settings.js', 'lib/bridge.js');

const S = self.TUC.settings;
const B = self.TUC.bridge;

function enablePanelOnClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
enablePanelOnClick();
chrome.runtime.onInstalled.addListener(enablePanelOnClick);
chrome.runtime.onStartup.addListener(enablePanelOnClick);

async function autoCheck(tabId, url) {
  if (!url || !/^https?:/i.test(url)) return;
  const settings = await S.load();
  const envInfo = S.detectEnv(url, settings);
  const enabled =
    settings.autoCheck === 'all' || (settings.autoCheck === 'registered' && envInfo.source === 'settings');
  if (!enabled) {
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }
  try {
    const res = await B.call(tabId, 'runAccident', { env: envInfo.env, settings, silent: true });
    await B.setBadge(tabId, res.summary);
    if (envInfo.env === 'production' && settings.showToast && res.summary.error > 0) {
      await B.call(tabId, 'showToast', {
        title: `公開前チェック：エラーが${res.summary.error}件あります`,
        message: '拡張機能「テストアップチェッカー」のアイコンをクリックすると詳細を確認できます。',
        sev: 'error',
      });
    }
  } catch (e) {
    // 対象外のページ（chrome:// など）や読み込み途中で閉じたタブは無視する
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') autoCheck(tabId, tab.url);
});

// サイドパネルが閉じられたら、操作していたタブのハイライトを片付ける
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'tuc-panel') return;
  const touched = new Set();
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'target' && typeof msg.tabId === 'number') touched.add(msg.tabId);
  });
  port.onDisconnect.addListener(() => {
    for (const tabId of touched) B.callIfLoaded(tabId, 'clear', null).catch(() => {});
  });
});
