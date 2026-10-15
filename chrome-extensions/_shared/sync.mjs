// 共通ファイルを各拡張機能の extension/shared/ にコピーする
//   node chrome-extensions/_shared/sync.mjs          … コピー
//   node chrome-extensions/_shared/sync.mjs --check  … 差分があれば失敗（テスト用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const FILES = ['base.css', 'ui.js', 'bridge.js', 'panel.js', 'background.js', 'page.js', 'picker.js', 'selector.js', 'ai.js', 'color.js'];
const check = process.argv.includes('--check');

const targets = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => path.join(root, d.name, 'extension', 'shared'))
  .filter((dir) => fs.existsSync(dir));

let stale = 0;
for (const dir of targets) {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(here, f));
    const dest = path.join(dir, f);
    const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(src);
    if (same) continue;
    if (check) {
      stale++;
      console.error(`古いままです: ${path.relative(root, dest)}`);
    } else {
      fs.writeFileSync(dest, src);
      console.log(`更新: ${path.relative(root, dest)}`);
    }
  }
}
if (check && stale) {
  console.error('node chrome-extensions/_shared/sync.mjs を実行してください');
  process.exit(1);
}
if (!check) console.log(`${targets.length}個の拡張機能に共通ファイルを反映しました`);
