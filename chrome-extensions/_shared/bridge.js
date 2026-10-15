/*
 * 共通：拡張機能（サイドパネル・バックグラウンド）からページ側の処理を呼び出す
 * ※ 正本は chrome-extensions/_shared/ です。
 *
 * 使い方：WDT.bridge.configure({ files: [...], css: [...] }) を最初に1回呼ぶ。
 * ページ側では globalThis.WDT.api に関数を並べておく。
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});

  const config = { files: [], css: [] };

  function configure(opts) {
    Object.assign(config, opts);
  }

  async function isLoaded(tabId) {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!(globalThis.WDT && globalThis.WDT.api),
    });
    return !!(probe && probe.result);
  }

  async function ensureInjected(tabId) {
    if (await isLoaded(tabId)) return;
    if (config.css.length) await chrome.scripting.insertCSS({ target: { tabId }, files: config.css });
    await chrome.scripting.executeScript({ target: { tabId }, files: config.files });
  }

  async function invoke(tabId, name, args) {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fn, input) => {
        try {
          if (!globalThis.WDT || !globalThis.WDT.api || typeof globalThis.WDT.api[fn] !== 'function') {
            return { ok: false, error: `unknown api: ${fn}` };
          }
          return { ok: true, value: await globalThis.WDT.api[fn](input) };
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

  async function callIfLoaded(tabId, name, args) {
    if (!(await isLoaded(tabId))) return null;
    return invoke(tabId, name, args);
  }

  function friendlyError(e) {
    const msg = String((e && e.message) || e || '');
    if (/Cannot access|cannot be scripted|chrome:\/\/|chrome-extension:\/\/|extensions gallery|Missing host permission|webstore|The tab was closed|No tab with id|Frame with ID 0 was removed/i.test(msg)) {
      return 'このページでは使用できません（Chromeの設定画面・新しいタブ・ウェブストアなど）';
    }
    if (/file:\/\//i.test(msg)) {
      return 'ローカルファイルで使うには、拡張機能の詳細で「ファイルの URL へのアクセスを許可する」をオンにしてください';
    }
    return msg || '不明なエラーが発生しました';
  }

  /** 表示中のタブを画像にする（サイドパネルからの呼び出し用） */
  async function captureTab(windowId) {
    return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  }

  /** 画像（dataURL）を切り抜く。rect はビューポート上の CSS ピクセル */
  async function cropImage(dataUrl, rect, dpr, maxWidth) {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const scale = dpr || 1;
    const sx = Math.max(0, Math.round(rect.left * scale));
    const sy = Math.max(0, Math.round(rect.top * scale));
    const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rect.width * scale)));
    const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rect.height * scale)));
    const ratio = maxWidth && sw > maxWidth ? maxWidth / sw : 1;
    const canvas = new OffscreenCanvas(Math.round(sw * ratio), Math.round(sh * ratio));
    canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(out);
    });
  }

  WDT.bridge = { configure, isLoaded, ensureInjected, call, callIfLoaded, friendlyError, captureTab, cropImage };
})(typeof globalThis !== 'undefined' ? globalThis : this);
