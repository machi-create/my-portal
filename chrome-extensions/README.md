# Webディレクター向け Chrome拡張機能

Webディレクターの「確認・調整・提案・進行」を助ける拡張機能のシリーズです。必要なものだけインストールできるよう、道具ごとに分けています。

| 拡張機能 | できること | フォルダ |
| --- | --- | --- |
| テストアップチェッカー | 原稿とページの文言照合、公開前の消し忘れ（noindex・ダミー文言・テスト環境URLなど）チェック | [`testup-checker`](testup-checker/) |
| フィードバック翻訳機 | 「もっと目立たせて」などの曖昧な要望を、実際のCSS値から具体的な修正案に変換。プレビュー・修正依頼文・Issue起票 | [`feedback-translator`](feedback-translator/) |
| 合意ピン | 要素に「決まったこと・確認者・日付」をピン留め。経緯をホバーで確認、Markdown/CSV/JSONで共有 | [`agreement-pins`](agreement-pins/) |
| 参考サイト・コラージュ | 参考サイトのセクションをクリックでワイヤーフレーム化。集めて並べ替え、SVG（Figma）・PNG・構成案で書き出し | [`reference-collage`](reference-collage/) |
| 見積もり逆算スキャナー | 参考サイトのページ数・テンプレート・フォーム・多言語・動き・技術を読み取り、見積もりのたたき台を作成 | [`estimate-scanner`](estimate-scanner/) |
| LP抑揚グラフ | スクロール位置ごとの文字量・画像・ボタン・見出しをグラフ化。ボタンのない区間や文字が続く区間を見つけ、競合LPと比較 | [`lp-rhythm`](lp-rhythm/) |
| ペルソナ憑依モード | シニア・色覚・片手操作・弱視・低速回線・初めての人になりきって見え方を再現し、つまずく箇所を自動で探す | [`persona-mode`](persona-mode/) |
| 工数オートログ | 見ているサイトから案件ごとの作業時間を自動で記録。未分類はクリックで振り分け、日報の文面とCSVを作成 | [`time-autolog`](time-autolog/) |

## インストール（共通）

1. このリポジトリを GitHub の「Code → Download ZIP」でダウンロードして展開します
2. Chrome で `chrome://extensions` を開き、右上の **デベロッパーモード** をオンにします
3. **パッケージ化されていない拡張機能を読み込む** で、使いたい拡張機能の `extension` フォルダを選びます

## 開発者向け

```
chrome-extensions/
  _shared/        共通部品の正本（スタイル・ページ上での要素選択・サイドパネルの共通処理・AIなど）
    sync.mjs      共通部品を各拡張機能の extension/shared/ にコピーする
    make-icon.py  アイコンを作る
  _test/          E2Eテストの共通ハーネス（拡張機能を読み込んだ Chromium を起動）
  <拡張機能>/
    extension/    Chrome に読み込むフォルダ
    test/         単体テスト・E2Eテスト
```

```sh
node chrome-extensions/_shared/sync.mjs          # 共通部品を反映
node chrome-extensions/_shared/sync.mjs --check  # 反映漏れがないか確認
```
