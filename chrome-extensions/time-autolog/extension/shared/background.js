/*
 * 共通：バックグラウンド（Service Worker）用のヘルパー
 * ※ 正本は chrome-extensions/_shared/ です。
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});

  /** ツールバーのアイコンでサイドパネルを開く */
  function enablePanelOnClick() {
    const run = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    run();
    chrome.runtime.onInstalled.addListener(run);
    chrome.runtime.onStartup.addListener(run);
  }

  /** サイドパネルが閉じられたら、操作していたタブで fn(tabId) を呼ぶ */
  function onPanelClosed(fn) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'wdt-panel') return;
      const touched = new Set();
      port.onMessage.addListener((msg) => {
        if (msg && msg.type === 'target' && typeof msg.tabId === 'number') touched.add(msg.tabId);
      });
      port.onDisconnect.addListener(() => {
        for (const tabId of touched) Promise.resolve(fn(tabId)).catch(() => {});
      });
    });
  }

  WDT.bg = { enablePanelOnClick, onPanelClosed };
})(typeof globalThis !== 'undefined' ? globalThis : this);
