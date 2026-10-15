// ライブラリ単体のテスト：node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const N = require('../extension/lib/normalize.js');
const D = require('../extension/lib/diff.js');
const M = require('../extension/lib/manuscript.js');
const S = require('../extension/lib/settings.js');

test('loose: 全角半角・大文字小文字・空白・ダッシュを同一視する', () => {
  assert.equal(N.loose('ＷＥＢ制作　２０２６年').text, 'web制作2026年');
  assert.equal(N.loose('お問い合わせ\n  はこちら').text, 'お問い合わせはこちら');
  assert.equal(N.loose('メール—フォーム').text, N.loose('メール-フォーム').text);
  assert.equal(N.loose('10:00〜18:00').text, N.loose('10:00～18:00').text);
});

test('loose: 半角カナの濁点を合成し、元文字列の位置を保持する', () => {
  const r = N.loose('ｶﾞｲﾄﾞ');
  assert.equal(r.text, 'ガイド');
  assert.deepEqual([...r.map], [0, 2, 3]);
  const r2 = N.loose('a 𠮷b');
  assert.equal(r2.text, 'a𠮷b');
  assert.deepEqual([...r2.map], [0, 2, 2, 4]);
});

test('canon / key: HTML由来の改行は取り除き、書かれたスペースは残す', () => {
  assert.equal(N.canon('  私たちは\n      地域の未来を\n  つくる。 '), '私たちは地域の未来をつくる。');
  assert.equal(N.canon('Web  Design\n制作'), 'Web Design制作');
  assert.equal(N.canon('Hello\n   World'), 'Hello World');
  assert.equal(N.canon('代表取締役　港 太郎'), '代表取締役　港 太郎');
  assert.equal(N.canon('全角　スペース'), '全角　スペース');
  assert.equal(N.key('港 太郎'), N.key('港太郎'));
  assert.notEqual(N.key('港　太郎'), N.key('港太郎'));
});

test('diffChars: 文字単位の差分', () => {
  assert.deepEqual(D.diffChars('地域の未来をデザインする会社', '地域の未来をつくる会社'), [
    [0, '地域の未来を'],
    [-1, 'デザインす'],
    [1, 'つく'],
    [0, 'る会社'],
  ]);
  assert.deepEqual(D.diffChars('同じ', '同じ'), [[0, '同じ']]);
  assert.deepEqual(D.diffChars('', 'abc'), [[1, 'abc']]);
});

test('manuscript.parse: テキストの行を分割し、ラベルや記号を外す', () => {
  const text = '【見出し】会社概要\n\n■私たちについて\n// 指示：ここは太字\n## 事業内容\n※価格は税込です';
  const r = M.parse(text);
  assert.equal(r.format, 'text');
  assert.deepEqual(
    r.segments.map((s) => s.text),
    ['会社概要', '私たちについて', '事業内容', '※価格は税込です']
  );
  assert.equal(r.segments[0].line, 1);
  assert.equal(r.segments[2].line, 5);
});

test('manuscript.parse: Excelからのコピペ（TSV・セル内改行）と列指定', () => {
  const tsv = '箇所\t原稿\t備考\nMV\t"一行目\n二行目"\t大きく\nボタン\tお問い合わせ\t';
  const all = M.parse(tsv);
  assert.equal(all.format, 'tsv');
  assert.ok(all.segments.some((s) => s.text === '一行目'));
  const onlyB = M.parse(tsv, { columns: 'B', skipHeader: true });
  assert.deepEqual(
    onlyB.segments.map((s) => [s.text, s.line, s.col]),
    [
      ['一行目', 2, 1],
      ['二行目', 2, 1],
      ['お問い合わせ', 3, 1],
    ]
  );
});

test('manuscript: 列指定・CSV変換・URL変換', () => {
  assert.deepEqual(M.parseColumns('C'), [2]);
  assert.deepEqual(M.parseColumns('2, D'), [1, 3]);
  assert.deepEqual(M.parseColumns('B-D'), [1, 2, 3]);
  assert.equal(M.parseColumns(''), null);
  assert.equal(M.columnName(0), 'A');
  assert.equal(M.columnName(27), 'AB');
  assert.equal(M.csvToTsv('a,"b,c","d\ne"\n1,2,3'), 'a\tb,c\t"d\ne"\n1\t2\t3');
  assert.equal(
    M.toFetchUrl('https://docs.google.com/spreadsheets/d/abc_123/edit#gid=456').url,
    'https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=456'
  );
  assert.equal(
    M.toFetchUrl('https://docs.google.com/document/d/xyz/edit').url,
    'https://docs.google.com/document/d/xyz/export?format=txt'
  );
});

test('manuscript.decodeBytes: Shift_JIS のCSVも読める', () => {
  // 「会社」を Shift_JIS で表したバイト列
  const sjis = new Uint8Array([0x89, 0xef, 0x8e, 0xd0]);
  assert.equal(M.decodeBytes(sjis.buffer), '会社');
  assert.equal(M.decodeBytes(new TextEncoder().encode('会社').buffer), '会社');
});

test('settings: ドメインの登録とテスト環境らしさの判定', () => {
  const settings = { ...S.DEFAULTS, productionHosts: ['example-corp.co.jp', '*.brand.jp'], stagingHosts: ['preview.client.com'] };
  assert.deepEqual(S.detectEnv('https://www.example-corp.co.jp/about/', settings), { env: 'production', source: 'settings' });
  assert.deepEqual(S.detectEnv('https://shop.brand.jp/', settings), { env: 'production', source: 'settings' });
  assert.deepEqual(S.detectEnv('https://preview.client.com/', settings), { env: 'staging', source: 'settings' });
  assert.deepEqual(S.detectEnv('https://stg.example-corp.co.jp/', settings), { env: 'staging', source: 'guess' });
  assert.deepEqual(S.detectEnv('http://localhost:3000/', settings), { env: 'staging', source: 'guess' });
  assert.deepEqual(S.detectEnv('https://other.com/', settings), { env: 'unknown', source: 'none' });

  assert.equal(S.stagingLevel('stg.example.co.jp'), 2);
  assert.equal(S.stagingLevel('dev-api.example.com'), 2);
  assert.equal(S.stagingLevel('192.168.0.10'), 2);
  assert.equal(S.stagingLevel('client.xsrv.jp'), 1);
  assert.equal(S.stagingLevel('test.co.jp'), 0, '登録ドメイン名そのものは判定しない');
  assert.equal(S.stagingLevel('dev.to'), 0);
  assert.equal(S.stagingLevel('developers.google.com'), 0);
  assert.equal(S.isExampleHost('www.example.com'), true);
  assert.equal(S.isExampleHost('example-corp.co.jp'), false);
  assert.deepEqual(S.parseHostList('https://www.Example.jp/path\n# メモ\n*.foo.com, bar.com'), ['www.example.jp', '*.foo.com', 'bar.com']);
});
