/*
 * 共通：Chrome 内蔵AI（Gemini Nano / Prompt API）を「使えるときだけ」使う
 * ※ 正本は chrome-extensions/_shared/ です。
 *
 * 端末内で動くため、ページや原稿の内容が外部に送られることはありません。
 * 使えない環境では status() が 'unsupported' / 'unavailable' を返し、各ツールはルールベースの結果だけを表示します。
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});

  const LANG = { expectedInputs: [{ type: 'text', languages: ['ja'] }], expectedOutputs: [{ type: 'text', languages: ['ja'] }] };

  function api() {
    return typeof root.LanguageModel !== 'undefined' ? root.LanguageModel : null;
  }

  /** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' */
  async function status() {
    const LM = api();
    if (!LM || typeof LM.availability !== 'function') return 'unsupported';
    try {
      return await LM.availability(LANG);
    } catch (e) {
      try {
        return await LM.availability();
      } catch (e2) {
        return 'unavailable';
      }
    }
  }

  const LABELS = {
    available: 'Chrome内蔵AI：利用できます',
    downloadable: 'Chrome内蔵AI：初回はモデルのダウンロードが必要です',
    downloading: 'Chrome内蔵AI：モデルをダウンロード中です',
    unavailable: 'Chrome内蔵AI：この端末では利用できません',
    unsupported: 'Chrome内蔵AI：このChromeでは利用できません（ルールベースで動作します）',
  };

  /**
   * @param {string} system  役割の指示
   * @param {string} input   入力
   * @param {{onProgress?: (ratio:number)=>void, signal?: AbortSignal}} opts
   */
  async function prompt(system, input, opts) {
    const LM = api();
    if (!LM) throw new Error('Chrome内蔵AIを利用できません');
    const o = opts || {};
    const createOpts = {
      ...LANG,
      initialPrompts: [{ role: 'system', content: system }],
      monitor(m) {
        if (o.onProgress) m.addEventListener('downloadprogress', (e) => o.onProgress(e.loaded));
      },
    };
    let session;
    try {
      session = await LM.create(createOpts);
    } catch (e) {
      delete createOpts.expectedInputs;
      delete createOpts.expectedOutputs;
      session = await LM.create(createOpts);
    }
    try {
      return await session.prompt(input, o.signal ? { signal: o.signal } : undefined);
    } finally {
      if (session && typeof session.destroy === 'function') session.destroy();
    }
  }

  /** モデルを準備する（初回はダウンロード。ユーザーの操作から呼ぶこと） */
  async function prepare(onProgress) {
    const LM = api();
    if (!LM) throw new Error('Chrome内蔵AIを利用できません');
    const session = await LM.create({
      ...LANG,
      monitor(m) {
        if (onProgress) m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
      },
    });
    if (session && typeof session.destroy === 'function') session.destroy();
    return status();
  }

  /** 設定画面の「AI」欄を作る。状態の表示と、ダウンロードが必要なときの準備ボタン */
  function mountStatus(container, onChange) {
    const doc = container.ownerDocument;
    container.textContent = '';
    const text = doc.createElement('p');
    text.className = 'hint';
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small';
    btn.textContent = 'AIを準備する（初回のみ・数GBのダウンロード）';
    btn.hidden = true;
    container.append(text, btn);
    const render = (st) => {
      text.textContent = LABELS[st] || st;
      btn.hidden = st !== 'downloadable';
      if (onChange) onChange(st);
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        render(await prepare((r) => (text.textContent = `Chrome内蔵AI：ダウンロード中… ${Math.round(r * 100)}%`)));
      } catch (e) {
        text.textContent = `Chrome内蔵AI：準備できませんでした（${(e && e.message) || e}）`;
      } finally {
        btn.disabled = false;
      }
    });
    status().then(render);
  }

  WDT.ai = { status, prompt, prepare, mountStatus, LABELS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
