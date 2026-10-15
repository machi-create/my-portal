// node chrome-extensions/time-autolog/test/e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, runner, until } from '../../_test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = await launch({ ext: path.resolve(here, '../extension'), fixtures: path.resolve(here, 'fixtures') });
const { step, shot, finish } = runner();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const { page, panel } = await env.openWithPanel(`${env.origin}/news.html`, 'sidepanel/sidepanel.html', { width: 380, height: 1500 });
  const sw = env.sw;
  const status = () => sw.evaluate(async () => ((await chrome.storage.session.get('status')).status || {}).state);
  const waitStatus = (s) => sw.evaluate(async (want) => {
    for (let i = 0; i < 50; i++) {
      const { status } = await chrome.storage.session.get('status');
      if (status && status.state === want) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }, s);
  const call = (op, extra) => panel.evaluate(([o, x]) => chrome.runtime.sendMessage({ ns: 'ta', op: o, ...x }), [op, extra || {}]);
  const todayLog = () => panel.evaluate(async () => {
    const k = `log:${window.TA.log.dayKey(Date.now())}`;
    return (await chrome.storage.local.get(k))[k] || [];
  });
  const settings = () => panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  const tiles = (sel) => panel.$$eval(`${sel} .tile b`, (els) => els.map((e) => e.textContent));
  const editor = async (name) => panel.locator(`.proj-edit[data-pid="${(await settings()).projects.find((p) => p.name === name).id}"]`);

  await step('見ているページを自動で記録する（通知件数は除き、ページごとに区切る）', async () => {
    await panel.evaluate(() =>
      chrome.storage.local.set({
        settings: {
          projects: [
            { id: 'pa', name: 'A社リニューアル', color: 0, rules: 'title:A社' },
            { id: 'pb', name: 'B社LP', color: 1, rules: 'title:【B社】' },
          ],
          exclude: 'title:個人',
        },
      }),
    );
    assert.ok(await waitStatus('recording'));
    await wait(1500);
    await page.goto(`${env.origin}/a-top.html`);
    await wait(2300);
    await page.goto(`${env.origin}/spec.html`);
    await wait(2300);
    assert.equal(await call('checkpoint').then((r) => r.ok), true);
    const log = await todayLog();
    const byTitle = (t) => log.filter((x) => x.title === t).reduce((a, x) => a + (x.e - x.s), 0);
    assert.ok(byTitle('今日のニュース') > 0, '「(3) 」は記録しない');
    assert.ok(byTitle('A社 コーポレートサイト（テストアップ）') >= 2000);
    assert.ok(byTitle('【B社】LP 要件定義書') >= 2000);
    assert.ok(log.every((x) => x.host === new URL(env.origin).host));
  });

  await step('ツールバーのバッジに、いまの案件の今日の時間を出す', async () => {
    const badge = await sw.evaluate(async () => ({ text: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}) }));
    assert.match(badge.text, /^\d+:\d\d$/);
    assert.match(badge.title, /B社LP（今日/);
  });

  await step('記録しないサイト・一時停止では記録しない', async () => {
    await page.goto(`${env.origin}/private.html`);
    assert.ok(await waitStatus('excluded'));
    await wait(1500);
    await call('checkpoint');
    assert.ok(!(await todayLog()).some((x) => x.title.includes('個人')));
    await panel.click('#pauseBtn');
    assert.ok(await waitStatus('paused'));
    assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '停止');
    await panel.waitForFunction(() => document.getElementById('statusTitle').textContent === '一時停止中');
    await page.goto(`${env.origin}/a-top.html`);
    await wait(1500);
    assert.equal(await status(), 'paused');
    await panel.click('#pauseBtn');
    assert.ok(await waitStatus('recording'));
    await panel.waitForFunction(() => document.getElementById('statusTitle').textContent === '記録中：A社リニューアル');
    await shot(panel, 'ta-panel-today.png', { fullPage: true });
  });

  // ---------------------------------------------------------------- 昨日の記録を用意して、画面を確かめる
  const Y = await panel.evaluate(() => window.TA.log.addDays(window.TA.log.dayKey(Date.now()), -1));
  await panel.evaluate((y) => {
    const L = window.TA.log;
    const at = (hm) => L.dayStart(y) + (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))) * 60000;
    const segs = [
      { s: at('09:00'), e: at('09:50'), host: 'stg.a-sha.example', path: '/', title: 'A社 トップページ（テスト環境）' },
      { s: at('10:00'), e: at('10:30'), host: 'docs.google.com', path: '/document/d/DOC1/edit', title: '議事録 - Google ドキュメント' },
      { s: at('10:30'), e: at('11:30'), host: 'b-lp.example', path: '/lp/', title: '【B社】LP デザイン確認' },
      { s: at('11:30'), e: at('11:50'), host: 'news.example.jp', path: '/', title: 'ニュース' },
      { s: at('13:00'), e: at('14:00'), host: 'meet.google.com', path: '/abc-defg-hij', title: 'Meet - abc-defg-hij' },
    ];
    return chrome.storage.local.get('days').then(({ days = [] }) => chrome.storage.local.set({ [`log:${y}`]: segs, days: [...new Set([...days, y])].sort() }));
  }, Y);

  await step('前の日へ移動：合計・プロジェクト別・未分類が出る', async () => {
    await panel.click('#prevDay');
    await panel.waitForFunction((label) => document.getElementById('dayLabel').textContent === label, await panel.evaluate((y) => window.TA.report.dateLabel(y), Y));
    assert.ok(await panel.isHidden('#status'), '今日以外は記録の状態を出さない');
    assert.deepEqual(await tiles('#dayTiles'), ['3:40', '1:50', '1:50']);
    assert.deepEqual(await panel.$$eval('#projList .proj-name', (els) => els.map((e) => e.textContent)), ['B社LP', 'A社リニューアル', '未分類']);
    const un = await panel.$$eval('#unList .un-row .un-label', (els) => els.map((e) => e.textContent));
    assert.deepEqual(un, ['meet.google.com', '議事録 - Google ドキュメント', 'news.example.jp']);
    assert.equal(await panel.locator('#timeline svg .tl-run').count(), 5);
    await panel.locator('#projList .proj-row', { hasText: 'B社LP' }).click();
    assert.match(await panel.textContent('#projList .proj-pages'), /【B社】LP デザイン確認/);
  });

  const openAssign = async (label) => {
    await panel.locator('#unList .un-row', { hasText: label }).getByRole('button', { name: '振り分ける' }).click();
    await panel.waitForSelector('#unList .assign');
  };

  await step('未分類のページを振り分ける → ルールが追加され、ほかの日にも反映', async () => {
    await openAssign('議事録');
    assert.equal(await panel.inputValue('#unList .assign input.mono'), 'docs.google.com/*/d/DOC1');
    await shot(panel, 'ta-panel-assign.png', { fullPage: true });
    await panel.locator('#unList .assign .chip', { hasText: 'A社リニューアル' }).click();
    await panel.waitForFunction(() => [...document.querySelectorAll('#dayTiles .tile b')].map((e) => e.textContent).join() === '3:40,2:20,1:20');
    assert.match((await settings()).projects[0].rules, /docs\.google\.com\/\*\/d\/DOC1/);
  });

  await step('新しいプロジェクトを作って振り分ける・記録しないサイトにする', async () => {
    await openAssign('meet.google.com');
    await panel.fill('#unList .assign input[placeholder="新しいプロジェクト名"]', '社内MTG');
    await panel.click('#unList .assign >> text=作って振り分け');
    await panel.waitForFunction(() => [...document.querySelectorAll('#projList .proj-name')].some((e) => e.textContent === '社内MTG'));
    const st = await settings();
    assert.deepEqual(st.projects.map((p) => [p.name, p.color, p.rules]).pop(), ['社内MTG', 2, 'meet.google.com']);

    await openAssign('news.example.jp');
    await panel.click('#unList .assign >> text=記録しないサイトにする');
    await panel.waitForFunction(() => document.querySelector('#dayTiles .tile b').textContent === '3:20');
    assert.match((await settings()).exclude, /news\.example\.jp/);
    assert.ok(await panel.isHidden('#unCard'), '未分類がなくなった');
  });

  await step('記録の一覧から、まとめて振り分け直す', async () => {
    await panel.click('#toggleBlocks');
    const row = panel.locator('#blocks .block', { has: panel.locator('.block-proj', { hasText: 'B社LP' }) });
    assert.match(await row.textContent(), /10:30–11:30/);
    await row.locator('select').selectOption({ label: 'A社リニューアル' });
    await panel.waitForFunction(() => !document.querySelector('#blocks .block .block-proj') || ![...document.querySelectorAll('#projList .proj-name')].some((e) => e.textContent === 'B社LP'));
    assert.deepEqual(await panel.$$eval('#projList .proj-time', (els) => els.map((e) => e.textContent)), ['2:20', '1:00']);
  });

  await step('手入力で会議の時間を足す', async () => {
    await panel.click('#addManualBtn');
    await panel.fill('#mStart', '15:00');
    await panel.fill('#mEnd', '15:30');
    await panel.selectOption('#mProject', { label: 'A社リニューアル' });
    await panel.fill('#mMemo', '定例MTG');
    await panel.click('#manualForm button[type="submit"]');
    await panel.waitForFunction(() => document.querySelector('#projList .proj-time').textContent === '2:50');
    assert.ok(await panel.isHidden('#manualForm'));
    const manual = panel.locator('#blocks .block', { has: panel.locator('.tag', { hasText: '手入力' }) });
    assert.match(await manual.textContent(), /15:00–15:30.*A社リニューアル.*0:30/);
    assert.match(await manual.textContent(), /手入力：定例MTG/);
    await shot(panel, 'ta-panel-day.png', { fullPage: true });
    await panel.emulateMedia({ colorScheme: 'dark' });
    await wait(400); // 色の切り替えアニメーションが終わってから撮る
    await shot(panel, 'ta-panel-day-dark.png', { fullPage: true });
    await panel.emulateMedia({ colorScheme: 'light' });
  });

  await step('日報：メモ・時間の表し方・丸め', async () => {
    await panel.click('#tab-report');
    assert.match(await panel.textContent('#rDayLabel'), /日（.）$/);
    const memo = panel.locator('#memoList li', { hasText: 'A社リニューアル' }).locator('textarea');
    await memo.fill('デザイン確認');
    await panel.click('#modeSeg [data-mode="h"]');
    await panel.selectOption('#unitSel', '15');
    const text = await panel.textContent('#reportText');
    const lines = text.split('\n');
    assert.match(lines[0], /の工数】合計 3\.75h$/);
    assert.deepEqual(lines.slice(1), ['■ A社リニューアル　2.75h', '　デザイン確認', '■ 社内MTG　1.00h']);
    await panel.check('#optDetails');
    assert.match(await panel.textContent('#reportText'), /　・【B社】LP デザイン確認（1:00）/);
    await until(panel, async (y) => ((await chrome.storage.local.get(`memo:${y}`))[`memo:${y}`] || {}).pa === 'デザイン確認', Y);
    await shot(panel, 'ta-panel-report.png', { fullPage: true });

  });

  await step('集計：日ごとの積み上げグラフ・表・CSV', async () => {
    await panel.click('#tab-period');
    const preset = await panel.evaluate((y) => {
      const t = window.TA.log.dayKey(Date.now());
      return window.TA.report.periodRange('thisWeek', t).keys.includes(y) ? 'thisWeek' : 'lastWeek';
    }, Y);
    await panel.click(`#periodSeg [data-period="${preset}"]`);
    await panel.waitForFunction(() => document.querySelectorAll('#periodChart .stack').length === 7);
    const legend = await panel.textContent('#periodLegend');
    assert.match(legend, /A社リニューアル/);
    assert.match(legend, /社内MTG/);
    const box = await panel.locator('#periodChart .day-hit').nth(await panel.evaluate((y) => (new Date(...y.split('-').map((v, i) => (i === 1 ? v - 1 : +v))).getDay() + 6) % 7, Y)).boundingBox();
    await panel.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await panel.waitForSelector('#tip:not([hidden])');
    assert.match(await panel.textContent('#tip'), /合計 3:50/);
    assert.match(await panel.textContent('#tip'), /2:50\s*A社リニューアル/);
    await shot(panel, 'ta-panel-period.png', { fullPage: true });
    await panel.emulateMedia({ colorScheme: 'dark' });
    await wait(400); // 色の切り替えアニメーションが終わってから撮る
    await shot(panel, 'ta-panel-period-dark.png', { fullPage: true });
    await panel.emulateMedia({ colorScheme: 'light' });
    await panel.mouse.move(5, 5);
    await panel.click('#periodTableBtn');
    assert.ok(await panel.isVisible('#periodTable table'));
    assert.match(await panel.textContent('#periodTable tbody'), /社内MTG/);

    const [dl] = await Promise.all([panel.waitForEvent('download'), panel.click('#csvSummaryBtn')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(csv.startsWith('﻿日付,曜日,プロジェクト,時間,時間（h）,分,メモ'));
    assert.ok(csv.includes(`${Y},`) && csv.includes(',A社リニューアル,2:50,2.83,170,デザイン確認'), csv);
    const [dl2] = await Promise.all([panel.waitForEvent('download'), panel.click('#csvDetailBtn')]);
    const detail = fs.readFileSync(await dl2.path(), 'utf8');
    assert.match(detail, /15:00,15:30,30\.0,A社リニューアル,手入力,,,,定例MTG/);
    assert.match(dl2.suggestedFilename(), /^工数_明細_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  await step('設定：プロジェクトの編集・ルールの確認・共有用の書き出しと読み込み', async () => {
    await panel.click('#tab-settings');
    assert.equal(await panel.locator('.proj-edit').count(), 3);
    const b = await editor('B社LP');
    await b.locator('textarea').fill('title:【B社】\nb lp.example');
    assert.match(await b.locator('.rule-note').textContent(), /読み取れない行があります：b lp\.example/);
    await b.locator('textarea').fill('title:【B社】\nb-lp.example');
    assert.equal(await b.locator('.rule-note').textContent(), 'ルール 2件');
    await b.locator('.color-btn').click();
    await b.locator('.swatch[aria-label="紫"]').click();
    await until(panel, async () => (await chrome.storage.local.get('settings')).settings.projects[1].color === 6);
    await shot(panel, 'ta-panel-settings.png', { fullPage: true });

    const [dl] = await Promise.all([panel.waitForEvent('download'), panel.click('#exportSettings')]);
    const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(data.type, 'time-autolog-settings');
    assert.deepEqual(data.projects.map((p) => p.name), ['A社リニューアル', 'B社LP', '社内MTG']);
    data.projects.push({ id: 'pc', name: 'C社', color: 3, rules: 'c-sha.jp' });
    data.projects[0].rules += '\ntitle:A社様';
    await panel.setInputFiles('#importFile', { name: 'shared.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await panel.waitForFunction(() => document.querySelectorAll('.proj-edit').length === 4);
    assert.match((await settings()).projects[0].rules, /title:A社様$/);
    await panel.setInputFiles('#importFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await panel.waitForFunction(() => document.getElementById('snackbar').textContent.includes('設定ファイルではありません'));
  });

  await step('プロジェクトを削除すると、その時間は未分類に戻る', async () => {
    const mtg = await editor('社内MTG');
    await mtg.locator('text=削除').click();
    await mtg.locator('text=もう一度押すと削除').click();
    await panel.waitForFunction(() => document.querySelectorAll('.proj-edit').length === 3);
    await panel.click('#tab-day');
    await panel.waitForFunction(() => [...document.querySelectorAll('#dayTiles .tile b')].map((e) => e.textContent).join() === '3:50,2:50,1:00');
  });

  await step('記録をすべて削除（設定は残る）', async () => {
    await panel.click('#tab-settings');
    await panel.click('#clearAll');
    await panel.click('#clearAll');
    await until(panel, async () => !(await chrome.storage.local.get('days')).days);
    assert.equal((await settings()).projects.length, 3);
    await panel.click('#tab-day');
    await panel.waitForFunction(() => !document.getElementById('dayEmpty').hidden);
  });
} finally {
  await env.close();
  finish();
}
