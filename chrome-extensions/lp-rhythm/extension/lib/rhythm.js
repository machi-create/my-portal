/*
 * LP抑揚グラフ：計測結果から指標と「気づき」を出す
 *
 * m = {
 *   url, title, host, vw, vh, docH, binH,
 *   bins: [{ chars, image }],      binH ごと（画面の半分）の文字数と画像の面積比（0〜1）
 *   ctas: [{ y, label }],          申し込みボタンなどの位置（ページ上端からのpx）
 *   headings: [{ y, level, text }],
 *   fixedCtas: [label],            画面に固定された（追従する）ボタン
 *   firstView: { heading, cta, image, chars }
 * }
 */
(function (root) {
  'use strict';
  const LR = (root.LR = root.LR || {});

  const BIN_SCREENS = 0.5;
  const WALL_CHARS = 350;
  const round1 = (n) => Math.round(n * 10) / 10;

  function metrics(m) {
    const screens = m.docH / m.vh;
    const ctaYs = m.ctas.map((c) => c.y).sort((a, b) => a - b);
    const totalChars = m.bins.reduce((s, b) => s + b.chars, 0);
    const imageShare = m.bins.length ? m.bins.reduce((s, b) => s + b.image, 0) / m.bins.length : 0;
    // CTA と CTA の間（先頭・末尾を含む）の長さ（画面数）
    const marks = [0, ...ctaYs, m.docH];
    let longest = { from: 0, to: 0, length: 0 };
    for (let i = 0; i + 1 < marks.length; i++) {
      const len = (marks[i + 1] - marks[i]) / m.vh;
      if (len > longest.length) longest = { from: marks[i] / m.vh, to: marks[i + 1] / m.vh, length: len };
    }
    return {
      screens: round1(screens),
      ctaCount: m.ctas.length,
      firstCta: ctaYs.length ? round1(ctaYs[0] / m.vh) : null,
      headingCount: m.headings.length,
      charsPerScreen: Math.round(totalChars / Math.max(1, screens)),
      imageShare: Math.round(imageShare * 100),
      longestGap: { from: round1(longest.from), to: round1(longest.to), length: round1(longest.length) },
      fixedCta: m.fixedCtas.length > 0,
    };
  }

  /** 条件を満たすビンが続く区間を探す（minBins 個以上） */
  function runs(bins, test, minBins) {
    const out = [];
    let start = -1;
    for (let i = 0; i <= bins.length; i++) {
      const ok = i < bins.length && test(bins[i], i);
      if (ok && start < 0) start = i;
      if (!ok && start >= 0) {
        if (i - start >= minBins) out.push({ from: start, to: i });
        start = -1;
      }
    }
    return out;
  }

  /**
   * 気づき（severity: warn / info / good）
   * zone は画面数での区間（ページ上の場所を示せるもの）
   */
  function insights(m) {
    const k = metrics(m);
    const out = [];
    const zoneOf = (r) => ({ from: round1(r.from * BIN_SCREENS), to: round1(r.to * BIN_SCREENS) });

    if (!m.firstView.cta) out.push({ id: 'fv-cta', severity: 'warn', title: 'ファーストビューに申し込みボタンがありません', detail: '最初の画面で行動の入口が見えると、すぐ申し込みたい人を逃しにくくなります。', zone: { from: 0, to: 1 } });
    if (!m.firstView.heading) out.push({ id: 'fv-heading', severity: 'warn', title: 'ファーストビューに大きな見出しがありません', detail: '何のページかが一目で伝わる見出し（キャッチコピー）を置くのが一般的です。', zone: { from: 0, to: 1 } });

    if (k.longestGap.length >= 3 && k.screens >= 4) {
      out.push({ id: 'gap', severity: 'warn', title: `${k.longestGap.from}〜${k.longestGap.to}画面目の${k.longestGap.length}画面、申し込みボタンがありません`, detail: '読み進めて気持ちが高まったところで押せるよう、途中にもボタンを置くことを検討してください。', zone: { from: k.longestGap.from, to: k.longestGap.to } });
    }

    // 画面の半分に350字以上（本文がほぼ埋まっている状態）で、画像が少ない区間が2画面以上
    for (const r of runs(m.bins, (b) => b.chars >= WALL_CHARS && b.image < 0.12, 4)) {
      const z = zoneOf(r);
      out.push({ id: `wall-${r.from}`, severity: 'warn', title: `${z.from}〜${z.to}画面目は文字が続きます`, detail: '画像・図・見出しを挟むと、読み疲れて離脱するのを防げます。', zone: z });
    }
    for (const r of runs(m.bins, (b, i) => i > 1 && b.chars < 30 && b.image < 0.15, 4)) {
      const z = zoneOf(r);
      out.push({ id: `sparse-${r.from}`, severity: 'info', title: `${z.from}〜${z.to}画面目は情報が少なく、余白が続きます`, detail: '意図した「間」でなければ、内容を詰めるか、写真などで間を持たせてください。', zone: z });
    }

    if (k.screens >= 6 && k.ctaCount < 2) out.push({ id: 'cta-few', severity: 'warn', title: `ページの長さ（${k.screens}画面）に対して、申し込みボタンが${k.ctaCount}個と少なめです`, detail: '3〜4画面に1回を目安に、ボタンを置くことを検討してください。' });
    if (k.screens >= 8 && !k.fixedCta) out.push({ id: 'fixed', severity: 'info', title: '画面に追従するボタンはありません', detail: '縦に長いLPでは、画面下に固定した申し込みボタン（追従CTA）が効果的なことがあります。' });
    if (k.fixedCta) out.push({ id: 'fixed-ok', severity: 'good', title: `画面に追従するボタンがあります（${m.fixedCtas.slice(0, 2).join('・')}）` });
    if (m.firstView.cta && m.firstView.heading) out.push({ id: 'fv-ok', severity: 'good', title: 'ファーストビューに見出しと申し込みボタンがあります' });
    if (!out.some((x) => x.id === 'gap' || x.id === 'cta-few') && k.ctaCount >= 2) out.push({ id: 'cta-ok', severity: 'good', title: `申し込みボタンが${k.ctaCount}か所にあり、長い空白はありません` });
    return out;
  }

  /** 比較表の行 */
  function compareRows(list) {
    const ms = list.map((x) => ({ name: x.name, k: metrics(x.m) }));
    const rows = [
      ['長さ', (k) => `${k.screens}画面`],
      ['申し込みボタン', (k) => `${k.ctaCount}個`],
      ['最初のボタン', (k) => (k.firstCta == null ? 'なし' : `${k.firstCta}画面目`)],
      ['ボタンのない最長区間', (k) => `${k.longestGap.length}画面`],
      ['見出し', (k) => `${k.headingCount}個`],
      ['1画面あたりの文字数', (k) => `${k.charsPerScreen}字`],
      ['画像の割合', (k) => `${k.imageShare}%`],
      ['追従ボタン', (k) => (k.fixedCta ? 'あり' : 'なし')],
    ];
    return { header: ['', ...ms.map((x) => x.name)], rows: rows.map(([label, f]) => [label, ...ms.map((x) => f(x.k))]) };
  }

  function binLabel(i) {
    return `${round1(i * BIN_SCREENS)}〜${round1((i + 1) * BIN_SCREENS)}画面目`;
  }

  LR.rhythm = { BIN_SCREENS, metrics, insights, compareRows, runs, binLabel };
  if (typeof module === 'object' && module.exports) module.exports = LR.rhythm;
})(typeof globalThis !== 'undefined' ? globalThis : this);
