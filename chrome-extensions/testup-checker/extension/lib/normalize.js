/*
 * テストアップチェッカー：文字列の正規化
 * - loose(): 照合用のゆるい正規化（全角半角・大文字小文字・空白・ダッシュ類を同一視）
 *            出力の各文字が元文字列のどこに対応するかの map も返す
 * - canon(): 表示・厳密比較用の正規化（HTML由来の改行や空白だけを整理）
 */
(function (root) {
  'use strict';
  const TUC = (root.TUC = root.TUC || {});

  const SPACE_RE = /[\s​-‍⁠﻿­]/;
  const DASH_RE = /[-‐-―⁃−─━ー﹘﹣－ｰ]/;
  const TILDE_RE = /[〜∼～~]/;
  const SINGLE_QUOTE_RE = /[‘’‚‛′]/;
  const DOUBLE_QUOTE_RE = /[“”„‟″]/;
  const VOICED_MARK_RE = /^[゙゚]/;

  function looseUnit(ch) {
    if (SPACE_RE.test(ch)) return '';
    const s = ch.normalize('NFKC').toLowerCase();
    let out = '';
    for (const c of s) {
      if (SPACE_RE.test(c)) continue;
      if (DASH_RE.test(c)) out += '-';
      else if (TILDE_RE.test(c)) out += '~';
      else if (SINGLE_QUOTE_RE.test(c)) out += "'";
      else if (DOUBLE_QUOTE_RE.test(c)) out += '"';
      else out += c;
    }
    return out;
  }

  /**
   * @param {string} str
   * @returns {{text: string, map: Int32Array}} map[i] = 出力 i 番目（UTF-16単位）に対応する元文字列のインデックス
   */
  function loose(str) {
    str = String(str == null ? '' : str);
    const parts = [];
    const map = [];
    let i = 0;
    for (const ch of str) {
      let out = looseUnit(ch);
      // 半角カナの濁点・半濁点（ｶﾞ）は直前の文字と合成する
      if (out && VOICED_MARK_RE.test(out) && parts.length) {
        const prev = parts[parts.length - 1];
        const composed = (prev + out[0]).normalize('NFC');
        if (composed.length === prev.length) {
          parts[parts.length - 1] = composed;
          out = out.slice(1);
        }
      }
      for (const u of out) {
        parts.push(u);
        map.push(i);
        if (u.length === 2) map.push(i);
      }
      i += ch.length;
    }
    return { text: parts.join(''), map: Int32Array.from(map) };
  }

  const NEWLINE_RUN_RE = /[\t\f\v  ]*[\r\n][\t\n\r\f\v  ]*/g;
  const SPACE_RUN_RE = /[\t\f\v  ]+/g;

  /**
   * 表示用の正規化。HTMLソースの改行・インデントは、日本語の前後なら取り除き、
   * それ以外は半角スペース1つにする。書かれているスペース（「港 太郎」など）は残す。
   */
  function canon(str) {
    return String(str == null ? '' : str)
      .normalize('NFC')
      .replace(/[​﻿]/g, '')
      .replace(NEWLINE_RUN_RE, '\n')
      .replace(SPACE_RUN_RE, ' ')
      .replace(/\n(?=[^\x00-\x7f])|(?<=[^\x00-\x7f])\n/g, '')
      .replace(/\n/g, ' ')
      .trim();
  }

  /** 「一致」判定用のキー。半角スペースの有無は区別しない（全角スペースは区別する） */
  function key(str) {
    return canon(str).replace(/ /g, '');
  }

  /** 文字（ひらがな・カタカナ・漢字・英字など）の数。記号や数字は数えない */
  function letterCount(str) {
    const m = String(str).match(/\p{L}/gu);
    return m ? m.length : 0;
  }

  TUC.normalize = { loose, canon, key, letterCount };
  if (typeof module === 'object' && module.exports) module.exports = TUC.normalize;
})(typeof globalThis !== 'undefined' ? globalThis : this);
