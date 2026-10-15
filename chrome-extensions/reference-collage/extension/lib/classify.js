/*
 * 参考サイト・コラージュ：セクションの種類を推定する
 *   RC.classify(features) → 'hero' | 'features' | 'pricing' | …（wire.js の KINDS）
 *
 * features = {
 *   tag, role, top, height, docHeight, viewportH, text,
 *   stats: { headings, texts, images, buttons, inputs, icons, links, details, bigNumbers, smallImages, columns, repeated },
 *   hasH1
 * }
 */
(function (root) {
  'use strict';
  const RC = (root.RC = root.RC || {});

  const count = (text, re) => (String(text || '').match(re) || []).length;

  const PRICE_RE = /[¥￥]\s?[\d,]{2,}|[\d,]{2,}\s?円|\$\s?\d+|\/\s?月|月額|年額|税込|税抜|プラン/g;
  const DATE_RE = /(?:19|20)\d{2}\s?[./年-]\s?\d{1,2}\s?[./月-]\s?\d{1,2}/g;

  function classify(f) {
    const s = f.stats || {};
    const text = f.text || '';
    const tag = String(f.tag || '').toLowerCase();
    const role = String(f.role || '').toLowerCase();
    const bottom = (f.top || 0) + (f.height || 0);

    if (tag === 'header' || role === 'banner' || ((f.top || 0) < 10 && f.height < 170 && (s.links || 0) >= 3)) return 'header';
    if (tag === 'footer' || role === 'contentinfo' || (f.docHeight && bottom >= f.docHeight - 4 && (s.links || 0) >= 5 && f.height < 700)) return 'footer';
    if ((s.inputs || 0) >= 2) return 'form';
    if ((s.details || 0) >= 2 || /よくある(?:ご)?質問|FAQ|Q\s?&\s?A|Ｑ＆Ａ/i.test(text) || count(text, /(?:^|\s)Q[.．:：]/g) >= 2) return 'faq';
    if (count(text, PRICE_RE) >= 3) return 'pricing';
    if (f.hasH1 || ((f.top || 0) < 260 && f.height >= 300 && (s.headings || 0) >= 1 && ((s.images || 0) >= 1 || (s.buttons || 0) >= 1))) return 'hero';
    if (count(text, DATE_RE) >= 2) return 'news';
    if (/お客様の声|お客さまの声|導入事例|事例紹介|レビュー|口コミ|VOICE|testimonial|利用者の声/i.test(text)) return 'testimonials';
    if (/STEP\s?\d|ステップ|ご利用の流れ|導入の流れ|ご依頼の流れ|フロー|制作の流れ/i.test(text) && (s.repeated || 0) >= 3) return 'steps';
    if ((s.bigNumbers || 0) >= 3) return 'stats';
    if ((s.smallImages || 0) >= 4 && (s.texts || 0) <= 2 && (s.headings || 0) <= 2) return 'logos';
    if ((s.images || 0) >= 4 && (s.texts || 0) <= (s.images || 0) / 2) return 'gallery';
    if ((s.repeated || 0) >= 3 || (s.columns || 0) >= 3) return 'features';
    if ((s.buttons || 0) >= 1 && f.height < 460 && (s.texts || 0) <= 3 && (s.headings || 0) >= 1) return 'cta';
    return 'content';
  }

  RC.classify = classify;
  if (typeof module === 'object' && module.exports) module.exports = classify;
})(typeof globalThis !== 'undefined' ? globalThis : this);
