// node chrome-extensions/feedback-translator/test/e2e.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, runner } from '../../_test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = await launch({ ext: path.resolve(here, '../extension'), fixtures: path.resolve(here, 'fixtures') });
const { step, shot, finish } = runner();

try {
  const { page, panel, tabId } = await env.openWithPanel(`${env.origin}/lp.html`);
  await panel.waitForFunction(() => document.getElementById('targetUrl').textContent.includes('lp.html'));

  /** パネルで「要素を選ぶ」→ ページ上の要素をクリック */
  async function pickElement(selector) {
    await panel.click((await panel.isVisible('#repick')) ? '#repick' : '#pickBtn');
    await page.bringToFront();
    await page.waitForFunction(() => {
      const host = document.getElementById('wdt-overlay-host');
      return host && host.shadowRoot && host.shadowRoot.querySelector('.pick-bar');
    });
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await panel.waitForSelector('#infoBox:not([hidden])');
  }

  await step('ボタンを選ぶと、役割・セレクタ・現在の見た目が表示される', async () => {
    await pickElement('a.cta');
    assert.equal(await panel.textContent('#infoRole'), 'ボタン');
    assert.equal(await panel.textContent('#infoText'), '無料で相談する');
    assert.match(await panel.textContent('#infoSelector'), /a\.cta/);
    const grid = await panel.textContent('#styleGrid');
    assert.match(grid, /文字サイズ14px/);
    assert.match(grid, /内側の余白8px 16px/);
    // クリックでリンク先に遷移していないこと
    assert.ok(!page.url().includes('#form'));
  });

  await step('スクリーンショットが撮れている', async () => {
    await panel.waitForFunction(() => {
      const img = document.getElementById('shotImg');
      return img && !img.hidden && img.src.startsWith('data:image/png');
    }, null, { timeout: 8000 });
    const size = await panel.evaluate(() => {
      const img = document.getElementById('shotImg');
      return { w: img.naturalWidth, h: img.naturalHeight };
    });
    assert.ok(size.w > 100 && size.h > 40, JSON.stringify(size));
  });

  await step('「もっとパッと目立つ感じに」から具体的な修正案が出る', async () => {
    await panel.fill('#feedback', 'もっとパッと目立つ感じにしてほしい');
    await panel.click('#analyzeBtn');
    await panel.waitForSelector('#proposalCard:not([hidden])');
    const text = await panel.textContent('#proposals');
    assert.match(text, /文字サイズ.*14px→18px/);
    assert.match(text, /文字の太さ.*400→700/);
    assert.match(text, /内側の余白.*8px 16px→14px 28px/);
    assert.match(await panel.textContent('#intentLine'), /目立たせる/);
    assert.match(text, /背景色/, '白文字のボタンは背景色を濃くする案');
    assert.doesNotMatch(text, /文字の色/);
  });

  await step('プレビューでページの見た目が変わり、解除で元に戻る', async () => {
    await panel.click('#previewBtn');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('a.cta')).fontSize === '18px');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('a.cta')).fontWeight), '700');
    await shot(page, 'ft-page-preview.png', { clip: { x: 0, y: 0, width: 900, height: 360 } });
    // 修正案を1つ外すと、プレビューからも外れる
    await panel.locator('.proposal', { hasText: '文字の太さ' }).locator('input').uncheck();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('a.cta')).fontWeight === '400');
    await panel.click('#previewBtn');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('a.cta')).fontSize === '14px');
    // インライン指定が残っていないこと（Chromium では空の style="" が残る場合があるが、見た目には影響しない）
    await page.waitForFunction(() => document.querySelector('a.cta').style.length === 0, null, { timeout: 3000 });
  });

  await step('開発者向け・クライアント向けの文面が書き出せる', async () => {
    const dev = await panel.textContent('#output');
    assert.match(dev, /font-size: 18px;/);
    assert.doesNotMatch(dev, /font-weight: 700/, '外した修正案は含めない');
    assert.match(dev, /先方の要望：「もっとパッと目立つ感じにしてほしい」/);
    await panel.click('[data-out="client"]');
    const client = await panel.textContent('#output');
    assert.match(client, /ボタン「無料で相談する」を次のように調整いたします/);
    assert.doesNotMatch(client, /font-size/);
    await shot(panel, 'ft-panel.png', { fullPage: true });
  });

  await step('文章を選んで「読みにくい」→ 文字サイズ・行間・コントラスト', async () => {
    await pickElement('p.lead');
    assert.equal(await panel.textContent('#infoRole'), '文章');
    assert.match(await panel.textContent('#styleGrid'), /コントラスト2\.\d : 1/);
    await panel.fill('#feedback', '文字が薄くて読みにくい');
    await panel.click('#analyzeBtn');
    const text = await panel.textContent('#proposals');
    assert.match(text, /文字サイズ.*13px→16px/);
    assert.match(text, /行の間隔/);
    assert.match(text, /文字の色/);
  });

  await step('GitHub Issue の作成画面を、本文入りで開く', async () => {
    await panel.evaluate(() => chrome.storage.sync.set({ repo: 'machi-create/site', labels: 'design' }));
    await panel.waitForFunction(() => document.getElementById('issueHint').textContent.includes('machi-create/site'));
    const [issue] = await Promise.all([env.context.waitForEvent('page'), panel.click('#issueBtn')]);
    await issue.waitForURL(/github\.com/, { timeout: 5000 }).catch(() => {});
    const u = new URL(issue.url());
    assert.equal(u.pathname, '/machi-create/site/issues/new');
    assert.match(u.searchParams.get('title'), /【修正依頼】文章/);
    assert.match(u.searchParams.get('body'), /font-size: 16px;/);
    assert.equal(u.searchParams.get('labels'), 'design');
    await issue.close();
  });

  await step('専門用語をやさしい言葉に言い換える', async () => {
    await panel.click('#tab-easy');
    await panel.fill('#easyInput', 'CLS改善のため画像にwidth/heightを指定し、ファーストビューのCTAを大きくします。');
    await panel.click('#easyBtn');
    const text = await panel.textContent('#easyText');
    assert.match(text, /表示中にレイアウトがずれる度合い（CLS）/);
    assert.match(text, /ページを開いて最初に見える範囲（ファーストビュー）/);
    assert.match(await panel.textContent('#easyTerms'), /CTA/);
  });

  await step('パネルを閉じるとページの表示が元に戻る', async () => {
    await panel.click('#tab-fb');
    await panel.click('#previewBtn');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('p.lead')).fontSize === '16px');
    await panel.close();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('p.lead')).fontSize === '13px', null, { timeout: 5000 });
    const layers = await page.evaluate(() => document.getElementById('wdt-overlay-host').shadowRoot.querySelector('[data-layer="selected"]').childElementCount);
    assert.equal(layers, 0);
  });
} finally {
  await env.close();
  finish();
}
