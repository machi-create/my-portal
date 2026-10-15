// node chrome-extensions/lp-rhythm/test/e2e.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, runner } from '../../_test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = await launch({ ext: path.resolve(here, '../extension'), fixtures: path.resolve(here, 'fixtures') });
const { step, shot, finish } = runner();

try {
  const { page, panel, front } = await env.openWithPanel(`${env.origin}/lp.html`, 'sidepanel/sidepanel.html', { width: 400, height: 1300 });

  await step('開くと自動で計測し、長さ・ボタン数・最初のボタンを出す', async () => {
    await panel.waitForSelector('#lpResult:not([hidden])', { timeout: 10000 });
    const tiles = await panel.$$eval('#tiles .tile', (els) => els.map((e) => e.textContent));
    const screens = parseFloat(tiles[0]);
    assert.ok(screens > 8 && screens < 16, tiles.join(','));
    assert.equal(tiles[1], '2ボタン');
    assert.match(tiles[2], /^0\.\d最初のボタン/);
    assert.equal(tiles[3], '6見出し');
  });

  await step('気づき：ボタンのない長い区間と、文字が続く区間を見つける', async () => {
    const text = await panel.textContent('#insights');
    assert.match(text, /画面、申し込みボタンがありません/);
    assert.match(text, /画面目は文字が続きます/);
    assert.match(text, /画面に追従するボタンはありません/);
    assert.match(text, /ファーストビューに見出しと申し込みボタンがあります/);
    // ページの左端に区間の帯が出る
    const bands = await page.evaluate(() => document.getElementById('wdt-overlay-host').shadowRoot.querySelectorAll('[data-layer="zones"] .band').length);
    assert.ok(bands >= 2, `bands=${bands}`);
  });

  await step('グラフ：ビンごとの棒、ボタンの点、ホバーで値を表示', async () => {
    const counts = await panel.evaluate(() => ({
      text: document.querySelectorAll('#chart .lr-text').length,
      image: document.querySelectorAll('#chart .lr-image').length,
      cta: document.querySelectorAll('#chart .lr-cta').length,
      zone: document.querySelectorAll('#chart .lr-zone').length,
    }));
    assert.equal(counts.cta, 2);
    assert.equal(counts.text, counts.image);
    assert.ok(counts.text >= 16, JSON.stringify(counts));
    assert.ok(counts.zone >= 2);
    const box = await panel.locator('#chart svg').boundingBox();
    await panel.mouse.move(box.x + box.width * 0.6, box.y + 34 + 14 * 6 + 5);
    await panel.waitForSelector('.lr-tip:not([hidden])');
    const tip = await panel.textContent('.lr-tip');
    assert.match(tip, /3〜3\.5画面目/);
    assert.match(tip, /\d+字文字量/);
    assert.match(tip, /\d+%画像の割合/);
    await shot(panel, 'lr-panel.png', { fullPage: true });
  });

  await step('グラフの行や気づきをクリックすると、ページのその位置へ移動する', async () => {
    await front();
    const box = await panel.locator('#chart svg').boundingBox();
    await panel.mouse.click(box.x + box.width * 0.6, box.y + 34 + 14 * 12 + 5);
    await page.waitForFunction(() => scrollY > 2000, null, { timeout: 5000 });
    await panel.locator('.insight', { hasText: '文字が続きます' }).click();
    await page.waitForFunction(() => document.getElementById('wdt-overlay-host').shadowRoot.querySelector('.row-flash'));
    await shot(page, 'lr-page.png');
  });

  await step('表で見る：グラフと同じ内容を表で確認できる', async () => {
    await panel.click('#toggleTable');
    const rows = await panel.$$eval('#tableWrap tbody tr', (els) => els.length);
    const bars = await panel.$$eval('#chart .lr-text', (els) => els.length);
    assert.equal(rows, bars);
    assert.match(await panel.textContent('#tableWrap'), /無料体験を申し込む/);
    await panel.click('#toggleTable');
  });

  await step('保存して、競合LPと並べて比べる', async () => {
    await panel.fill('#saveName', '改修前');
    await panel.click('#saveBtn');
    await panel.waitForFunction(() => document.getElementById('savedCount').textContent === '1');
    await page.goto(`${env.origin}/competitor.html`);
    await panel.waitForFunction(() => document.getElementById('targetUrl').textContent.includes('competitor'));
    await panel.waitForFunction(() => document.querySelector('#tiles .tile') && document.querySelectorAll('#tiles .tile')[1].textContent === '3ボタン', null, { timeout: 10000 });
    assert.match(await panel.textContent('#insights'), /画面に追従するボタンがあります（30日無料で試す）/);
    await panel.click('#tab-cmp');
    await panel.waitForSelector('#cmpCard:not([hidden])');
    const header = await panel.$$eval('#cmpTable thead th', (els) => els.map((e) => e.textContent));
    assert.deepEqual(header, ['', 'このLP', '改修前']);
    const rows = await panel.$$eval('#cmpTable tbody tr', (els) => els.map((e) => e.textContent));
    assert.ok(rows.some((r) => r === '追従ボタンありなし'), rows.join(' / '));
    assert.ok(rows.some((r) => /^申し込みボタン3個2個$/.test(r)));
    const cols = await panel.$$eval('#cmpChart .lr-col-title', (els) => els.map((e) => e.textContent));
    assert.deepEqual(cols, ['このLP', '改修前']);
    await shot(panel, 'lr-compare.png', { fullPage: true });
  });

  await step('パネルを閉じるとページ上の帯が消える', async () => {
    await panel.close();
    await page.waitForFunction(() => {
      const host = document.getElementById('wdt-overlay-host');
      return host && host.shadowRoot.querySelectorAll('.band').length === 0;
    }, null, { timeout: 5000 });
  });
} finally {
  await env.close();
  finish();
}
