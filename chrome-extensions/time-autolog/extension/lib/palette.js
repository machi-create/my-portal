/*
 * 工数オートログ：プロジェクトの色（データ可視化の検証済みパレット。色覚の違いがあっても隣り合う色を見分けられる順番）
 * 画面では sidepanel.css の --p0〜--p7（ライト・ダーク別）を使い、ここではツールバーのバッジ用の色を持つ
 */
(function (root) {
  'use strict';
  const TA = (root.TA = root.TA || {});
  const light = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const names = ['青', 'オレンジ', '青緑', '黄', 'ピンク', '緑', '紫', '赤'];
  // バッジの文字色：明るい色の上は黒
  const ink = ['#ffffff', '#000000', '#000000', '#000000', '#000000', '#ffffff', '#ffffff', '#ffffff'];

  /** まだ使われていない色の番号（全部使っていれば、少ない順） */
  function nextColor(projects) {
    const used = new Array(light.length).fill(0);
    for (const p of projects || []) used[(p.color || 0) % light.length]++;
    const min = Math.min(...used);
    return used.indexOf(min);
  }

  TA.palette = { light, names, ink, size: light.length, nextColor };
  if (typeof module === 'object' && module.exports) module.exports = TA.palette;
})(typeof globalThis !== 'undefined' ? globalThis : this);
