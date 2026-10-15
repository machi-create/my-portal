/*
 * テストアップチェッカー：拡張機能（サイドパネル・バックグラウンド）からページ側の処理を呼び出す
 */
(function (root) {
  'use strict';
  const TUC = (root.TUC = root.TUC || {});

  const CONTENT_FILES = ['lib/normalize.js', 'lib/diff.js', 'lib/settings.js', 'content/content.js'];

  async function isLoaded(tabId) {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!(globalThis.TUC && globalThis.TUC.api),
    });
    return !!(probe && probe.result);
  }

  async function ensureInjected(tabId) {
    if (await isLoaded(tabId)) return;
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  }

  async function invoke(tabId, name, args) {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fn, input) => {
        try {
          return { ok: true, value: await globalThis.TUC.api[fn](input) };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      },
      args: [name, args === undefined ? null : args],
    });
    if (!res || !res.result) throw new Error('ページから応答がありませんでした');
    if (!res.result.ok) throw new Error(res.result.error);
    return res.result.value;
  }

  async function call(tabId, name, args) {
    await ensureInjected(tabId);
    return invoke(tabId, name, args);
  }

  /** すでに読み込み済みのときだけ呼ぶ（後片付け用） */
  async function callIfLoaded(tabId, name, args) {
    if (!(await isLoaded(tabId))) return null;
    return invoke(tabId, name, args);
  }

  async function setBadge(tabId, summary) {
    if (!summary) return chrome.action.setBadgeText({ tabId, text: '' });
    let text = '✓';
    let color = '#16a34a';
    if (summary.error > 0) {
      text = String(Math.min(summary.error, 99));
      color = '#dc2626';
    } else if (summary.warn > 0) {
      text = String(Math.min(summary.warn, 99));
      color = '#d97706';
    }
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    await chrome.action.setBadgeText({ tabId, text });
  }

  function friendlyError(e) {
    const msg = String((e && e.message) || e || '');
    if (/Cannot access|cannot be scripted|chrome:\/\/|chrome-extension:\/\/|extensions gallery|Missing host permission|webstore|The tab was closed|No tab with id/i.test(msg)) {
      return 'このページでは使用できません（Chromeの設定画面・ウェブストア・拡張機能のページなど）';
    }
    if (/file:\/\//i.test(msg)) {
      return 'ローカルファイルを確認するには、拡張機能の詳細で「ファイルの URL へのアクセスを許可する」をオンにしてください';
    }
    return msg || '不明なエラーが発生しました';
  }

  TUC.bridge = { CONTENT_FILES, ensureInjected, call, callIfLoaded, setBadge, friendlyError };
})(typeof globalThis !== 'undefined' ? globalThis : this);
