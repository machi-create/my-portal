/*
 * 共通：サイドパネルが「いま見ているタブ」を追いかける
 * ※ 正本は chrome-extensions/_shared/ です。
 *
 *   WDT.panel.on('target', ({ reason }) => …)   対象タブが決まった・切り替わった
 *   WDT.panel.on('reload', ({ urlChanged }) => …) 対象タブが再読み込み・遷移した
 *   await WDT.panel.init()
 *
 * テスト用：sidepanel.html?tabId=123 で対象タブを固定できる
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});

  const params = new URLSearchParams(location.search);
  const FORCED = params.has('tabId') ? Number(params.get('tabId')) : null;
  const state = { tabId: null, windowId: null, url: '', title: '', port: null };
  const listeners = { target: [], reload: [] };

  const emit = (ev, detail) => {
    for (const fn of listeners[ev]) {
      try {
        const r = fn(detail);
        if (r && typeof r.catch === 'function') r.catch((e) => console.error(e));
      } catch (e) {
        console.error(e);
      }
    }
  };

  function isUsable(url) {
    return /^(?:https?|file):/i.test(url || '');
  }

  async function setTarget(tabId, reason) {
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      /* タブが閉じられた */
    }
    state.tabId = tab ? tabId : null;
    state.url = (tab && tab.url) || '';
    state.title = (tab && tab.title) || '';
    if (state.port && tab) {
      try {
        state.port.postMessage({ type: 'target', tabId });
      } catch (e) {
        state.port = null;
      }
    }
    emit('target', { reason, tab });
  }

  async function init() {
    const win = await chrome.windows.getCurrent();
    state.windowId = win.id;
    try {
      state.port = chrome.runtime.connect({ name: 'wdt-panel' });
      // バックグラウンドに受け口がない拡張機能では、すぐに切れる。切れた接続には送らない
      state.port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        state.port = null;
      });
    } catch (e) {
      state.port = null;
    }
    chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
      if (FORCED != null || windowId !== state.windowId) return;
      setTarget(tabId, 'switch');
    });
    chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
      if (tabId !== state.tabId) return;
      if (info.title) state.title = info.title;
      if (info.status === 'complete') {
        const urlChanged = (tab.url || '') !== state.url;
        state.url = tab.url || '';
        state.title = tab.title || state.title;
        emit('reload', { tab, urlChanged });
      }
    });
    let id = FORCED;
    if (id == null) {
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      id = tab ? tab.id : null;
    }
    if (id != null) await setTarget(id, 'init');
    else emit('target', { reason: 'init', tab: null });
  }

  function label(url) {
    url = url == null ? state.url : url;
    try {
      const u = new URL(url);
      if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').pop());
      return u.host + u.pathname + u.search;
    } catch (e) {
      return url || '—';
    }
  }

  WDT.panel = {
    init,
    on(ev, fn) {
      listeners[ev].push(fn);
    },
    get tabId() {
      return state.tabId;
    },
    get windowId() {
      return state.windowId;
    },
    get url() {
      return state.url;
    },
    get title() {
      return state.title;
    },
    usable() {
      return state.tabId != null && isUsable(state.url);
    },
    isUsable,
    label,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
