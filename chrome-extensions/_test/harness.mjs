// E2Eテストの共通ハーネス：拡張機能を読み込んだ Chromium と、テスト用のWebサーバーを起動する
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}

/**
 * @param {object} opts
 * @param {string} opts.ext 拡張機能のフォルダ
 * @param {(req, res, url: URL) => boolean} [opts.route] true を返したら処理済み
 * @param {string} [opts.fixtures] 静的ファイルのフォルダ（/fixtures/ 以下で配信）
 */
export async function launch(opts) {
  const { chromium } = loadPlaywright();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (opts.route && opts.route(req, res, url)) return;
    if (opts.fixtures) {
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(opts.fixtures, p);
      if (file.startsWith(opts.fixtures) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const type = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(file)] || 'application/octet-stream';
        res.writeHead(200, { 'content-type': type });
        res.end(fs.readFileSync(file));
        return;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdt-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${opts.ext}`, `--load-extension=${opts.ext}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  async function tabIdOf(panelLike, url) {
    return panelLike.evaluate(async (u) => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => x.url === u) || tabs.find((x) => x.url && x.url.startsWith(u));
      return t ? t.id : null;
    }, url);
  }

  /** ページを開き、そのタブを対象にしたサイドパネル（通常タブとして）を開く */
  async function openWithPanel(pageUrl, panelPath = 'sidepanel/sidepanel.html', size = { width: 380, height: 1100 }) {
    const page = await context.newPage();
    await page.goto(pageUrl);
    const panel = await context.newPage();
    await panel.setViewportSize(size);
    await panel.goto(`chrome-extension://${extId}/${panelPath}`);
    const tabId = await tabIdOf(panel, page.url());
    await panel.goto(`chrome-extension://${extId}/${panelPath}?tabId=${tabId}`);
    return { page, panel, tabId };
  }

  async function close() {
    await context.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  return { context, server, origin, extId, sw, openWithPanel, tabIdOf, close };
}

/** テストの手順を記録する。TUC_SHOTS / WDT_SHOTS にフォルダを指定するとスクリーンショットを保存 */
export function runner() {
  let failures = 0;
  const shotsDir = process.env.WDT_SHOTS || process.env.TUC_SHOTS || null;
  async function step(name, fn) {
    try {
      await fn();
      console.log(`✔ ${name}`);
    } catch (e) {
      failures++;
      console.log(`✘ ${name}\n  ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 8).join('\n  ')}`);
    }
  }
  async function shot(target, name, opts) {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    await target.screenshot({ path: path.join(shotsDir, name), ...opts });
  }
  function finish() {
    if (failures) {
      console.log(`\n${failures}件失敗しました`);
      process.exitCode = 1;
    } else console.log('\nすべて成功しました');
  }
  return { step, shot, finish, shotsDir };
}
