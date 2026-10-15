// node --test chrome-extensions/estimate-scanner/test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../extension/lib/detect.js');
const E = require('../extension/lib/estimate.js');

test('HTML から技術と機能を見つける', () => {
  const html = `<html lang="ja"><head><meta name="generator" content="WordPress 6.6.2">
    <link rel="alternate" hreflang="en" href="/en/"><link rel="alternate" hreflang="ja" href="/">
    <script src="/wp-content/themes/x/js/jquery-3.7.1.min.js"></script><script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"></script></head>
    <body><div data-aos="fade-up"></div><iframe src="https://www.google.com/maps/embed?pb=1"></iframe>
    <form role="search"><input type="search" name="s"></form>
    <form action="/contact/"><input name="name"><input name="email" type="email"><textarea name="msg"></textarea><input type="file" name="f"><input type="hidden" name="t"><button>送信</button></form>
    <a href="/mypage/">マイページ</a></body></html>`;
  const r = D.fromHtml(html);
  assert.deepEqual(r.tech, ['WordPress', 'jQuery']);
  assert.equal(r.features.slider, true);
  assert.equal(r.features.scrollAnim, true);
  assert.equal(r.features.map, true);
  assert.equal(r.features.search, true);
  assert.equal(r.features.login, true);
  assert.equal(r.features.cart, false);
  assert.deepEqual(r.features.forms, [{ fields: 4, upload: true }], '検索フォームは数えない');
  assert.deepEqual(r.features.langs.sort(), ['en', 'ja']);
  assert.ok(D.fromHtml('<meta name="generator" content="STUDIO">').tech.includes('STUDIO'));
});

test('複数ページの結果をまとめる（同じフォームは1つ）', () => {
  const a = { url: '/', ...D.fromHtml('<form><input name="a"><input name="b"></form><div class="swiper"></div>') };
  const b = { url: '/contact/', ...D.fromHtml('<form><input name="a"><input name="b"></form><form><input><input><input><textarea></textarea></form><div data-aos></div>') };
  const m = D.merge([a, b]);
  assert.equal(m.features.forms.length, 2);
  assert.deepEqual(m.features.animations, ['slider', 'scrollAnim']);
});

test('sitemap と robots.txt の読み取り', () => {
  const index = '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://ex.jp/post-sitemap.xml</loc></sitemap><sitemap><loc>https://ex.jp/page-sitemap.xml</loc></sitemap></sitemapindex>';
  assert.deepEqual(D.parseSitemap(index), { urls: [], sitemaps: ['https://ex.jp/post-sitemap.xml', 'https://ex.jp/page-sitemap.xml'] });
  const set = '<urlset><url><loc>https://ex.jp/?a=1&amp;b=2</loc></url><url><loc><![CDATA[https://ex.jp/about/]]></loc></url></urlset>';
  assert.deepEqual(D.parseSitemap(set).urls, ['https://ex.jp/?a=1&b=2', 'https://ex.jp/about/']);
  assert.deepEqual(D.sitemapsFromRobots('User-agent: *\nDisallow: /wp-admin/\nSitemap: https://ex.jp/sitemap_index.xml\n'), ['https://ex.jp/sitemap_index.xml']);
});

const urls = [
  'https://ex.jp/', 'https://ex.jp/about/', 'https://ex.jp/about/message/', 'https://ex.jp/about/history/', 'https://ex.jp/about/access/', 'https://ex.jp/about/philosophy/',
  'https://ex.jp/service/', 'https://ex.jp/service/web/', 'https://ex.jp/service/branding/',
  'https://ex.jp/contact/', 'https://ex.jp/privacy/', 'https://ex.jp/doc/guide.pdf',
  ...Array.from({ length: 24 }, (_, i) => `https://ex.jp/news/${1000 + i}/`),
  'https://ex.jp/news/', 'https://ex.jp/news/page/2/', 'https://ex.jp/news/page/3/',
  ...Array.from({ length: 6 }, (_, i) => `https://ex.jp/works/case-${i + 1}/`), 'https://ex.jp/works/',
];

test('URL を「一覧＋詳細」と固定ページに分け、テンプレート数を推定する', () => {
  const g = E.groupUrls(urls);
  assert.equal(g.files, 1, 'PDFは数えない');
  assert.equal(g.top, 1);
  assert.deepEqual(g.collections.map((c) => [c.path, c.count, c.label]), [['/news/', 25, 'お知らせ'], ['/works/', 7, '実績・事例']]);
  assert.deepEqual(g.pages.map((p) => [p.path, p.count]), [['/about/', 5], ['/service/', 3], ['/contact/', 1], ['/privacy/', 1]]);
  assert.equal(g.total, 1 + 5 + 3 + 1 + 1 + 25 + 7, 'ページ送りは除く');
  const t = E.templates(g);
  assert.deepEqual({ ...t }, { top: 1, collections: 2, staticTemplates: 5, lower: 9, total: 10, staticPages: 10, extraPages: 5 });
});

test('見積もり：数量×単価・ディレクション・幅・上書き', () => {
  const g = E.groupUrls(urls);
  const a = {
    url: 'https://ex.jp/', origin: 'https://ex.jp', title: 'EX',
    pages: { total: g.total, source: 'sitemap', groups: g, templates: E.templates(g) },
    tech: ['WordPress', 'jQuery'],
    features: { forms: [{ fields: 5, upload: false }], animations: ['slider'], map: true, video: false, search: false, langs: ['ja', 'en'], login: true, cart: false },
  };
  const est = E.build(a, {}, {});
  const line = (id) => est.lines.find((l) => l.id === id);
  assert.equal(line('designTemplate').qty, 9);
  assert.equal(line('designTemplate').amount, 9 * 60000);
  assert.equal(line('cmsBase').qty, 1);
  assert.match(line('cmsBase').basis, /WordPress/);
  assert.equal(line('cmsCollection').amount, 2 * 80000);
  assert.equal(line('form').amount, 50000);
  assert.equal(line('lang').qty, 1);
  const designCoding = 150000 + 9 * 60000 + 100000 + 9 * 40000 + 5 * 10000;
  assert.equal(line('lang').amount, Math.round(designCoding * 0.3));
  assert.ok(line('member').quote);
  assert.equal(est.direction, Math.round(est.subtotal * 0.15));
  assert.equal(est.total, est.subtotal + est.direction);
  assert.equal(est.low % 10000, 0);
  assert.ok(est.low < est.total && est.total < est.high);
  // 数量の上書き・行の除外
  const est2 = E.build(a, { designTemplate: 50000 }, { designTemplate: { qty: 6 }, lang: { enabled: false } });
  assert.equal(est2.lines.find((l) => l.id === 'designTemplate').amount, 300000);
  assert.equal(est2.lines.find((l) => l.id === 'lang').amount, 0);
  // 書き出し
  const tsv = E.toTsv(est);
  assert.match(tsv.split('\n')[0], /^項目\t数量\t単位\t単価\t金額\t根拠$/);
  assert.match(tsv, /デザイン（下層テンプレート）\t9\t種\t60000\t540000\t一覧・詳細 2種×2＋固定ページ 5種/);
  assert.match(tsv, /会員機能・ログイン\t\t式\t要見積もり/);
  const md = E.toMarkdown(est, a);
  assert.match(md, /ページ数：約43ページ（sitemap\.xml より）/);
  assert.match(md, /\| \*\*合計\*\* \| \| \| \*\*[\d,]+円\*\* \|/);
  assert.match(md, /会員機能・ログイン は別途お見積もりが必要です/);
});
