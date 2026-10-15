/*
 * テストアップチェッカー：原稿の読み込みと分割
 * テキスト / TSV（Excel・スプレッドシートからのコピペ）/ CSV を「1要素＝1セグメント」に分割する
 */
(function (root) {
  'use strict';
  const TUC = (root.TUC = root.TUC || {});

  const DEFAULT_OPTIONS = {
    columns: '',
    skipHeader: false,
    stripLabels: true,
    ignorePrefixes: '//, ※指示, ※修正',
  };

  // 原稿によく付く「【見出し】」などのラベル（中身ではないもの）だけを対象にする
  const LABEL_RE =
    /^【\s*(?:h[1-6]|見出し[0-9０-９]*|大見出し|中見出し|小見出し|タイトル|ページタイトル|title|本文|リード文?|ボタン|キャプション|注釈|注記|alt|代替テキスト|description|ディスクリプション|メタ|キャッチ(?:コピー)?|サブ(?:コピー|タイトル)?|コピー|テキスト|リンク|画像|ラベル)[^】]{0,12}】\s*/i;
  const MARKDOWN_RE = /^(?:#{1,6}\s+|[-*+]\s+|\d{1,3}[.)]\s+|>\s*)/;
  const BULLET_RE = /^[■□●◆◇▼▽▶▷★☆・◎]+\s*/;

  /** CSV/TSV をパースする（ダブルクォート内の改行・区切り文字に対応） */
  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let atFieldStart = true;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
        continue;
      }
      if (c === '"' && atFieldStart) {
        inQuotes = true;
        atFieldStart = false;
        continue;
      }
      if (c === delimiter) {
        row.push(field);
        field = '';
        atFieldStart = true;
        continue;
      }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        atFieldStart = true;
        continue;
      }
      field += c;
      atFieldStart = false;
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  /** "C" / "3" / "C,D" / "B-D" → 0始まりの列番号の配列（空なら null = すべて） */
  function parseColumns(spec) {
    spec = String(spec || '').trim();
    if (!spec) return null;
    const toIndex = (token) => {
      token = token.trim().toUpperCase().normalize('NFKC');
      if (/^\d+$/.test(token)) return Number(token) - 1;
      if (/^[A-Z]{1,3}$/.test(token)) {
        let n = 0;
        for (const ch of token) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n - 1;
      }
      return -1;
    };
    const out = new Set();
    for (const part of spec.split(/[,、，\s]+/)) {
      if (!part) continue;
      const range = part.split(/[-‐ー〜~]/);
      if (range.length === 2) {
        const a = toIndex(range[0]);
        const b = toIndex(range[1]);
        if (a >= 0 && b >= a) for (let k = a; k <= b; k++) out.add(k);
      } else {
        const k = toIndex(part);
        if (k >= 0) out.add(k);
      }
    }
    return out.size ? [...out].sort((a, b) => a - b) : null;
  }

  function columnName(index) {
    let n = index + 1;
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function detectFormat(text) {
    return /\t/.test(text) ? 'tsv' : 'text';
  }

  function cleanLine(line, opts, prefixes) {
    let s = line.replace(/^[\s　]+|[\s　]+$/g, '');
    if (!s) return '';
    if (prefixes.some((p) => s.startsWith(p))) return '';
    if (opts.stripLabels) {
      for (let k = 0; k < 3; k++) {
        const before = s;
        s = s.replace(LABEL_RE, '').replace(MARKDOWN_RE, '').replace(BULLET_RE, '');
        s = s.replace(/^[\s　]+/, '');
        if (s === before) break;
      }
    }
    return s;
  }

  /**
   * @returns {{segments: {text:string, line:number, col:number|null}[], format:string, rows:number}}
   */
  function parse(text, options) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, options);
    text = String(text || '').replace(/^﻿/, '');
    const format = opts.format && opts.format !== 'auto' ? opts.format : detectFormat(text);
    const prefixes = String(opts.ignorePrefixes || '')
      .split(/[,、，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const segments = [];

    if (format === 'text') {
      const lines = text.split(/\r\n|\r|\n/);
      lines.forEach((line, i) => {
        const s = cleanLine(line, opts, prefixes);
        if (s) segments.push({ text: s, line: i + 1, col: null });
      });
      return { segments, format, rows: lines.length };
    }

    const rows = parseDelimited(text, format === 'csv' ? ',' : '\t');
    const cols = parseColumns(opts.columns);
    rows.forEach((row, r) => {
      if (opts.skipHeader && r === 0) return;
      row.forEach((cell, c) => {
        if (cols && !cols.includes(c)) return;
        for (const sub of String(cell).split(/\r\n|\r|\n/)) {
          const s = cleanLine(sub, opts, prefixes);
          if (s) segments.push({ text: s, line: r + 1, col: c });
        }
      });
    });
    return { segments, format, rows: rows.length };
  }

  /** CSV をテキストエリア表示用の TSV に変換する（セル内改行はExcel同様にクォート） */
  function csvToTsv(text) {
    const rows = parseDelimited(String(text).replace(/^﻿/, ''), ',');
    return rows
      .map((row) =>
        row.map((cell) => (/[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join('\t')
      )
      .join('\n');
  }

  /** Google スプレッドシート / ドキュメントのURLを、テキストで取得できるURLに変換する */
  function toFetchUrl(input) {
    const u = new URL(String(input).trim());
    if (u.hostname === 'docs.google.com') {
      const gidMatch = (u.hash + u.search).match(/gid=(\d+)/);
      const gid = gidMatch ? `&gid=${gidMatch[1]}` : '';
      let m = u.pathname.match(/^\/spreadsheets\/d\/(e\/)?([\w-]+)/);
      if (m) {
        if (m[1]) return { url: `https://docs.google.com/spreadsheets/d/e/${m[2]}/pub?output=csv${gid}`, format: 'csv', kind: 'Googleスプレッドシート' };
        return { url: `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=csv${gid}`, format: 'csv', kind: 'Googleスプレッドシート' };
      }
      m = u.pathname.match(/^\/document\/d\/(e\/)?([\w-]+)/);
      if (m) {
        if (m[1]) return { url: u.href, format: 'html', kind: 'Googleドキュメント' };
        return { url: `https://docs.google.com/document/d/${m[2]}/export?format=txt`, format: 'text', kind: 'Googleドキュメント' };
      }
    }
    const ext = (u.pathname.match(/\.([a-z0-9]+)$/i) || [])[1];
    const format = ext ? { csv: 'csv', tsv: 'tsv', txt: 'text', md: 'text', text: 'text' }[ext.toLowerCase()] : null;
    return { url: u.href, format: format || 'auto', kind: 'URL' };
  }

  /** バイト列を文字列に。UTF-8 として不正なら Shift_JIS（日本語版ExcelのCSV）として読む */
  function decodeBytes(buffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (e) {
      return new TextDecoder('shift_jis').decode(buffer);
    }
  }

  TUC.manuscript = {
    DEFAULT_OPTIONS,
    parse,
    parseDelimited,
    parseColumns,
    columnName,
    detectFormat,
    csvToTsv,
    toFetchUrl,
    decodeBytes,
  };
  if (typeof module === 'object' && module.exports) module.exports = TUC.manuscript;
})(typeof globalThis !== 'undefined' ? globalThis : this);
