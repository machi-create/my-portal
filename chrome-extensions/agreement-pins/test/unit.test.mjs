// node --test chrome-extensions/agreement-pins/test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../extension/lib/pins.js');

const entry = (id, status, what, who, date, createdAt) => ({ id, status, what, who, date, note: '', createdAt });
const pinA = {
  id: 'pin_a',
  origin: 'https://stg.example.jp',
  path: '/about/',
  url: 'https://stg.example.jp/about/',
  pageTitle: '会社概要',
  target: '見出し「私たちは、地域の未来を…」',
  anchor: { selector: 'h1', tag: 'h1', text: '私たちは' },
  entries: [entry('e1', 'pending', 'キャッチコピーは2案で検討', '先方 田中様', '2026-10-01', 1), entry('e2', 'agreed', 'A案「地域の未来をつくる」で確定', '先方 田中様', '2026-10-14', 2)],
  createdAt: 1,
  updatedAt: 2,
};
const pinB = { ...pinA, id: 'pin_b', origin: 'https://www.example.jp', target: 'ボタン「無料で相談する」', entries: [entry('e3', 'question', 'ボタン色 | 要確認', '', '2026-10-15', 3)], createdAt: 3, updatedAt: 3 };

test('パスの正規化とキー', () => {
  assert.equal(D.pathOf('https://stg.example.jp/about/index.html?x=1#top'), '/about/');
  assert.equal(D.keyFor('https://www.example.jp/about/'), 'pins:/about/');
  assert.equal(D.originOf('https://www.example.jp/about/'), 'https://www.example.jp');
});

test('別ドメインのピンは設定で表示・非表示を切り替える', () => {
  const url = 'https://www.example.jp/about/';
  assert.equal(D.filterForUrl([pinA, pinB], url, { shareAcrossHosts: true }).length, 2);
  assert.deepEqual(D.filterForUrl([pinA, pinB], url, { shareAcrossHosts: false }).map((p) => p.id), ['pin_b']);
});

test('最新の状態は最後の履歴', () => {
  assert.equal(D.statusOf(pinA), 'agreed');
  assert.equal(D.latest(pinA).what, 'A案「地域の未来をつくる」で確定');
});

test('読み込み時の統合：新しいピンは追加、同じピンは履歴の和集合', () => {
  const incomingA = { ...pinA, entries: [...pinA.entries, entry('e9', 'rejected', 'やはり再検討', '先方 佐藤様', '2026-10-20', 9)], updatedAt: 9 };
  const pinC = { ...pinB, id: 'pin_c', createdAt: 5 };
  const res = D.merge([pinA, pinB], [incomingA, pinC, { broken: true }]);
  assert.equal(res.added, 1);
  assert.equal(res.updated, 1);
  assert.equal(res.pins.length, 3);
  const a = res.pins.find((p) => p.id === 'pin_a');
  assert.deepEqual(a.entries.map((e) => e.id), ['e1', 'e2', 'e9']);
  assert.equal(D.statusOf(a), 'rejected');
  // 同じ内容をもう一度読み込んでも増えない
  const again = D.merge(res.pins, [incomingA]);
  assert.equal(again.added + again.updated, 0);
});

test('Markdown と CSV の書き出し', () => {
  const md = D.toMarkdown([pinA, pinB], { today: new Date(2026, 9, 15) });
  assert.match(md, /^# 合意事項一覧（2026\/10\/15 時点）/);
  assert.match(md, /## \/about\/（会社概要）/);
  assert.match(md, /\| 1 \| 合意 \| 見出し「私たちは、地域の未来を…」 \| A案「地域の未来をつくる」で確定 \| 先方 田中様 \| 2026\/10\/14 \|/);
  assert.match(md, /\| 2 \| 要確認 .* ボタン色 ｜ 要確認/, '表の区切り文字はエスケープ');
  assert.match(md, /No\.1 の経緯：10\/01 保留（先方 田中様） → 10\/14 合意（先方 田中様）/);
  const rows = D.toRows([pinA, pinB]);
  assert.deepEqual(rows[0], ['ページ', 'No.', '状態', '対象', '内容', '確認者', '日付', 'メモ', '履歴の数', 'URL']);
  assert.equal(rows[1][2], '合意');
  assert.equal(rows[1][8], 2);
});
