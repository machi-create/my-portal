// node chrome-extensions/estimate-scanner/test/e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, runner } from '../../_test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, 'fixtures');
const html = (name) => fs.readFileSync(path.join(FIX, name));

// WordPress 風のサイト。localhost で来たときは sitemap が無いサイトとして振る舞う
const env = await launch({
  ext: path.resolve(here, '../extension'),
  route(req, res, url) {
    const origin = `http://${req.headers.host}`;
    const noSitemap = /^localhost/.test(req.headers.host);
    const send = (type, body, status = 200) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
      return true;
    };
    const p = url.pathname;
    if (p === '/robots.txt') return noSitemap ? send('text/plain', 'not found', 404) : send('text/plain', `User-agent: *\nDisallow: /wp-admin/\nSitemap: ${origin}/sitemap_index.xml\n`);
    if (/sitemap/.test(p) && noSitemap) return send('text/plain', 'not found', 404);
    if (p === '/sitemap_index.xml') return send('application/xml', `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/page-sitemap.xml</loc></sitemap><sitemap><loc>${origin}/post-sitemap.xml</loc></sitemap></sitemapindex>`);
    if (p === '/page-sitemap.xml') {
      const pages = ['/', '/about/', '/about/message/', '/about/history/', '/about/access/', '/about/philosophy/', '/service/', '/service/web/', '/contact/', '/privacy/'];
      return send('application/xml', `<urlset>${pages.map((x) => `<url><loc>${origin}${x}</loc></url>`).join('')}</urlset>`);
    }
    if (p === '/post-sitemap.xml') {
      const posts = ['/news/', ...Array.from({ length: 30 }, (_, i) => `/news/${1001 + i}/`)];
      return send('application/xml', `<urlset>${posts.map((x) => `<url><loc>${origin}${x}</loc></url>`).join('')}</urlset>`);
    }
    if (p === '/') return send('text/html; charset=utf-8', html('top.html'));
    if (p === '/contact/') return send('text/html; charset=utf-8', html('contact.html'));
    if (/^\/(?:about|service|news|privacy|en)\//.test(p)) return send('text/html; charset=utf-8', html('page.html'));
    return false;
  },
});
const { step, shot, finish } = runner();

try {
  const { panel } = await env.openWithPanel(`${env.origin}/`);
  await panel.waitForFunction(() => !document.getElementById('scanBtn').disabled);

  await step('サイトを解析すると、sitemap からページ数と「一覧＋詳細」を読み取る', async () => {
    await panel.click('#scanBtn');
    await panel.waitForSelector('#result:not([hidden])', { timeout: 60000 });
    const tiles = await panel.$$eval('#tiles .tile', (els) => els.map((e) => e.textContent));
    assert.deepEqual(tiles, ['41ページ', '8テンプレート', '1フォーム', '2言語']);
    assert.match(await panel.textContent('#collections'), /お知らせ\/news\/31件/);
    assert.match(await panel.textContent('#pages'), /\/about\/5ページ/);
    assert.match(await panel.textContent('#pagesSource'), /sitemap\.xml（3ファイル）から/);
  });

  await step('技術と機能・動きを検出する（フォームは下層の問い合わせページから）', async () => {
    const tech = await panel.$$eval('#tech .chip', (els) => els.map((e) => e.textContent));
    assert.ok(tech.includes('WordPress') && tech.includes('jQuery'), tech.join(','));
    const on = await panel.$$eval('#features li:not(.off)', (els) => els.map((e) => e.textContent));
    assert.ok(on.some((x) => /フォーム1件/.test(x)), on.join(' / '));
    assert.ok(on.some((x) => /多言語ja・en/.test(x)));
    assert.ok(on.some((x) => /スライダー/.test(x)));
    assert.ok(on.some((x) => /スクロール連動/.test(x)));
    assert.ok(on.some((x) => /地図/.test(x)));
    assert.match(await panel.textContent('#samples'), /\/contact\/（フォーム1）/);
    await shot(panel, 'est-scan.png', { fullPage: true });
  });

  let firstTotal = 0;
  await step('見積もり：内訳と合計・幅が出て、外したり数量を直したりできる', async () => {
    await panel.click('#toEstimate');
    await panel.waitForSelector('#estBox:not([hidden])');
    const total = await panel.textContent('#total');
    firstTotal = Number(total.replace(/[^\d]/g, ''));
    assert.ok(firstTotal > 1000000, total);
    assert.match(await panel.textContent('#range'), /目安 [\d,]+〜[\d,]+円/);
    const lines = await panel.textContent('#lines');
    assert.match(lines, /CMS構築（一覧・詳細）/);
    assert.match(lines, /お知らせ（\/news\/ 31件）/);
    assert.match(lines, /多言語対応/);
    // 多言語を外す
    await panel.locator('.line', { hasText: '多言語対応' }).locator('input[type="checkbox"]').uncheck();
    await panel.waitForFunction((t) => Number(document.getElementById('total').textContent.replace(/[^\d]/g, '')) < t, firstTotal);
    // 下層テンプレートの数を直す
    const qty = panel.locator('.line', { hasText: 'デザイン（下層テンプレート）' }).locator('input[type="number"]');
    await qty.fill('4');
    await qty.dispatchEvent('change');
    await panel.waitForFunction(() => [...document.querySelectorAll('.line')].some((l) => l.textContent.includes('デザイン（下層テンプレート）') && l.textContent.includes('240,000円')));
    await shot(panel, 'est-estimate.png', { fullPage: true });
  });

  await step('単価を変えると見積もりに反映され、再読み込みしても残る', async () => {
    await panel.click('#tab-price');
    const input = panel.locator('.price-row', { hasText: 'デザイン（下層テンプレート）' }).locator('input');
    await input.fill('80000');
    await panel.waitForFunction(() => document.getElementById('priceSaved').textContent.includes('保存'));
    await panel.click('#tab-est');
    await panel.waitForFunction(() => [...document.querySelectorAll('.line')].some((l) => l.textContent.includes('デザイン（下層テンプレート）') && l.textContent.includes('320,000円')));
    await panel.reload();
    await panel.click('#tab-est');
    await panel.waitForFunction(() => [...document.querySelectorAll('.line')].some((l) => l.textContent.includes('デザイン（下層テンプレート）') && l.textContent.includes('320,000円')));
  });

  await step('sitemap.xml が無いサイトでは、リンクをたどってページを数える', async () => {
    const other = await env.openWithPanel(`${env.origin.replace('127.0.0.1', 'localhost')}/`);
    await other.panel.waitForFunction(() => !document.getElementById('scanBtn').disabled);
    await other.panel.click('#tab-scan');
    await other.panel.click('#scanBtn');
    await other.panel.waitForSelector('#result:not([hidden])', { timeout: 60000 });
    assert.match(await other.panel.textContent('#pagesSource'), /sitemap\.xml が無いため/);
    const pages = Number((await other.panel.textContent('#tiles .tile')).replace(/[^\d]/g, ''));
    assert.ok(pages >= 8, `pages=${pages}`);
  });

  await step('タブを切り替えると、サイドパネルの対象ページも切り替わる', async () => {
    const a = await env.context.newPage();
    await a.goto(`${env.origin}/about/`);
    // 実際のサイドパネルと同じく、対象タブを固定せずに開く（同じウィンドウのタブとして）
    const panel = await env.context.newPage();
    const errors = [];
    panel.on('pageerror', (e) => errors.push(e.message));
    panel.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await panel.goto(`chrome-extension://${env.extId}/sidepanel/sidepanel.html`);
    const aId = await env.tabIdOf(env.sw, a.url());
    await env.sw.evaluate((id) => chrome.tabs.update(id, { active: true }), aId);
    await panel.waitForFunction(() => document.getElementById('targetUrl').textContent.includes('/about/'));
    assert.deepEqual(errors, []);
  });
} finally {
  await env.close();
  finish();
}
