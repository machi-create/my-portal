// node chrome-extensions/persona-mode/test/e2e.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, runner, until } from '../../_test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = await launch({ ext: path.resolve(here, '../extension'), fixtures: path.resolve(here, 'fixtures') });
const { step, shot, finish } = runner();

try {
  const { page, panel, tabId, front } = await env.openWithPanel(`${env.origin}/service.html`, 'sidepanel/sidepanel.html', { width: 400, height: 1400 });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.waitForFunction(() => document.getElementById('targetUrl').textContent.includes('service.html'));

  const pick = async (short) => {
    await panel.locator('.persona', { hasText: short }).click();
    await panel.waitForFunction(() => document.querySelectorAll('.finding').length > 0, null, { timeout: 10000 });
  };
  const filter = () => page.evaluate(() => document.documentElement.style.getPropertyValue('filter'));
  const findings = () => panel.$$eval('.finding', (els) => els.map((e) => e.textContent));

  await step('シニア：見え方（ぼかし・黄ばみ）を再現し、つまずきとひとりごとを出す', async () => {
    await pick('シニア');
    const f = await filter();
    assert.match(f, /blur\(0\.7px\)/);
    assert.match(f, /sepia\(0\.25\)/);
    const text = (await findings()).join(' / ');
    assert.match(text, /16px未満の文字が\d+か所あります/);
    assert.match(text, /背景との色の差が小さい文字/);
    assert.match(text, /押しにくい小さなボタン・リンク/);
    assert.match(text, /伝わりにくい言葉が\d+種類/);
    assert.match(text, /60字を超える長い文/);
    assert.match(text, /行き先がわからないリンク/);
    const voice = await panel.textContent('#voice');
    assert.match(voice, /老眼鏡/);
    await shot(page, 'pm-page-senior.png');
    await shot(panel, 'pm-panel-senior.png', { fullPage: true });
  });

  await step('つまずきの項目をクリックすると、ページの該当箇所へ移動・強調する', async () => {
    await front();
    await panel.locator('.finding', { hasText: '伝わりにくい言葉' }).locator('.finding-items li').first().click();
    await page.waitForFunction(() => CSS.highlights.has('wdt-find'));
    await panel.locator('.finding', { hasText: '押しにくい' }).locator('.finding-head').click();
    await page.waitForFunction(() => document.getElementById('wdt-overlay-host').shadowRoot.querySelectorAll('[data-layer="marks"] .mark').length >= 2);
  });

  await step('ズーム125%で見る → 解除で元の倍率に戻る', async () => {
    await panel.check('#zoomOn');
    await until(panel, async (t) => (await chrome.tabs.getZoom(t)) > 1.2, tabId);
    await panel.uncheck('#zoomOn');
    await until(panel, async (t) => Math.abs((await chrome.tabs.getZoom(t)) - 1) < 0.01, tabId);
  });

  await step('色覚D型：色の見え方を再現し、色だけのリンクを見つける', async () => {
    await pick('色覚 D型');
    assert.match(await filter(), /url\("?#wdt-cvd-d"?\)/);
    assert.ok(await page.evaluate(() => !!document.querySelector('#wdt-persona-defs filter#wdt-cvd-d feColorMatrix')));
    const text = (await findings()).join(' / ');
    assert.match(text, /色だけで区別しているリンクが1か所/);
    await shot(page, 'pm-page-cvd.png');
  });

  await step('片手：親指の届く範囲を表示し、固定バー・ボタンの位置を指摘する', async () => {
    await pick('片手・急ぎ');
    assert.equal(await filter(), '');
    await page.waitForFunction(() => document.getElementById('wdt-overlay-host').shadowRoot.querySelector('[data-layer="thumb"] svg circle'));
    const text = (await findings()).join(' / ');
    assert.match(text, /固定されたヘッダー・バーが画面の2\d%を占めています/);
    assert.match(text, /1画面目の申し込みボタンが、画面の上半分にしかありません/);
    assert.match(await panel.textContent('#voice'), /親指が届かない/);
    await shot(page, 'pm-page-onehand.png');
  });

  await step('弱視・低速回線・初めての人でも、それぞれの視点で指摘する', async () => {
    await pick('弱視');
    assert.match(await filter(), /blur\(2px\)/);
    assert.match((await findings()).join(' / '), /名前のないボタンが1か所/);
    await pick('低速回線');
    assert.equal(await filter(), '');
    assert.match((await findings()).join(' / '), /電波の弱い場所では、表示まで約[\d.]+秒/);
    await pick('初めての人');
    const text = (await findings()).join(' / ');
    assert.match(text, /アルファベットの略語が\d+種類/);
    assert.match(text, /最初の画面に見出しがあります/);
  });

  await step('解除すると、見え方・表示が元に戻る', async () => {
    await pick('シニア');
    await panel.click('#stopBtn');
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('filter') === '');
    assert.ok(await page.evaluate(() => !CSS.highlights.has('wdt-find')));
    assert.ok(await panel.isVisible('#empty'));
  });

  await step('パネルを閉じても、見え方とズームが元に戻る', async () => {
    await pick('シニア');
    await panel.check('#zoomOn');
    await until(panel, async (t) => (await chrome.tabs.getZoom(t)) > 1.2, tabId);
    await panel.close();
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('filter') === '', null, { timeout: 5000 });
    const sw = env.sw;
    await new Promise((r) => setTimeout(r, 500));
    const zoom = await sw.evaluate((t) => chrome.tabs.getZoom(t), tabId);
    assert.ok(Math.abs(zoom - 1) < 0.01, `zoom=${zoom}`);
  });
} finally {
  await env.close();
  finish();
}
