// node --test chrome-extensions/feedback-translator/test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../extension/lib/color.js');
const R = require('../extension/lib/rules.js');

const button = {
  role: 'button',
  tag: 'a',
  selector: '.hero > a.cta',
  text: '無料で相談する',
  rect: { width: 130, height: 37 },
  styles: {
    fontSize: 14, fontWeight: 400, lineHeight: null, letterSpacing: 0, fontFamily: 'system-ui',
    color: 'rgb(255, 255, 255)', background: 'rgb(74, 159, 110)', textAlign: 'left', textDecorationLine: 'none',
    paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
    borderRadius: 0, boxShadow: 'none', textShadow: 'none', display: 'inline-block',
  },
  viewport: { width: 1280 },
};

const lead = {
  role: 'text',
  tag: 'p',
  selector: '.lead',
  text: '期間中にご成約いただいた方に…',
  rect: { width: 1200, height: 18 },
  styles: { ...button.styles, fontSize: 13, lineHeight: 18.2, color: 'rgb(154, 154, 154)', background: 'rgb(246, 243, 238)', paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, marginBottom: 24 },
};

test('color: コントラスト比の計算と調整', () => {
  assert.equal(Math.round(C.contrast(C.parse('#000'), C.parse('#fff'))), 21);
  const gray = C.parse('rgb(154,154,154)');
  const bg = C.parse('#fff');
  assert.ok(C.contrast(gray, bg) < 4.5);
  const fixed = C.ensureContrast(gray, bg, 7);
  assert.ok(C.contrast(fixed, bg) >= 7);
  const soft = C.softenContrast(C.parse('#000'), bg, 4.5);
  assert.ok(Math.abs(C.contrast(soft, bg) - 4.5) < 0.2);
  assert.equal(C.toHex(C.parse('rgba(255, 0, 0, 0.5)')), '#ff0000');
});

test('「もっとパッと目立つ感じに」→ ボタンを大きく・太く・影・余白', () => {
  const r = R.analyze('もっとパッと目立つ感じにしてほしい', button);
  assert.deepEqual(r.intents.map((i) => i.id), ['emphasize']);
  const by = (css) => r.proposals.find((p) => p.css === css);
  assert.equal(by('font-size').to, '18px');
  assert.equal(by('font-weight').to, '700');
  assert.equal(by('padding').to, '14px 28px');
  assert.ok(by('box-shadow'));
  assert.equal(by('margin-top').to, '24px');
  assert.equal(by('color'), undefined, '白文字はこれ以上白くできない');
  const own = R.analyze('もっと目立たせたい', { ...button, styles: { ...button.styles, ownBackground: true } });
  const bg = own.proposals.find((x) => x.css === 'background-color');
  assert.ok(bg, '要素に背景色があれば背景を濃くする');
  assert.ok(C.contrast(C.parse('#ffffff'), C.parse(bg.to)) >= 7);
});

test('「小さくて読みにくい」→ 16px以上・行間・コントラスト・行長', () => {
  const r = R.analyze('文字が小さくて読みにくい', lead);
  const ids = r.intents.map((i) => i.id);
  assert.ok(ids.includes('bigger') && ids.includes('readability'));
  const by = (css) => r.proposals.find((p) => p.css === css);
  assert.equal(by('font-size').to, '16px', 'bigger より readability の基準が優先されない場合でも16px');
  assert.equal(by('line-height').to, '1.8');
  assert.ok(by('color'));
  assert.equal(by('max-width').to, '40em');
});

test('方向が逆の言葉を取り違えない', () => {
  assert.deepEqual(R.analyze('ちょっと大きすぎる', button).intents.map((i) => i.id), ['smaller']);
  assert.deepEqual(R.analyze('目立ちすぎなので控えめに', button).intents.map((i) => i.id), ['subdue']);
  assert.deepEqual(R.analyze('行間を詰めて', lead).proposals.map((p) => p.to), ['1.5']);
  assert.equal(R.analyze('真ん中に揃えて', lead).proposals[0].to, 'center');
});

test('読み取れない要望は空、同じプロパティは重複しない', () => {
  assert.equal(R.analyze('いい感じにお願いします', button).intents.length, 0);
  const r = R.analyze('太く、そして目立たせて', button);
  assert.equal(r.proposals.filter((p) => p.css === 'font-weight').length, 1);
});

test('開発者向け・クライアント向けの文面', () => {
  const r = R.analyze('もっと目立たせたい', button);
  const ctx = { info: button, feedback: 'もっと目立たせたい', ...r, url: 'https://stg.example.jp/', title: 'LP' };
  const dev = R.devReport(ctx);
  assert.match(dev, /\.hero > a\.cta \{/);
  assert.match(dev, /font-size: 18px;/);
  assert.match(dev, /\| 文字サイズ（font-size） \| 14px \| 18px \|/);
  const client = R.clientReport({ ...ctx, signature: 'ディレクター 山田' });
  assert.match(client, /ボタン「無料で相談する」を次のように調整/);
  assert.match(client, /文字を一回り大きくして.*（14px → 18px）/);
  assert.doesNotMatch(client, /font-size/);
  assert.match(client, /ディレクター 山田$/);
});

test('専門用語をやさしい言葉に置き換える', () => {
  const r = R.easyJapanese('CLSを改善するため、画像にwidth/heightを指定し、ファーストビューのCTAを大きくします。CTAの色も変えます。');
  assert.match(r.text, /表示中にレイアウトがずれる度合い（CLS）/);
  assert.match(r.text, /問い合わせや申し込みへ誘導するボタン（CTA）を大きく/);
  assert.match(r.text, /。問い合わせや申し込みへ誘導するボタンの色/, '2回目は言い換えだけ');
  assert.deepEqual(r.terms.map((t) => t.term).sort(), ['CLS', 'CTA', 'ファーストビュー'].sort());
  assert.equal(R.easyJapanese('CVRとCVを比較').terms.length, 2);
});
