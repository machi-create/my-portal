// 実ブラウザ（Chromium）に拡張機能を読み込んで動作を確認する
//   node test/e2e.mjs                 … 確認のみ
//   TUC_SHOTS=./shots node test/e2e.mjs … スクリーンショットも保存
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  const { execSync } = await import('node:child_process');
  playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium } = playwright;

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../extension');
const FIX = path.resolve(here, 'fixtures');
const SHOTS = process.env.TUC_SHOTS ? path.resolve(process.env.TUC_SHOTS) : null;
const manuscript = fs.readFileSync(path.join(FIX, 'manuscript.txt'), 'utf8');

// ---------------------------------------------------------------- テスト用サーバー
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (p === '/about/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(FIX, 'stg-about.html')));
  } else if (p === '/' || p === '/works/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>ok</title><p>ok</p>');
  } else if (p === '/contact/') {
    res.writeHead(301, { location: '/contact/form/' });
    res.end();
  } else if (p === '/contact/form/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>form</title>');
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const PAGE_URL = `${ORIGIN}/about/`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuc-profile-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (e) {
    failures++;
    console.log(`✘ ${name}\n  ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n  ')}`);
  }
}
const shot = async (target, name, opts) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, name), ...opts });
};

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 1100 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  const tabId = await panel.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, PAGE_URL);
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html?tabId=${tabId}`);
  await panel.waitForFunction(() => document.getElementById('targetUrl').textContent.includes('/about/'));

  const callContent = (name, args) =>
    panel.evaluate(([t, n, a]) => window.TUC.bridge.call(t, n, a), [tabId, name, args]);

  // ---------------------------------------------------------------- 原稿照合（ロジック）
  await step('原稿照合：一致・表記ゆれ・文言差分・未反映・原稿にない を判定できる', async () => {
    const res = await panel.evaluate(
      ([t, text]) => {
        const p = window.TUC.manuscript.parse(text);
        return window.TUC.bridge.call(t, 'runManuscript', { segments: p.segments, options: {} });
      },
      [tabId, manuscript]
    );
    const by = (text) => res.items.find((i) => i.text === text);
    assert.equal(res.summary.total, 17);
    assert.equal(by('会社概要｜みなとデザイン株式会社').status, 'ok');
    assert.equal(by('会社概要｜みなとデザイン株式会社').where, 'title');
    assert.equal(by('代表取締役　港 太郎').status, 'ok');
    assert.equal(by('〒100-0001 東京都千代田区千代田1-1').status, 'ok');
    assert.equal(by('創業から15年、Web制作を通じて地元企業の挑戦を支えてきました。').status, 'variant');
    const diff = by('私たちは、地域の未来をデザインする会社です。');
    assert.equal(diff.status, 'diff');
    assert.equal(diff.page, '私たちは、地域の未来をつくる会社です。');
    assert.ok(diff.diff.some(([op, t]) => op === -1 && t.includes('デザインす')));
    const faq = by('内容にもよりますが、2〜3か月が目安です。');
    assert.equal(faq.status, 'ok');
    assert.equal(faq.hidden, true, '閉じた details の中は非表示として扱う');
    assert.equal(by('採用情報は随時更新しています。').status, 'missing');
    assert.equal(by('資料をダウンロード').status, 'ok');
    const extras = res.extras.map((x) => x.text);
    assert.ok(extras.includes('顧客満足度No.1の制作会社です。'), extras.join(' / '));
    assert.ok(extras.includes('テキストテキストテキストテキスト'));
    assert.ok(!extras.some((x) => x.includes('制作実績')), 'ナビは除外');
    assert.ok(!extras.some((x) => x.includes('Minato')), 'フッターは除外');
    assert.ok(!res.items.some((i) => i.text.includes('指示')), '// で始まる行は無視');
  });

  await step('原稿照合：照合範囲のセレクタが不正ならエラーを返す', async () => {
    await assert.rejects(
      panel.evaluate((t) => window.TUC.bridge.call(t, 'runManuscript', { segments: [{ text: 'a', line: 1 }], options: { scope: '##' } }), tabId),
      /セレクタ/
    );
  });

  // ---------------------------------------------------------------- 公開前チェック（ロジック）
  await step('公開前チェック：仕込んだ不備をすべて検出できる', async () => {
    const res = await callContent('runAccident', { env: 'staging', settings: {}, year: 2026 });
    const get = (id) => res.checks.find((c) => c.id === id);
    const texts = (id) => (get(id) ? get(id).items.map((i) => i.text).join(' | ') : '');
    assert.equal(get('robots').sev, 'ok');
    assert.equal(get('dummy-text').sev, 'error');
    assert.match(texts('dummy-text'), /テキストテキスト/);
    assert.match(texts('dummy-text'), /○○○○/);
    assert.match(texts('dummy-text'), /info@example\.com/);
    assert.equal(get('dummy-weak').sev, 'warn');
    assert.equal(get('link-staging').sev, 'warn');
    assert.match(texts('link-staging'), /localhost:3000/);
    assert.equal(get('link-empty').sev, 'warn');
    assert.equal(get('link-tel').sev, 'warn');
    assert.equal(get('link-mail').sev, 'error');
    assert.equal(get('img-placeholder').sev, 'error');
    assert.equal(get('img-alt').sev, 'warn');
    assert.equal(get('img-alt').total, 1);
    assert.equal(get('text-typo').sev, 'warn');
    assert.equal(get('text-hankaku-kana').sev, 'warn');
    assert.equal(get('text-zenkaku').sev, 'info');
    assert.equal(get('legal-copyright').sev, 'info');
    assert.equal(get('legal-no1').sev, 'warn');
    assert.equal(get('legal-privacy').sev, 'warn');
    assert.equal(get('description').sev, 'warn');
    assert.equal(get('ogp').sev, 'warn');
    assert.equal(get('ref-canonical').sev, 'warn');
    assert.equal(get('favicon').sev, 'warn');
    assert.equal(get('h1').sev, 'ok');
    assert.equal(get('tag-ga').sev, 'info');
    assert.deepEqual(res.tags, [{ id: 'G-AB12CD34EF', kind: 'GA4' }]);
  });

  await step('公開前チェック：本番として判定すると noindex がエラーになる', async () => {
    const res = await callContent('runAccident', { env: 'production', settings: {}, year: 2026 });
    const robots = res.checks.find((c) => c.id === 'robots');
    assert.equal(robots.sev, 'error');
    assert.equal(res.checks.find((c) => c.id === 'link-staging').sev, 'error');
  });

  // ---------------------------------------------------------------- サイドパネルの操作
  await step('サイドパネル：原稿を貼り付けて照合し、結果が表示される', async () => {
    await panel.click('#tab-ms');
    await panel.fill('#msText', manuscript);
    await panel.waitForFunction(() => /^17件/.test(document.getElementById('msStat').textContent));
    await panel.click('#runMs');
    await panel.waitForSelector('#msResult:not([hidden])');
    const rate = await panel.textContent('#msRate');
    assert.equal(rate, '94%');
    const chipText = await panel.$$eval('#msChips .chip', (els) => els.map((e) => e.textContent).join(','));
    assert.match(chipText, /文言差分1/);
    assert.match(chipText, /未反映1/);
    const firstItem = await panel.textContent('#msItems .item');
    assert.ok(firstItem.length > 0);
  });

  await step('サイドパネル：結果をクリックするとページ上の該当箇所へ移動する', async () => {
    await page.bringToFront();
    await panel.click('#msItems .item.clickable >> text=文言差分');
    await page.waitForSelector('#tuc-overlay-root .tuc-focus-box', { timeout: 3000 });
    await shot(page, 'page-manuscript.png');
    await shot(panel, 'panel-manuscript.png', { fullPage: true });
  });

  await step('サイドパネル：原稿はページごとに保存され、再読み込み後も残る', async () => {
    await panel.reload();
    await panel.waitForFunction(() => document.getElementById('msText').value.includes('みなとデザイン'));
    const saved = await panel.textContent('#msSaved');
    assert.match(saved, /保存済み/);
  });

  await step('サイドパネル：公開前チェックの結果が表示され、バッジが付く', async () => {
    await panel.click('#tab-acc');
    await panel.click('#runAcc');
    await panel.waitForSelector('#accResult:not([hidden])');
    const tiles = await panel.$$eval('#accTiles .tile', (els) => els.map((e) => e.textContent));
    assert.ok(Number.parseInt(tiles[0], 10) >= 4, tiles.join(','));
    const badge = await panel.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), tabId);
    assert.ok(Number(badge) >= 4, `badge=${badge}`);
    await shot(page, 'page-accident.png');
  });

  await step('サイドパネル：リンク切れチェックで 404 と接続不可を検出する', async () => {
    await panel.click('#runLinks');
    await panel.waitForFunction(() => document.getElementById('linkResult').textContent.includes('件を確認'), null, { timeout: 30000 });
    const text = await panel.textContent('#linkResult');
    assert.match(text, /リンク切れが2件/);
    assert.match(text, /\/service\//);
    assert.match(text, /localhost:3000/);
    assert.match(text, /リダイレクトされるリンクが1件/);
    await shot(panel, 'panel-accident.png', { fullPage: true });
    if (SHOTS) {
      await panel.emulateMedia({ colorScheme: 'dark' });
      await panel.click('#tab-ms');
      await shot(panel, 'panel-dark.png');
      await panel.emulateMedia({ colorScheme: 'light' });
      await panel.click('#tab-acc');
    }
  });

  await step('自動チェック：本番ドメインに登録すると、読み込み時にバッジと通知が出る', async () => {
    await panel.evaluate((host) => chrome.storage.sync.set({ productionHosts: [host] }), new URL(ORIGIN).host);
    await page.reload();
    await page.waitForSelector('#tuc-toast', { timeout: 8000 });
    await panel.waitForFunction(() => document.getElementById('envBadge').dataset.env === 'production');
    const expected = await callContent('runAccident', { env: 'production', settings: {} });
    const badge = await panel.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), tabId);
    assert.equal(Number(badge), expected.summary.error);
    assert.ok(expected.summary.error >= 5, `error=${expected.summary.error}`);
    await page.waitForTimeout(400);
    await shot(page, 'page-toast.png', { clip: { x: 760, y: 700, width: 520, height: 200 } });
    await panel.evaluate(() => chrome.storage.sync.set({ productionHosts: [] }));
  });

  await step('ページ再読み込み時に照合をやり直し、パネルを閉じるとハイライトが消える', async () => {
    await panel.click('#tab-ms');
    await panel.click('#runMs');
    await panel.waitForSelector('#msResult:not([hidden])');
    assert.ok(await page.evaluate(() => CSS.highlights.size > 0));
    await panel.close();
    await page.waitForFunction(() => CSS.highlights.size === 0, null, { timeout: 5000 });
  });
} finally {
  await context.close();
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

if (failures) {
  console.log(`\n${failures}件失敗しました`);
  process.exit(1);
}
console.log('\nすべて成功しました');
