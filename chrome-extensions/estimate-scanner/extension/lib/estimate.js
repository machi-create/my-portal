/*
 * 見積もり逆算スキャナー：ページの分類・テンプレートの推定・見積もりの計算
 */
(function (root) {
  'use strict';
  const ES = (root.ES = root.ES || {});

  /** 仮の単価（円）。設定画面で自社の単価に置き換えて使う */
  const DEFAULT_PRICES = {
    ia: 30000,
    designTop: 150000,
    designTemplate: 60000,
    codingTop: 100000,
    codingTemplate: 40000,
    codingPage: 10000,
    cmsBase: 150000,
    cmsCollection: 80000,
    form: 50000,
    animation: 30000,
    embed: 10000,
    search: 50000,
    langRate: 30,
    directionRate: 15,
    rangeRate: 20,
  };

  const PRICE_LABELS = {
    ia: ['情報設計・ワイヤーフレーム', '1テンプレートあたり'],
    designTop: ['デザイン（トップページ）', '1式'],
    designTemplate: ['デザイン（下層テンプレート）', '1種あたり'],
    codingTop: ['コーディング（トップページ）', '1式'],
    codingTemplate: ['コーディング（下層テンプレート）', '1種あたり'],
    codingPage: ['コーディング（量産ページ）', '1ページあたり'],
    cmsBase: ['CMS構築（基本設定）', '1式'],
    cmsCollection: ['CMS構築（一覧・詳細）', '1種あたり'],
    form: ['フォーム', '1つあたり'],
    animation: ['アニメーション・動き', '1種類あたり'],
    embed: ['地図・動画の埋め込み', '1種類あたり'],
    search: ['サイト内検索', '1式'],
    langRate: ['多言語対応', 'デザイン＋コーディングの％（1言語あたり）'],
    directionRate: ['ディレクション', '小計の％'],
    rangeRate: ['見積もりの幅', '±％'],
  };

  const PAGINATION_RE = /^(?:page|p|paged)$/i;
  const DYNAMIC_SEG_RE = /^(?:\d+|\d{4}-\d{2}(?:-\d{2})?|[0-9a-f]{8,}|[\w-]*\d[\w-]*)$/i;

  function normalizePath(u) {
    try {
      const url = new URL(u);
      let p = decodeURIComponent(url.pathname).replace(/\/index\.(?:html?|php)$/i, '/');
      if (!p.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(p)) p += '/';
      return p;
    } catch (e) {
      return null;
    }
  }

  /**
   * URLの一覧を「一覧＋詳細（CMSで更新しそうなもの）」と「固定ページ」に分ける
   * @returns {{ total, top, collections: [{path, count, label}], pages: [{path, count}], files }}
   */
  function groupUrls(urls) {
    const paths = new Set();
    let files = 0;
    for (const u of urls) {
      const p = normalizePath(u);
      if (!p) continue;
      if (/\.(?:pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)$/i.test(p)) {
        files++;
        continue;
      }
      paths.add(p);
    }
    const tree = new Map(); // 第1階層 → そのパスたち
    let top = 0;
    for (const p of paths) {
      const segs = p.split('/').filter(Boolean);
      if (!segs.length) {
        top = 1;
        continue;
      }
      // ページ送り（/news/page/2/）は数えない
      if (segs.some((s, i) => i > 0 && PAGINATION_RE.test(s) && /^\d+$/.test(segs[i + 1] || ''))) continue;
      const key = segs[0];
      if (!tree.has(key)) tree.set(key, []);
      tree.get(key).push(segs);
    }
    const collections = [];
    const pages = [];
    for (const [key, list] of tree) {
      const deeper = list.filter((s) => s.length >= 2);
      const dynamic = deeper.filter((s) => s.slice(1).some((x) => DYNAMIC_SEG_RE.test(x)));
      const isCollection = deeper.length >= 10 || (deeper.length >= 5 && dynamic.length >= deeper.length * 0.5);
      if (isCollection) collections.push({ path: `/${key}/`, count: list.length, label: collectionLabel(key) });
      else pages.push({ path: `/${key}/`, count: list.length });
    }
    collections.sort((a, b) => b.count - a.count);
    pages.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
    const t = top || (paths.size ? 1 : 0);
    const total = t + [...collections, ...pages].reduce((sum, g) => sum + g.count, 0);
    return { total, top: t, collections, pages, files };
  }

  function collectionLabel(seg) {
    const s = seg.toLowerCase();
    if (/news|info|topics|notice|oshirase|press/.test(s)) return 'お知らせ';
    if (/blog|column|journal|magazine|media|article|post/.test(s)) return 'ブログ・コラム';
    if (/works|case|portfolio|project|jisseki|example/.test(s)) return '実績・事例';
    if (/product|item|shop|goods|catalog/.test(s)) return '商品';
    if (/recruit|career|job|saiyo/.test(s)) return '採用・求人';
    if (/event|seminar/.test(s)) return 'イベント・セミナー';
    if (/staff|member|people|interview/.test(s)) return 'スタッフ・インタビュー';
    if (/faq|qa|question/.test(s)) return 'よくある質問';
    if (/voice|review|testimonial/.test(s)) return 'お客様の声';
    if (/tag|category|archive/.test(s)) return 'アーカイブ';
    return '一覧・詳細';
  }

  /** テンプレートの数を推定する */
  function templates(groups) {
    const collections = groups.collections.length;
    // 固定ページは、第1階層ごとに1種（子ページが4つ以上あれば親と子で2種）。多すぎる場合は上限
    let staticTemplates = 0;
    for (const g of groups.pages) staticTemplates += g.count >= 4 ? 2 : 1;
    staticTemplates = Math.min(staticTemplates, 12);
    const staticPages = groups.pages.reduce((s, g) => s + g.count, 0);
    const extraPages = Math.max(0, staticPages - staticTemplates);
    return {
      top: groups.top ? 1 : 0,
      collections,
      staticTemplates,
      lower: collections * 2 + staticTemplates,
      total: (groups.top ? 1 : 0) + collections * 2 + staticTemplates,
      staticPages,
      extraPages,
    };
  }

  const yen = (n) => Math.round(n);

  /**
   * 見積もりを組み立てる
   * @param {object} a 解析結果 { pages: { groups, templates, total, source }, tech, features }
   * @param {object} prices 単価
   * @param {object} overrides 行ごとの { qty, enabled }
   */
  function build(a, prices, overrides) {
    const P = Object.assign({}, DEFAULT_PRICES, prices);
    const O = overrides || {};
    const t = a.pages.templates;
    const f = a.features || {};
    const cms = (a.tech || []).some((x) => /WordPress|Movable Type|a-blog|HubSpot|Shopify|EC-CUBE|STUDIO|Wix|Webflow/.test(x));
    const lines = [];
    const add = (id, label, qty, unit, unitLabel, basis, opts) => {
      const o = O[id] || {};
      const q = o.qty != null ? Number(o.qty) : qty;
      const enabled = o.enabled != null ? o.enabled : !(opts && opts.optional) && q > 0;
      lines.push({ id, label, qty: q, unit, unitLabel, amount: enabled ? yen(q * unit) : 0, enabled, basis, quote: !!(opts && opts.quote) });
    };

    const lower = t.lower;
    add('ia', '情報設計・ワイヤーフレーム', t.total, P.ia, '種', `テンプレート ${t.total}種（トップ1＋下層${lower}）`);
    add('designTop', 'デザイン（トップページ）', t.top, P.designTop, '式', 'トップページ');
    add('designTemplate', 'デザイン（下層テンプレート）', lower, P.designTemplate, '種', templateBasis(a, t));
    add('codingTop', 'コーディング（トップページ）', t.top, P.codingTop, '式', 'トップページ');
    add('codingTemplate', 'コーディング（下層テンプレート）', lower, P.codingTemplate, '種', templateBasis(a, t));
    add('codingPage', 'コーディング（量産ページ）', t.extraPages, P.codingPage, 'ページ', `固定ページ ${t.staticPages}ページのうち、テンプレート以外`);
    const needCms = t.collections > 0 || cms;
    add('cmsBase', 'CMS構築（基本設定）', needCms ? 1 : 0, P.cmsBase, '式', needCms ? (cms ? `現行サイトは ${a.tech.filter((x) => /WordPress|Movable Type|a-blog|HubSpot|Shopify|EC-CUBE|STUDIO|Wix|Webflow/.test(x)).join('・')}` : '更新が必要な一覧ページあり') : 'CMS不要と推定');
    add('cmsCollection', 'CMS構築（一覧・詳細）', t.collections, P.cmsCollection, '種', a.pages.groups.collections.map((c) => `${c.label}（${c.path} ${c.count}件）`).join('、') || '—');
    const forms = (f.forms || []).length;
    add('form', 'フォーム', forms, P.form, '件', forms ? (f.forms || []).map((x) => `入力${x.fields}項目${x.upload ? '・添付あり' : ''}`).join('、') : 'フォームは見つかりませんでした');
    const anims = f.animations || [];
    add('animation', 'アニメーション・動き', anims.length, P.animation, '種類', anims.map((k) => ES.detect.ANIMATION_LABELS[k]).join('、') || '—');
    const embeds = [f.map && '地図', f.video && '動画'].filter(Boolean);
    add('embed', '地図・動画の埋め込み', embeds.length, P.embed, '種類', embeds.join('・') || '—');
    add('search', 'サイト内検索', f.search ? 1 : 0, P.search, '式', f.search ? '検索ボックスあり' : '—');

    const designCoding = lines.filter((l) => /^(?:design|coding)/.test(l.id) && l.enabled).reduce((s, l) => s + l.amount, 0);
    const langs = (f.langs || []).length;
    const extraLangs = Math.max(0, langs - 1);
    {
      const o = O.lang || {};
      const q = o.qty != null ? Number(o.qty) : extraLangs;
      const enabled = o.enabled != null ? o.enabled : q > 0;
      const unit = yen((designCoding * P.langRate) / 100);
      lines.push({ id: 'lang', label: '多言語対応', qty: q, unit, unitLabel: '言語', amount: enabled ? unit * q : 0, enabled, basis: langs > 1 ? `${f.langs.join('・')}（追加${extraLangs}言語）` : '日本語のみ', quote: false });
    }
    if (f.login) lines.push(quoteLine(O, 'member', '会員機能・ログイン', 'ログイン・マイページの導線あり'));
    if (f.cart) lines.push(quoteLine(O, 'ec', 'EC（カート・決済）', 'カートの導線あり'));
    if (f.chat) lines.push(quoteLine(O, 'chat', 'チャット・外部ツール連携', 'チャットツールの読み込みあり'));

    const subtotal = lines.reduce((s, l) => s + (l.enabled ? l.amount : 0), 0);
    const dir = O.direction || {};
    const directionEnabled = dir.enabled != null ? dir.enabled : true;
    const direction = directionEnabled ? yen((subtotal * P.directionRate) / 100) : 0;
    lines.push({ id: 'direction', label: 'ディレクション・進行管理', qty: P.directionRate, unit: null, unitLabel: '％', amount: direction, enabled: directionEnabled, basis: `小計の${P.directionRate}％`, quote: false });
    const total = subtotal + direction;
    const r = P.rangeRate / 100;
    const round10k = (n) => Math.round(n / 10000) * 10000;
    return { lines, subtotal, direction, total, low: round10k(total * (1 - r)), high: round10k(total * (1 + r)), quotes: lines.filter((l) => l.quote && l.enabled).map((l) => l.label) };
  }

  function quoteLine(O, id, label, basis) {
    const o = O[id] || {};
    return { id, label, qty: 1, unit: 0, unitLabel: '式', amount: 0, enabled: o.enabled != null ? o.enabled : true, basis: `${basis}（要個別見積もり）`, quote: true };
  }

  function templateBasis(a, t) {
    const parts = [];
    if (t.collections) parts.push(`一覧・詳細 ${t.collections}種×2`);
    if (t.staticTemplates) parts.push(`固定ページ ${t.staticTemplates}種`);
    return parts.join('＋') || '—';
  }

  const fmt = (n) => (n == null ? '' : `${Math.round(n).toLocaleString('ja-JP')}`);

  function toTsv(est) {
    const rows = [['項目', '数量', '単位', '単価', '金額', '根拠']];
    for (const l of est.lines) {
      if (!l.enabled) continue;
      if (l.id === 'direction') rows.push([l.label, '', '', '', l.amount, l.basis]);
      else rows.push([l.label, l.quote ? '' : l.qty, l.unitLabel, l.quote ? '要見積もり' : l.unit, l.quote ? '' : l.amount, l.basis]);
    }
    rows.push(['合計', '', '', '', est.total, `目安 ${fmt(est.low)}〜${fmt(est.high)}円`]);
    return rows.map((r) => r.map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
  }

  function toMarkdown(est, a) {
    const out = [`# 概算見積もり（たたき台）：${a.title || a.origin}`, '', `- 対象：${a.url}`, `- ページ数：約${a.pages.total}ページ（${a.pages.source === 'sitemap' ? 'sitemap.xml より' : 'ページ内のリンクより'}）`, `- テンプレート：約${a.pages.templates.total}種`];
    if (a.tech && a.tech.length) out.push(`- 現行サイトの技術：${a.tech.join('・')}`);
    out.push('', '| 項目 | 数量 | 単価 | 金額 | 根拠 |', '| --- | ---: | ---: | ---: | --- |');
    for (const l of est.lines) {
      if (!l.enabled) continue;
      if (l.id === 'direction') out.push(`| ${l.label} | ${l.qty}${l.unitLabel} | | ${fmt(l.amount)}円 | ${l.basis} |`);
      else if (l.quote) out.push(`| ${l.label} | 1式 | 要見積もり | — | ${l.basis} |`);
      else out.push(`| ${l.label} | ${l.qty}${l.unitLabel} | ${fmt(l.unit)}円 | ${fmt(l.amount)}円 | ${l.basis} |`);
    }
    out.push(`| **合計** | | | **${fmt(est.total)}円** | 目安 ${fmt(est.low)}〜${fmt(est.high)}円 |`);
    out.push('', '※ 公開サイトの構造から機械的に推定したたたき台です。原稿作成・撮影・保守運用・サーバー費用は含みません。');
    if (est.quotes.length) out.push(`※ ${est.quotes.join('・')} は別途お見積もりが必要です。`);
    return out.join('\n');
  }

  ES.estimate = { DEFAULT_PRICES, PRICE_LABELS, normalizePath, groupUrls, templates, build, toTsv, toMarkdown, fmt, collectionLabel };
  if (typeof module === 'object' && module.exports) module.exports = ES.estimate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
