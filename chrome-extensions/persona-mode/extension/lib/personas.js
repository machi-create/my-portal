/*
 * ペルソナ憑依モード：ペルソナの定義と、計測結果 →「つまずき」「実況」への変換
 *
 * raw（ページ側の計測結果）= {
 *   viewport: { w, h },
 *   texts:   [{ refId, text, size, weight, contrast }]     見えている文字の要素
 *   targets: [{ refId, label, w, h, inline }]              押せる要素（inline は文中のリンク）
 *   colorLinks: [{ refId, text, ratio }]                   下線がなく、周りの文字との色の差が小さいリンク
 *   vague:   [{ refId, text }]                             「こちら」などの曖昧なリンク
 *   unnamed: [{ refId, text }]                             名前のないボタン
 *   fixed:   { top, bottom, overlays: [{ refId, coverage, text }] }
 *   ctas:    [{ refId, label, x, y, w, h, fixed }]          申し込みボタン（固定なら画面上の位置、それ以外はページ上端からの位置）
 *   weight:  { bytes, requests, unknown, largest: [{ name, bytes }], blocking, fonts, autoplay, load, lcp }
 *   text: '見えている文章（ブロックごとに改行）'
 * }
 */
(function (root) {
  'use strict';
  const PM = (root.PM = root.PM || {});

  const PERSONAS = [
    {
      id: 'senior',
      name: '65歳・老眼・スマホに不慣れ',
      short: 'シニア',
      desc: '細かい文字や薄い色が読みづらく、小さなボタンを押し間違えやすい。カタカナ語や略語が苦手。',
      effects: { blur: 0.7, contrast: 0.9, sepia: 0.25 },
      zoom: true,
      th: { font: 16, contrast: 7, target: 44, sentence: 60 },
      checks: ['font', 'contrast', 'target', 'jargon', 'sentence', 'vague'],
    },
    {
      id: 'cvd-p',
      name: '色の見え方が違う（P型）',
      short: '色覚 P型',
      desc: '赤と緑の区別がつきにくい。P型・D型は日本人男性の約20人に1人。',
      effects: { cvd: 'p' },
      th: { contrast: 4.5 },
      checks: ['colorlink', 'contrast'],
    },
    {
      id: 'cvd-d',
      name: '色の見え方が違う（D型）',
      short: '色覚 D型',
      desc: '赤と緑の区別がつきにくい。もっとも多いタイプ。',
      effects: { cvd: 'd' },
      th: { contrast: 4.5 },
      checks: ['colorlink', 'contrast'],
    },
    {
      id: 'cvd-t',
      name: '色の見え方が違う（T型）',
      short: '色覚 T型',
      desc: '青と黄色の区別がつきにくい。まれなタイプ。',
      effects: { cvd: 't' },
      th: { contrast: 4.5 },
      checks: ['colorlink', 'contrast'],
    },
    {
      id: 'onehand',
      name: '片手で急いでいる会社員（スマホ）',
      short: '片手・急ぎ',
      desc: '電車でつり革を持ちながら、親指だけで操作。じっくりは読まない。',
      effects: { thumb: true },
      th: { target: 44, sentence: 80 },
      checks: ['target', 'fixed', 'reach', 'firstcta', 'sentence'],
    },
    {
      id: 'lowvision',
      name: '弱視（ぼやけて見える）',
      short: '弱視',
      desc: '画面がぼやけて見える。拡大や読み上げ機能を使うことも多い。',
      effects: { blur: 2, contrast: 0.85 },
      zoom: true,
      th: { font: 18, contrast: 7 },
      checks: ['font', 'contrast', 'unnamed', 'vague'],
    },
    {
      id: 'slow',
      name: '電波の弱い場所でスマホを使う人',
      short: '低速回線',
      desc: '地下鉄や地方など、通信が遅い場所で見ている。重いページは待ちきれない。',
      effects: {},
      th: {},
      checks: ['weight'],
    },
    {
      id: 'beginner',
      name: '初めて訪れた人（業界に詳しくない）',
      short: '初めての人',
      desc: '会社やサービスのことを知らず、業界の言葉もわからない。何のページかをまず知りたい。',
      effects: {},
      th: { sentence: 80 },
      checks: ['jargon', 'acronym', 'sentence', 'vague', 'firstview'],
    },
  ];

  // 一般の人に伝わりにくいカタカナ語・略語（よく使われる業界用語）
  const JARGON = [
    'ソリューション', 'エンゲージメント', 'コミット', 'アジャイル', 'スキーム', 'イノベーション', 'プラットフォーム', 'ワンストップ',
    'シナジー', 'ステークホルダー', 'エビデンス', 'コンセンサス', 'アサイン', 'ローンチ', 'マネタイズ', 'フィンテック', 'オンボーディング',
    'カスタマーサクセス', 'リテンション', 'コンバージョン', 'インサイト', 'ナレッジ', 'リソース', 'アライアンス', 'パラダイム',
    'ベストプラクティス', 'スケーラブル', 'ケイパビリティ', 'バリューチェーン', 'ガバナンス', 'コンプライアンス', 'イニシアチブ',
    'ブランディング', 'マーケティングオートメーション', 'デジタルトランスフォーメーション', 'ペインポイント', 'ジャーニー', 'タッチポイント',
    'ROI', 'KPI', 'KGI', 'DX', 'SaaS', 'PaaS', 'IaaS', 'IoT', 'BtoB', 'B2B', 'BtoC', 'CRM', 'SFA', 'ERP', 'API', 'PoC', 'OEM', 'BPO', 'LTV', 'CX', 'UX',
  ];

  // 説明なしでも伝わる略語（略語の指摘から除く）
  const COMMON_ACRONYMS = new Set(['OK', 'NG', 'PC', 'TV', 'CM', 'QA', 'FAQ', 'SNS', 'PDF', 'URL', 'WEB', 'TEL', 'FAX', 'AI', 'IT', 'NEW', 'TOP', 'HOME', 'Q', 'A', 'JP', 'EN', 'MENU', 'LINE', 'CEO', 'NPO', 'USB', 'GPS', 'ATM', 'ID']);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** 文章から、伝わりにくい言葉・略語・長い文を数える */
  function analyzeText(text) {
    const src = String(text || '');
    const jargon = [];
    for (const term of JARGON) {
      const ascii = /^[\x00-\x7f]+$/.test(term);
      const re = new RegExp(ascii ? `(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])` : escapeRe(term), 'g');
      const n = (src.match(re) || []).length;
      if (n) jargon.push({ term, count: n });
    }
    jargon.sort((a, b) => b.count - a.count);
    const acr = new Map();
    for (const m of src.matchAll(/(?<![A-Za-z0-9])[A-Z]{2,5}(?![A-Za-z0-9])/g)) {
      const t = m[0];
      if (COMMON_ACRONYMS.has(t) || JARGON.includes(t)) continue;
      acr.set(t, (acr.get(t) || 0) + 1);
    }
    const acronyms = [...acr].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count);
    const sentences = src
      .split(/(?<=[。！？!?])|\n/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 10);
    return { jargon, acronyms, sentences };
  }

  const sevOrder = { error: 0, warn: 1, info: 2, good: 3 };

  /** ペルソナの視点で、つまずきを並べる */
  function findings(personaId, raw) {
    const p = PERSONAS.find((x) => x.id === personaId);
    const th = p.th;
    const out = [];
    const add = (f) => out.push(Object.assign({ items: [] }, f));
    const t = analyzeText(raw.text);

    for (const c of p.checks) {
      if (c === 'font') {
        const small = raw.texts.filter((x) => x.size < th.font && x.text.length >= 4);
        if (small.length) {
          const min = Math.min(...small.map((x) => x.size));
          add({ id: 'font', severity: small.some((x) => x.size < 12) ? 'error' : 'warn', title: `${th.font}px未満の文字が${small.length}か所あります（最小${min}px）`, detail: `${p.short}の人には読みづらい大きさです。本文は${th.font}px以上が目安です。`, items: small.sort((a, b) => a.size - b.size).slice(0, 40).map((x) => ({ refId: x.refId, text: `${x.size}px：${x.text}` })), meta: { min, count: small.length } });
        } else add({ id: 'font', severity: 'good', title: `文字は${th.font}px以上で読みやすい大きさです` });
      }
      if (c === 'contrast') {
        const low = raw.texts.filter((x) => x.contrast < th.contrast && x.text.length >= 2);
        const bad = low.filter((x) => x.contrast < (x.size >= 24 ? 3 : 4.5));
        if (low.length) {
          add({ id: 'contrast', severity: bad.length ? 'error' : 'warn', title: `背景との色の差が小さい文字が${low.length}か所あります`, detail: bad.length ? `うち${bad.length}か所は、多くの人にとって読みにくい基準（コントラスト比4.5未満）です。` : `一般の基準は満たしていますが、${p.short}の人には薄く見えます（目安${th.contrast}以上）。`, items: low.sort((a, b) => a.contrast - b.contrast).slice(0, 40).map((x) => ({ refId: x.refId, text: `${x.contrast.toFixed(1)}：${x.text}` })), meta: { count: low.length, bad: bad.length } });
        } else add({ id: 'contrast', severity: 'good', title: '文字と背景の色の差は十分です' });
      }
      if (c === 'target') {
        const small = raw.targets.filter((x) => !x.inline && Math.min(x.w, x.h) < th.target);
        if (small.length) add({ id: 'target', severity: small.some((x) => Math.min(x.w, x.h) < 24) ? 'error' : 'warn', title: `押しにくい小さなボタン・リンクが${small.length}か所あります`, detail: `指で押しやすい大きさは${th.target}px四方以上が目安です（文中のリンクは除く）。`, items: small.slice(0, 40).map((x) => ({ refId: x.refId, text: `${Math.round(x.w)}×${Math.round(x.h)}px：${x.label}` })), meta: { count: small.length } });
        else add({ id: 'target', severity: 'good', title: 'ボタンやリンクは押しやすい大きさです' });
      }
      if (c === 'colorlink') {
        if (raw.colorLinks.length) add({ id: 'colorlink', severity: 'error', title: `色だけで区別しているリンクが${raw.colorLinks.length}か所あります`, detail: '下線がなく、周りの文字との色の差も小さいため、リンクだと気づけません。下線などを付けてください。', items: raw.colorLinks.slice(0, 40).map((x) => ({ refId: x.refId, text: `色の差${x.ratio.toFixed(1)}：${x.text}` })) });
        else add({ id: 'colorlink', severity: 'good', title: '文中のリンクは、色以外（下線など）でも区別できます' });
      }
      if (c === 'jargon') {
        if (t.jargon.length) add({ id: 'jargon', severity: 'warn', title: `伝わりにくい言葉が${t.jargon.length}種類あります`, detail: '業界用語やカタカナ語は、言い換えるか、短い説明を添えてください。', items: t.jargon.slice(0, 20).map((x) => ({ find: x.term, text: `「${x.term}」×${x.count}` })), meta: { terms: t.jargon.map((x) => x.term) } });
        else add({ id: 'jargon', severity: 'good', title: '難しいカタカナ語や業界用語は見当たりません' });
      }
      if (c === 'acronym') {
        if (t.acronyms.length) add({ id: 'acronym', severity: 'info', title: `アルファベットの略語が${t.acronyms.length}種類あります`, detail: '初めて出てくるところで、意味を書き添えると親切です。', items: t.acronyms.slice(0, 20).map((x) => ({ find: x.term, text: `${x.term}×${x.count}` })), meta: { terms: t.acronyms.map((x) => x.term) } });
      }
      if (c === 'sentence') {
        const long = t.sentences.filter((s) => s.length > th.sentence);
        if (long.length) add({ id: 'sentence', severity: 'warn', title: `${th.sentence}字を超える長い文が${long.length}文あります`, detail: '1文1メッセージにして、読点で区切ると読みやすくなります。', items: long.sort((a, b) => b.length - a.length).slice(0, 10).map((s) => ({ find: s.slice(0, 20), text: `${s.length}字：${s.slice(0, 50)}…` })), meta: { count: long.length } });
      }
      if (c === 'vague') {
        if (raw.vague.length) add({ id: 'vague', severity: 'warn', title: `行き先がわからないリンクが${raw.vague.length}か所あります`, detail: '「こちら」「詳しくはこちら」ではなく、「料金表を見る」のように行き先を書いてください。読み上げでも内容がわかります。', items: raw.vague.slice(0, 30).map((x) => ({ refId: x.refId, text: `「${x.text}」` })), meta: { first: raw.vague[0].text } });
      }
      if (c === 'unnamed') {
        if (raw.unnamed.length) add({ id: 'unnamed', severity: 'error', title: `名前のないボタンが${raw.unnamed.length}か所あります`, detail: 'アイコンだけのボタンは、読み上げると何のボタンかわかりません。aria-label などで名前を付けてください。', items: raw.unnamed.slice(0, 30).map((x) => ({ refId: x.refId, text: x.text })) });
        else add({ id: 'unnamed', severity: 'good', title: 'すべてのボタンに名前（文字や読み上げ用のラベル）があります' });
      }
      if (c === 'fixed') {
        const share = (raw.fixed.top + raw.fixed.bottom) / raw.viewport.h;
        if (share > 0.25) add({ id: 'fixed', severity: 'warn', title: `固定されたヘッダー・バーが画面の${Math.round(share * 100)}%を占めています`, detail: 'スマホでは、読める範囲がかなり狭くなります。スクロールで隠す、高さを抑えるなどを検討してください。', meta: { share } });
        for (const o of raw.fixed.overlays) add({ id: `overlay-${o.refId}`, severity: 'error', title: `画面の${Math.round(o.coverage * 100)}%を覆う表示があります`, detail: 'ポップアップやバナーが本文を隠しています。閉じるボタンが押しやすいか確認してください。', items: [{ refId: o.refId, text: o.text }] });
      }
      if (c === 'reach') {
        const first = raw.ctas.filter((x) => x.fixed || x.y < raw.viewport.h);
        // 親指が届きやすいのは画面の下半分（上部に固定されたヘッダーのボタンは届きにくい）
        const easy = first.filter((x) => x.y + x.h / 2 > raw.viewport.h * 0.5);
        if (first.length && !easy.length) add({ id: 'reach', severity: 'warn', title: '1画面目の申し込みボタンが、画面の上半分にしかありません', detail: '片手で持つと、親指は画面の下半分にしか届きにくくなります。下側に置く・画面下に固定する、を検討してください。', items: first.map((x) => ({ refId: x.refId, text: x.label })) });
        else if (easy.length) add({ id: 'reach', severity: 'good', title: '親指の届きやすい位置に、申し込みボタンがあります' });
      }
      if (c === 'firstcta') {
        const first = raw.ctas.filter((x) => x.fixed || x.y < raw.viewport.h);
        if (!first.length) add({ id: 'firstcta', severity: 'warn', title: '最初の画面に、申し込みボタンがありません', detail: '急いでいる人は、スクロールする前に次の行動を探します。' });
      }
      if (c === 'firstview') {
        const h1 = raw.firstView && raw.firstView.h1;
        if (!h1) add({ id: 'firstview', severity: 'warn', title: '最初の画面に、何のページかを伝える大きな見出しがありません', detail: '「誰の、何のためのサービスか」が一目でわかる見出しを置いてください。' });
        else add({ id: 'firstview', severity: 'good', title: `最初の画面に見出しがあります：「${h1}」` });
      }
      if (c === 'weight') {
        const w = raw.weight;
        const mb = w.bytes / 1024 / 1024;
        // 下り1.6Mbps（低速な回線）で、ファイルの読み込みにかかる時間の目安
        const sec = Math.round(((w.bytes * 8) / 1.6e6 + w.blocking * 0.4 + 0.6) * 10) / 10;
        const sev = sec >= 10 ? 'error' : sec >= 5 ? 'warn' : 'good';
        add({ id: 'weight', severity: sev, title: `電波の弱い場所では、表示まで約${sec}秒かかります`, detail: `ページの重さ ${mb.toFixed(1)}MB・ファイル${w.requests}個${w.unknown ? `（ほか${w.unknown}個は外部のためサイズ不明）` : ''}。表示を待てずに離れる人が増えるのは3秒を超えたあたりからと言われます。`, meta: { sec, mb } });
        const big = w.largest.filter((x) => x.bytes > 300 * 1024);
        if (big.length) add({ id: 'heavy', severity: 'warn', title: `300KBを超える大きなファイルが${big.length}個あります`, detail: '画像は表示サイズに合わせて縮小し、WebPなどの軽い形式にすると速くなります。', items: big.slice(0, 10).map((x) => ({ text: `${Math.round(x.bytes / 1024)}KB：${x.name}` })) });
        if (w.blocking) add({ id: 'blocking', severity: 'info', title: `表示を止めてしまう読み込みが${w.blocking}個あります`, detail: '<head> 内のスクリプトに defer / async を付けると、先に画面を出せます。' });
        if (w.autoplay) add({ id: 'autoplay', severity: 'warn', title: '自動再生の動画があります', detail: '通信量が多く、低速な回線では表示が遅くなります。' });
      }
    }
    out.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
    return out;
  }

  /** つまずきを、ペルソナの口調の「ひとりごと」にする（最大5つ） */
  function narrate(personaId, list) {
    const lines = [];
    const by = (id) => list.find((f) => f.id === id && f.severity !== 'good');
    const say = (s) => lines.push(s);
    const P = personaId;
    const f = {
      font: by('font'),
      contrast: by('contrast'),
      target: by('target'),
      colorlink: by('colorlink'),
      jargon: by('jargon'),
      acronym: by('acronym'),
      sentence: by('sentence'),
      vague: by('vague'),
      unnamed: by('unnamed'),
      fixed: by('fixed'),
      reach: by('reach'),
      firstcta: by('firstcta'),
      firstview: by('firstview'),
      weight: by('weight'),
      overlay: list.find((x) => x.id.startsWith('overlay-')),
    };
    if (f.weight) say(`なかなか表示されない…。${f.weight.meta.sec}秒も待っていられないよ。`);
    if (f.overlay) say('いきなり何かが画面をふさいできた。閉じるボタンはどこ？');
    if (f.font) say(P === 'senior' ? `文字が小さくて、老眼鏡を探しちゃう…（${f.font.meta.min}pxの文字がある）` : `小さな文字はぼやけて、形がわからない…（${f.font.meta.min}px）`);
    if (f.contrast) say(P.startsWith('cvd') ? 'この色の組み合わせ、文字が背景とほとんど同じに見える…' : '薄い色の文字が、背景に溶けて読めない…');
    if (f.colorlink) say('どれがリンクなのか、見分けがつかない…。押せるところを探して、あちこち触っちゃう。');
    if (f.unnamed) say('このボタン、何のボタン？読み上げても名前が出てこない。');
    if (f.fixed) say('上と下に固定されたバーのせいで、読める場所が狭い…');
    if (f.reach) say('申し込みボタンが画面の上のほう…。片手だと親指が届かない！');
    if (f.firstcta) say('どこから申し込めばいいの？すぐには見つからない。');
    if (f.target) say(P === 'onehand' ? '親指だと、小さいボタンが押しにくい！隣のリンクを押しちゃった。' : 'ボタンが小さくて、隣を押してしまいそう…');
    if (f.firstview) say('結局、ここは何のページなんだろう？');
    if (f.jargon) say(`「${f.jargon.meta.terms[0]}」って何のこと？${f.jargon.meta.terms.length > 1 ? `「${f.jargon.meta.terms[1]}」もわからない…` : ''}`);
    if (f.acronym) say(`${f.acronym.meta.terms.slice(0, 3).join('、')}…アルファベットの略語が多くて意味がわからない。`);
    if (f.vague) say(`「${f.vague.meta.first}」って、押したらどこに行くんだろう？`);
    if (f.sentence) say(P === 'onehand' ? '長い文章は読み飛ばしちゃう。結論だけ教えて。' : '1文が長くて、途中で何の話かわからなくなった…');
    if (!lines.length) say('特につまずくところはなかった！スムーズに使えたよ。');
    return lines.slice(0, 5);
  }

  /** 色覚の見え方を再現する行列（Machado ほか 2009、強さ1.0、リニアRGB） */
  const CVD_MATRIX = {
    p: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    d: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
    t: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  };

  PM.personas = { PERSONAS, JARGON, analyzeText, findings, narrate, CVD_MATRIX };
  if (typeof module === 'object' && module.exports) module.exports = PM.personas;
})(typeof globalThis !== 'undefined' ? globalThis : this);
