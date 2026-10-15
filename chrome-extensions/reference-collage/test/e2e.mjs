// node chrome-extensions/reference-collage/test/e2e.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, runner } from '../../_test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = await launch({ ext: path.resolve(here, '../extension'), fixtures: path.resolve(here, 'fixtures') });
const { step, shot, finish } = runner();

try {
  const { page, panel, tabId, front } = await env.openWithPanel(`${env.origin}/lp.html`);
  await panel.waitForFunction(() => document.getElementById('targetUrl').textContent.includes('lp.html'));

  async function pickAt(selector) {
    const before = await panel.$$eval('.item', (els) => els.length);
    await panel.click('#pickBtn');
    await front();
    await page.waitForFunction(() => {
      const host = document.getElementById('wdt-overlay-host');
      return host && host.shadowRoot.querySelector('.pick-bar');
    });
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + 3, box.y + 3);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await panel.waitForFunction((n) => document.querySelectorAll('.item').length === n + 1, before, { timeout: 10000 });
  }

  const kinds = () => panel.$$eval('.item .kind-select', (els) => els.map((e) => e.value));

  await step('ファーストビューを摘むと、種類を自動判定してワイヤーに変換する', async () => {
    await pickAt('.hero h1');
    assert.deepEqual(await kinds(), ['hero']);
    const meta = await panel.textContent('.item .item-meta');
    assert.match(meta, /見出し1/);
    assert.match(meta, /ボタン2/);
    assert.match(meta, /参考：127\.0\.0\.1/);
    const rects = await panel.$$eval('.item .wire svg rect', (els) => els.length);
    assert.ok(rects >= 6, `rect=${rects}`);
  });

  await step('カードの一部をクリックしても、セクション全体（特徴・料金・FAQ）を摘む', async () => {
    await pickAt('#f .card:nth-child(2) p');
    await pickAt('#p .plan:nth-child(1) .price');
    await pickAt('#q details:nth-of-type(2) summary');
    assert.deepEqual(await kinds(), ['hero', 'features', 'pricing', 'faq']);
    assert.match(await panel.textContent('.item:nth-child(2) .item-meta'), /3列/);
  });

  await step('参考のスクリーンショットも保存され、切り替えて見られる', async () => {
    await panel.locator('.item').first().locator('text=参考スクショ').click();
    await panel.waitForSelector('.item:first-child img.shot');
    const size = await panel.$eval('.item:first-child img.shot', (img) => [img.naturalWidth, img.naturalHeight]);
    // 1280×444px のセクションを幅1000pxに縮小
    assert.deepEqual(size, [1000, 347]);
    await panel.locator('.item').first().locator('text=ワイヤー').click();
  });

  await step('種類の手直し・並べ替え・メモが保存される', async () => {
    await panel.locator('.item').nth(3).locator('.kind-select').selectOption('content');
    await panel.locator('.item').nth(3).locator('.kind-select').selectOption('faq');
    await panel.locator('.item').nth(1).locator('button[title="下へ"]').click();
    await panel.waitForFunction(() => document.querySelectorAll('.item .kind-select')[1].value === 'pricing');
    assert.deepEqual(await kinds(), ['hero', 'pricing', 'features', 'faq']);
    await panel.locator('.item').nth(0).locator('.memo').fill('キャッチは短く、ボタンは2つ');
    await panel.waitForTimeout(600);
    await panel.reload();
    await panel.waitForFunction(() => document.querySelectorAll('.item').length === 4);
    assert.deepEqual(await kinds(), ['hero', 'pricing', 'features', 'faq']);
    assert.equal(await panel.inputValue('.item:first-child .memo'), 'キャッチは短く、ボタンは2つ');
    await shot(panel, 'collage-panel.png', { fullPage: true });
  });

  await step('ドラッグで並べ替えできる', async () => {
    await panel.bringToFront();
    await panel.evaluate(() => scrollTo(0, 0));
    await panel.dragAndDrop('.item:nth-child(2) .handle', '.item:nth-child(1) .item-head');
    await panel.waitForFunction(() => document.querySelector('.item .kind-select').value === 'pricing');
    assert.deepEqual(await kinds(), ['pricing', 'hero', 'features', 'faq']);
    await panel.dragAndDrop('.item:nth-child(2) .handle', '.item:nth-child(1) .item-head');
    await panel.waitForFunction(() => document.querySelector('.item .kind-select').value === 'hero');
    assert.deepEqual(await kinds(), ['hero', 'pricing', 'features', 'faq']);
  });

  await step('ワイヤーフレーム画面で全体を確認し、SVG・構成案を書き出せる', async () => {
    const [board] = await Promise.all([env.context.waitForEvent('page'), panel.click('#openBoard')]);
    await board.setViewportSize({ width: 1400, height: 1000 });
    await board.waitForFunction(() => document.querySelectorAll('.section').length === 4);
    const titles = await board.$$eval('.section-kind', (els) => els.map((e) => e.textContent));
    assert.deepEqual(titles, ['ファーストビュー', '料金・プラン', '特徴・サービス', 'よくある質問']);
    assert.match(await board.textContent('.section-memo'), /キャッチは短く/);
    await board.check('#optText');
    assert.match(await board.textContent('.section:first-child .wire'), /経理の時間を、半分に。/);
    const svg = await board.evaluate(() => window.RC.wire.boardSvg([], {}) && document.querySelector('.section .wire svg').outerHTML);
    assert.match(svg, /^<svg/);
    const md = await board.evaluate(async () => {
      const b = new URLSearchParams(location.search).get('board');
      return window.RC.wire.toMarkdown(await window.RC.db.items(b), { title: 'x' });
    });
    assert.match(md, /1\. \*\*ファーストビュー\*\*/);
    assert.match(md, /- メモ：キャッチは短く、ボタンは2つ/);
    await board.uncheck('#optText');
    await shot(board, 'collage-board.png', { fullPage: false });
    await board.close();
  });

  await step('ボードを分けて管理できる', async () => {
    await panel.click('#boardNew');
    await panel.waitForFunction(() => !document.getElementById('renameRow').hidden && document.getElementById('boardName').value === 'ボード 2');
    await panel.fill('#boardName', 'B社 採用サイト');
    await panel.click('#renameSave');
    await panel.waitForFunction(() => document.querySelectorAll('.item').length === 0);
    await panel.waitForFunction(() => {
      const s = document.getElementById('boardSel');
      return s.options[s.selectedIndex].textContent === 'B社 採用サイト';
    });
    await panel.selectOption('#boardSel', { index: 0 });
    await panel.waitForFunction(() => document.querySelectorAll('.item').length === 4);
  });
} finally {
  await env.close();
  finish();
}
