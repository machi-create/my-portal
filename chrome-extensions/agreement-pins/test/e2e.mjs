// node chrome-extensions/agreement-pins/test/e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, runner } from '../../_test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, 'fixtures');
let version = 1;
const env = await launch({
  ext: path.resolve(here, '../extension'),
  fixtures: FIX,
  // ?v=2 で「改修後」のページ（クラス名が変わり、要素が1つ増えた）を返す
  route(req, res, url) {
    if (url.pathname === '/about/' && (url.searchParams.get('v') === '2' || version === 2)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(FIX, 'about-v2.html')));
      return true;
    }
    return false;
  },
});
const { step, shot, finish } = runner();
const pinsIn = (page) => page.evaluate(() => {
  const host = document.getElementById('wdt-overlay-host');
  return host ? [...host.shadowRoot.querySelectorAll('.pin')].map((d) => d.textContent) : [];
});

try {
  const { page, panel, tabId } = await env.openWithPanel(`${env.origin}/about/`);
  await panel.waitForFunction(() => document.getElementById('targetUrl').textContent.includes('/about/'));

  async function pickIn(selector) {
    await page.bringToFront();
    await page.waitForFunction(() => {
      const host = document.getElementById('wdt-overlay-host');
      return host && host.shadowRoot.querySelector('.pick-bar');
    });
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  async function addPin(selector, { status, what, who }) {
    await panel.click('#addBtn');
    await pickIn(selector);
    await panel.waitForSelector('#pinForm:not([hidden])');
    if (status) await panel.click(`#statusSeg [data-st="${status}"]`);
    await panel.fill('#fWhat', what);
    if (who) await panel.fill('#fWho', who);
    await panel.click('#formSave');
    await panel.waitForSelector('#pinForm[hidden]', { state: 'attached' });
  }

  await step('要素を選んでピンを追加すると、一覧とページ上に番号が出る', async () => {
    await addPin('h1', { what: 'キャッチコピーはA案「地域の未来をつくる」で確定', who: '先方 田中様' });
    await panel.waitForFunction(() => document.querySelectorAll('.pin-card').length === 1);
    const card = await panel.textContent('.pin-card');
    assert.match(card, /合意/);
    assert.match(card, /見出し「私たちは、地域の未来をつくる会社です。」/);
    assert.match(card, /先方 田中様/);
    await page.waitForFunction(() => document.getElementById('wdt-overlay-host').shadowRoot.querySelectorAll('.pin').length === 1);
  });

  await step('空の内容では保存できない', async () => {
    await panel.click('#addBtn');
    await pickIn('a.btn-main');
    await panel.waitForSelector('#pinForm:not([hidden])');
    await panel.click('#formSave');
    assert.match(await panel.textContent('#formError'), /入力してください/);
    await panel.click('#formCancel');
  });

  await step('保留のピンに「経緯を追加」すると、履歴が残る', async () => {
    await addPin('a.btn-main', { status: 'pending', what: 'ボタンの色は緑か青で検討中', who: '先方 田中様' });
    await panel.locator('.pin-card', { hasText: 'ボタンの色' }).locator('text=経緯を追加').click();
    await panel.waitForSelector('#pinForm:not([hidden])');
    assert.equal(await panel.getAttribute('#statusSeg [data-st="agreed"]', 'aria-checked'), 'true');
    await panel.fill('#fWhat', 'ボタンはブランドグリーン（#2E7D32）で確定');
    await panel.click('#formSave');
    await panel.waitForSelector('#pinForm[hidden]', { state: 'attached' });
    const card = await panel.textContent('.pin-card:nth-child(2)');
    assert.match(card, /ブランドグリーン/);
    assert.match(card, /これまでの経緯（1件）/);
    assert.deepEqual(await pinsIn(page), ['1', '2']);
  });

  await step('ページのピンにホバーすると経緯が出て、クリックで一覧の該当ピンが選ばれる', async () => {
    await page.bringToFront();
    const pos = await page.evaluate(() => {
      const d = document.getElementById('wdt-overlay-host').shadowRoot.querySelectorAll('.pin')[1].getBoundingClientRect();
      return { x: d.x + d.width / 2, y: d.y + d.height / 2 };
    });
    await page.mouse.move(pos.x, pos.y);
    await page.waitForFunction(() => {
      const card = document.getElementById('wdt-overlay-host').shadowRoot.querySelector('.card');
      return card && card.textContent.includes('ブランドグリーン') && card.textContent.includes('緑か青で検討中');
    });
    await shot(page, 'pins-page-hover.png', { clip: { x: 0, y: 0, width: 1000, height: 420 } });
    await page.mouse.click(pos.x, pos.y);
    await panel.waitForFunction(() => {
      const active = document.querySelector('.pin-card.active');
      return active && active.textContent.includes('ブランドグリーン');
    });
    assert.ok(!page.url().includes('#contact'), 'ピンのクリックでリンクは動かない');
  });

  await step('ページが改修されて（クラス名が変わっても）、文言から要素を見つけ直す', async () => {
    version = 2;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.news'));
    await panel.waitForFunction(() => document.querySelectorAll('.pin-card').length === 2);
    await page.waitForFunction(() => {
      const host = document.getElementById('wdt-overlay-host');
      return host && host.shadowRoot.querySelectorAll('.pin').length === 2;
    }, null, { timeout: 8000 });
    const warn = await panel.$$eval('.pin-warn', (els) => els.map((e) => e.textContent));
    assert.equal(warn.length, 0, warn.join(' / '));
    version = 1;
  });

  await step('別のドメイン（テスト環境 → 本番を想定）でも同じパスならピンが出て、自動でアイコンに件数が付く', async () => {
    const other = await env.context.newPage();
    const otherUrl = `${env.origin.replace('127.0.0.1', 'localhost')}/about/`;
    await other.goto(otherUrl);
    await other.waitForFunction(() => {
      const host = document.getElementById('wdt-overlay-host');
      return host && host.shadowRoot.querySelectorAll('.pin').length === 2;
    }, null, { timeout: 8000 });
    const otherTab = await env.tabIdOf(panel, otherUrl);
    assert.equal(await panel.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), otherTab), '2');
    await other.close();
  });

  await step('すべての合意：絞り込みと Markdown の書き出し', async () => {
    await panel.click('#tab-all');
    await panel.waitForFunction(() => document.querySelectorAll('.row-item').length === 2);
    await panel.fill('#search', 'グリーン');
    await panel.waitForFunction(() => document.querySelectorAll('.row-item').length === 1);
    await panel.fill('#search', '');
    const md = await panel.evaluate(async () => window.PIN.data.toMarkdown(await window.PIN.data.loadAll()));
    assert.match(md, /\| 1 \| 合意 \| 見出し「私たちは、地域の未来をつくる会社です。」 \| キャッチコピーはA案/);
    assert.match(md, /No\.2 の経緯：\d\d\/\d\d 保留（先方 田中様） → \d\d\/\d\d 合意（先方 田中様）/);
    await shot(panel, 'pins-panel-all.png', { fullPage: true });
  });

  await step('JSON を読み込むと、ほかの人の追記がまとまる', async () => {
    const all = await panel.evaluate(() => window.PIN.data.loadAll());
    const shared = JSON.parse(JSON.stringify(all));
    shared[0].entries.push({ id: 'e_remote', status: 'question', what: '英語版のコピーは別途相談', who: '先方 佐藤様', date: '2026-10-20', note: '', createdAt: Date.now() });
    shared[0].updatedAt = Date.now();
    await panel.setInputFiles('#loadJson', { name: 'shared.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ pins: shared })) });
    await panel.waitForFunction(() => document.getElementById('snackbar').textContent.includes('更新 1件'));
    await panel.click('#tab-page');
    await panel.waitForFunction(() => document.querySelector('.pin-card').textContent.includes('英語版のコピー'));
  });

  await step('削除は2回押して確定する', async () => {
    await panel.click('#tab-page');
    const del = panel.locator('.pin-card').first().locator('text=削除');
    await del.click();
    await panel.locator('.pin-card').first().locator('text=本当に削除する').click();
    await panel.waitForFunction(() => document.querySelectorAll('.pin-card').length === 1);
    await page.waitForFunction(() => document.getElementById('wdt-overlay-host').shadowRoot.querySelectorAll('.pin').length === 1);
    await shot(panel, 'pins-panel.png', { fullPage: true });
  });
} finally {
  await env.close();
  finish();
}
