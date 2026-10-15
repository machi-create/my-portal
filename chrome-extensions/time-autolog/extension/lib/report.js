/*
 * 工数オートログ：集計・日報・CSV
 */
(function (root) {
  'use strict';
  const TA = (root.TA = root.TA || {});
  const R = TA.rules || (typeof require === 'function' ? require('./rules.js') : null);
  const L = TA.log || (typeof require === 'function' ? require('./log.js') : null);

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const BLOCK_GAP = 5 * MIN; // 一覧で1つの作業にまとめる間隔
  const RUN_GAP = MIN; // タイムラインで1本につなげる間隔
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const pad = (n) => String(n).padStart(2, '0');

  function roundMs(ms, unitMin) {
    const unit = (unitMin || 1) * MIN;
    return Math.round(ms / unit) * unit;
  }

  /** 時間の表示。mode: 'hm' → 1:05 / 'h' → 1.08h */
  function fmt(ms, mode, unitMin) {
    const r = roundMs(Math.max(0, ms || 0), unitMin);
    if (mode === 'h') return `${(r / HOUR).toFixed(2)}h`;
    const m = Math.round(r / MIN);
    return `${Math.floor(m / 60)}:${pad(m % 60)}`;
  }

  /** 「1時間5分」のような読みやすい表示 */
  function fmtLong(ms) {
    const m = Math.round(Math.max(0, ms || 0) / MIN);
    if (m < 1) return '1分未満';
    const h = Math.floor(m / 60);
    return h ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
  }

  const clock = (ms) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  function dateLabel(key, withYear) {
    const [y, m, d] = key.split('-').map(Number);
    const w = WEEK[new Date(y, m - 1, d).getDay()];
    return `${withYear ? `${y}年` : ''}${m}月${d}日（${w}）`;
  }

  const weekday = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
  };

  function mergeIntervals(list) {
    const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of sorted) {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  }

  /** 手入力の区間を優先し、重なる自動記録の時間を差し引く。ref は元の区間のID（s） */
  function effective(segs) {
    const sorted = [...(segs || [])].sort((a, b) => a.s - b.s);
    const manual = mergeIntervals(sorted.filter((x) => x.manual).map((x) => [x.s, x.e]));
    const out = [];
    for (const x of sorted) {
      if (!(x.e > x.s)) continue;
      if (x.manual || !manual.length) {
        out.push({ ...x, ref: x.s });
        continue;
      }
      let pieces = [[x.s, x.e]];
      for (const [ms, me] of manual) {
        if (me <= x.s || ms >= x.e) continue;
        pieces = pieces.flatMap(([a, b]) => {
          if (me <= a || ms >= b) return [[a, b]];
          const keep = [];
          if (ms > a) keep.push([a, ms]);
          if (me < b) keep.push([me, b]);
          return keep;
        });
      }
      for (const [a, b] of pieces) if (b - a >= 1000) out.push({ ...x, s: a, e: b, ref: x.s });
    }
    return out.sort((a, b) => a.s - b.s);
  }

  const tally = (map, key, ms) => map.set(key, (map.get(key) || 0) + ms);
  const top = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, ms]) => ({ key, ms }));

  function pageLabel(x) {
    if (x.manual) return x.memo ? `手入力：${x.memo}` : '手入力';
    return R.cleanLabel(x.title) || String(x.host || '').replace(/^www\./, '');
  }

  /**
   * 1日の集計
   * @param {Array} segs その日の区間
   * @param {Array} projects 設定のプロジェクト一覧
   */
  function day(segs, projects) {
    projects = projects || [];
    const classify = R.compile(projects);
    const byId = new Map(projects.map((p, i) => [p.id, { ...p, order: i }]));
    const pidOf = (x) => {
      if (x.pid === L.NONE) return null;
      if (x.pid && byId.has(x.pid)) return x.pid;
      return x.manual ? null : classify(x);
    };
    const items = effective(segs).map((x) => ({ ...x, p: pidOf(x) }));

    let total = 0;
    let unassigned = 0;
    const per = new Map();
    const groups = new Map();
    for (const x of items) {
      const ms = x.e - x.s;
      total += ms;
      if (x.p) {
        let g = per.get(x.p);
        if (!g) per.set(x.p, (g = { ms: 0, pages: new Map(), hosts: new Map() }));
        g.ms += ms;
        tally(g.pages, pageLabel(x), ms);
        if (x.host) tally(g.hosts, x.host.replace(/^www\./, ''), ms);
      } else {
        unassigned += ms;
        const sg = x.manual ? { rule: '', label: pageLabel(x), kind: 'manual' } : R.suggest(x);
        let u = groups.get(sg.rule || `manual:${x.ref}`);
        if (!u) groups.set(sg.rule || `manual:${x.ref}`, (u = { ...sg, ms: 0, refs: new Set(), titles: new Map(), host: x.host || '' }));
        u.ms += ms;
        u.refs.add(x.ref);
        tally(u.titles, pageLabel(x), ms);
      }
    }

    const projectRows = [...per.entries()]
      .map(([id, g]) => {
        const p = byId.get(id);
        return {
          id,
          name: p.name || '（名前なし）',
          color: p.color || 0,
          order: p.order,
          ms: g.ms,
          pages: top(g.pages).map(({ key, ms }) => ({ label: key, ms })),
          hosts: top(g.hosts).map(({ key, ms }) => ({ host: key, ms })),
        };
      })
      .sort((a, b) => b.ms - a.ms || a.order - b.order);

    const unassignedGroups = [...groups.values()]
      .map((u) => ({ rule: u.rule, label: u.label, kind: u.kind, host: u.host, ms: u.ms, refs: [...u.refs], titles: top(u.titles).map(({ key, ms }) => ({ label: key, ms })) }))
      .sort((a, b) => b.ms - a.ms);

    return {
      total,
      assigned: total - unassigned,
      unassigned,
      projects: projectRows,
      unassignedGroups,
      blocks: blocks(items),
      runs: runs(items),
      items,
      first: items.length ? items[0].s : null,
      last: items.length ? Math.max(...items.map((x) => x.e)) : null,
    };
  }

  /** 一覧用：同じプロジェクトの作業が続いている間を1つにまとめる */
  function blocks(items) {
    const out = [];
    for (const x of items) {
      const ms = x.e - x.s;
      const last = out[out.length - 1];
      if (last && !x.manual && !last.manual && last.p === x.p && x.s - last.e <= BLOCK_GAP) {
        last.e = Math.max(last.e, x.e);
        last.ms += ms;
        last.refs.add(x.ref);
        tally(last.pages, pageLabel(x), ms);
        if (x.live) last.live = true;
        continue;
      }
      const b = { p: x.p, s: x.s, e: x.e, ms, refs: new Set([x.ref]), manual: !!x.manual, memo: x.memo || '', pages: new Map(), live: !!x.live };
      tally(b.pages, pageLabel(x), ms);
      out.push(b);
    }
    return out.map((b) => ({ ...b, refs: [...b.refs], pages: top(b.pages).map(({ key, ms }) => ({ label: key, ms })) }));
  }

  /** タイムライン用：同じプロジェクトで途切れずに続いている区間 */
  function runs(items) {
    const out = [];
    for (const x of items) {
      const last = out[out.length - 1];
      if (last && last.p === x.p && !!last.manual === !!x.manual && x.s - last.e <= RUN_GAP) {
        last.e = Math.max(last.e, x.e);
        last.ms += x.e - x.s;
        continue;
      }
      out.push({ p: x.p, s: x.s, e: x.e, ms: x.e - x.s, manual: !!x.manual });
    }
    return out;
  }

  /** 期間のプリセット（週は月曜始まり） */
  function periodRange(preset, today) {
    const [y, m, d] = today.split('-').map(Number);
    const t = new Date(y, m - 1, d);
    let from;
    let to;
    if (preset === 'thisWeek' || preset === 'lastWeek') {
      const monday = new Date(y, m - 1, d - ((t.getDay() + 6) % 7) - (preset === 'lastWeek' ? 7 : 0));
      from = monday;
      to = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    } else if (preset === 'lastMonth') {
      from = new Date(y, m - 2, 1);
      to = new Date(y, m - 1, 0);
    } else {
      from = new Date(y, m - 1, 1);
      to = new Date(y, m, 0);
    }
    const keys = [];
    for (let k = L.dayKey(from.getTime()); k <= L.dayKey(to.getTime()); k = L.addDays(k, 1)) keys.push(k);
    return { from: keys[0], to: keys[keys.length - 1], keys };
  }

  /** 期間の集計。statsByKey: 日付 → day() の結果 */
  function period(keys, statsByKey, projects) {
    projects = projects || [];
    const order = new Map(projects.map((p, i) => [p.id, i]));
    const totals = new Map();
    const dayCount = new Map();
    let total = 0;
    let unassigned = 0;
    const days = keys.map((key) => {
      const st = statsByKey[key];
      const by = {};
      if (st) {
        for (const p of st.projects) {
          by[p.id] = p.ms;
          tally(totals, p.id, p.ms);
          tally(dayCount, p.id, 1);
        }
        total += st.total;
        unassigned += st.unassigned;
      }
      return { key, total: st ? st.total : 0, unassigned: st ? st.unassigned : 0, by };
    });
    const byId = new Map(projects.map((p) => [p.id, p]));
    const rows = [...totals.entries()]
      .filter(([id]) => byId.has(id))
      .map(([id, ms]) => ({ id, name: byId.get(id).name || '（名前なし）', color: byId.get(id).color || 0, ms, days: dayCount.get(id) || 0, order: order.get(id) }))
      .sort((a, b) => b.ms - a.ms || a.order - b.order);
    const activeDays = days.filter((x) => x.total > 0).length;
    return { days, projects: rows, total, unassigned, activeDays };
  }

  /**
   * 日報のテキスト
   * @param {object} stats day() の結果
   * @param {object} o { key, mode: 'hm'|'h', unit: 丸め（分）, details: 主なページ, unassigned: 未分類も入れる, memos: {pid: text} }
   */
  function reportText(stats, o) {
    const mode = o.mode || 'hm';
    const unit = o.unit || 0;
    const memos = o.memos || {};
    const rows = [];
    const skipped = [];
    for (const p of stats.projects) {
      const r = roundMs(p.ms, unit);
      if (r > 0) rows.push({ p, r });
      else skipped.push(p);
    }
    const un = o.unassigned ? roundMs(stats.unassigned, unit) : 0;
    const title = `【${dateLabel(o.key)}の工数】`;
    if (!rows.length && !un) return `${title}記録がありません`;
    const total = rows.reduce((a, x) => a + x.r, 0) + un;
    const lines = [`${title}合計 ${fmt(total, mode)}`];
    for (const { p, r } of rows) {
      lines.push(`■ ${p.name}　${fmt(r, mode)}`);
      const memo = String(memos[p.id] || '').trim();
      if (memo) for (const m of memo.split(/\r?\n/)) if (m.trim()) lines.push(`　${m.trim()}`);
      if (o.details) for (const pg of p.pages.slice(0, 3)) lines.push(`　・${clip(pg.label, 40)}（${fmt(pg.ms, 'hm')}）`);
    }
    if (un > 0) lines.push(`■ 未分類　${fmt(un, mode)}`);
    if (skipped.length) lines.push(`※ ${unit ? `${unit}分単位で丸めると0になるため` : '1分未満のため'}省略：${skipped.map((p) => `${p.name}（${fmtLong(p.ms)}）`).join('、')}`);
    return lines.join('\n');
  }

  function clip(s, n) {
    const a = Array.from(String(s || ''));
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  }

  const hours = (ms) => (ms / HOUR).toFixed(2);

  /** 集計CSV：日付×プロジェクト（1分未満は省く） */
  function csvSummary(keys, statsByKey, memosByKey) {
    const rows = [['日付', '曜日', 'プロジェクト', '時間', '時間（h）', '分', 'メモ']];
    for (const key of keys) {
      const st = statsByKey[key];
      if (!st) continue;
      const memos = (memosByKey && memosByKey[key]) || {};
      for (const p of st.projects) if (Math.round(p.ms / MIN) >= 1) rows.push([key, WEEK[weekday(key)], p.name, fmt(p.ms), hours(p.ms), Math.round(p.ms / MIN), memos[p.id] || '']);
      if (Math.round(st.unassigned / MIN) >= 1) rows.push([key, WEEK[weekday(key)], '未分類', fmt(st.unassigned), hours(st.unassigned), Math.round(st.unassigned / MIN), '']);
    }
    return rows;
  }

  /** 明細CSV：記録した区間ごと */
  function csvDetail(keys, statsByKey, projects) {
    const names = new Map((projects || []).map((p) => [p.id, p.name]));
    const rows = [['日付', '開始', '終了', '分', 'プロジェクト', '種別', 'サイト', 'ページタイトル', 'URL', 'メモ']];
    for (const key of keys) {
      const st = statsByKey[key];
      if (!st) continue;
      for (const x of st.items) {
        rows.push([
          key,
          clock(x.s),
          clock(x.e),
          ((x.e - x.s) / MIN).toFixed(1),
          x.p ? names.get(x.p) || '' : '未分類',
          x.manual ? '手入力' : '自動',
          x.host || '',
          x.title || '',
          x.host ? `${x.host}${x.path || ''}` : '',
          x.memo || '',
        ]);
      }
    }
    return rows;
  }

  TA.report = { MIN, HOUR, WEEK, BLOCK_GAP, roundMs, fmt, fmtLong, clock, dateLabel, weekday, effective, day, blocks, runs, periodRange, period, reportText, csvSummary, csvDetail };
  if (typeof module === 'object' && module.exports) module.exports = TA.report;
})(typeof globalThis !== 'undefined' ? globalThis : this);
