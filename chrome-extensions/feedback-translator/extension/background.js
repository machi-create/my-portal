/*
 * フィードバック翻訳機：バックグラウンド
 */
importScripts('shared/background.js', 'shared/bridge.js');

self.WDT.bg.enablePanelOnClick();
// サイドパネルを閉じたら、プレビューと選択表示を元に戻す
self.WDT.bg.onPanelClosed((tabId) => self.WDT.bridge.callIfLoaded(tabId, 'clear'));
