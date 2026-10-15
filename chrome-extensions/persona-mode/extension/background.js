/*
 * ペルソナ憑依モード：バックグラウンド
 */
importScripts('shared/background.js', 'shared/bridge.js');

self.WDT.bg.enablePanelOnClick();
// サイドパネルを閉じたら、見え方とズームを元に戻す
self.WDT.bg.onPanelClosed(async (tabId) => {
  await self.WDT.bridge.callIfLoaded(tabId, 'clear').catch(() => {});
  const key = `zoom:${tabId}`;
  const saved = (await chrome.storage.session.get(key))[key];
  if (saved != null) {
    await chrome.tabs.setZoom(tabId, saved).catch(() => {});
    await chrome.storage.session.remove(key);
  }
});
