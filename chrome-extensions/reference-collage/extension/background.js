/*
 * 参考サイト・コラージュ：バックグラウンド
 */
importScripts('shared/background.js', 'shared/bridge.js');

self.WDT.bg.enablePanelOnClick();
self.WDT.bg.onPanelClosed((tabId) => self.WDT.bridge.callIfLoaded(tabId, 'clear'));
