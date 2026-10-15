// node --test chrome-extensions/reference-collage/test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const classify = require('../extension/lib/classify.js');
const W = require('../extension/lib/wire.js');

const base = (over) => ({
  tag: 'section', role: '', top: 1200, height: 520, docHeight: 5000, viewportH: 900, text: '', hasH1: false,
  ...over,
  stats: { headings: 1, texts: 2, images: 0, buttons: 0, inputs: 0, icons: 0, links: 0, details: 0, bigNumbers: 0, smallImages: 0, columns: 0, repeated: 0, ...(over && over.stats) },
});

test('セクションの種類を推定する', () => {
  assert.equal(classify(base({ tag: 'header', top: 0, height: 72 })), 'header');
  assert.equal(classify(base({ tag: 'div', top: 4880, height: 120, stats: { links: 6 } })), 'footer');
  assert.equal(classify(base({ top: 72, height: 520, hasH1: true, stats: { buttons: 2, images: 1 } })), 'hero');
  assert.equal(classify(base({ text: 'ライト 980円/月 スタンダード 1,980円/月 プロ 3,980円/月' })), 'pricing');
  assert.equal(classify(base({ text: 'よくある質問 無料期間はありますか？' })), 'faq');
  assert.equal(classify(base({ stats: { details: 3 } })), 'faq');
  assert.equal(classify(base({ stats: { inputs: 4, buttons: 1 } })), 'form');
  assert.equal(classify(base({ text: '2026.10.01 お知らせ 2026.09.12 リリース' })), 'news');
  assert.equal(classify(base({ text: 'お客様の声 導入して良かった' })), 'testimonials');
  assert.equal(classify(base({ text: 'ご利用の流れ STEP1 STEP2 STEP3', stats: { repeated: 3 } })), 'steps');
  assert.equal(classify(base({ stats: { bigNumbers: 3 } })), 'stats');
  assert.equal(classify(base({ stats: { smallImages: 8, images: 8, texts: 0, headings: 1 } })), 'logos');
  assert.equal(classify(base({ stats: { repeated: 3, columns: 3, texts: 3, headings: 4 } })), 'features');
  assert.equal(classify(base({ height: 300, stats: { headings: 1, buttons: 1, texts: 0 } })), 'cta');
  assert.equal(classify(base({ height: 900, stats: { headings: 1, texts: 6 } })), 'content');
});

const hero = {
  id: 's1', kind: 'hero', memo: 'コピーは短く\n画像は人物写真に', source: { url: 'https://ref.example.com/', title: '参考 <LP>', host: 'ref.example.com' },
  size: { w: 1200, h: 600 },
  nodes: [
    { type: 'image', x: 0, y: 0, w: 1200, h: 600, bg: true },
    { type: 'heading', x: 80, y: 120, w: 520, h: 48, level: 1, text: '経理の時間を、半分に。' },
    { type: 'text', x: 80, y: 190, w: 520, h: 54, lines: 2 },
    { type: 'button', x: 80, y: 280, w: 160, h: 48, text: '無料で試す' },
    { type: 'icon', x: 700, y: 120, w: 32, h: 32 },
    { type: 'input', x: 80, y: 360, w: 300, h: 40 },
  ],
  stats: { headings: 1, texts: 1, images: 1, buttons: 1, inputs: 1, icons: 1, columns: 0 },
};

test('ワイヤーの SVG：幅に合わせて縮小し、要素を描き分ける', () => {
  const svg = W.toSvg(hero, { width: 600 });
  assert.match(svg, /^<svg [^>]*width="600" height="300"/);
  assert.equal((svg.match(/<rect /g) || []).length, 1 + 1 + 1 + 2 + 1 + 1, '枠・画像・見出し・文章2行・ボタン・入力欄');
  assert.match(svg, /<circle /);
  assert.match(svg, />見出し H1</);
  assert.match(svg, />ボタン</);
  assert.doesNotMatch(svg, /経理の時間/, '既定では参考サイトの文言を出さない');
  assert.match(W.toSvg(hero, { width: 600, text: true }), />経理の時間を、半分に。</);
});

test('ボード全体の SVG と構成案の Markdown', () => {
  const faq = { ...hero, id: 's2', kind: 'faq', memo: '', nodes: [{ type: 'heading', x: 0, y: 0, w: 300, h: 40, level: 2 }], stats: { headings: 1, texts: 3 } };
  const svg = W.boardSvg([hero, faq], { title: '新サイト <案>' });
  assert.match(svg, /新サイト &lt;案&gt;/, '文字はエスケープ');
  assert.match(svg, /01 {2}ファーストビュー/);
  assert.match(svg, /02 {2}よくある質問/);
  assert.match(svg, /参考：ref\.example\.com/);
  assert.match(svg, />コピーは短く</);
  const md = W.toMarkdown([hero, faq], { title: '新サイト' });
  assert.match(md, /^# 新サイト/);
  assert.match(md, /1\. \*\*ファーストビュー\*\*\n {3}- 要素：見出し1・文章1・画像1・アイコン1・ボタン1・入力欄1/);
  assert.match(md, /- 参考：参考 <LP> https:\/\/ref\.example\.com\//);
  assert.match(md, /- メモ：画像は人物写真に/);
  assert.match(md, /2\. \*\*よくある質問\*\*/);
});
