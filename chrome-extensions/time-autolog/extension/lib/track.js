/*
 * 工数オートログ：設定と「いま記録するか」の判定
 */
(function (root) {
  'use strict';
  const TA = (root.TA = root.TA || {});
  const R = TA.rules || (typeof require === 'function' ? require('./rules.js') : null);
  const L = TA.log || (typeof require === 'function' ? require('./log.js') : null);

  const DEFAULTS = {
    projects: [],
    exclude: '',
    idleMin: 5, // 操作がない時間（分）で休止
    keepAudible: true, // 音が出ているタブ（オンライン会議など）は、操作がなくても記録
    recordUnfocused: false, // Chrome が前面になくても記録
    badge: true,
    retentionDays: 180,
  };

  function withDefaults(s) {
    const out = { ...DEFAULTS, ...(s || {}) };
    out.projects = Array.isArray(out.projects) ? out.projects.filter((p) => p && p.id) : [];
    return out;
  }

  /**
   * 記録するかどうかを決める
   * @returns {{state: 'recording'|'paused'|'idle'|'away'|'other'|'private'|'excluded', host?, path?, title?, tabId?}}
   */
  function decide({ paused, idleState, chromeFocused, tab, audibleTab, settings }) {
    const st = withDefaults(settings);
    if (paused) return { state: 'paused' };
    if (idleState === 'locked') return { state: 'idle' };
    if (!tab) return { state: 'away' };
    if (!chromeFocused && !st.recordUnfocused) return { state: 'away' };
    if (tab.incognito) return { state: 'private' };
    if (idleState === 'idle') {
      // 操作がなくても、音が出ているタブ（オンライン会議など）があれば、そのタブを記録する
      if (!st.keepAudible) return { state: 'idle' };
      if (!tab.audible) {
        if (!audibleTab || audibleTab.incognito) return { state: 'idle' };
        tab = audibleTab;
      }
    }
    const page = R.pageOf(tab.url || tab.pendingUrl || '');
    if (!page) return { state: 'other' };
    const title = L.cleanTitle(tab.title || '');
    if (R.compileExclude(st.exclude)({ ...page, title })) return { state: 'excluded', host: page.host };
    return { state: 'recording', host: page.host, path: page.path, title, tabId: tab.id };
  }

  const keyOf = (d) => (d && d.state === 'recording' ? `${d.host}\n${d.path}\n${d.title}` : null);

  function addLines(text, more) {
    let out = text || '';
    for (const line of String(more || '').split(/\r?\n/)) if (line.trim()) out = R.addRule(out, line.trim());
    return out;
  }

  /**
   * 書き出した設定ファイルを、今の設定に追加する（チームでルールを共有する用）。
   * 同じID・同じ名前のプロジェクトはルールを足し、ないものは新しく作る
   * @returns {{settings, added: number, updated: number}}
   */
  function mergeSettings(current, data, makeId, nextColor) {
    if (!data || data.type !== 'time-autolog-settings' || !Array.isArray(data.projects)) throw new Error('工数オートログの設定ファイルではありません');
    const st = withDefaults(JSON.parse(JSON.stringify(current || {})));
    let added = 0;
    let updated = 0;
    for (const p of data.projects) {
      const name = String((p && p.name) || '').trim().slice(0, 40);
      if (!name) continue;
      const same = st.projects.find((x) => x.id === p.id) || st.projects.find((x) => x.name.trim() === name);
      if (same) {
        const rules = addLines(same.rules, String(p.rules || '').slice(0, 5000));
        if (rules !== same.rules) {
          same.rules = rules;
          updated++;
        }
        continue;
      }
      const color = Number.isInteger(p.color) && p.color >= 0 && p.color < 8 ? p.color : nextColor(st.projects);
      const id = typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) ? p.id : makeId();
      st.projects.push({ id, name, color, rules: addLines('', String(p.rules || '').slice(0, 5000)) });
      added++;
    }
    st.exclude = addLines(st.exclude, String(data.exclude || '').slice(0, 5000));
    return { settings: st, added, updated };
  }

  function exportSettings(settings) {
    const st = withDefaults(settings);
    return {
      type: 'time-autolog-settings',
      version: 1,
      projects: st.projects.map(({ id, name, color, rules }) => ({ id, name, color, rules })),
      exclude: st.exclude,
    };
  }

  TA.track = { DEFAULTS, withDefaults, decide, keyOf, mergeSettings, exportSettings };
  if (typeof module === 'object' && module.exports) module.exports = TA.track;
})(typeof globalThis !== 'undefined' ? globalThis : this);
