/*
 * 共通：画面部品のヘルパー（サイドパネル・拡張機能のページ用）
 * ※ 正本は chrome-extensions/_shared/ です。
 */
(function (root) {
  'use strict';
  const WDT = (root.WDT = root.WDT || {});

  const $ = (id) => document.getElementById(id);

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  function svg(tag, attrs, ...children) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const clip = (s, n = 40) => {
    const a = Array.from(String(s == null ? '' : s));
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  };

  const debounce = (fn, ms) => {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  let snackTimer = 0;
  function snack(msg, ms = 2800) {
    let el = $('snackbar');
    if (!el) {
      el = h('div', { class: 'snackbar', id: 'snackbar', role: 'status', 'aria-live': 'polite' });
      document.body.append(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** ボタンを処理中の表示にする。戻り値の関数で元に戻す */
  function busy(btn, label) {
    const prev = btn.textContent;
    const wasDisabled = btn.disabled;
    if (label) btn.textContent = label;
    btn.classList.add('loading');
    btn.disabled = true;
    return () => {
      btn.textContent = prev;
      btn.classList.remove('loading');
      btn.disabled = wasDisabled;
    };
  }

  async function copyText(text, message) {
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
    snack(message || 'コピーしました');
  }

  async function copyImage(dataUrl, message) {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    snack(message || '画像をコピーしました');
  }

  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** タブ（role="tab"）の切り替え。選んだタブを localStorage に覚える */
  function setupTabs(storageKey, onChange) {
    const tabs = [...document.querySelectorAll('.tab[role="tab"]')];
    const select = (id) => {
      for (const t of tabs) {
        const on = t.id === id;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = $(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      }
      try {
        localStorage.setItem(storageKey, id);
      } catch (e) {
        /* 保存できなくても問題なし */
      }
      if (onChange) onChange(id);
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t.id));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        select(next.id);
        next.focus();
      });
    });
    let initial = null;
    try {
      initial = localStorage.getItem(storageKey);
    } catch (e) {
      /* 既定のタブ */
    }
    if (initial && $(initial)) select(initial);
    return select;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(d, withTime) {
    d = d instanceof Date ? d : new Date(d);
    const s = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
  }

  function isoDate(d) {
    d = d instanceof Date ? d : new Date(d);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function uid(prefix) {
    return `${prefix || 'id'}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  /** CSV の1セルを作る（Excelで文字化けしないよう、ファイル全体は BOM 付き UTF-8 で出力する） */
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(rows) {
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  WDT.ui = { $, h, svg, clip, debounce, snack, busy, copyText, copyImage, download, setupTabs, formatDate, isoDate, pad, uid, toCsv };
})(typeof globalThis !== 'undefined' ? globalThis : this);
