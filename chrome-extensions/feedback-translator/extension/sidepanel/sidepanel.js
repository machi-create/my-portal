/*
 * フィードバック翻訳機：サイドパネル
 */
(() => {
  'use strict';
  const { ui, bridge: B, panel, ai } = window.WDT;
  const { $, h, clip, snack, busy } = ui;
  const R = window.FT.rules;
  const C = window.FT.color;

  B.configure({ files: ['shared/page.js', 'shared/picker.js', 'shared/selector.js', 'content/content.js'] });

  const SETTINGS = { repo: '', labels: '', signature: '', autoShot: true };
  const state = {
    settings: { ...SETTINGS },
    info: null,
    shot: null,
    analysis: null,
    previewOn: false,
    out: 'dev',
    aiStatus: 'unsupported',
    picking: false,
  };

  // ================================================================ 対象タブ
  function renderTarget() {
    $('targetUrl').textContent = panel.label();
    $('targetUrl').title = panel.url;
    $('unavailable').hidden = panel.usable() || !panel.url;
    for (const id of ['pickBtn', 'analyzeBtn']) $(id).disabled = !panel.usable();
  }

  function resetSelection() {
    state.info = null;
    state.shot = null;
    state.previewOn = false;
    renderInfo();
    renderAnalysis();
  }

  // ================================================================ 1. 要素
  async function pick() {
    if (!panel.usable()) return;
    const done = busy($('pickBtn'), 'ページ上で要素をクリック…');
    $('pickCancel').hidden = false;
    state.picking = true;
    try {
      const res = await B.call(panel.tabId, 'pick');
      if (res.cancelled) return;
      state.info = res.info;
      state.previewOn = false;
      state.shot = null;
      renderInfo();
      if (state.settings.autoShot) await takeShot();
      if ($('feedback').value.trim()) analyze();
      else $('feedback').focus();
    } catch (e) {
      snack(B.friendlyError(e), 5000);
    } finally {
      state.picking = false;
      $('pickCancel').hidden = true;
      done();
    }
  }

  async function takeShot() {
    try {
      const cap = await B.call(panel.tabId, 'prepareCapture');
      if (!cap) return;
      const dataUrl = await chrome.tabs.captureVisibleTab(panel.windowId, { format: 'png' });
      state.shot = await B.cropImage(dataUrl, cap.rect, cap.dpr, 1400);
    } catch (e) {
      state.shot = null;
      snack('スクリーンショットを撮れませんでした（ページを表示した状態で「撮り直す」を押してください）', 5000);
    } finally {
      B.callIfLoaded(panel.tabId, 'endCapture').catch(() => {});
      renderShot();
    }
  }

  function styleRow(label, value, cls) {
    return h('div', null, h('dt', null, label), h('dd', { class: cls || null, title: typeof value === 'string' ? value : null }, value));
  }

  function swatchValue(color) {
    const c = C.parse(color);
    const hex = c ? C.toHex(c) : color;
    return h('span', null, h('i', { class: 'swatch', style: { background: color } }), hex);
  }

  function renderInfo() {
    const info = state.info;
    $('pickEmpty').hidden = !!info;
    $('infoBox').hidden = !info;
    $('repick').hidden = !info;
    if (!info) return;
    const s = info.styles;
    $('infoRole').textContent = R.ROLE_LABELS[info.role] || '要素';
    $('infoText').textContent = info.text || `<${info.tag}>`;
    $('infoSelector').textContent = info.selector;
    const bg = C.parse(s.background) || { r: 255, g: 255, b: 255, a: 1 };
    const fg = C.blend(C.parse(s.color) || { r: 0, g: 0, b: 0, a: 1 }, bg);
    const ratio = C.contrast(fg, bg);
    const lh = s.lineHeight && s.fontSize ? (s.lineHeight / s.fontSize).toFixed(2) : 'normal';
    const pad = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map((v) => Math.round(v));
    const padText = pad[0] === pad[2] && pad[1] === pad[3] ? (pad[0] === pad[1] ? `${pad[0]}px` : `${pad[0]}px ${pad[1]}px`) : pad.map((v) => `${v}px`).join(' ');
    const grid = $('styleGrid');
    grid.textContent = '';
    grid.append(
      styleRow('文字サイズ', `${Math.round(s.fontSize)}px`),
      styleRow('太さ', String(s.fontWeight)),
      styleRow('行間', lh),
      styleRow('大きさ', `${info.rect.width}×${info.rect.height}`),
      styleRow('文字色', swatchValue(s.color)),
      styleRow('背景', swatchValue(s.background)),
      styleRow('コントラスト', `${ratio.toFixed(1)} : 1`, ratio < 4.5 ? 'contrast-bad' : 'contrast-ok'),
      styleRow('内側の余白', padText)
    );
    renderShot();
  }

  function renderShot() {
    $('shotBox').hidden = !state.info;
    $('shotImg').hidden = !state.shot;
    if (state.shot) $('shotImg').src = state.shot;
    for (const id of ['shotCopy', 'shotSave']) $(id).hidden = !state.shot;
  }

  // ================================================================ 2〜3. 要望 → 修正案
  async function analyze() {
    const feedback = $('feedback').value.trim();
    if (!feedback) {
      snack('先方の要望を入力してください');
      $('feedback').focus();
      return;
    }
    if (!state.info) {
      snack('先に、修正したい要素をページ上で選んでください');
      return;
    }
    let result = R.analyze(feedback, state.info);
    if (!result.intents.length && state.aiStatus === 'available') {
      const ids = await aiClassify(feedback);
      if (ids.length) {
        const phrase = ids.map((id) => (R.INTENTS.find((i) => i.id === id) || {}).chip || '').filter(Boolean).join('、');
        if (phrase) {
          result = R.analyze(phrase, state.info);
          result.viaAi = phrase;
        }
      }
    }
    state.analysis = result;
    if (state.previewOn) await applyPreview();
    renderAnalysis();
  }

  async function aiClassify(feedback) {
    const options = R.INTENTS.filter((i) => i.chip).map((i) => `${i.id}: ${i.chip}`).join('\n');
    const system = 'あなたはWebディレクターのアシスタントです。クライアントの要望が、次のどの方向性に当てはまるかを判断し、当てはまるIDだけをカンマ区切りで答えてください。説明は不要です。\n' + options;
    try {
      const text = await ai.prompt(system, feedback);
      const valid = new Set(R.INTENTS.map((i) => i.id));
      return String(text).split(/[\s,、]+/).map((s) => s.trim()).filter((s) => valid.has(s)).slice(0, 3);
    } catch (e) {
      return [];
    }
  }

  function selectedProposals() {
    return state.analysis ? state.analysis.proposals.filter((p) => p.apply) : [];
  }

  function valueEl(p) {
    if (p.css === 'color') {
      return h('span', null, h('i', { class: 'swatch', style: { background: p.from } }), p.from, h('span', { class: 'arrow' }, '→'), h('i', { class: 'swatch', style: { background: p.to } }), h('span', { class: 'to' }, p.to), p.note ? h('span', { class: 'muted' }, `（${p.note}）`) : null);
    }
    return h('span', null, clip(p.from, 40), h('span', { class: 'arrow' }, '→'), h('span', { class: 'to' }, clip(p.to, 60)));
  }

  function renderAnalysis() {
    const a = state.analysis;
    $('proposalCard').hidden = !a || !state.info;
    $('outputCard').hidden = !a || !state.info;
    if (!a || !state.info) return;
    const line = $('intentLine');
    line.textContent = '';
    if (a.intents.length) line.append('解釈：', ...a.intents.map((i) => h('span', { class: 'pill accent' }, i.label)));
    if (a.viaAi) line.append(h('span', { class: 'ai-badge', title: `AIが「${a.viaAi}」と解釈しました` }, 'AI'));

    const none = !a.intents.length;
    $('noIntent').hidden = !(none || !a.proposals.length);
    $('noIntent').textContent = none
      ? '要望から方向性を読み取れませんでした。下のよくある要望から近いものを選ぶか、「大きく」「読みにくい」など具体的な言葉で言い換えてください。'
      : '選んだ要素は、すでにこの方向性に沿った見た目になっています（変更案はありません）。別の言い方や、別の要素を試してください。';

    const ul = $('proposals');
    ul.textContent = '';
    for (const p of a.proposals) {
      const cb = h('input', { type: 'checkbox', 'aria-label': p.label });
      cb.checked = p.apply;
      cb.addEventListener('change', () => {
        p.apply = cb.checked;
        li.classList.toggle('off', !p.apply);
        if (state.previewOn) applyPreview();
        renderOutput();
      });
      const li = h(
        'li',
        { class: `proposal${p.apply ? '' : ' off'}` },
        cb,
        h('div', { class: 'proposal-head' }, h('span', { class: 'proposal-label' }, p.label), h('span', { class: 'proposal-css' }, p.css)),
        h('div', { class: 'proposal-value' }, valueEl(p)),
        h('div', { class: 'proposal-reason' }, p.reason)
      );
      ul.append(li);
    }
    const notes = $('notes');
    notes.textContent = '';
    for (const n of a.notes) notes.append(h('li', null, n));
    renderPreviewState();
    renderOutput();
  }

  // ---------------------------------------------------------------- プレビュー
  async function applyPreview() {
    const styles = Object.fromEntries(selectedProposals().map((p) => [p.css, p.to]));
    try {
      if (!Object.keys(styles).length) await B.call(panel.tabId, 'revert');
      else await B.call(panel.tabId, 'preview', { styles });
    } catch (e) {
      state.previewOn = false;
      snack(B.friendlyError(e), 5000);
    }
    renderPreviewState();
  }

  async function togglePreview() {
    if (!state.analysis) return;
    state.previewOn = !state.previewOn;
    if (state.previewOn) await applyPreview();
    else {
      await B.callIfLoaded(panel.tabId, 'revert').catch(() => {});
      renderPreviewState();
    }
  }

  function renderPreviewState() {
    const btn = $('previewBtn');
    btn.setAttribute('aria-pressed', String(state.previewOn));
    btn.textContent = state.previewOn ? 'プレビューを解除' : 'ページでプレビュー';
    $('previewState').textContent = state.previewOn ? 'ページ上に修正後の見た目を表示中（保存はされません）' : '';
  }

  // ================================================================ 4. 書き出し
  function reportCtx() {
    return {
      info: state.info,
      feedback: $('feedback').value.trim(),
      intents: state.analysis ? state.analysis.intents : [],
      proposals: state.analysis ? state.analysis.proposals : [],
      notes: state.analysis ? state.analysis.notes : [],
      url: state.info ? state.info.url : panel.url,
      title: state.info ? state.info.title : panel.title,
      signature: state.settings.signature,
    };
  }

  function currentOutput() {
    if (!state.analysis || !state.info) return '';
    if (state.out === 'client' && state.clientOverride) return state.clientOverride;
    return state.out === 'dev' ? R.devReport(reportCtx()) : R.clientReport(reportCtx());
  }

  function renderOutput() {
    state.clientOverride = null;
    $('output').textContent = currentOutput();
    for (const b of document.querySelectorAll('[data-out]')) b.setAttribute('aria-checked', String(b.dataset.out === state.out));
    $('aiPolish').hidden = state.out !== 'client' || state.aiStatus !== 'available';
    $('issueHint').textContent = state.settings.repo
      ? `${state.settings.repo} に Issue を作成します。スクリーンショットはクリップボードにコピーされるので、本文に貼り付けてください。`
      : 'Issue を作成するには、設定タブで GitHub リポジトリを登録してください。';
  }

  async function createIssue() {
    if (!state.settings.repo) {
      selectTab('tab-set');
      $('setRepo').focus();
      return;
    }
    const ctx = reportCtx();
    const title = `【修正依頼】${R.targetLabel(ctx.info)}：「${clip(ctx.feedback, 30)}」`;
    let body = R.devReport(ctx);
    if (state.shot) body += '\n\n### スクリーンショット\n（クリップボードの画像をここに貼り付けてください）\n';
    const params = new URLSearchParams({ title, body });
    if (state.settings.labels.trim()) params.set('labels', state.settings.labels.split(/[,、]/).map((s) => s.trim()).filter(Boolean).join(','));
    if (state.shot) {
      try {
        await ui.copyImage(state.shot, 'スクリーンショットをコピーしました。Issue の本文に貼り付けてください');
      } catch (e) {
        /* コピーできなくても Issue は作れる */
      }
    }
    await chrome.tabs.create({ url: `https://github.com/${state.settings.repo.replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '')}/issues/new?${params}` });
  }

  async function aiPolish() {
    const text = $('output').textContent;
    const done = busy($('aiPolish'), 'AIで整えています…');
    try {
      const system = 'あなたはWebディレクターです。クライアントに送る修正内容の説明文を、丁寧で分かりやすい日本語のビジネス文面に整えてください。数値や内容は変えず、専門用語は使わないでください。文面だけを出力してください。';
      const out = await ai.prompt(system, text);
      state.clientOverride = String(out).trim();
      $('output').textContent = state.clientOverride;
    } catch (e) {
      snack('AIで整えられませんでした', 4000);
    } finally {
      done();
    }
  }

  // ================================================================ 専門用語 → やさしく
  function runEasy() {
    const src = $('easyInput').value.trim();
    if (!src) {
      snack('言い換えたい文章を入力してください');
      return;
    }
    const r = R.easyJapanese(src);
    $('easyResult').hidden = false;
    $('easyText').textContent = r.text;
    const dl = $('easyTerms');
    dl.textContent = '';
    if (!r.terms.length) dl.append(h('dd', null, '置き換えた用語はありません'));
    for (const t of r.terms) dl.append(h('dt', null, t.term), h('dd', null, t.plain));
    $('easyAiRow').hidden = state.aiStatus !== 'available';
  }

  async function easyAi() {
    const done = busy($('easyAi'), 'AIで整えています…');
    try {
      const system = 'あなたはWebディレクターです。次の技術的な説明を、Webに詳しくないクライアントにも伝わるやさしい日本語に書き直してください。内容は省略せず、専門用語は使わないか、使う場合は短く説明を添えてください。文章だけを出力してください。';
      const out = await ai.prompt(system, $('easyInput').value.trim());
      $('easyText').textContent = String(out).trim();
    } catch (e) {
      snack('AIで整えられませんでした', 4000);
    } finally {
      done();
    }
  }

  // ================================================================ 設定
  async function loadSettings() {
    state.settings = { ...SETTINGS, ...(await chrome.storage.sync.get(SETTINGS)) };
    $('setRepo').value = state.settings.repo;
    $('setLabels').value = state.settings.labels;
    $('setSignature').value = state.settings.signature;
    $('setAutoShot').checked = !!state.settings.autoShot;
  }

  const saveSettings = ui.debounce(async () => {
    state.settings = {
      repo: $('setRepo').value.trim(),
      labels: $('setLabels').value.trim(),
      signature: $('setSignature').value.trim(),
      autoShot: $('setAutoShot').checked,
    };
    await chrome.storage.sync.set(state.settings);
    renderOutput();
    $('setSaved').textContent = '✓ 保存しました';
    setTimeout(() => ($('setSaved').textContent = ''), 1600);
  }, 400);

  // ================================================================ 初期化
  let selectTab = () => {};

  function bind() {
    selectTab = ui.setupTabs('ft.tab');
    $('pickBtn').addEventListener('click', pick);
    $('repick').addEventListener('click', pick);
    $('pickCancel').addEventListener('click', () => B.callIfLoaded(panel.tabId, 'cancelPick').catch(() => {}));
    $('focusBtn').addEventListener('click', async () => {
      try {
        const r = await B.call(panel.tabId, 'focus');
        if (r && r.hidden) snack('非表示の要素です');
        else if (!r || !r.ok) snack('要素が見つかりません。選び直してください');
      } catch (e) {
        snack(B.friendlyError(e));
      }
    });
    $('shotRetake').addEventListener('click', takeShot);
    $('shotCopy').addEventListener('click', () => state.shot && ui.copyImage(state.shot).catch(() => snack('画像をコピーできませんでした')));
    $('shotSave').addEventListener('click', async () => {
      if (!state.shot) return;
      ui.download(`feedback-${ui.isoDate(new Date())}.png`, await (await fetch(state.shot)).blob());
    });

    const chips = $('quickChips');
    for (const text of R.CHIPS) {
      chips.append(
        h('button', {
          class: 'chip',
          type: 'button',
          onclick: () => {
            const ta = $('feedback');
            ta.value = ta.value.trim() ? `${ta.value.trim()}、${text}` : text;
            ta.focus();
          },
        }, text)
      );
    }
    $('analyzeBtn').addEventListener('click', analyze);
    $('feedback').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        analyze();
      }
    });
    $('previewBtn').addEventListener('click', togglePreview);
    for (const b of document.querySelectorAll('[data-out]')) {
      b.addEventListener('click', () => {
        state.out = b.dataset.out;
        renderOutput();
      });
    }
    $('copyOut').addEventListener('click', () => ui.copyText($('output').textContent, 'コピーしました（Slack・Backlog・メールに貼り付けできます）'));
    $('issueBtn').addEventListener('click', createIssue);
    $('aiPolish').addEventListener('click', aiPolish);

    $('easyBtn').addEventListener('click', runEasy);
    $('easyCopy').addEventListener('click', () => ui.copyText($('easyText').textContent));
    $('easyAi').addEventListener('click', easyAi);

    for (const id of ['setRepo', 'setLabels', 'setSignature']) $(id).addEventListener('input', saveSettings);
    $('setAutoShot').addEventListener('change', saveSettings);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !Object.keys(changes).some((k) => k in SETTINGS)) return;
      if (document.activeElement && document.activeElement.closest('#panel-set')) return;
      loadSettings().then(renderOutput);
    });

    panel.on('target', ({ reason }) => {
      renderTarget();
      if (reason !== 'init') resetSelection();
    });
    panel.on('reload', () => {
      renderTarget();
      resetSelection();
    });
  }

  async function init() {
    bind();
    await loadSettings();
    renderOutput();
    await panel.init();
    renderTarget();
    ai.mountStatus($('aiStatus'), (st) => {
      state.aiStatus = st;
      renderOutput();
    });
  }

  init().catch((e) => snack(B.friendlyError(e), 6000));
})();
