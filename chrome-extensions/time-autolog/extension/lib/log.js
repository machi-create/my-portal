/*
 * 工数オートログ：記録（1日ごとの区間リスト）の操作
 *
 * 区間 = { s: 開始ms, e: 終了ms, host, path, title }       … 自動記録
 *        { s, e, manual: true, pid, memo }                   … 手入力
 *   pid がある区間は、ルールより pid を優先（手で振り分け直したもの）。pid: '_none' は「未分類」に固定
 * 区間は開始時刻 s の順に並べ、s を区間のIDとして使う。
 */
(function (root) {
  'use strict';
  const TA = (root.TA = root.TA || {});

  const MIN = 60 * 1000;
  const MERGE_GAP = 90 * 1000; // 同じページの記録が、この間隔以内なら1つにまとめる
  const NONE = '_none';

  const pad = (n) => String(n).padStart(2, '0');

  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dayStart(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + n).getTime());
  }

  function nextMidnight(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  /** 日付をまたぐ区間を、日ごとに分ける */
  function splitByDay(seg) {
    const out = [];
    let s = seg.s;
    while (s < seg.e) {
      const e = Math.min(seg.e, nextMidnight(s));
      out.push({ key: dayKey(s), seg: { ...seg, s, e } });
      s = e;
    }
    return out;
  }

  /** 保存用のタイトル：通知件数「(3)」を除き、長すぎるものは切る */
  function cleanTitle(title) {
    const t = String(title || '')
      .replace(/^\(\d+\+?\)\s*/, '')
      .replace(/\s*\(\d{1,4}\+?\)(?=\s*[-–—|｜]|$)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const a = Array.from(t);
    return a.length > 120 ? a.slice(0, 120).join('') : t;
  }

  const samePage = (a, b) => !a.manual && !b.manual && a.host === b.host && a.path === b.path && a.title === b.title;

  /** 区間を1日のリストに加える（直前の同じページの記録とつながっていれば延長する）。list を書き換えて返す */
  function append(list, seg) {
    if (!(seg.e - seg.s >= 1000)) return list;
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      if (x.manual) continue;
      if (samePage(x, seg) && seg.s >= x.s && seg.s - x.e <= MERGE_GAP) {
        x.e = Math.max(x.e, seg.e);
        return list;
      }
      break;
    }
    insert(list, seg);
    return list;
  }

  function insert(list, seg) {
    while (list.some((x) => x.s === seg.s)) seg.s += 1;
    let i = list.length;
    while (i > 0 && list[i - 1].s > seg.s) i--;
    list.splice(i, 0, seg);
    return seg;
  }

  function assign(list, ids, pid) {
    const set = new Set(ids);
    let n = 0;
    for (const x of list) {
      if (!set.has(x.s)) continue;
      if (pid == null) delete x.pid;
      else x.pid = pid;
      n++;
    }
    return n;
  }

  function remove(list, ids) {
    const set = new Set(ids);
    return list.filter((x) => !set.has(x.s));
  }

  /** 記録中の区間を閉じる時刻。ハートビートが途切れていたら（スリープなど）、途切れる前までにする */
  const BEAT = MIN;
  const STALE = 3 * MIN;
  function closeAt(current, now) {
    const end = now - current.beat > STALE ? current.beat + BEAT : now;
    return Math.max(current.s, Math.min(end, now));
  }

  TA.log = { MIN, MERGE_GAP, NONE, BEAT, STALE, pad, dayKey, dayStart, addDays, nextMidnight, splitByDay, cleanTitle, samePage, append, insert, assign, remove, closeAt };
  if (typeof module === 'object' && module.exports) module.exports = TA.log;
})(typeof globalThis !== 'undefined' ? globalThis : this);
