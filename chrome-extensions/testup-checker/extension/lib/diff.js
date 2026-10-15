/*
 * テストアップチェッカー：文字単位の差分
 * diffChars(a, b) → [[op, text], ...]  op: 0=共通 / -1=a（原稿）にだけある / 1=b（ページ）にだけある
 */
(function (root) {
  'use strict';
  const TUC = (root.TUC = root.TUC || {});

  const EQ = 0;
  const DEL = -1;
  const INS = 1;

  function push(ops, op, text) {
    if (!text) return;
    const last = ops[ops.length - 1];
    if (last && last[0] === op) last[1] += text;
    else ops.push([op, text]);
  }

  function lcs(a, b, maxCells, ops) {
    const m = a.length;
    const n = b.length;
    if (!m && !n) return;
    if (!m) return push(ops, INS, b.join(''));
    if (!n) return push(ops, DEL, a.join(''));
    if ((m + 1) * (n + 1) > maxCells) {
      push(ops, DEL, a.join(''));
      push(ops, INS, b.join(''));
      return;
    }
    const w = n + 1;
    // (m+1)(n+1) <= maxCells なので LCS 長は Uint16 に収まる
    const dp = new Uint16Array((m + 1) * w);
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i * w + j] =
          a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) {
        push(ops, EQ, a[i]);
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        push(ops, DEL, a[i++]);
      } else {
        push(ops, INS, b[j++]);
      }
    }
    if (i < m) push(ops, DEL, a.slice(i).join(''));
    if (j < n) push(ops, INS, b.slice(j).join(''));
  }

  /** 連続する変更を「削除→挿入」の順にまとめる */
  function normalizeOps(ops) {
    const out = [];
    let del = '';
    let ins = '';
    const flush = () => {
      if (del) out.push([DEL, del]);
      if (ins) out.push([INS, ins]);
      del = '';
      ins = '';
    };
    for (const [op, text] of ops) {
      if (!text) continue;
      if (op === EQ) {
        flush();
        const last = out[out.length - 1];
        if (last && last[0] === EQ) last[1] += text;
        else out.push([EQ, text]);
      } else if (op === DEL) del += text;
      else ins += text;
    }
    flush();
    return out;
  }

  /** 変更に挟まれた1文字だけの共通部分は、読みやすさのため変更側に吸収する */
  function cleanup(ops) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let k = 1; k < ops.length - 1; k++) {
        if (ops[k][0] !== EQ || Array.from(ops[k][1]).length > 1) continue;
        if (ops[k - 1][0] === EQ || ops[k + 1][0] === EQ) continue;
        const t = ops[k][1];
        ops.splice(k, 1, [DEL, t], [INS, t]);
        ops = normalizeOps(ops);
        changed = true;
        break;
      }
    }
    return ops;
  }

  function diffChars(a, b, maxCells) {
    maxCells = maxCells || 4000000;
    a = String(a == null ? '' : a);
    b = String(b == null ? '' : b);
    if (a === b) return a ? [[EQ, a]] : [];
    const A = Array.from(a);
    const B = Array.from(b);
    let pre = 0;
    while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    let suf = 0;
    while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
    const ops = [];
    if (pre) push(ops, EQ, A.slice(0, pre).join(''));
    lcs(A.slice(pre, A.length - suf), B.slice(pre, B.length - suf), maxCells, ops);
    if (suf) push(ops, EQ, A.slice(A.length - suf).join(''));
    return cleanup(normalizeOps(ops));
  }

  TUC.diff = { diffChars, EQ, DEL, INS };
  if (typeof module === 'object' && module.exports) module.exports = TUC.diff;
})(typeof globalThis !== 'undefined' ? globalThis : this);
