/*
 * 参考サイト・コラージュ：ワイヤーフレームの描画と構成案の書き出し
 *
 * section = {
 *   id, kind, memo, source: { url, title, host },
 *   size: { w, h },                     元のセクションの大きさ（px）
 *   nodes: [{ type, x, y, w, h, level?, lines?, label? }],   セクション内の位置（px）
 *   stats: { headings, texts, images, buttons, inputs, icons, columns }
 * }
 * type: heading / text / button / image / video / map / input / icon
 */
(function (root) {
  'use strict';
  const RC = (root.RC = root.RC || {});

  const KINDS = {
    header: 'ヘッダー',
    hero: 'ファーストビュー',
    features: '特徴・サービス',
    pricing: '料金・プラン',
    faq: 'よくある質問',
    form: 'お問い合わせフォーム',
    testimonials: 'お客様の声・事例',
    news: 'お知らせ',
    steps: '流れ・ステップ',
    stats: '実績の数字',
    logos: '取引先・ロゴ',
    gallery: 'ギャラリー',
    cta: 'CTA（申し込み導線）',
    footer: 'フッター',
    content: 'コンテンツ',
  };

  const TYPE_LABELS = { box: 'カード', heading: '見出し', text: '文章', button: 'ボタン', image: '画像', video: '動画', map: '地図', input: '入力欄', icon: 'アイコン' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = (n) => Math.round(n * 10) / 10;

  const COLORS = {
    frame: '#d6dae3',
    bg: '#ffffff',
    image: '#e6e9ef',
    imageLine: '#c7cdd8',
    heading: '#3f4656',
    text: '#c9ced8',
    button: '#3f4656',
    input: '#9aa2b4',
    icon: '#b9c0cd',
    label: '#ffffff',
  };

  /** 1つのセクションを SVG の要素文字列（<g>）にする */
  function sectionMarkup(sec, opts) {
    const o = Object.assign({ width: 960, x: 0, y: 0, labels: true, text: false }, opts);
    const scale = o.width / Math.max(1, sec.size.w);
    const H = Math.max(40, sec.size.h * scale);
    const out = [];
    out.push(`<g transform="translate(${r1(o.x)} ${r1(o.y)})">`);
    out.push(`<rect x="0" y="0" width="${r1(o.width)}" height="${r1(H)}" fill="${COLORS.bg}" stroke="${COLORS.frame}" stroke-width="1"/>`);
    const fontFamily = 'system-ui, -apple-system, Hiragino Sans, Noto Sans JP, sans-serif';
    for (const n of sec.nodes || []) {
      const x = n.x * scale;
      const y = n.y * scale;
      const w = Math.max(2, n.w * scale);
      const h = Math.max(2, n.h * scale);
      if (x > o.width || y > H) continue;
      const fs = Math.max(7, Math.min(14, h * 0.45));
      if (n.type === 'box') {
        out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(Math.min(8, w / 10))}" fill="#f7f8fb" stroke="${COLORS.frame}" stroke-width="1"/>`);
      } else if (n.type === 'image' || n.type === 'video' || n.type === 'map') {
        out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${COLORS.image}" stroke="${COLORS.imageLine}" stroke-width="1"/>`);
        out.push(`<path d="M${r1(x)} ${r1(y)}L${r1(x + w)} ${r1(y + h)}M${r1(x + w)} ${r1(y)}L${r1(x)} ${r1(y + h)}" stroke="${COLORS.imageLine}" stroke-width="1"/>`);
        if (o.labels && w > 40 && h > 20) {
          const mark = n.type === 'video' ? '▶ 動画' : n.type === 'map' ? '地図' : '画像';
          out.push(`<text x="${r1(x + w / 2)}" y="${r1(y + h / 2)}" font-size="${r1(Math.min(12, fs))}" fill="#8a93a6" text-anchor="middle" dominant-baseline="middle" font-family="${fontFamily}">${mark}</text>`);
        }
      } else if (n.type === 'heading') {
        const bar = Math.max(4, Math.min(h, h * 0.8));
        out.push(`<rect x="${r1(x)}" y="${r1(y + (h - bar) / 2)}" width="${r1(w)}" height="${r1(bar)}" rx="${r1(Math.min(3, bar / 4))}" fill="${COLORS.heading}"/>`);
        if (o.labels && w > 30 && bar > 9) {
          out.push(`<text x="${r1(x + 6)}" y="${r1(y + h / 2)}" font-size="${r1(Math.min(13, bar * 0.6))}" fill="${COLORS.label}" dominant-baseline="middle" font-family="${fontFamily}">${esc(o.text && n.text ? n.text : `見出し${n.level ? ` H${n.level}` : ''}`)}</text>`);
        }
      } else if (n.type === 'text') {
        const lines = Math.max(1, Math.min(12, n.lines || Math.round(h / 22) || 1));
        const step = h / lines;
        const bar = Math.max(2, Math.min(8, step * 0.38));
        for (let i = 0; i < lines; i++) {
          const lw = i === lines - 1 && lines > 1 ? w * 0.62 : w;
          out.push(`<rect x="${r1(x)}" y="${r1(y + step * i + (step - bar) / 2)}" width="${r1(lw)}" height="${r1(bar)}" rx="${r1(bar / 2)}" fill="${COLORS.text}"/>`);
        }
      } else if (n.type === 'button') {
        out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(Math.min(h / 2, 8))}" fill="none" stroke="${COLORS.button}" stroke-width="1.5"/>`);
        if (o.labels && w > 24 && h > 10) {
          out.push(`<text x="${r1(x + w / 2)}" y="${r1(y + h / 2)}" font-size="${r1(Math.min(12, fs))}" fill="${COLORS.button}" text-anchor="middle" dominant-baseline="middle" font-family="${fontFamily}">${esc(o.text && n.text ? n.text : 'ボタン')}</text>`);
        }
      } else if (n.type === 'input') {
        out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="3" fill="#fff" stroke="${COLORS.input}" stroke-width="1"/>`);
        if (o.labels && w > 40 && h > 10) out.push(`<text x="${r1(x + 6)}" y="${r1(y + h / 2)}" font-size="${r1(Math.min(11, fs))}" fill="#9aa2b4" dominant-baseline="middle" font-family="${fontFamily}">${esc(n.label || '入力欄')}</text>`);
      } else if (n.type === 'icon') {
        const r = Math.max(2, Math.min(w, h) / 2);
        out.push(`<circle cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" r="${r1(r)}" fill="${COLORS.icon}"/>`);
      }
    }
    out.push('</g>');
    return { markup: out.join(''), height: H };
  }

  /** 1つのセクションだけの SVG */
  function toSvg(sec, opts) {
    const o = Object.assign({ width: 960, labels: true, text: false }, opts);
    const { markup, height } = sectionMarkup(sec, { width: o.width, labels: o.labels, text: o.text });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(o.width)}" height="${r1(height)}" viewBox="0 0 ${r1(o.width)} ${r1(height)}">${markup}</svg>`;
  }

  /** ボード全体（縦に積んだワイヤーフレーム）の SVG。Figma にドラッグ＆ドロップで読み込めます */
  function boardSvg(sections, opts) {
    const o = Object.assign({ width: 1200, gap: 56, labels: true, text: false, title: '構成案' }, opts);
    const pad = 40;
    const parts = [];
    let y = pad;
    const fontFamily = 'system-ui, -apple-system, Hiragino Sans, Noto Sans JP, sans-serif';
    parts.push(`<text x="${pad}" y="${y}" font-size="22" font-weight="700" fill="#191c28" font-family="${fontFamily}">${esc(o.title)}</text>`);
    y += 28;
    sections.forEach((sec, i) => {
      y += 18;
      const label = `${String(i + 1).padStart(2, '0')}  ${KINDS[sec.kind] || sec.kind}`;
      parts.push(`<text x="${pad}" y="${y}" font-size="14" font-weight="700" fill="#191c28" font-family="${fontFamily}">${esc(label)}</text>`);
      if (sec.source && sec.source.host) parts.push(`<text x="${pad + o.width}" y="${y}" font-size="11" fill="#8a93a6" text-anchor="end" font-family="${fontFamily}">参考：${esc(sec.source.host)}</text>`);
      y += 10;
      const { markup, height } = sectionMarkup(sec, { width: o.width, x: pad, y, labels: o.labels, text: o.text });
      parts.push(markup);
      y += height;
      if (sec.memo) {
        y += 20;
        for (const line of String(sec.memo).split(/\r?\n/).slice(0, 6)) {
          parts.push(`<text x="${pad}" y="${y}" font-size="12" fill="#4b5263" font-family="${fontFamily}">${esc(line)}</text>`);
          y += 18;
        }
      }
      y += o.gap - 18;
    });
    const W = o.width + pad * 2;
    const H = y + pad;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${r1(H)}" viewBox="0 0 ${W} ${r1(H)}"><rect width="100%" height="100%" fill="#f4f5fa"/>${parts.join('')}</svg>`;
  }

  function describe(sec) {
    const s = sec.stats || {};
    const parts = [];
    if (s.headings) parts.push(`見出し${s.headings}`);
    if (s.texts) parts.push(`文章${s.texts}`);
    if (s.images) parts.push(`画像${s.images}`);
    if (s.icons) parts.push(`アイコン${s.icons}`);
    if (s.buttons) parts.push(`ボタン${s.buttons}`);
    if (s.inputs) parts.push(`入力欄${s.inputs}`);
    if (s.columns && s.columns > 1) parts.push(`${s.columns}列`);
    return parts.join('・');
  }

  /** 構成案（Markdown） */
  function toMarkdown(sections, opts) {
    const o = Object.assign({ title: '構成案' }, opts);
    const out = [`# ${o.title}`, ''];
    sections.forEach((sec, i) => {
      out.push(`${i + 1}. **${KINDS[sec.kind] || sec.kind}**`);
      const d = describe(sec);
      if (d) out.push(`   - 要素：${d}`);
      if (sec.source && sec.source.url) out.push(`   - 参考：${sec.source.title ? `${sec.source.title} ` : ''}${sec.source.url}`);
      if (sec.memo) for (const line of String(sec.memo).split(/\r?\n/)) if (line.trim()) out.push(`   - メモ：${line.trim()}`);
    });
    return out.join('\n');
  }

  RC.wire = { KINDS, TYPE_LABELS, COLORS, sectionMarkup, toSvg, boardSvg, toMarkdown, describe };
  if (typeof module === 'object' && module.exports) module.exports = RC.wire;
})(typeof globalThis !== 'undefined' ? globalThis : this);
