/*
 * テストアップチェッカー：サイドパネル
 */
(() => {
  'use strict';
  const { settings: S, bridge: B, manuscript: M } = window.TUC;

  // テスト・デバッグ用：?tabId=123 で対象タブを固定できる
  const params = new URLSearchParams(location.search);
  const FORCED_TAB = params.has('tabId') ? Number(params.get('tabId')) : null;

  const $ = (id) => document.getElementById(id);
  const clip = (s, n = 40) => {
    const a = Array.from(String(s || ''));
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  };
  const debounce = (fn, ms) => {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const STATUS_LABEL = { ok: '一致', variant: '表記ゆれ', diff: '文言差分', missing: '未反映', extra: '原稿にない' };
  const FILTERS = [
    { id: 'issues', label: '要確認', dot: 'issues', match: (s) => s !== 'ok' },
    { id: 'diff', label: '文言差分', dot: 'diff', match: (s) => s === 'diff' },
    { id: 'variant', label: '表記ゆれ', dot: 'variant', match: (s) => s === 'variant' },
    { id: 'missing', label: '未反映', dot: 'missing', match: (s) => s === 'missing' },
    { id: 'extra', label: '原稿にない', dot: 'extra', match: (s) => s === 'extra' },
    { id: 'ok', label: '一致', dot: 'ok', match: (s) => s === 'ok' },
  ];
  const SEV_LABEL = { error: '要修正', warn: '注意', info: '情報', ok: 'OK' };
  const CATEGORIES = [
    ['dummy', 'ダミー・仮素材'],
    ['link', 'リンク・URL'],
    ['meta', 'SEO・メタ情報'],
    ['image', '画像'],
    ['tag', '計測タグ'],
    ['text', '表記・誤字'],
    ['legal', '表示・法務'],
  ];
  const MS_OPTION_DEFAULTS = {
    columns: '',
    skipHeader: false,
    scope: '',
    ignorePrefixes: M.DEFAULT_OPTIONS.ignorePrefixes,
    stripLabels: true,
    excludeHidden: false,
    detectExtras: true,
    excludeChrome: true,
    autoRerun: true,
  };
  const OPTION_FIELDS = {
    columns: ['optColumns', 'value'],
    skipHeader: ['optSkipHeader', 'checked'],
    scope: ['optScope', 'value'],
    ignorePrefixes: ['optIgnore', 'value'],
    stripLabels: ['optStrip', 'checked'],
    excludeHidden: ['optExcludeHidden', 'checked'],
    detectExtras: ['optExtras', 'checked'],
    excludeChrome: ['optExcludeChrome', 'checked'],
    autoRerun: ['optAutoRerun', 'checked'],
  };
  const PAGE_SIZE = 150;
  const LINK_LIMIT = 150;

  const state = {
    tabId: null,
    windowId: null,
    url: '',
    available: false,
    settings: { ...S.DEFAULTS },
    envInfo: { env: 'unknown', source: 'none' },
    msOptions: { ...MS_OPTION_DEFAULTS },
    msResult: null,
    msFilter: 'issues',
    msShown: PAGE_SIZE,
    accResult: null,
    linkResult: null,
    hl: { manuscript: true, ok: true, accident: true },
    cache: new Map(),
    port: null,
    busy: new Set(),
  };

  // ================================================================ 共通UI
  let snackTimer = 0;
  function snack(msg, ms = 2800) {
    const el = $('snackbar');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function setBusy(btn, busy, label) {
    if (busy) {
      state.busy.add(btn.id);
      btn.dataset.label = btn.textContent;
      if (label) btn.textContent = label;
      btn.classList.add('loading');
      btn.disabled = true;
    } else {
      state.busy.delete(btn.id);
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.classList.remove('loading');
      btn.disabled = !state.available;
    }
  }

  function selectTab(id) {
    for (const t of document.querySelectorAll('.tab')) {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    try {
      localStorage.setItem('tuc.tab', id);
    } catch (e) {
      /* 保存できなくても動作に影響なし */
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = h('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    snack('結果をコピーしました（Slack・Backlogなどにそのまま貼り付けできます）');
  }

  // ================================================================ 対象タブ
  async function resolveInitialTab() {
    const win = await chrome.windows.getCurrent();
    state.windowId = win.id;
    if (FORCED_TAB != null) return FORCED_TAB;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab ? tab.id : null;
  }

  async function setTarget(tabId) {
    if (state.tabId != null && state.tabId !== tabId) {
      state.cache.set(state.tabId, { url: state.url, msResult: state.msResult, accResult: state.accResult, linkResult: state.linkResult });
    }
    const prevUrl = state.url;
    state.tabId = tabId;
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      /* タブが閉じられた */
    }
    state.url = (tab && tab.url) || '';
    const cached = state.cache.get(tabId);
    if (cached && cached.url === state.url) {
      state.msResult = cached.msResult;
      state.accResult = cached.accResult;
      state.linkResult = cached.linkResult;
    } else {
      state.msResult = null;
      state.accResult = null;
      state.linkResult = null;
      state.cache.delete(tabId);
    }
    if (state.port) state.port.postMessage({ type: 'target', tabId });
    updateHeader();
    renderMs();
    renderAcc();
    renderLinks();
    if (state.url !== prevUrl) await loadManuscriptFor(state.url);
  }

  async function onTabReloaded(tab) {
    const hadMs = !!state.msResult;
    const hadAcc = !!state.accResult;
    const urlChanged = (tab.url || '') !== state.url;
    state.url = tab.url || '';
    state.msResult = null;
    state.accResult = null;
    state.linkResult = null;
    state.cache.delete(state.tabId);
    updateHeader();
    renderMs();
    renderAcc();
    renderLinks();
    if (urlChanged) await loadManuscriptFor(state.url);
    if (!state.msOptions.autoRerun || !state.available) return;
    if (hadMs && !urlChanged) await runManuscript({ silent: true });
    if (hadAcc) await runAccident({ silent: true });
  }

  function currentEnv() {
    if (/^file:/i.test(state.url)) return { env: 'staging', source: 'guess' };
    return S.detectEnv(state.url, state.settings);
  }

  function updateHeader() {
    const url = state.url;
    state.envInfo = currentEnv();
    let label = url;
    try {
      const u = new URL(url);
      label = u.protocol === 'file:' ? decodeURIComponent(u.pathname.split('/').pop()) : u.host + u.pathname + u.search;
    } catch (e) {
      /* URLでない */
    }
    $('targetUrl').textContent = label || '—';
    $('targetUrl').title = url;

    const { env, source } = state.envInfo;
    const shown = env === 'unsupported' ? 'unknown' : env;
    $('envBadge').dataset.env = shown;
    $('envBadge').textContent = S.ENV_LABELS[shown];
    $('envBadge2').dataset.env = shown;
    $('envBadge2').textContent = S.ENV_LABELS[shown] + (source === 'guess' ? '（自動判定）' : '');
    let hint;
    if (source === 'settings') {
      hint = env === 'production'
        ? '登録済みの本番ドメインです。noindex やテスト環境URLの残りを「要修正」として扱います。'
        : '登録済みのテスト環境です。noindex が無いときなどに「注意」を出します。';
    } else if (source === 'guess') {
      hint = 'ドメイン名からテスト環境と判定しました。設定タブで登録すると確実です。';
    } else {
      hint = '本番かテスト環境か判断できない項目は「注意」として表示します。';
    }
    $('envHint').textContent = hint;
    $('quickReg').hidden = source === 'settings' || !/^https?:/i.test(url);

    state.available = /^(?:https?|file):/i.test(url);
    $('unavailable').hidden = state.available || !url;
    $('unavailableMsg').textContent = 'Chromeの設定画面・新しいタブ・ウェブストア・PDFなどでは動作しません。確認したいページを開いてください。';
    for (const id of ['runMs', 'runAcc', 'runLinks']) if (!state.busy.has(id)) $(id).disabled = !state.available;
  }

  async function quickRegister(key) {
    let u;
    try {
      u = new URL(state.url);
    } catch (e) {
      return;
    }
    const host = u.port ? u.host : u.hostname;
    const other = key === 'productionHosts' ? 'stagingHosts' : 'productionHosts';
    const patch = {
      [key]: S.parseHostList([...state.settings[key], host]),
      [other]: state.settings[other].filter((p) => p !== host),
    };
    state.settings = { ...state.settings, ...patch };
    await S.save(patch);
    fillSettings();
    updateHeader();
    snack(`${host} を${key === 'productionHosts' ? '本番' : 'テスト環境'}として登録しました`);
  }

  // ================================================================ 原稿の入力
  function pageKeys(url) {
    try {
      const u = new URL(url);
      if (!/^(?:https?|file):$/.test(u.protocol)) return null;
      return { exact: `ms:${u.origin}${u.pathname}`, path: `msp:${u.pathname}` };
    } catch (e) {
      return null;
    }
  }

  async function loadManuscriptFor(url) {
    const keys = pageKeys(url);
    if (!keys) return;
    const data = await chrome.storage.local.get([keys.exact, keys.path]);
    const saved = data[keys.exact] || data[keys.path];
    if (saved && typeof saved.text === 'string') {
      if (saved.text !== $('msText').value) {
        $('msText').value = saved.text;
        updateMsStat();
      }
      $('msSaved').textContent = data[keys.exact] ? '✓ 保存済み' : '✓ 同じパスの原稿';
      $('msSaved').title = data[keys.exact] ? 'このページ用に保存されている原稿です' : '別のドメインの同じパスで使った原稿を読み込みました';
    } else {
      $('msSaved').textContent = '';
    }
  }

  async function saveManuscript() {
    const keys = pageKeys(state.url);
    const entry = { text: $('msText').value, savedAt: Date.now() };
    const patch = { 'ms:last': entry };
    if (keys) {
      patch[keys.exact] = entry;
      patch[keys.path] = entry;
    }
    await chrome.storage.local.set(patch);
    if (keys) {
      $('msSaved').textContent = '✓ 保存済み';
      $('msSaved').title = 'このページ用に保存されている原稿です';
    }
  }

  function parseCurrent() {
    const o = state.msOptions;
    return M.parse($('msText').value, {
      columns: o.columns,
      skipHeader: o.skipHeader,
      stripLabels: o.stripLabels,
      ignorePrefixes: o.ignorePrefixes,
    });
  }

  function updateMsStat() {
    const p = parseCurrent();
    $('msStat').textContent = p.segments.length ? `${p.segments.length}件（${p.format === 'tsv' ? '表形式' : 'テキスト'}）` : '0件';
  }
  const updateMsStatSoon = debounce(updateMsStat, 250);

  function setSource(src) {
    for (const b of document.querySelectorAll('.seg-btn')) b.setAttribute('aria-checked', String(b.dataset.src === src));
    for (const p of document.querySelectorAll('.src-pane')) p.hidden = p.dataset.pane !== src;
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
    const BLOCK = /^(?:P|DIV|LI|H[1-6]|TR|BR|SECTION|ARTICLE|HEADER|FOOTER|UL|OL|TABLE|BLOCKQUOTE|PRE|DT|DD|HR)$/;
    const lines = [];
    let cur = '';
    const flush = () => {
      if (cur.trim()) lines.push(cur);
      cur = '';
    };
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) cur += c.data.replace(/\s+/g, ' ');
        else if (c.nodeType === 1) {
          if (c.tagName === 'TD' || c.tagName === 'TH') {
            walk(c);
            cur += '\t';
            continue;
          }
          const blk = BLOCK.test(c.tagName);
          if (blk) flush();
          walk(c);
          if (blk) flush();
        }
      }
    })(doc.body || doc.documentElement);
    flush();
    return lines.map((l) => l.replace(/\t+$/, '').trim()).filter(Boolean).join('\n');
  }

  async function loadFromUrl() {
    const input = $('msUrl').value.trim();
    if (!input) {
      snack('URLを入力してください');
      $('msUrl').focus();
      return;
    }
    let target;
    try {
      target = M.toFetchUrl(input);
    } catch (e) {
      snack('URLの形式が正しくありません');
      return;
    }
    const btn = $('msUrlLoad');
    setBusy(btn, true);
    btn.disabled = true;
    try {
      const res = await fetch(target.url, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
      if (!res.ok) throw new Error(`読み込めませんでした（HTTP ${res.status}）`);
      const type = res.headers.get('content-type') || '';
      const isGoogle = target.kind.startsWith('Google');
      if (/accounts\.google\.com/.test(res.url) || (isGoogle && target.format !== 'html' && /text\/html/i.test(type))) {
        throw new Error('Googleのログイン画面が返されました。共有設定を「リンクを知っている全員」にするか、閲覧できるアカウントでChromeにログインしてください');
      }
      let text = M.decodeBytes(await res.arrayBuffer());
      let format = target.format;
      if (format === 'html' || (format === 'auto' && /text\/html/i.test(type))) format = 'html';
      else if (format === 'auto' && /csv/i.test(type)) format = 'csv';
      if (format === 'html') text = htmlToText(text);
      else if (format === 'csv') text = M.csvToTsv(text);
      $('msText').value = text.trim();
      updateMsStat();
      chrome.storage.local.set({ 'ms:lastUrl': input });
      snack(`${target.kind}から読み込みました`);
    } catch (e) {
      snack(e && e.message && !/Failed to fetch/i.test(e.message) ? e.message : '読み込めませんでした。URLと共有設定を確認してください', 6000);
    } finally {
      setBusy(btn, false);
      btn.disabled = false;
    }
  }

  async function loadFile(file) {
    if (!file) return;
    if (/\.(?:xlsx|xlsm|xls|numbers|docx?|pages)$/i.test(file.name)) {
      snack('Excel・Wordのファイルは直接読み込めません。CSVで保存するか、セルをコピーして貼り付けてください', 6500);
      return;
    }
    let text = M.decodeBytes(await file.arrayBuffer());
    if (/\.csv$/i.test(file.name)) text = M.csvToTsv(text);
    $('msText').value = text.trim();
    updateMsStat();
    snack(`「${file.name}」を読み込みました`);
  }

  function fillOptions() {
    for (const [k, [id, prop]] of Object.entries(OPTION_FIELDS)) $(id)[prop] = state.msOptions[k];
    $('optExcludeChrome').disabled = !state.msOptions.detectExtras;
  }

  function readOptions() {
    for (const [k, [id, prop]] of Object.entries(OPTION_FIELDS)) state.msOptions[k] = $(id)[prop];
    $('optExcludeChrome').disabled = !state.msOptions.detectExtras;
    chrome.storage.local.set({ msOptions: state.msOptions });
    updateMsStatSoon();
  }

  // ================================================================ 原稿照合
  async function runManuscript({ silent = false } = {}) {
    if (!state.available || state.tabId == null) return;
    const parsed = parseCurrent();
    if (!parsed.segments.length) {
      if (!silent) {
        snack('原稿を入力してください');
        $('msText').focus();
      }
      return;
    }
    const btn = $('runMs');
    setBusy(btn, true, '照合中…');
    try {
      const o = state.msOptions;
      const res = await B.call(state.tabId, 'runManuscript', {
        segments: parsed.segments,
        options: {
          scope: o.scope,
          excludeHidden: o.excludeHidden,
          detectExtras: o.detectExtras,
          excludeChrome: o.excludeChrome,
          threshold: state.settings.fuzzyThreshold / 100,
        },
      });
      await B.call(state.tabId, 'setVisibility', { manuscript: state.hl.manuscript, ok: state.hl.ok });
      const s = res.summary;
      state.msResult = res;
      state.msFilter = s.variant + s.diff + s.missing + s.extra ? 'issues' : 'ok';
      state.msShown = PAGE_SIZE;
      renderMs();
      saveManuscript();
      if (!res.highlightSupported) snack('このChromeではページ上の色付けに対応していません（Chrome 105以降が必要です）', 5000);
      else if (silent) snack('ページが更新されたので、もう一度照合しました');
    } catch (e) {
      snack(B.friendlyError(e), 6000);
    } finally {
      setBusy(btn, false);
    }
  }

  function renderDiff(ops) {
    const wrap = h('div', { class: 'diff' });
    const last = ops.length - 1;
    ops.forEach(([op, text], i) => {
      if (op === 0) {
        const a = Array.from(text);
        let t = text;
        if (a.length > 36) {
          if (i === 0) t = '…' + a.slice(-16).join('');
          else if (i === last) t = a.slice(0, 16).join('') + '…';
          else t = a.slice(0, 12).join('') + ' … ' + a.slice(-12).join('');
        }
        wrap.append(h('span', null, t));
      } else {
        const shown = text.replace(/ /g, '␣').replace(/　/g, '□');
        wrap.append(h(op < 0 ? 'del' : 'ins', { title: op < 0 ? '原稿にあってページにない' : 'ページにだけある' }, shown));
      }
    });
    return wrap;
  }

  function locationLabel(it) {
    if (!it.line) return '';
    return it.col != null ? `${it.line}行 ${M.columnName(it.col)}列` : `${it.line}行目`;
  }

  function msItemEl(it) {
    const clickable = !!it.refId;
    const li = h('li', { class: `item${clickable ? ' clickable' : ''}`, tabindex: clickable ? '0' : null, role: clickable ? 'button' : null });
    const meta = [];
    const loc = locationLabel(it);
    if (loc) meta.push(loc);
    if (it.similarity != null) meta.push(`類似度 ${Math.round(it.similarity * 100)}%`);
    if (it.count > 1) meta.push(`${it.count}箇所`);
    li.append(
      h(
        'div',
        { class: 'item-head' },
        h('span', { class: `pill ${it.status}` }, STATUS_LABEL[it.status]),
        meta.length ? h('span', { class: 'item-meta' }, meta.join(' ・ ')) : null,
        it.where && it.where !== 'page' ? h('span', { class: 'tag' }, it.where) : null,
        it.hidden ? h('span', { class: 'tag' }, '非表示の要素') : null
      )
    );
    if ((it.status === 'variant' || it.status === 'diff') && it.diff) li.append(renderDiff(it.diff));
    else li.append(h('div', { class: 'item-text' }, it.text));
    if (it.status === 'missing' && it.hint) {
      const hintText = clip(it.hint.text, 40);
      li.append(
        h(
          'div',
          { class: 'hint-line' },
          '近い箇所：',
          it.hint.refId
            ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => { e.stopPropagation(); focusRef(it.hint.refId); } }, hintText)
            : hintText
        )
      );
    }
    if (clickable) {
      li.addEventListener('click', () => focusRef(it.refId));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          focusRef(it.refId);
        }
      });
    }
    return li;
  }

  function renderMs() {
    const res = state.msResult;
    $('msResult').hidden = !res;
    $('msEmpty').hidden = !!res;
    if (!res) return;
    const s = res.summary;

    const ring = $('msRing');
    const perfect = s.total > 0 && s.ok === s.total && !s.extra;
    ring.style.setProperty('--p', String(s.rate));
    ring.style.setProperty('--c', perfect ? 'var(--ok)' : s.rate >= 90 ? 'var(--accent)' : 'var(--missing)');
    $('msRate').textContent = `${Math.floor(s.rate)}%`;
    $('msRateDesc').textContent = perfect
      ? `原稿${s.total}件すべてがページと一致しました`
      : `原稿${s.total}件のうち${s.found}件がページにあります（完全一致は${s.ok}件）`;

    const all = [...res.items, ...res.extras];
    const counts = Object.fromEntries(FILTERS.map((f) => [f.id, all.filter((i) => f.match(i.status)).length]));
    const chips = $('msChips');
    chips.textContent = '';
    for (const f of FILTERS) {
      chips.append(
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(state.msFilter === f.id),
            disabled: counts[f.id] === 0 && state.msFilter !== f.id,
            onclick: () => {
              state.msFilter = f.id;
              state.msShown = PAGE_SIZE;
              renderMs();
            },
          },
          h('i', { class: `dot ${f.dot}` }),
          f.label,
          h('b', null, counts[f.id])
        )
      );
    }

    const filter = FILTERS.find((f) => f.id === state.msFilter) || FILTERS[0];
    const list = all.filter((i) => filter.match(i.status));
    const ul = $('msItems');
    ul.textContent = '';
    if (!list.length) {
      ul.append(h('li', { class: 'no-results' }, filter.id === 'issues' ? '確認が必要な項目はありません 🎉' : '該当する項目はありません'));
    }
    for (const it of list.slice(0, state.msShown)) ul.append(msItemEl(it));
    if (list.length > state.msShown) {
      ul.append(
        h('li', null, h('button', { class: 'more', type: 'button', onclick: () => { state.msShown += PAGE_SIZE; renderMs(); } }, `さらに表示（残り${list.length - state.msShown}件）`))
      );
    }
    $('msElapsed').textContent = `${res.elapsed}ms`;
  }

  async function focusRef(refId) {
    if (state.tabId == null) return;
    try {
      const r = await B.call(state.tabId, 'focus', { refId });
      if (!r || !r.ok) snack('ページが更新されたため位置を表示できません。もう一度実行してください');
      else if (r.hidden) snack('非表示の要素内にあります（アコーディオン・タブ・スマホ用の表示などを開いて確認してください）', 4500);
    } catch (e) {
      snack(B.friendlyError(e));
    }
  }

  function msReport() {
    const r = state.msResult;
    const s = r.summary;
    const lines = [
      `【原稿照合】${r.title || ''}`,
      `URL：${r.url}`,
      `反映率 ${s.rate}%（一致 ${s.ok} / 表記ゆれ ${s.variant} / 文言差分 ${s.diff} / 未反映 ${s.missing}）・原稿にない文言 ${s.extra}件`,
      '',
    ];
    const section = (title, list, fmt) => {
      if (!list.length) return;
      lines.push(`■ ${title}（${list.length}件）`);
      for (const i of list) lines.push(fmt(i));
      lines.push('');
    };
    const loc = (i) => (locationLabel(i) ? `［${locationLabel(i)}］` : '');
    const pair = (i) => `・${loc(i)}原稿：${i.text}\n　　ページ：${i.page}`;
    section('文言差分', r.items.filter((i) => i.status === 'diff'), pair);
    section('表記ゆれ', r.items.filter((i) => i.status === 'variant'), pair);
    section('未反映', r.items.filter((i) => i.status === 'missing'), (i) => `・${loc(i)}${i.text}`);
    section('原稿にない文言', r.extras, (i) => `・${i.text}`);
    return lines.join('\n').trim();
  }

  // ================================================================ 公開前チェック
  async function runAccident({ silent = false } = {}) {
    if (!state.available || state.tabId == null) return;
    const btn = $('runAcc');
    setBusy(btn, true, 'チェック中…');
    try {
      const env = state.envInfo.env === 'unsupported' ? 'unknown' : state.envInfo.env;
      const res = await B.call(state.tabId, 'runAccident', { env, settings: state.settings });
      await B.call(state.tabId, 'setVisibility', { accident: state.hl.accident });
      state.accResult = res;
      state.linkResult = null;
      renderAcc();
      renderLinks();
      B.setBadge(state.tabId, res.summary).catch(() => {});
      if (silent) snack('ページが更新されたので、もう一度チェックしました');
    } catch (e) {
      snack(B.friendlyError(e), 6000);
    } finally {
      setBusy(btn, false);
    }
  }

  function checkCardEl(c) {
    const card = h(
      'div',
      { class: `check-card sev-${c.sev}` },
      h('div', { class: 'check-title' }, h('span', { class: `sev-label ${c.sev}` }, SEV_LABEL[c.sev]), h('span', null, c.title)),
      c.msg ? h('p', { class: 'check-msg' }, c.msg) : null
    );
    const items = c.items || [];
    if (items.length) {
      const LIMIT = 5;
      const ul = h('ul', { class: 'check-items' });
      items.forEach((it, i) => {
        const li = h('li', { class: it.refId ? 'clickable' : null, tabindex: it.refId ? '0' : null, role: it.refId ? 'button' : null }, it.text);
        if (i >= LIMIT) li.hidden = true;
        if (it.refId) {
          li.addEventListener('click', () => focusRef(it.refId));
          li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              focusRef(it.refId);
            }
          });
        }
        ul.append(li);
      });
      card.append(ul);
      if (items.length > LIMIT) {
        card.append(
          h('button', { class: 'link-btn', type: 'button', onclick: (e) => { ul.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; }); e.currentTarget.remove(); } }, `さらに${items.length - LIMIT}件を表示`)
        );
      }
      const total = c.total || items.length;
      if (total > items.length) card.append(h('p', { class: 'check-msg' }, `ほか${total - items.length}件（表示は先頭${items.length}件まで）`));
    }
    return card;
  }

  function updateTabCount() {
    const el = $('accCount');
    const res = state.accResult;
    if (!res) {
      el.hidden = true;
      return;
    }
    const s = res.summary;
    el.hidden = false;
    el.className = 'tab-count' + (s.error ? '' : s.warn ? ' warn' : ' ok');
    el.textContent = s.error ? String(s.error) : s.warn ? String(s.warn) : '✓';
  }

  function renderAcc() {
    const res = state.accResult;
    $('accResult').hidden = !res;
    $('accEmpty').hidden = !!res;
    updateTabCount();
    if (!res) return;
    const s = res.summary;

    const tiles = $('accTiles');
    tiles.textContent = '';
    for (const sev of ['error', 'warn', 'info', 'ok']) {
      tiles.append(h('div', { class: `tile ${sev}${s[sev] ? '' : ' zero'}` }, h('b', null, s[sev]), h('span', null, SEV_LABEL[sev])));
    }

    const groups = $('accGroups');
    groups.textContent = '';
    const order = { error: 0, warn: 1, info: 2 };
    for (const [cat, label] of CATEGORIES) {
      const checks = res.checks.filter((c) => c.cat === cat && c.sev !== 'ok').sort((a, b) => order[a.sev] - order[b.sev]);
      if (!checks.length) continue;
      groups.append(h('section', { class: 'group' }, h('h3', { class: 'group-title' }, label), checks.map(checkCardEl)));
    }
    if (!s.error && !s.warn && !s.info) {
      groups.append(h('div', { class: 'card' }, h('p', { class: 'ok-line' }, '✓ 問題は見つかりませんでした')));
    }
    const oks = res.checks.filter((c) => c.sev === 'ok');
    if (oks.length) {
      groups.append(
        h('details', { class: 'ok-list card' }, h('summary', null, `問題なし（${oks.length}件）`), h('ul', null, oks.map((c) => h('li', null, c.title))))
      );
    }
    $('accElapsed').textContent = `${res.elapsed}ms`;
  }

  // ---------------------------------------------------------------- リンク切れ
  async function probe(url) {
    const attempt = async (method) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10000);
      try {
        return await fetch(url, { method, redirect: 'follow', credentials: 'include', cache: 'no-store', signal: ac.signal });
      } finally {
        clearTimeout(timer);
        // 本文は不要なので、ヘッダーを受け取ったらGETの通信を打ち切る
        if (method === 'GET') ac.abort();
      }
    };
    try {
      let res = await attempt('HEAD');
      if ([400, 403, 404, 405, 429, 500, 501, 503].includes(res.status)) {
        try {
          res = await attempt('GET');
        } catch (e) {
          /* HEADの結果を使う */
        }
      }
      const code = res.status;
      if (code >= 200 && code < 400) return { code, level: res.redirected && res.url !== url ? 'redirect' : 'ok', finalUrl: res.url };
      if (code === 404 || code === 410) return { code, level: 'error', note: 'ページが見つかりません' };
      if (code >= 500) return { code, level: 'error', note: 'サーバーエラー' };
      if ([401, 403, 429, 999].includes(code)) return { code, level: 'unknown', note: 'アクセス制限のため確認できません' };
      return { code, level: 'error', note: `HTTP ${code}` };
    } catch (e) {
      if (e && e.name === 'AbortError') return { code: 0, level: 'unknown', note: 'タイムアウト' };
      return { code: 0, level: 'error', note: '接続できません' };
    }
  }

  async function runLinks() {
    if (!state.available || state.tabId == null) return;
    const btn = $('runLinks');
    setBusy(btn, true, '確認中…');
    $('linkProgress').hidden = false;
    $('linkBar').style.width = '0%';
    try {
      const { links, total } = await B.call(state.tabId, 'collectLinks', { limit: LINK_LIMIT });
      const results = [];
      const queue = links.slice();
      let done = 0;
      const worker = async () => {
        while (queue.length) {
          const link = queue.shift();
          results.push({ ...link, ...(await probe(link.url)) });
          done++;
          $('linkBar').style.width = `${(done / links.length) * 100}%`;
          btn.textContent = `確認中… ${done}/${links.length}`;
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, links.length) }, worker));
      results.sort((a, b) => links.indexOf(links.find((l) => l.url === a.url)) - links.indexOf(links.find((l) => l.url === b.url)));
      state.linkResult = { results, total, checked: links.length };
      const marks = results.filter((r) => r.level === 'error').map((r) => ({ refId: r.refId, sev: 'error', label: r.code ? `リンク切れ ${r.code}` : 'リンク切れ' }));
      if (marks.length) await B.call(state.tabId, 'mark', { items: marks });
      renderLinks();
    } catch (e) {
      snack(B.friendlyError(e), 6000);
    } finally {
      $('linkProgress').hidden = true;
      setBusy(btn, false);
    }
  }

  function renderLinks() {
    const box = $('linkResult');
    box.textContent = '';
    const lr = state.linkResult;
    if (!lr) return;
    if (!lr.checked) {
      box.append(h('p', { class: 'hint' }, 'チェック対象のリンクはありませんでした。'));
      return;
    }
    const by = (level) => lr.results.filter((r) => r.level === level);
    const errors = by('error');
    const unknown = by('unknown');
    const redirects = by('redirect');
    box.append(
      h('p', { class: 'hint' }, `${lr.checked}件を確認：リンク切れ ${errors.length}件 ・ 確認できず ${unknown.length}件 ・ リダイレクト ${redirects.length}件${lr.total > lr.checked ? `（全${lr.total}件中）` : ''}`)
    );
    if (errors.length) {
      box.append(checkCardEl({ sev: 'error', title: `リンク切れが${errors.length}件あります`, items: errors.map((r) => ({ text: `${r.note}${r.code ? `（${r.code}）` : ''}：${r.label} → ${r.url}`, refId: r.refId })) }));
    } else {
      box.append(h('p', { class: 'hint ok-line' }, '✓ リンク切れは見つかりませんでした'));
    }
    if (unknown.length) {
      box.append(checkCardEl({ sev: 'info', title: `確認できなかったリンクが${unknown.length}件あります`, msg: 'SNSなどアクセス制限のあるサイトは、ブラウザで開いて確認してください。', items: unknown.map((r) => ({ text: `${r.note}${r.code ? `（${r.code}）` : ''}：${r.url}`, refId: r.refId })) }));
    }
    if (redirects.length) {
      box.append(checkCardEl({ sev: 'info', title: `リダイレクトされるリンクが${redirects.length}件あります`, msg: '最終的なURLに書き換えると、表示が少し速くなります。', items: redirects.map((r) => ({ text: `${r.url} ⇒ ${r.finalUrl}`, refId: r.refId })) }));
    }
  }

  function accReport() {
    const r = state.accResult;
    const s = r.summary;
    const lines = [
      `【公開前チェック】${r.title || ''}`,
      `URL：${r.url}`,
      `判定：${S.ENV_LABELS[r.env] || r.env}　要修正 ${s.error} / 注意 ${s.warn} / 情報 ${s.info} / OK ${s.ok}`,
      '',
    ];
    for (const sev of ['error', 'warn', 'info']) {
      const checks = r.checks.filter((c) => c.sev === sev);
      if (!checks.length) continue;
      lines.push(`■ ${SEV_LABEL[sev]}`);
      for (const c of checks) {
        lines.push(`・${c.title}`);
        for (const it of c.items.slice(0, 10)) lines.push(`　- ${it.text}`);
        if ((c.total || c.items.length) > 10) lines.push(`　- ほか${(c.total || c.items.length) - 10}件`);
      }
      lines.push('');
    }
    const lr = state.linkResult;
    if (lr && lr.checked) {
      const errors = lr.results.filter((x) => x.level === 'error');
      lines.push(`■ リンク切れ（${lr.checked}件を確認）`);
      if (!errors.length) lines.push('・なし');
      for (const e of errors) lines.push(`・${e.note}${e.code ? `（${e.code}）` : ''}：${e.url}`);
    }
    return lines.join('\n').trim();
  }

  // ================================================================ 設定
  function fillSettings() {
    $('setProd').value = state.settings.productionHosts.join('\n');
    $('setStg').value = state.settings.stagingHosts.join('\n');
    for (const r of document.querySelectorAll('input[name="autoCheck"]')) r.checked = r.value === state.settings.autoCheck;
    $('setToast').checked = !!state.settings.showToast;
    $('setThr').value = String(state.settings.fuzzyThreshold);
    $('thrOut').textContent = `${state.settings.fuzzyThreshold}%`;
  }

  const saveSettings = debounce(async () => {
    const checked = document.querySelector('input[name="autoCheck"]:checked');
    const patch = {
      productionHosts: S.parseHostList($('setProd').value),
      stagingHosts: S.parseHostList($('setStg').value),
      autoCheck: checked ? checked.value : 'registered',
      showToast: $('setToast').checked,
      fuzzyThreshold: Number($('setThr').value),
    };
    state.settings = { ...state.settings, ...patch };
    await S.save(patch);
    updateHeader();
    $('setSaved').textContent = '✓ 保存しました';
    setTimeout(() => {
      $('setSaved').textContent = '';
    }, 1800);
  }, 400);

  // ================================================================ 初期化
  function bindEvents() {
    const tabs = [...document.querySelectorAll('.tab')];
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => selectTab(t.id));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(next.id);
        next.focus();
      });
    });

    for (const b of document.querySelectorAll('.seg-btn')) b.addEventListener('click', () => setSource(b.dataset.src));
    $('msUrlLoad').addEventListener('click', loadFromUrl);
    $('msUrl').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadFromUrl();
    });
    $('msFile').addEventListener('change', (e) => {
      loadFile(e.target.files[0]);
      e.target.value = '';
    });
    const dz = $('dropzone');
    for (const target of [dz, $('msText')]) {
      target.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        dz.classList.add('drag');
      });
      target.addEventListener('dragleave', () => dz.classList.remove('drag'));
      target.addEventListener('drop', (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        dz.classList.remove('drag');
        loadFile(e.dataTransfer.files[0]);
      });
    }
    $('msText').addEventListener('input', updateMsStatSoon);
    $('msText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        runManuscript();
      }
    });
    $('msClearText').addEventListener('click', async () => {
      $('msText').value = '';
      updateMsStat();
      const keys = pageKeys(state.url);
      if (keys) await chrome.storage.local.remove([keys.exact, keys.path]);
      await chrome.storage.local.remove('ms:last');
      $('msSaved').textContent = '';
      $('msText').focus();
    });
    for (const [id, prop] of Object.values(OPTION_FIELDS)) $(id).addEventListener(prop === 'checked' ? 'change' : 'input', readOptions);

    $('runMs').addEventListener('click', () => runManuscript());
    $('clearMs').addEventListener('click', async () => {
      state.msResult = null;
      renderMs();
      if (state.tabId != null) await B.callIfLoaded(state.tabId, 'clear', { group: 'manuscript' }).catch(() => {});
    });
    $('copyMs').addEventListener('click', () => state.msResult && copyText(msReport()));
    $('hlShow').addEventListener('change', () => {
      state.hl.manuscript = $('hlShow').checked;
      $('hlOk').disabled = !state.hl.manuscript;
      applyVisibility();
    });
    $('hlOk').addEventListener('change', () => {
      state.hl.ok = $('hlOk').checked;
      applyVisibility();
    });

    $('runAcc').addEventListener('click', () => runAccident());
    $('runLinks').addEventListener('click', runLinks);
    $('accShow').addEventListener('change', () => {
      state.hl.accident = $('accShow').checked;
      applyVisibility();
    });
    $('copyAcc').addEventListener('click', () => state.accResult && copyText(accReport()));
    for (const b of document.querySelectorAll('[data-reg]')) b.addEventListener('click', () => quickRegister(b.dataset.reg));

    for (const id of ['setProd', 'setStg']) {
      $(id).addEventListener('input', saveSettings);
      $(id).addEventListener('blur', () => {
        $(id).value = S.parseHostList($(id).value).join('\n');
      });
    }
    for (const r of document.querySelectorAll('input[name="autoCheck"]')) r.addEventListener('change', saveSettings);
    $('setToast').addEventListener('change', saveSettings);
    $('setThr').addEventListener('input', () => {
      $('thrOut').textContent = `${$('setThr').value}%`;
      saveSettings();
    });

    // ファイルをパネル内の別の場所に落としたときに、パネルがファイルを開いてしまわないようにする
    addEventListener('dragover', (e) => e.preventDefault());
    addEventListener('drop', (e) => e.preventDefault());

    // 別のウィンドウのパネルなどで設定が変わったら反映する
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      let touched = false;
      for (const [k, v] of Object.entries(changes)) {
        if (!(k in S.DEFAULTS)) continue;
        state.settings[k] = v.newValue === undefined ? S.DEFAULTS[k] : v.newValue;
        touched = true;
      }
      if (!touched) return;
      const active = document.activeElement;
      if (!(active && active.closest && active.closest('#panel-set'))) fillSettings();
      updateHeader();
    });

    chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
      if (FORCED_TAB != null || windowId !== state.windowId) return;
      setTarget(tabId);
    });
    chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
      if (tabId !== state.tabId) return;
      if (info.status === 'complete') onTabReloaded(tab);
      else if (info.url) {
        state.url = info.url;
        updateHeader();
      }
    });
  }

  async function applyVisibility() {
    if (state.tabId == null) return;
    try {
      await B.callIfLoaded(state.tabId, 'setVisibility', { ...state.hl });
    } catch (e) {
      /* ページ側が未読み込みなら何もしない */
    }
  }

  async function init() {
    bindEvents();
    const stored = await chrome.storage.local.get(['msOptions', 'ms:last', 'ms:lastUrl']);
    state.msOptions = { ...MS_OPTION_DEFAULTS, ...(stored.msOptions || {}) };
    fillOptions();
    if (stored['ms:lastUrl']) $('msUrl').value = stored['ms:lastUrl'];
    state.settings = await S.load();
    fillSettings();
    try {
      const t = localStorage.getItem('tuc.tab');
      if (t && $(t)) selectTab(t);
    } catch (e) {
      /* 既定のタブのまま */
    }
    state.port = chrome.runtime.connect({ name: 'tuc-panel' });
    const tabId = await resolveInitialTab();
    if (tabId != null) await setTarget(tabId);
    else updateHeader();
    if (!$('msText').value && stored['ms:last']) $('msText').value = stored['ms:last'].text || '';
    updateMsStat();
  }

  init().catch((e) => snack(B.friendlyError(e), 6000));
})();
