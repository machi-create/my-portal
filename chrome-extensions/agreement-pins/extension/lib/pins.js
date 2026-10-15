/*
 * 合意ピン：データの形・保存・書き出し
 *
 * pin = {
 *   id, origin, path, url, pageTitle,
 *   anchor: { selector, tag, text, x, y },   要素を見つけ直す手がかり
 *   target: '見出し「会社概要」',             人が読む対象名
 *   entries: [{ id, status, what, who, date, note, createdAt }],  古い順の履歴
 *   createdAt, updatedAt
 * }
 * ページのパスごとに chrome.storage.local の `pins:<パス>` に配列で保存します。
 */
(function (root) {
  'use strict';
  const PIN = (root.PIN = root.PIN || {});

  const STATUS = {
    agreed: { label: '合意', color: '#16a34a' },
    pending: { label: '保留', color: '#d97706' },
    question: { label: '要確認', color: '#2563eb' },
    rejected: { label: '却下', color: '#6b7280' },
  };
  const STATUS_ORDER = ['agreed', 'pending', 'question', 'rejected'];

  const DEFAULT_SETTINGS = { shareAcrossHosts: true, autoShow: true, recorder: '' };

  function pathOf(url) {
    try {
      const u = new URL(url);
      let p = u.pathname || '/';
      p = p.replace(/\/index\.html?$/i, '/');
      return p;
    } catch (e) {
      return '/';
    }
  }

  function originOf(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'file:' ? 'file://' : u.origin;
    } catch (e) {
      return '';
    }
  }

  function keyFor(url) {
    return `pins:${pathOf(url)}`;
  }

  function latest(pin) {
    return pin.entries[pin.entries.length - 1] || { status: 'pending', what: '', who: '', date: '' };
  }

  function statusOf(pin) {
    return latest(pin).status;
  }

  /** このページに表示するピン（同じパス。shareAcrossHosts が false なら同じドメインのみ） */
  function filterForUrl(pins, url, settings) {
    const origin = originOf(url);
    const share = settings ? settings.shareAcrossHosts !== false : true;
    return (pins || []).filter((p) => share || p.origin === origin);
  }

  function sortPins(pins) {
    return [...pins].sort((a, b) => a.createdAt - b.createdAt);
  }

  // ---------------------------------------------------------------- 保存（chrome.storage.local）
  async function loadPage(url) {
    const key = keyFor(url);
    const data = await chrome.storage.local.get(key);
    return sortPins(data[key] || []);
  }

  async function savePin(pin) {
    const key = `pins:${pin.path}`;
    const data = await chrome.storage.local.get(key);
    const list = data[key] || [];
    const i = list.findIndex((p) => p.id === pin.id);
    pin.updatedAt = Date.now();
    if (i >= 0) list[i] = pin;
    else list.push(pin);
    await chrome.storage.local.set({ [key]: list });
    return pin;
  }

  async function removePin(pin) {
    const key = `pins:${pin.path}`;
    const data = await chrome.storage.local.get(key);
    const list = (data[key] || []).filter((p) => p.id !== pin.id);
    if (list.length) await chrome.storage.local.set({ [key]: list });
    else await chrome.storage.local.remove(key);
  }

  async function loadAll() {
    const data = await chrome.storage.local.get(null);
    const out = [];
    for (const [k, v] of Object.entries(data)) if (k.startsWith('pins:') && Array.isArray(v)) out.push(...v);
    return sortPins(out);
  }

  /** 読み込んだピンを統合する。同じIDは更新日時が新しい方、履歴は和集合 */
  function merge(existing, incoming) {
    const map = new Map(existing.map((p) => [p.id, p]));
    let added = 0;
    let updated = 0;
    for (const p of incoming) {
      if (!p || !p.id || !Array.isArray(p.entries) || !p.path) continue;
      const cur = map.get(p.id);
      if (!cur) {
        map.set(p.id, p);
        added++;
        continue;
      }
      const entries = new Map(cur.entries.map((e) => [e.id, e]));
      let changed = false;
      for (const e of p.entries) {
        if (!entries.has(e.id)) {
          entries.set(e.id, e);
          changed = true;
        }
      }
      const base = (p.updatedAt || 0) > (cur.updatedAt || 0) ? p : cur;
      const mergedEntries = [...entries.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (changed || base !== cur) updated++;
      map.set(p.id, { ...base, entries: mergedEntries, updatedAt: Math.max(cur.updatedAt || 0, p.updatedAt || 0) });
    }
    return { pins: sortPins([...map.values()]), added, updated };
  }

  async function importPins(incoming) {
    const all = await loadAll();
    const res = merge(all, incoming);
    const byKey = {};
    for (const p of res.pins) (byKey[`pins:${p.path}`] = byKey[`pins:${p.path}`] || []).push(p);
    await chrome.storage.local.set(byKey);
    return res;
  }

  // ---------------------------------------------------------------- 書き出し
  function fmtDate(d) {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : String(d);
  }

  function cell(s) {
    return String(s == null ? '' : s).replace(/\|/g, '｜').replace(/\r?\n/g, ' ');
  }

  function groupByPage(pins) {
    const groups = new Map();
    for (const p of sortPins(pins)) {
      const k = p.path;
      if (!groups.has(k)) groups.set(k, { path: k, title: p.pageTitle || '', pins: [] });
      const g = groups.get(k);
      if (!g.title && p.pageTitle) g.title = p.pageTitle;
      g.pins.push(p);
    }
    return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  function toMarkdown(pins, opts) {
    const o = Object.assign({ title: '合意事項一覧', today: new Date() }, opts);
    const t = o.today;
    const stamp = `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}`;
    const out = [`# ${o.title}（${stamp} 時点）`, ''];
    for (const g of groupByPage(pins)) {
      out.push(`## ${g.path}${g.title ? `（${g.title}）` : ''}`, '');
      out.push('| No. | 状態 | 対象 | 内容 | 確認者 | 日付 |');
      out.push('| --- | --- | --- | --- | --- | --- |');
      g.pins.forEach((p, i) => {
        const e = latest(p);
        out.push(`| ${i + 1} | ${STATUS[e.status] ? STATUS[e.status].label : e.status} | ${cell(p.target)} | ${cell(e.what)}${e.note ? `<br>※${cell(e.note)}` : ''} | ${cell(e.who)} | ${fmtDate(e.date)} |`);
      });
      const withHistory = g.pins.map((p, i) => [p, i]).filter(([p]) => p.entries.length > 1);
      if (withHistory.length) {
        out.push('');
        for (const [p, i] of withHistory) {
          const hist = p.entries.map((e) => `${fmtDate(e.date).slice(5)} ${STATUS[e.status] ? STATUS[e.status].label : e.status}（${e.who || '—'}）`).join(' → ');
          out.push(`- No.${i + 1} の経緯：${hist}`);
        }
      }
      out.push('');
    }
    return out.join('\n').trim();
  }

  function toRows(pins) {
    const rows = [['ページ', 'No.', '状態', '対象', '内容', '確認者', '日付', 'メモ', '履歴の数', 'URL']];
    for (const g of groupByPage(pins)) {
      g.pins.forEach((p, i) => {
        const e = latest(p);
        rows.push([g.path, i + 1, STATUS[e.status] ? STATUS[e.status].label : e.status, p.target, e.what, e.who, fmtDate(e.date), e.note || '', p.entries.length, p.url]);
      });
    }
    return rows;
  }

  PIN.data = { STATUS, STATUS_ORDER, DEFAULT_SETTINGS, pathOf, originOf, keyFor, latest, statusOf, filterForUrl, sortPins, loadPage, savePin, removePin, loadAll, merge, importPins, toMarkdown, toRows, groupByPage, fmtDate };
  if (typeof module === 'object' && module.exports) module.exports = PIN.data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
