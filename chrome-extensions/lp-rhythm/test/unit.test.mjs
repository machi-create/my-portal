// node --test chrome-extensions/lp-rhythm/test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../extension/lib/rhythm.js');

// 画面の高さ 800px、10画面ぶん（20ビン）の LP を作る
function lp(over) {
  const vh = 800;
  const bins = Array.from({ length: 20 }, (_, i) => ({ chars: i < 2 ? 40 : 120, image: i < 2 ? 0.5 : 0.2 }));
  return {
    url: 'https://ex.jp/lp', title: 'LP', host: 'ex.jp', vw: 1280, vh, docH: vh * 10, binH: vh / 2,
    bins,
    ctas: [{ y: 500, label: '申し込む' }, { y: 4000, label: '申し込む' }, { y: 7600, label: '申し込む' }],
    headings: [{ y: 200, level: 1, text: 'キャッチ' }, { y: 1800, level: 2, text: '理由' }],
    fixedCtas: [],
    firstView: { heading: true, cta: true, image: true, chars: 80 },
    ...over,
  };
}

test('指標：長さ・ボタン・最初のボタン・ボタンのない最長区間', () => {
  const k = R.metrics(lp());
  assert.equal(k.screens, 10);
  assert.equal(k.ctaCount, 3);
  assert.equal(k.firstCta, 0.6);
  assert.deepEqual(k.longestGap, { from: 5, to: 9.5, length: 4.5 });
  assert.equal(k.charsPerScreen, Math.round((2 * 40 + 18 * 120) / 10));
  assert.equal(k.imageShare, 23);
});

test('気づき：ボタンのない区間・文字が続く区間・余白が続く区間', () => {
  const bins = Array.from({ length: 20 }, (_, i) => ({ chars: i >= 6 && i < 12 ? 700 : i >= 14 && i < 19 ? 5 : 120, image: i >= 6 && i < 12 ? 0.02 : i >= 14 && i < 19 ? 0.05 : 0.3 }));
  const list = R.insights(lp({ bins, ctas: [{ y: 500, label: 'A' }, { y: 7900, label: 'B' }] }));
  const ids = list.map((x) => x.id);
  assert.ok(ids.includes('gap'), ids.join(','));
  const gap = list.find((x) => x.id === 'gap');
  assert.match(gap.title, /0\.6〜9\.9画面目の9\.3画面、申し込みボタンがありません/);
  const wall = list.find((x) => x.id.startsWith('wall'));
  assert.deepEqual(wall.zone, { from: 3, to: 6 });
  const sparse = list.find((x) => x.id.startsWith('sparse'));
  assert.deepEqual(sparse.zone, { from: 7, to: 9.5 });
  assert.ok(ids.includes('fixed'), '長いLPに追従ボタンがない');
});

test('気づき：ファーストビュー・良い点', () => {
  const bad = R.insights(lp({ firstView: { heading: false, cta: false, image: false, chars: 300 } }));
  assert.ok(bad.some((x) => x.id === 'fv-cta'));
  assert.ok(bad.some((x) => x.id === 'fv-heading'));
  const good = R.insights(lp({ ctas: [{ y: 500 }, { y: 2600 }, { y: 4800 }, { y: 7000 }].map((c) => ({ ...c, label: 'x' })), fixedCtas: ['無料で試す'] }));
  assert.ok(good.some((x) => x.id === 'fixed-ok'));
  assert.ok(good.some((x) => x.id === 'cta-ok'));
  assert.ok(!good.some((x) => x.severity === 'warn'), good.map((x) => x.id).join(','));
});

test('比較表と区間の表記', () => {
  const t = R.compareRows([{ name: 'このLP', m: lp() }, { name: '競合', m: lp({ docH: 4000, ctas: [{ y: 300, label: 'x' }], fixedCtas: ['追従'] }) }]);
  assert.deepEqual(t.header, ['', 'このLP', '競合']);
  assert.deepEqual(t.rows[0], ['長さ', '10画面', '5画面']);
  assert.deepEqual(t.rows[2], ['最初のボタン', '0.6画面目', '0.4画面目']);
  assert.deepEqual(t.rows[7], ['追従ボタン', 'なし', 'あり']);
  assert.equal(R.binLabel(3), '1.5〜2画面目');
});
