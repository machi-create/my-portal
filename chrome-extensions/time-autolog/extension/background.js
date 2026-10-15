/*
 * 工数オートログ：バックグラウンド（自動記録）
 *
 * 前面のタブを、タブの切り替え・ページ移動ごと、そして1分ごとに確認し、ページごとの区間を
 * chrome.storage.local の log:YYYY-MM-DD に記録する。
 * 記録中の区間は storage.session の current に置き、1分ごとに確定する（ブラウザが落ちても失うのは1分以内）。
 * 記録の書き換えはすべてここで順番に行う（サイドパネルからはメッセージで依頼する）。
 */
importScripts('shared/background.js', 'lib/rules.js', 'lib/log.js', 'lib/track.js', 'lib/report.js', 'lib/palette.js');

const { rules: R, log: L, track: T, report: RP, palette: PAL } = self.TA;

self.WDT.bg.enablePanelOnClick();

const STATE_LABEL = {
  recording: '記録中',
  paused: '一時停止中',
  idle: '操作がないため休止中',
  away: 'Chromeが前面にないため休止中',
  other: 'Webページ以外を表示中',
  private: 'シークレットウィンドウは記録しません',
  excluded: '記録しないサイトを表示中',
};

// ---------------------------------------------------------------- 書き込みは1つずつ順番に
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch((e) => console.error(e));
  return run;
}

async function loadSettings() {
  const { settings, paused } = await chrome.storage.local.get(['settings', 'paused']);
  return { settings: T.withDefaults(settings), paused: !!paused };
}

async function saveDay(key, list) {
  const k = `log:${key}`;
  const { days = [] } = await chrome.storage.local.get('days');
  if (list.length) {
    const patch = { [k]: list };
    if (!days.includes(key)) patch.days = [...days, key].sort();
    await chrome.storage.local.set(patch);
  } else {
    await chrome.storage.local.remove(k);
    if (days.includes(key)) await chrome.storage.local.set({ days: days.filter((d) => d !== key) });
  }
}

async function loadDay(key) {
  const k = `log:${key}`;
  return (await chrome.storage.local.get(k))[k] || [];
}

async function commit(seg) {
  for (const { key, seg: piece } of L.splitByDay(seg)) {
    if (!(piece.e - piece.s >= 1000)) continue;
    const list = await loadDay(key);
    L.append(list, piece);
    await saveDay(key, list);
  }
}

// ---------------------------------------------------------------- いま記録するか
async function activeContext() {
  let wins = [];
  try {
    wins = await chrome.windows.getAll({ windowTypes: ['normal', 'popup', 'devtools'] });
  } catch (e) {
    /* ウィンドウなし */
  }
  let win = null;
  try {
    win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  } catch (e) {
    /* ウィンドウなし */
  }
  let tab = null;
  if (win) [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return { chromeFocused: wins.some((w) => w.focused), tab: tab || null };
}

async function evaluateNow() {
  const { settings, paused } = await loadSettings();
  const idleSec = Math.max(15, Math.round(settings.idleMin * 60));
  chrome.idle.setDetectionInterval(idleSec);
  const idleState = await chrome.idle.queryState(idleSec);
  const ctx = await activeContext();
  let audibleTab = null;
  if (idleState === 'idle' && settings.keepAudible && ctx.tab && !ctx.tab.audible) {
    [audibleTab] = await chrome.tabs.query({ audible: true, windowType: 'normal' });
  }
  const d = T.decide({ paused, idleState, chromeFocused: ctx.chromeFocused, tab: ctx.tab, audibleTab: audibleTab || null, settings });
  const key = T.keyOf(d);
  const now = Date.now();
  const { current, status: prev } = await chrome.storage.session.get(['current', 'status']);

  let next = null;
  if (current) {
    const end = L.closeAt(current, now);
    await commit({ s: current.s, e: end, host: current.host, path: current.path, title: current.title });
    if (current.key === key && end === now) next = { ...current, s: now, beat: now };
  }
  if (key && !next) next = { key, s: now, beat: now, since: now, host: d.host, path: d.path, title: d.title };

  const same = prev && prev.state === d.state && (prev.key || null) === key;
  const status = { ...d, key, since: same ? prev.since : now, at: now };
  await chrome.storage.session.set({ current: next, status });
  await updateBadge(status, settings).catch(() => {});
}

const evaluate = () => serial(evaluateNow);

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(evaluate, 300);
}

// ---------------------------------------------------------------- ツールバーのバッジ：いまの案件の、今日の合計
async function updateBadge(status, settings) {
  let text = '';
  let color = '#7b8091';
  let ink = '#ffffff';
  let title = `工数オートログ：${STATE_LABEL[status.state] || ''}`;
  if (status.state === 'recording') {
    const pid = R.compile(settings.projects)(status);
    const proj = settings.projects.find((p) => p.id === pid);
    if (proj) {
      const st = RP.day(await loadDay(L.dayKey(Date.now())), settings.projects);
      const ms = (st.projects.find((p) => p.id === pid) || { ms: 0 }).ms;
      const c = (proj.color || 0) % PAL.size;
      text = RP.fmt(ms);
      color = PAL.light[c];
      ink = PAL.ink[c];
      title = `工数オートログ：${proj.name}（今日 ${RP.fmtLong(ms)}）`;
    } else {
      text = '?';
      title = '工数オートログ：未分類のページを記録中';
    }
  } else if (status.state === 'paused') {
    text = '停止';
  }
  if (!settings.badge) text = '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: ink });
  await chrome.action.setTitle({ title });
}

// ---------------------------------------------------------------- 古い記録の削除
async function prune() {
  const { settings } = await loadSettings();
  if (!settings.retentionDays) return;
  const { days = [] } = await chrome.storage.local.get('days');
  const limit = L.addDays(L.dayKey(Date.now()), -settings.retentionDays);
  const old = days.filter((k) => k < limit);
  if (!old.length) return;
  await chrome.storage.local.remove(old.flatMap((k) => [`log:${k}`, `memo:${k}`]));
  await chrome.storage.local.set({ days: days.filter((k) => k >= limit) });
}

// ---------------------------------------------------------------- サイドパネルからの依頼
async function edit(msg) {
  await evaluateNow(); // 記録中の区間を確定してから書き換える
  if (msg.op === 'checkpoint') return true;
  if (msg.op === 'clearAll') {
    const { days = [] } = await chrome.storage.local.get('days');
    await chrome.storage.local.remove([...days.flatMap((k) => [`log:${k}`, `memo:${k}`]), 'days']);
    await chrome.storage.session.set({ current: null });
    await evaluateNow();
    return days.length;
  }
  const key = msg.day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) throw new Error('日付が正しくありません');
  let list = await loadDay(key);
  let n = 0;
  if (msg.op === 'assign') {
    n = L.assign(list, msg.ids || [], msg.pid == null ? null : String(msg.pid));
  } else if (msg.op === 'remove') {
    n = list.length;
    list = L.remove(list, msg.ids || []);
    n -= list.length;
  } else if (msg.op === 'removeMatching') {
    const hit = R.compileExclude(msg.rule);
    n = list.length;
    list = list.filter((x) => x.manual || !hit(x));
    n -= list.length;
  } else if (msg.op === 'add') {
    const seg = msg.seg || {};
    if (!(seg.e > seg.s) || L.dayKey(seg.s) !== key) throw new Error('時間が正しくありません');
    L.insert(list, { s: seg.s, e: seg.e, manual: true, pid: seg.pid ? String(seg.pid) : undefined, memo: String(seg.memo || '').slice(0, 200) });
    n = 1;
  } else if (msg.op === 'clearDay') {
    n = list.length;
    list = [];
    await chrome.storage.local.remove(`memo:${key}`);
  } else {
    throw new Error(`不明な操作です：${msg.op}`);
  }
  await saveDay(key, list);
  await updateBadge((await chrome.storage.session.get('status')).status || { state: 'idle' }, (await loadSettings()).settings).catch(() => {});
  return n;
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.ns !== 'ta') return undefined;
  serial(() => edit(msg)).then(
    (value) => send({ ok: true, value }),
    (e) => send({ ok: false, error: String((e && e.message) || e) }),
  );
  return true;
});

// ---------------------------------------------------------------- きっかけ
async function ensureAlarms() {
  if (!(await chrome.alarms.get('tick'))) await chrome.alarms.create('tick', { periodInMinutes: 1 });
  if (!(await chrome.alarms.get('prune'))) await chrome.alarms.create('prune', { delayInMinutes: 1, periodInMinutes: 360 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick') evaluate();
  else if (a.name === 'prune') serial(prune);
});
chrome.tabs.onActivated.addListener(schedule);
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (tab.active && ('url' in info || 'title' in info || 'audible' in info || info.status === 'complete')) schedule();
});
chrome.tabs.onRemoved.addListener(schedule);
chrome.windows.onFocusChanged.addListener(schedule);
chrome.idle.onStateChanged.addListener(schedule);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || changes.paused)) schedule();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  serial(prune);
});
chrome.runtime.onInstalled.addListener(ensureAlarms);

ensureAlarms();
evaluate();
