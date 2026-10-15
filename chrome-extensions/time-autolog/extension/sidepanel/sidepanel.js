/*
 * 工数オートログ：サイドパネル
 * 記録の書き換え（振り分け直し・削除・手入力）はバックグラウンドに依頼し、設定と日報メモはここで保存する。
 */
(() => {
  'use strict';
  const { ui } = window.WDT;
  const { $, h, svg, snack, debounce } = ui;
  const { rules: R, log: L, track: T, report: RP, palette: PAL } = window.TA;

  const STATE_LABEL = {
    recording: '記録中',
    paused: '一時停止中',
    idle: '休止中（操作がありません）',
    away: '休止中（Chromeが前面にありません）',
    other: '休止中（Webページ以外を表示中）',
    private: '休止中（シークレットウィンドウ）',
    excluded: '休止中（記録しないサイト）',
  };
  const OPTS_KEY = 'ta-report-opts';
  const DAY_EDIT = '#panel-day .assign, #blocks'; // 入力中は「1日」タブを作り直さない

  const state = {
    ready: false,
    settings: T.withDefaults(null),
    paused: false,
    day: L.dayKey(Date.now()),
    followToday: true,
    segs: [],
    memos: {},
    current: null,
    status: null,
    stats: null,
    tab: 'tab-day',
    showBlocks: false,
    assignKey: null,
    statusAssign: false,
    openProj: new Set(),
    period: 'thisWeek',
    periodTable: false,
    periodData: null,
    chartHover: false,
    opts: loadOpts(),
  };
  const assignCache = new Map();

  const today = () => L.dayKey(Date.now());
  const colorVar = (c) => `var(--p${(Number(c) || 0) % PAL.size})`;
  const projById = (id) => state.settings.projects.find((p) => p.id === id) || null;
  const host = (s) => String(s || '').replace(/^www\./, '');

  function loadOpts() {
    const base = { mode: 'hm', unit: 0, details: false, unassigned: false };
    try {
      return { ...base, ...JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') };
    } catch (e) {
      return base;
    }
  }

  function saveOpts() {
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify(state.opts));
    } catch (e) {
      /* 保存できなくても問題なし */
    }
  }

  async function send(op, extra) {
    const r = await chrome.runtime.sendMessage({ ns: 'ta', op, ...(extra || {}) });
    if (!r || !r.ok) throw new Error((r && r.error) || '処理できませんでした');
    return r.value;
  }

  // ================================================================ データ
  async function loadSettings() {
    const { settings, paused } = await chrome.storage.local.get(['settings', 'paused']);
    state.settings = T.withDefaults(settings);
    state.paused = !!paused;
  }

  async function saveSettings() {
    await chrome.storage.local.set({ settings: state.settings });
  }

  async function loadSession() {
    const { current, status } = await chrome.storage.session.get(['current', 'status']);
    state.current = current || null;
    state.status = status || null;
  }

  async function loadDay() {
    const k = `log:${state.day}`;
    const m = `memo:${state.day}`;
    const got = await chrome.storage.local.get([k, m]);
    state.segs = got[k] || [];
    state.memos = got[m] || {};
  }

  /** 記録中の区間（まだ確定していない分）を足す */
  function withLive(key, segs) {
    const c = state.current;
    if (!c || key !== today() || state.paused) return segs;
    const s = Math.max(c.s, L.dayStart(key));
    const e = Date.now();
    if (e - s < 1000) return segs;
    const live = { s, e, host: c.host, path: c.path, title: c.title, live: true };
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].manual) continue;
      if (L.samePage(segs[i], live) && s - segs[i].e <= L.MERGE_GAP && segs[i].pid) live.pid = segs[i].pid;
      break;
    }
    return [...segs, live];
  }

  // ================================================================ 共通の部品
  function sw(c, kind) {
    const el = h('i', { class: `sw${kind ? ` ${kind}` : ''}`, 'aria-hidden': 'true' });
    if (!kind) el.style.setProperty('--c', colorVar(c));
    return el;
  }

  function bar(ratio, color, kind) {
    const fill = h('i', { class: `bar-fill${kind ? ` ${kind}` : ''}` });
    fill.style.width = `${Math.max(1.5, Math.min(1, ratio) * 100)}%`;
    if (!kind) fill.style.setProperty('--c', colorVar(color));
    return h('div', { class: 'bar', 'aria-hidden': 'true' }, fill);
  }

  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '');

  const tip = $('tip');
  function showTip(x, y, nodes) {
    tip.textContent = '';
    tip.append(...nodes);
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 12;
    if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - 12);
    let top = y + 14;
    if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height - 10);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function hideTip() {
    tip.hidden = true;
  }

  function tipRow(value, name, color, kind) {
    const key = h('i', { class: 'tip-key' });
    key.style.setProperty('--c', kind === 'un' ? 'var(--un-ink)' : kind === 'other' ? 'var(--other)' : colorVar(color));
    return h('div', { class: 'tip-row' }, key, h('b', null, value), h('span', null, name));
  }

  /** 入力中の欄があるときは、作り直さない（入力やプルダウンが閉じないように） */
  function editingIn(sel) {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest(sel) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }

  // ================================================================ 振り分け
  function assignBox(g, onClose) {
    const ruleIn = h('input', { type: 'text', class: 'mono', value: g.rule, spellcheck: 'false', 'aria-label': '振り分けのルール' });
    const desc = h('small', null, R.describe(g.rule));
    ruleIn.addEventListener('input', () => {
      desc.textContent = R.describe(ruleIn.value) || '読み取れないルールです';
    });
    const rule = () => {
      const v = ruleIn.value.trim();
      if (!R.parseLine(v)) {
        snack('ルールを確認してください');
        ruleIn.focus();
        return null;
      }
      return v;
    };
    const projects = state.settings.projects;
    const chips = projects.length
      ? h(
          'div',
          { class: 'chips', role: 'group', 'aria-label': '振り分け先' },
          projects.map((p) =>
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                onclick: () => {
                  const r = rule();
                  if (r) assignRule(p.id, r);
                },
              },
              sw(p.color),
              p.name,
            ),
          ),
        )
      : null;
    const nameIn = h('input', { type: 'text', maxlength: '40', placeholder: '新しいプロジェクト名', 'aria-label': '新しいプロジェクト名' });
    const create = h(
      'button',
      {
        class: 'btn small',
        type: 'button',
        onclick: () => {
          const r = rule();
          if (r) createProject(nameIn.value, r);
        },
      },
      '作って振り分け',
    );
    nameIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        create.click();
      }
    });
    return h(
      'div',
      { class: 'assign' },
      h('label', { class: 'field' }, h('span', null, '振り分けのルール', h('small', null, '書き換えもできます')), ruleIn, desc),
      chips,
      h('div', { class: 'row' }, nameIn, create),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'link-btn danger',
            type: 'button',
            onclick: () => {
              const r = rule();
              if (r) excludeRule(r);
            },
          },
          '記録しないサイトにする',
        ),
        h('span', { class: 'spacer' }),
        h('button', { class: 'link-btn', type: 'button', onclick: onClose }, '閉じる'),
      ),
    );
  }

  function cachedAssignBox(key, g, onClose) {
    let el = assignCache.get(key);
    if (!el) assignCache.set(key, (el = assignBox(g, onClose)));
    return el;
  }

  function closeAssign() {
    state.assignKey = null;
    state.statusAssign = false;
    assignCache.clear();
  }

  async function assignRule(pid, rule) {
    const p = projById(pid);
    if (!p) return;
    p.rules = R.addRule(p.rules, rule);
    closeAssign();
    await saveSettings();
    renderSettings();
    renderAll();
    snack(`「${p.name}」に振り分けました。ほかの日の記録にも反映されます`);
  }

  async function createProject(name, rule) {
    name = String(name || '').trim();
    if (!name) {
      snack('プロジェクト名を入力してください');
      return null;
    }
    const p = { id: ui.uid('p'), name, color: PAL.nextColor(state.settings.projects), rules: rule || '' };
    state.settings.projects.push(p);
    closeAssign();
    await saveSettings();
    renderSettings();
    renderAll();
    snack(rule ? `「${name}」を作って振り分けました` : `「${name}」を追加しました`);
    return p;
  }

  async function excludeRule(rule) {
    state.settings.exclude = R.addRule(state.settings.exclude, rule);
    closeAssign();
    await saveSettings();
    try {
      const n = await send('removeMatching', { day: state.day, rule });
      await refreshDay();
      snack(`記録しないサイトに追加しました（この日の記録 ${n}件を削除）`);
    } catch (e) {
      snack(e.message, 5000);
    }
    renderSettings();
  }

  async function refreshDay() {
    await loadSession();
    await loadDay();
    renderAll();
  }

  // ================================================================ 1日
  function renderHeader() {
    const b = $('pauseBtn');
    b.textContent = state.paused ? '再開' : '一時停止';
    b.setAttribute('aria-pressed', String(state.paused));
  }

  let pendingDay = false;
  function renderDay() {
    if (editingIn(DAY_EDIT)) {
      pendingDay = true;
      return;
    }
    pendingDay = false;
    const key = state.day;
    const isToday = key === today();
    const st = (state.stats = RP.day(withLive(key, state.segs), state.settings.projects));

    $('dayLabel').textContent = RP.dateLabel(key, key.slice(0, 4) !== today().slice(0, 4));
    $('dayPick').value = key;
    $('dayPick').max = today();
    $('nextDay').disabled = isToday;
    $('todayBtn').hidden = isToday;

    renderStatus(isToday, st);
    $('onboard').hidden = state.settings.projects.length > 0;

    const has = st.total > 0;
    $('dayEmpty').hidden = has;
    $('dayEmptyTitle').textContent = isToday ? '今日の記録はまだありません' : 'この日の記録はありません';
    $('dayTiles').hidden = !has;
    $('projCard').hidden = !has;
    $('unCard').hidden = !st.unassignedGroups.length;
    for (const id of ['timeline', 'timelineHint', 'toggleBlocks']) $(id).hidden = !has;

    const tiles = $('dayTiles');
    tiles.textContent = '';
    for (const [v, label] of [
      [RP.fmt(st.total), '合計'],
      [RP.fmt(st.assigned), '振り分け済み'],
      [RP.fmt(st.unassigned), '未分類'],
    ]) {
      tiles.append(h('div', { class: 'tile' }, h('b', null, v), h('span', null, label)));
    }

    renderProjList(st);
    renderTimeline(st, isToday);
    renderBlocks(st);
    renderUnassigned(st);
  }

  function renderStatus(isToday, st) {
    $('status').hidden = !isToday;
    const box = $('statusAssign');
    if (!isToday) {
      box.hidden = true;
      return;
    }
    const s = state.status || { state: 'idle' };
    const rec = s.state === 'recording' && !state.paused;
    const pid = rec ? R.compile(state.settings.projects)(s) : null;
    const p = pid ? projById(pid) : null;
    $('statusDot').className = `status-dot${rec ? ' rec' : state.paused || s.state === 'paused' ? ' paused' : ''}`;
    $('statusTitle').textContent = rec ? `記録中：${p ? p.name : '未分類'}` : STATE_LABEL[state.paused ? 'paused' : s.state] || '記録していません';
    let sub = '';
    if (rec) {
      const ms = p ? (st.projects.find((x) => x.id === pid) || { ms: 0 }).ms : 0;
      sub = [p ? `今日 ${RP.fmt(ms)}` : '', host(s.host), s.title].filter(Boolean).join(' · ');
    } else if (state.paused || s.state === 'paused') sub = '「再開」を押すと記録を始めます';
    else if (s.state === 'idle') sub = `${state.settings.idleMin}分以上操作がない時間は数えません`;
    else if (s.state === 'excluded') sub = host(s.host);
    $('statusSub').textContent = sub;
    $('statusSub').title = sub;

    const canAssign = rec && !p;
    const open = canAssign && state.statusAssign;
    $('statusAssignBtn').hidden = !canAssign;
    $('statusAssignBtn').setAttribute('aria-expanded', String(open));
    box.textContent = '';
    box.hidden = !open;
    if (open) {
      const g = R.suggest(s);
      box.append(
        cachedAssignBox(`status:${g.rule}`, g, () => {
          closeAssign();
          renderDay();
        }),
      );
    }
  }

  function renderProjList(st) {
    const list = $('projList');
    const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.pid : null;
    list.textContent = '';
    const max = Math.max(1, ...st.projects.map((p) => p.ms), st.unassigned);
    for (const p of st.projects) {
      const open = state.openProj.has(p.id);
      const li = h(
        'li',
        { class: 'proj-row clickable', tabindex: '0', role: 'button', 'aria-expanded': String(open), 'data-pid': p.id },
        h('div', { class: 'proj-top' }, sw(p.color), h('span', { class: 'proj-name' }, p.name), h('b', { class: 'proj-time' }, RP.fmt(p.ms)), h('span', { class: 'proj-share' }, pct(p.ms, st.total))),
        bar(p.ms / max, p.color),
        open
          ? h(
              'ul',
              { class: 'proj-pages' },
              p.pages.slice(0, 6).map((pg) => h('li', null, h('span', { title: pg.label }, pg.label), h('span', null, RP.fmt(pg.ms)))),
            )
          : null,
      );
      const toggle = () => {
        if (open) state.openProj.delete(p.id);
        else state.openProj.add(p.id);
        renderDay();
      };
      li.addEventListener('click', toggle);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
      list.append(li);
    }
    if (st.unassigned > 0) {
      const li = h(
        'li',
        { class: 'proj-row clickable', tabindex: '0', role: 'button', 'data-pid': '_un' },
        h('div', { class: 'proj-top' }, sw(0, 'un'), h('span', { class: 'proj-name' }, '未分類'), h('b', { class: 'proj-time' }, RP.fmt(st.unassigned)), h('span', { class: 'proj-share' }, pct(st.unassigned, st.total))),
        bar(st.unassigned / max, 0, 'un'),
      );
      const go = () => $('unCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
      list.append(li);
    }
    if (focusId) {
      const el = list.querySelector(`[data-pid="${CSS.escape(focusId)}"]`);
      if (el) el.focus();
    }
  }

  function renderTimeline(st, isToday) {
    const box = $('timeline');
    box.textContent = '';
    if (!st.runs.length) return;
    const W = Math.max(200, box.clientWidth || 300);
    const STRIP = 20;
    const H = 36;
    const base = L.dayStart(state.day);
    const hr = (ms) => (ms - base) / RP.HOUR;
    const end = isToday ? Math.max(st.last, Date.now()) : st.last;
    let from = Math.max(0, Math.floor(hr(st.first)));
    let to = Math.min(24, Math.ceil(hr(end)));
    if (to - from < 4) {
      to = Math.min(24, from + 4);
      from = Math.max(0, to - 4);
    }
    const span = to - from;
    const x = (ms) => ((hr(ms) - from) / span) * W;
    const step = span <= 8 ? 1 : span <= 14 ? 2 : 3;
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${from}時から${to}時までの作業の流れ（詳しくは記録の一覧）` });
    root.append(
      svg(
        'defs',
        null,
        svg(
          'pattern',
          { id: 'hatch-tl', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
          svg('rect', { width: 4, height: 4, style: 'fill: var(--un)' }),
          svg('line', { x1: 0, y1: 0, x2: 0, y2: 4, style: 'stroke: var(--un-ink); stroke-width: 1.2' }),
        ),
      ),
    );
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
      const xx = ((t - from) / span) * W;
      root.append(svg('line', { class: 'grid-line', x1: xx, x2: xx, y1: 0, y2: STRIP + 3 }));
      root.append(svg('text', { class: 'axis-label', x: xx, y: H - 2, 'text-anchor': t === from ? 'start' : t === to ? 'end' : 'middle' }, `${t}時`));
    }
    for (const r of st.runs) {
      const x0 = x(r.s);
      let w = x(r.e) - x0;
      if (w > 3) w -= 1;
      w = Math.max(1, w);
      const p = r.p ? projById(r.p) : null;
      const rect = svg('rect', { class: 'tl-run', x: x0, y: 0, width: w, height: STRIP, rx: Math.min(2, w / 2), style: p ? `fill: ${colorVar(p.color)}` : 'fill: url(#hatch-tl)' });
      rect.addEventListener('pointermove', (e) =>
        showTip(e.clientX, e.clientY, [
          h('div', { class: 'tip-head' }, `${RP.clock(r.s)}–${RP.clock(r.e)}${r.manual ? '（手入力）' : ''}`),
          tipRow(RP.fmt(r.ms), p ? p.name : '未分類', p ? p.color : 0, p ? null : 'un'),
        ]),
      );
      rect.addEventListener('pointerleave', hideTip);
      rect.addEventListener('click', () => openBlockAt(r.s));
      root.append(rect);
    }
    root.append(svg('line', { class: 'base-line', x1: 0, x2: W, y1: STRIP + 0.5, y2: STRIP + 0.5 }));
    if (isToday) {
      const xn = x(Date.now());
      root.append(svg('line', { class: 'now-line', x1: xn, x2: xn, y1: -3, y2: STRIP + 3 }));
    }
    box.append(root);
  }

  function openBlockAt(ms) {
    state.showBlocks = true;
    renderDay();
    const items = [...$('blocks').querySelectorAll('.block[data-s]')];
    const li = items.find((el) => Number(el.dataset.s) <= ms && ms < Number(el.dataset.e)) || items.find((el) => Number(el.dataset.s) >= ms);
    if (!li) return;
    li.scrollIntoView({ behavior: 'smooth', block: 'center' });
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1400);
  }

  function summarizePages(pages) {
    const names = pages.slice(0, 2).map((p) => p.label);
    const more = pages.length - names.length;
    return names.join('、') + (more > 0 ? ` ほか${more}件` : '');
  }

  function renderBlocks(st) {
    const shown = st.blocks.filter((b) => b.ms >= RP.MIN || b.manual);
    const hiddenCount = st.blocks.length - shown.length;
    const btn = $('toggleBlocks');
    btn.textContent = state.showBlocks ? '記録の一覧を閉じる' : shown.length || !hiddenCount ? `記録の一覧を見る（${shown.length}件）` : `記録の一覧を見る（1分未満の記録 ${hiddenCount}件）`;
    btn.setAttribute('aria-expanded', String(state.showBlocks));
    const list = $('blocks');
    list.hidden = !state.showBlocks;
    list.textContent = '';
    if (!state.showBlocks) return;
    for (const b of shown) list.append(blockRow(b));
    if (hiddenCount) list.append(h('li', { class: 'block muted small' }, `1分未満の短い記録 ${hiddenCount}件は省略しています（合計には含みます）`));
  }

  function blockRow(b) {
    const p = b.p ? projById(b.p) : null;
    const sel = h(
      'select',
      { 'aria-label': `${RP.clock(b.s)}からの記録の振り分け先` },
      h('option', { value: '' }, p ? '振り分け先を変える…' : '振り分ける…'),
      state.settings.projects.filter((x) => x.id !== b.p).map((x) => h('option', { value: `p:${x.id}` }, x.name)),
      p && !b.manual ? h('option', { value: 'none' }, '未分類にする') : null,
      h('option', { value: 'delete' }, 'この記録を削除'),
    );
    sel.addEventListener('change', () => blockAction(b, sel.value));
    return h(
      'li',
      { class: 'block', 'data-s': b.s, 'data-e': b.e },
      h(
        'div',
        { class: 'block-top' },
        h('span', { class: 'block-time' }, `${RP.clock(b.s)}–${RP.clock(b.e)}`),
        p ? sw(p.color) : sw(0, 'un'),
        h('span', { class: 'block-proj' }, p ? p.name : '未分類'),
        b.manual ? h('span', { class: 'tag' }, '手入力') : null,
        b.live ? h('span', { class: 'live' }, '記録中') : null,
        h('b', null, RP.fmt(b.ms)),
      ),
      h('div', { class: 'block-pages', title: b.pages.map((x) => x.label).join('\n') }, summarizePages(b.pages)),
      h('div', { class: 'block-actions' }, sel),
    );
  }

  async function blockAction(b, v) {
    if (!v) return;
    document.activeElement.blur();
    try {
      if (v === 'delete') {
        await send('remove', { day: state.day, ids: b.refs });
        snack('記録を削除しました');
      } else if (v === 'none') {
        await send('assign', { day: state.day, ids: b.refs, pid: L.NONE });
        snack('未分類にしました');
      } else {
        const pid = v.slice(2);
        await send('assign', { day: state.day, ids: b.refs, pid });
        snack(`「${(projById(pid) || {}).name}」に振り分けました`);
      }
      await refreshDay();
    } catch (e) {
      snack(e.message, 5000);
      renderDay();
    }
  }

  function renderUnassigned(st) {
    $('unTotal').textContent = `合計 ${RP.fmt(st.unassigned)}`;
    const list = $('unList');
    list.textContent = '';
    const groups = st.unassignedGroups.filter((g) => g.kind !== 'manual');
    for (const g of groups.slice(0, 30)) {
      const open = state.assignKey === g.rule;
      const sub = g.kind === 'site' ? g.titles.slice(0, 2).map((t) => t.label).join('、') : host(g.host);
      const btn = h('button', { class: 'btn small', type: 'button', 'aria-expanded': String(open) }, open ? '閉じる' : '振り分ける');
      btn.addEventListener('click', () => {
        assignCache.delete(`un:${state.assignKey}`);
        state.assignKey = open ? null : g.rule;
        renderDay();
        if (!open) {
          const input = list.querySelector('.assign input');
          if (input) input.focus({ preventScroll: true });
        }
      });
      list.append(
        h(
          'li',
          { class: 'un-row' },
          h('div', { class: 'un-top' }, h('span', { class: 'un-label', title: g.label }, g.label), h('span', { class: 'tag' }, g.kind === 'page' ? 'ページ' : 'サイト'), h('b', null, RP.fmt(g.ms)), btn),
          sub ? h('div', { class: 'un-sub', title: sub }, sub) : null,
          open
            ? cachedAssignBox(`un:${g.rule}`, g, () => {
                closeAssign();
                renderDay();
              })
            : null,
        ),
      );
    }
    if (groups.length > 30) list.append(h('li', { class: 'un-row muted small' }, `ほか ${groups.length - 30}件（短いものは省略）`));
  }

  // ---------------------------------------------------------------- 手入力
  function roundTo5(d) {
    return new Date(Math.floor(d.getTime() / (5 * RP.MIN)) * 5 * RP.MIN);
  }

  const hm = (d) => `${L.pad(d.getHours())}:${L.pad(d.getMinutes())}`;

  function toggleManual(open) {
    $('manualForm').hidden = !open;
    $('addManualBtn').setAttribute('aria-expanded', String(open));
    if (!open) return;
    refreshManualProjects();
    if (state.day === today()) {
      const end = roundTo5(new Date());
      const start = new Date(Math.max(L.dayStart(state.day), end.getTime() - 30 * RP.MIN));
      $('mStart').value = hm(start);
      $('mEnd').value = hm(end);
    } else {
      $('mStart').value = '10:00';
      $('mEnd').value = '11:00';
    }
    $('mStart').focus();
  }

  function refreshManualProjects() {
    const sel = $('mProject');
    const prev = sel.value;
    sel.textContent = '';
    if (!state.settings.projects.length) sel.append(h('option', { value: '' }, '先にプロジェクトを登録してください'));
    for (const p of state.settings.projects) sel.append(h('option', { value: p.id }, p.name));
    if (prev && projById(prev)) sel.value = prev;
  }

  function timeOnDay(key, v) {
    const [hh, mm] = String(v || '').split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
    return L.dayStart(key) + (hh * 60 + mm) * RP.MIN;
  }

  async function submitManual(e) {
    e.preventDefault();
    const s = timeOnDay(state.day, $('mStart').value);
    const end = timeOnDay(state.day, $('mEnd').value);
    const pid = $('mProject').value;
    if (!(end > s)) {
      snack('終了は開始より後の時刻にしてください');
      return;
    }
    if (!pid) {
      snack('プロジェクトを選んでください');
      return;
    }
    try {
      await send('add', { day: state.day, seg: { s, e: end, pid, memo: $('mMemo').value.trim() } });
      $('mMemo').value = '';
      toggleManual(false);
      await refreshDay();
      snack('手入力の記録を追加しました');
    } catch (err) {
      snack(err.message, 5000);
    }
  }

  // ================================================================ 集計
  const shortDate = (k) => `${Number(k.slice(5, 7))}/${Number(k.slice(8))}（${RP.WEEK[RP.weekday(k)]}）`;

  let periodSeq = 0;
  async function renderPeriod() {
    const seq = ++periodSeq;
    const range = RP.periodRange(state.period, today());
    const keys = range.keys;
    const got = await chrome.storage.local.get(keys.flatMap((k) => [`log:${k}`, `memo:${k}`]));
    if (seq !== periodSeq) return;
    const statsByKey = {};
    const memosByKey = {};
    for (const k of keys) {
      const segs = withLive(k, got[`log:${k}`] || []);
      if (segs.length) statsByKey[k] = RP.day(segs, state.settings.projects);
      if (got[`memo:${k}`]) memosByKey[k] = got[`memo:${k}`];
    }
    const per = RP.period(keys, statsByKey, state.settings.projects);
    state.periodData = { range, keys, statsByKey, memosByKey, per };

    for (const b of document.querySelectorAll('#periodSeg .seg-btn')) b.setAttribute('aria-checked', String(b.dataset.period === state.period));
    $('periodLabel').textContent = `${shortDate(range.from)}〜${shortDate(range.to)}`;
    const has = per.total > 0;
    $('periodEmpty').hidden = has;
    for (const id of ['periodTiles', 'periodChartCard', 'periodListCard']) $(id).hidden = !has;
    for (const id of ['csvSummaryBtn', 'csvDetailBtn']) $(id).disabled = !has;
    if (!has) return;

    const tiles = $('periodTiles');
    tiles.textContent = '';
    for (const [v, label] of [
      [RP.fmt(per.total), '合計'],
      [RP.fmt(per.activeDays ? per.total / per.activeDays : 0), '1日平均'],
      [`${per.activeDays}日`, '記録した日'],
      [RP.fmt(per.unassigned), '未分類'],
    ]) {
      tiles.append(h('div', { class: 'tile' }, h('b', null, v), h('span', null, label)));
    }

    const series = periodSeries(per);
    const legend = $('periodLegend');
    legend.textContent = '';
    for (const s of series) legend.append(h('span', null, s.kind ? sw(0, s.kind) : sw(s.color), s.name));

    renderPeriodChart(per, series);
    renderPeriodTable(per, keys);

    const list = $('periodList');
    list.textContent = '';
    const max = Math.max(1, ...per.projects.map((p) => p.ms), per.unassigned);
    for (const p of per.projects) {
      list.append(
        h(
          'li',
          { class: 'proj-row' },
          h('div', { class: 'proj-top' }, sw(p.color), h('span', { class: 'proj-name' }, p.name), h('b', { class: 'proj-time' }, RP.fmt(p.ms)), h('span', { class: 'proj-sub' }, `${RP.fmt(p.ms, 'h')}・${p.days}日`)),
          bar(p.ms / max, p.color),
        ),
      );
    }
    if (per.unassigned > 0) {
      list.append(
        h(
          'li',
          { class: 'proj-row' },
          h('div', { class: 'proj-top' }, sw(0, 'un'), h('span', { class: 'proj-name' }, '未分類'), h('b', { class: 'proj-time' }, RP.fmt(per.unassigned)), h('span', { class: 'proj-sub' }, RP.fmt(per.unassigned, 'h'))),
          bar(per.unassigned / max, 0, 'un'),
        ),
      );
    }
  }

  /** グラフに出す系列：上位7件のプロジェクト＋その他＋未分類（色が足りなくならないように） */
  function periodSeries(per) {
    const shown = per.projects.slice(0, 7);
    const rest = per.projects.slice(7);
    const restIds = new Set(rest.map((p) => p.id));
    const out = shown.map((p) => ({ id: p.id, name: p.name, color: p.color, value: (d) => d.by[p.id] || 0 }));
    if (rest.length) out.push({ id: '_other', name: `その他（${rest.length}件）`, kind: 'other', value: (d) => Object.entries(d.by).reduce((a, [id, ms]) => a + (restIds.has(id) ? ms : 0), 0) });
    if (per.unassigned > 0) out.push({ id: '_un', name: '未分類', kind: 'un', value: (d) => d.unassigned });
    return out;
  }

  function renderPeriodChart(per, series) {
    const box = $('periodChart');
    box.textContent = '';
    const days = per.days;
    const n = days.length;
    const week = n <= 7;
    const W = Math.max(240, box.clientWidth || 300);
    const H = 190;
    const ml = 30;
    const mr = 4;
    const mt = 8;
    const mb = week ? 30 : 18;
    const pw = W - ml - mr;
    const ph = H - mt - mb;
    const maxH = Math.max(...days.map((d) => d.total)) / RP.HOUR;
    const yMax = maxH <= 4 ? 4 : maxH <= 8 ? 8 : maxH <= 10 ? 10 : maxH <= 12 ? 12 : Math.ceil(maxH / 4) * 4;
    const yStep = yMax <= 4 ? 1 : yMax <= 12 ? 2 : 4;
    const y = (hours) => mt + ph - (hours / yMax) * ph;
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': '日ごとの工数（積み上げ棒グラフ）。数値は「表で見る」でも確認できます' });
    const defs = svg(
      'defs',
      null,
      svg(
        'pattern',
        { id: 'hatch-pd', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        svg('rect', { width: 4, height: 4, style: 'fill: var(--un)' }),
        svg('line', { x1: 0, y1: 0, x2: 0, y2: 4, style: 'stroke: var(--un-ink); stroke-width: 1.2' }),
      ),
    );
    root.append(defs);
    for (let v = 0; v <= yMax; v += yStep) {
      root.append(svg('line', { class: v === 0 ? 'base-line' : 'grid-line', x1: ml, x2: W - mr, y1: y(v) + 0.5, y2: y(v) + 0.5 }));
      root.append(svg('text', { class: 'axis-label', x: ml - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, `${v}h`));
    }
    const slot = pw / n;
    const bw = Math.max(3, Math.min(22, slot * 0.6));
    const tKey = today();
    const fill = (s) => (s.kind === 'un' ? 'fill: url(#hatch-pd)' : s.kind === 'other' ? 'fill: var(--other)' : `fill: ${colorVar(s.color)}`);

    days.forEach((d, i) => {
      const cx = ml + slot * (i + 0.5);
      const g = svg('g', { class: 'stack' });
      const vals = series.map((s) => [s, s.value(d)]).filter(([, v]) => v > 0);
      let acc = 0;
      vals.forEach(([s, v], j) => {
        const y0 = y(acc / RP.HOUR);
        const y1 = y((acc + v) / RP.HOUR);
        acc += v;
        let top = y1;
        let height = y0 - y1;
        if (j < vals.length - 1 && height > 3) {
          top += 2; // 上の区切りとの間に2pxのすき間
          height -= 2;
        }
        g.append(svg('rect', { x: cx - bw / 2, y: top, width: bw, height: Math.max(0.5, height), style: fill(s) }));
      });
      if (vals.length) {
        const topY = y(d.total / RP.HOUR);
        const id = `cp${i}`;
        defs.append(svg('clipPath', { id }, svg('rect', { x: cx - bw / 2, y: topY, width: bw, height: mt + ph - topY + 4, rx: Math.min(4, bw / 2) })));
        g.setAttribute('clip-path', `url(#${id})`);
      }
      root.append(g);

      const dd = Number(d.key.slice(8));
      const wd = RP.weekday(d.key);
      const strong = d.key === tKey ? ' strong' : '';
      if (week) {
        root.append(svg('text', { class: `axis-label${strong}`, x: cx, y: mt + ph + 13, 'text-anchor': 'middle' }, RP.WEEK[wd]));
        root.append(svg('text', { class: `axis-label${strong}`, x: cx, y: mt + ph + 26, 'text-anchor': 'middle' }, String(dd)));
      } else if (dd === 1 || dd % 5 === 0) {
        root.append(svg('text', { class: `axis-label${strong}`, x: cx, y: mt + ph + 13, 'text-anchor': 'middle' }, String(dd)));
      }

      const hit = svg('rect', { class: 'day-hit', x: ml + slot * i, y: mt, width: slot, height: ph, tabindex: '0', 'aria-label': `${RP.dateLabel(d.key)}：${d.total ? RP.fmtLong(d.total) : '記録なし'}` });
      const tipNodes = () => [
        h('div', { class: 'tip-head' }, `${RP.dateLabel(d.key)}　合計 ${RP.fmt(d.total)}`),
        ...(vals.length ? [...vals].sort((a, b) => b[1] - a[1]).map(([s, v]) => tipRow(RP.fmt(v), s.name, s.color, s.kind)) : [h('div', { class: 'muted' }, '記録なし')]),
      ];
      const on = (x, yy) => {
        state.chartHover = true;
        root.classList.add('dim');
        g.classList.add('on');
        showTip(x, yy, tipNodes());
      };
      const off = () => {
        state.chartHover = false;
        root.classList.remove('dim');
        g.classList.remove('on');
        hideTip();
        if (pendingPeriod) schedulePeriod();
      };
      hit.addEventListener('pointermove', (e) => on(e.clientX, e.clientY));
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('focus', () => {
        const r = hit.getBoundingClientRect();
        on(r.left + r.width / 2, r.top + 20);
      });
      hit.addEventListener('blur', off);
      root.append(hit);
    });
    box.append(root);
  }

  function renderPeriodTable(per, keys) {
    const wrap = $('periodTable');
    wrap.textContent = '';
    wrap.hidden = !state.periodTable;
    $('periodChart').hidden = state.periodTable;
    $('periodTableBtn').textContent = state.periodTable ? 'グラフで見る' : '表で見る';
    $('periodTableBtn').setAttribute('aria-pressed', String(state.periodTable));
    if (!state.periodTable) return;
    const cell = (ms) => (ms ? h('td', null, RP.fmt(ms)) : h('td', { class: 'zero' }, '—'));
    const rows = per.projects.map((p) => h('tr', null, h('th', { scope: 'row', title: p.name }, p.name), per.days.map((d) => cell(d.by[p.id] || 0)), h('td', null, h('b', null, RP.fmt(p.ms)))));
    if (per.unassigned > 0) rows.push(h('tr', null, h('th', { scope: 'row' }, '未分類'), per.days.map((d) => cell(d.unassigned)), h('td', null, h('b', null, RP.fmt(per.unassigned)))));
    wrap.append(
      h(
        'table',
        { class: 'data-table' },
        h('thead', null, h('tr', null, h('th', null, 'プロジェクト'), keys.map((k) => h('th', { scope: 'col', title: RP.dateLabel(k) }, keys.length <= 7 ? `${Number(k.slice(8))}（${RP.WEEK[RP.weekday(k)]}）` : String(Number(k.slice(8))))), h('th', { scope: 'col' }, '合計'))),
        h('tbody', null, rows),
        h('tfoot', null, h('tr', null, h('td', null, '合計'), per.days.map((d) => cell(d.total)), h('td', null, RP.fmt(per.total)))),
      ),
    );
  }

  let pendingPeriod = false;
  const schedulePeriod = debounce(() => {
    if (state.tab !== 'tab-period') return;
    if (state.chartHover) {
      pendingPeriod = true;
      return;
    }
    pendingPeriod = false;
    renderPeriod();
  }, 400);

  function downloadCsv(kind) {
    const d = state.periodData;
    if (!d) return;
    const rows = kind === 'detail' ? RP.csvDetail(d.keys, d.statsByKey, state.settings.projects) : RP.csvSummary(d.keys, d.statsByKey, d.memosByKey);
    ui.download(`工数_${kind === 'detail' ? '明細' : '集計'}_${d.range.from}_${d.range.to}.csv`, ui.toCsv(rows), 'text/csv;charset=utf-8');
    snack('CSVを書き出しました');
  }

  // ================================================================ 日報
  function renderReport() {
    const st = state.stats || RP.day(withLive(state.day, state.segs), state.settings.projects);
    $('rDayLabel').textContent = RP.dateLabel(state.day, state.day.slice(0, 4) !== today().slice(0, 4));
    $('rNextDay').disabled = state.day === today();
    for (const b of document.querySelectorAll('#modeSeg .seg-btn')) b.setAttribute('aria-checked', String(b.dataset.mode === state.opts.mode));
    $('unitSel').value = String(state.opts.unit);
    $('optDetails').checked = !!state.opts.details;
    $('optUnassigned').checked = !!state.opts.unassigned;

    $('memoCard').hidden = !st.projects.length;
    if (!editingIn('#memoList')) {
      const list = $('memoList');
      list.textContent = '';
      for (const p of st.projects) {
        const ta = h('textarea', { rows: '2', maxlength: '300', 'aria-label': `「${p.name}」の作業内容`, placeholder: '例：デザイン確認、要件定義書の修正' });
        ta.value = state.memos[p.id] || '';
        ta.addEventListener('input', () => {
          state.memos[p.id] = ta.value;
          saveMemoSoon();
          updateReportText();
        });
        ta.addEventListener('blur', flushMemo);
        list.append(h('li', null, h('div', { class: 'memo-head' }, sw(p.color), h('span', null, p.name), h('b', null, RP.fmt(p.ms))), ta));
      }
    }
    updateReportText();
  }

  function updateReportText() {
    const st = state.stats || RP.day(withLive(state.day, state.segs), state.settings.projects);
    $('reportText').textContent = RP.reportText(st, { key: state.day, ...state.opts, memos: state.memos });
  }

  let memoPending = null;
  const flushMemoSoon = debounce(() => flushMemo(), 400);
  function saveMemoSoon() {
    memoPending = { day: state.day, memos: state.memos };
    flushMemoSoon();
  }

  function flushMemo() {
    if (!memoPending) return;
    const { day, memos } = memoPending;
    memoPending = null;
    const clean = Object.fromEntries(Object.entries(memos).filter(([, v]) => String(v || '').trim()));
    const k = `memo:${day}`;
    if (Object.keys(clean).length) chrome.storage.local.set({ [k]: clean });
    else chrome.storage.local.remove(k);
  }

  // ================================================================ 設定
  const saveSettingsSoon = debounce(async () => {
    await saveSettings();
    refreshManualProjects();
    renderAll();
  }, 400);

  function ruleNote(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((s) => s.replace(/(^|\s)#.*$/, '').trim())
      .filter(Boolean);
    const bad = lines.filter((l) => !R.parseLine(l));
    if (bad.length) return { bad: true, text: `読み取れない行があります：${bad.join('、')}` };
    return { bad: false, text: lines.length ? `ルール ${lines.length}件` : 'ルールがありません（「1日」タブの未分類から振り分けると追加されます）' };
  }

  function projectEditor(p) {
    const colorBtn = h('button', { class: 'color-btn', type: 'button', 'aria-expanded': 'false', 'aria-label': `色を変える（いまは${PAL.names[p.color % PAL.size]}）` }, sw(p.color));
    const name = h('input', { type: 'text', value: p.name, maxlength: '40', placeholder: 'プロジェクト名', 'aria-label': 'プロジェクト名' });
    const del = h('button', { class: 'link-btn danger', type: 'button' }, '削除');
    const swatches = h(
      'div',
      { class: 'swatches', role: 'radiogroup', 'aria-label': '色', hidden: true },
      PAL.light.map((_, i) => {
        const b = h('button', { class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(i === p.color % PAL.size), 'aria-label': PAL.names[i] });
        b.style.setProperty('--c', colorVar(i));
        b.addEventListener('click', async () => {
          p.color = i;
          await saveSettings();
          renderSettings();
          renderAll();
        });
        return b;
      }),
    );
    const rules = h('textarea', { class: 'mono', rows: '3', spellcheck: 'false', 'aria-label': `「${p.name}」の振り分けルール`, placeholder: 'a-sha.co.jp\ntitle:A社' });
    rules.value = p.rules || '';
    const note = h('div', { class: 'rule-note' });
    const updateNote = () => {
      const r = ruleNote(rules.value);
      note.className = `rule-note${r.bad ? ' bad' : ''}`;
      note.textContent = r.text;
    };
    updateNote();

    colorBtn.addEventListener('click', () => {
      swatches.hidden = !swatches.hidden;
      colorBtn.setAttribute('aria-expanded', String(!swatches.hidden));
    });
    name.addEventListener('input', () => {
      p.name = name.value.trim() || '（名前なし）';
      saveSettingsSoon();
    });
    rules.addEventListener('input', () => {
      p.rules = rules.value;
      updateNote();
      saveSettingsSoon();
    });
    let confirmTimer = 0;
    del.addEventListener('click', async () => {
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.textContent = 'もう一度押すと削除';
        confirmTimer = setTimeout(() => {
          del.classList.remove('confirm');
          del.textContent = '削除';
        }, 4000);
        return;
      }
      clearTimeout(confirmTimer);
      state.settings.projects = state.settings.projects.filter((x) => x.id !== p.id);
      await saveSettings();
      renderSettings();
      renderAll();
      snack(`「${p.name}」を削除しました（記録は残り、このプロジェクトの時間は未分類に戻ります）`);
    });
    return h('li', { class: 'proj-edit', 'data-pid': p.id }, h('div', { class: 'proj-edit-head' }, colorBtn, name, del), swatches, rules, note);
  }

  function renderSettings() {
    const st = state.settings;
    const list = $('projectEditor');
    list.textContent = '';
    for (const p of st.projects) list.append(projectEditor(p));
    $('noProjects').hidden = st.projects.length > 0;
    $('exclude').value = st.exclude || '';
    $('idleMin').value = String(st.idleMin);
    $('keepAudible').checked = !!st.keepAudible;
    $('recordUnfocused').checked = !!st.recordUnfocused;
    $('badge').checked = !!st.badge;
    $('retentionDays').value = String(st.retentionDays);
    refreshManualProjects();
  }

  async function importSettings(file) {
    try {
      const data = JSON.parse(await file.text());
      const r = T.mergeSettings(state.settings, data, () => ui.uid('p'), PAL.nextColor);
      state.settings = r.settings;
      await saveSettings();
      renderSettings();
      renderAll();
      snack(`読み込みました：${r.added}件追加・${r.updated}件にルールを追加`);
    } catch (e) {
      snack(e instanceof SyntaxError ? '設定ファイルを読み取れませんでした' : e.message, 5000);
    }
  }

  // ================================================================ 全体
  function renderAll() {
    if (!state.ready) return;
    renderHeader();
    renderDay();
    renderReport();
    if (state.tab === 'tab-period') schedulePeriod();
  }

  const scheduleRender = debounce(renderAll, 200);

  async function setDay(key) {
    flushMemo();
    const t = today();
    if (key > t) key = t;
    state.day = key;
    state.followToday = key === t;
    state.showBlocks = false;
    state.openProj.clear();
    closeAssign();
    toggleManual(false);
    await loadDay();
    renderAll();
  }

  function bind() {
    $('pauseBtn').addEventListener('click', () => chrome.storage.local.set({ paused: !state.paused }));
    $('statusAssignBtn').addEventListener('click', () => {
      state.statusAssign = !state.statusAssign;
      if (!state.statusAssign) assignCache.clear();
      renderDay();
      const input = $('statusAssign').querySelector('input');
      if (input && state.statusAssign) input.focus({ preventScroll: true });
    });
    $('goSettings').addEventListener('click', () => {
      selectTab('tab-settings');
      $('addProject').focus();
    });
    $('prevDay').addEventListener('click', () => setDay(L.addDays(state.day, -1)));
    $('nextDay').addEventListener('click', () => setDay(L.addDays(state.day, 1)));
    $('rPrevDay').addEventListener('click', () => setDay(L.addDays(state.day, -1)));
    $('rNextDay').addEventListener('click', () => setDay(L.addDays(state.day, 1)));
    $('todayBtn').addEventListener('click', () => setDay(today()));
    $('dayLabel').addEventListener('click', () => {
      try {
        $('dayPick').showPicker();
      } catch (e) {
        $('dayPick').focus();
      }
    });
    $('dayPick').addEventListener('change', () => {
      if ($('dayPick').value) setDay($('dayPick').value);
    });
    $('toggleBlocks').addEventListener('click', () => {
      state.showBlocks = !state.showBlocks;
      renderDay();
    });
    $('addManualBtn').addEventListener('click', () => toggleManual($('manualForm').hidden));
    $('mCancel').addEventListener('click', () => toggleManual(false));
    $('manualForm').addEventListener('submit', submitManual);
    document.addEventListener('focusout', () =>
      setTimeout(() => {
        if (pendingDay && !editingIn(DAY_EDIT)) renderDay();
      }, 0),
    );

    for (const b of document.querySelectorAll('#periodSeg .seg-btn')) {
      b.addEventListener('click', () => {
        state.period = b.dataset.period;
        renderPeriod();
      });
    }
    $('periodTableBtn').addEventListener('click', () => {
      state.periodTable = !state.periodTable;
      if (state.periodData) renderPeriodTable(state.periodData.per, state.periodData.keys);
    });
    $('csvSummaryBtn').addEventListener('click', () => downloadCsv('summary'));
    $('csvDetailBtn').addEventListener('click', () => downloadCsv('detail'));

    for (const b of document.querySelectorAll('#modeSeg .seg-btn')) {
      b.addEventListener('click', () => {
        state.opts.mode = b.dataset.mode;
        saveOpts();
        renderReport();
      });
    }
    $('unitSel').addEventListener('change', () => {
      state.opts.unit = Number($('unitSel').value) || 0;
      saveOpts();
      renderReport();
    });
    $('optDetails').addEventListener('change', () => {
      state.opts.details = $('optDetails').checked;
      saveOpts();
      updateReportText();
    });
    $('optUnassigned').addEventListener('change', () => {
      state.opts.unassigned = $('optUnassigned').checked;
      saveOpts();
      updateReportText();
    });
    $('copyReport').addEventListener('click', () => ui.copyText($('reportText').textContent, '日報をコピーしました'));

    $('addProject').addEventListener('click', async () => {
      const p = await createProject(`プロジェクト${state.settings.projects.length + 1}`, '');
      const input = $('projectEditor').querySelector(`[data-pid="${CSS.escape(p.id)}"] input`);
      if (input) {
        input.focus();
        input.select();
      }
    });
    $('exclude').addEventListener('input', () => {
      state.settings.exclude = $('exclude').value;
      saveSettingsSoon();
    });
    for (const id of ['idleMin', 'retentionDays']) {
      $(id).addEventListener('change', () => {
        state.settings[id] = Number($(id).value);
        saveSettings();
      });
    }
    for (const id of ['keepAudible', 'recordUnfocused', 'badge']) {
      $(id).addEventListener('change', () => {
        state.settings[id] = $(id).checked;
        saveSettings();
      });
    }
    $('exportSettings').addEventListener('click', () => {
      ui.download(`工数オートログ_設定_${today()}.json`, JSON.stringify(T.exportSettings(state.settings), null, 2), 'application/json');
      snack('設定を書き出しました');
    });
    $('importSettings').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', () => {
      const f = $('importFile').files[0];
      $('importFile').value = '';
      if (f) importSettings(f);
    });
    let clearTimer = 0;
    $('clearAll').addEventListener('click', async () => {
      const b = $('clearAll');
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.textContent = 'もう一度押すと、すべての記録を削除します';
        clearTimer = setTimeout(() => {
          b.classList.remove('confirm');
          b.textContent = '記録をすべて削除';
        }, 5000);
        return;
      }
      clearTimeout(clearTimer);
      b.classList.remove('confirm');
      b.textContent = '記録をすべて削除';
      try {
        const n = await send('clearAll');
        await refreshDay();
        snack(`${n}日分の記録を削除しました（設定は残っています）`);
      } catch (e) {
        snack(e.message, 5000);
      }
    });

    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'session') {
        if (ch.current) state.current = ch.current.newValue || null;
        if (ch.status) state.status = ch.status.newValue || null;
        if (ch.current || ch.status) scheduleRender();
        return;
      }
      if (area !== 'local') return;
      if (ch.settings) {
        const next = T.withDefaults(ch.settings.newValue);
        if (JSON.stringify(next) !== JSON.stringify(state.settings)) {
          state.settings = next;
          renderSettings();
        }
        scheduleRender();
      }
      if (ch.paused) {
        state.paused = !!ch.paused.newValue;
        scheduleRender();
      }
      const k = `log:${state.day}`;
      if (ch[k]) {
        state.segs = ch[k].newValue || [];
        scheduleRender();
      }
      if (state.tab === 'tab-period' && Object.keys(ch).some((x) => x.startsWith('log:'))) schedulePeriod();
    });

    window.addEventListener('resize', debounce(renderAll, 200));
    window.addEventListener('pagehide', flushMemo);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushMemo();
    });
  }

  function tick() {
    if (state.followToday && state.day !== today()) {
      setDay(today());
      return;
    }
    if (state.day === today()) {
      renderDay();
      if (!editingIn('#memoList')) renderReport();
    }
  }

  let selectTab = () => {};
  async function init() {
    bind();
    selectTab = ui.setupTabs('ta-tab', (id) => {
      state.tab = id;
      hideTip();
      flushMemo();
      if (!state.ready) return;
      if (id === 'tab-period') renderPeriod();
      else if (id === 'tab-day') renderDay();
    });
    state.tab = (document.querySelector('.tab[aria-selected="true"]') || {}).id || 'tab-day';
    await loadSettings();
    await loadSession();
    await loadDay();
    state.ready = true;
    renderSettings();
    renderAll();
    if (state.tab === 'tab-period') renderPeriod();
    send('checkpoint').catch(() => {});
    setInterval(tick, 30 * 1000);
  }

  init();
})();
