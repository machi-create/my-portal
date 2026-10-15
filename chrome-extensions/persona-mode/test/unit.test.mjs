// node --test chrome-extensions/persona-mode/test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PS = require('../extension/lib/personas.js');

const raw = {
  viewport: { w: 390, h: 844 },
  texts: [
    { refId: 't1', text: '見出し', size: 26, weight: 700, contrast: 12 },
    { refId: 't2', text: '※ 効果には個人差があります。', size: 12, weight: 400, contrast: 2.3 },
    { refId: 't3', text: '本文のテキストです', size: 15, weight: 400, contrast: 6.2 },
  ],
  targets: [
    { refId: 'b1', label: 'お問い合わせ', w: 110, h: 40, inline: false },
    { refId: 'b2', label: '<button>', w: 20, h: 20, inline: false },
    { refId: 'l1', label: '導入事例', w: 60, h: 18, inline: true },
  ],
  colorLinks: [{ refId: 'l1', text: '導入事例', ratio: 1 }],
  vague: [{ refId: 'l2', text: '詳しくはこちら' }],
  unnamed: [{ refId: 'b2', text: '<button class="close">' }],
  fixed: { top: 140, bottom: 80, overlays: [] },
  ctas: [{ refId: 'b1', label: 'お問い合わせ', x: 260, y: 20, w: 110, h: 40, fixed: true }],
  firstView: { h1: 'DXソリューションで…' },
  weight: { bytes: 3.2 * 1024 * 1024, requests: 40, unknown: 3, largest: [{ name: 'img/hero.jpg', bytes: 900 * 1024 }, { name: 'app.js', bytes: 120 * 1024 }], blocking: 4, fonts: 2, autoplay: false, load: 2100, lcp: 1800 },
  text: 'DXソリューションで、エンゲージメントを最大化\n当社のプラットフォームは、KPIとROIを可視化し、ステークホルダーとのシナジーを生み出すことで、お客様のビジネスにおけるデジタルトランスフォーメーションをワンストップで実現し、持続的な成長を支援します。\nCMSやSFAとの連携も可能です。FAQもご覧ください。',
};

test('文章から、伝わりにくい言葉・略語・長い文を数える', () => {
  const t = PS.analyzeText(raw.text);
  const terms = t.jargon.map((x) => x.term);
  for (const w of ['ソリューション', 'エンゲージメント', 'プラットフォーム', 'KPI', 'ROI', 'DX', 'SFA', 'デジタルトランスフォーメーション']) assert.ok(terms.includes(w), w);
  assert.deepEqual(t.acronyms.map((x) => x.term), ['CMS'], 'FAQ などのよく知られた略語・用語集にある略語は除く');
  assert.ok(t.sentences.some((s) => s.length > 80));
});

test('シニア：小さな文字・薄い文字・小さなボタン・カタカナ語・長い文・曖昧なリンク', () => {
  const f = PS.findings('senior', raw);
  const by = (id) => f.find((x) => x.id === id);
  assert.equal(by('font').severity, 'warn', '12px は注意（12px未満は要改善）');
  assert.match(by('font').title, /16px未満の文字が2か所あります（最小12px）/);
  assert.equal(by('contrast').severity, 'error');
  assert.match(by('contrast').title, /2か所/, '6.2 は一般の基準は満たすが、シニアには薄い');
  assert.equal(by('target').severity, 'error');
  assert.match(by('target').title, /2か所/, '文中のリンクは除く');
  assert.equal(by('jargon').severity, 'warn');
  assert.equal(by('vague').severity, 'warn');
  assert.equal(f[0].severity, 'error', '重いものから並ぶ');
  const lines = PS.narrate('senior', f);
  assert.ok(lines.length >= 3 && lines.length <= 5);
  assert.match(lines.join('\n'), /老眼鏡/);
});

test('色覚：色だけで区別しているリンク', () => {
  const f = PS.findings('cvd-d', raw);
  assert.equal(f.find((x) => x.id === 'colorlink').severity, 'error');
  assert.match(PS.narrate('cvd-d', f).join('\n'), /リンクなのか、見分けがつかない/);
});

test('片手：固定バーの面積・親指の届く位置', () => {
  const f = PS.findings('onehand', raw);
  const fixed = f.find((x) => x.id === 'fixed');
  assert.match(fixed.title, /画面の26%を占めています/);
  assert.equal(f.find((x) => x.id === 'reach').severity, 'warn', '上部に固定されたヘッダーのボタンは届きにくい');
  const bottom = { ...raw, ctas: [{ ...raw.ctas[0], y: 780 }] };
  assert.equal(PS.findings('onehand', bottom).find((x) => x.id === 'reach').severity, 'good', '画面下に固定されたボタンは届く');
  assert.ok(!PS.findings('onehand', { ...raw, ctas: [] }).some((x) => x.id === 'reach'));
  assert.ok(PS.findings('onehand', { ...raw, ctas: [] }).some((x) => x.id === 'firstcta'));
});

test('弱視・低速回線・初めての人', () => {
  assert.equal(PS.findings('lowvision', raw).find((x) => x.id === 'unnamed').severity, 'error');
  const slow = PS.findings('slow', raw);
  const w = slow.find((x) => x.id === 'weight');
  // 3.2MB を 1.6Mbps で読むと約17秒＋表示を止める読み込み
  assert.match(w.title, /約19秒/);
  assert.equal(w.severity, 'error');
  assert.ok(slow.some((x) => x.id === 'heavy'));
  assert.ok(slow.some((x) => x.id === 'blocking'));
  const b = PS.findings('beginner', raw);
  assert.ok(b.some((x) => x.id === 'acronym'));
  assert.equal(b.find((x) => x.id === 'firstview').severity, 'good');
  assert.match(PS.narrate('beginner', b).join('\n'), /って何のこと？/);
});

test('問題がなければ、そう言う', () => {
  const clean = { ...raw, texts: [raw.texts[0]], targets: [{ ...raw.targets[0], h: 48 }], colorLinks: [], vague: [], unnamed: [], text: 'わかりやすい文章です。' };
  const f = PS.findings('senior', clean);
  assert.ok(f.every((x) => x.severity === 'good'), f.map((x) => `${x.id}:${x.severity}`).join(','));
  assert.deepEqual(PS.narrate('senior', f), ['特につまずくところはなかった！スムーズに使えたよ。']);
});
