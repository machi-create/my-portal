/*
 * フィードバック翻訳機：曖昧な要望 → 具体的な修正案（ルールベース）
 *
 *   FT.rules.analyze(feedback, info) → { intents, proposals, notes }
 *   FT.rules.devReport(ctx) / FT.rules.clientReport(ctx)
 *   FT.rules.easyJapanese(text) → { text, terms }
 *
 * info はページ側で取得した要素の情報（content.js の describe() を参照）
 */
(function (root) {
  'use strict';
  const FT = (root.FT = root.FT || {});
  const C = FT.color || (typeof require === 'function' ? require('./color.js') : null);

  const SIZE_SCALE = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 120];
  const TEXTY = new Set(['text', 'heading', 'button', 'link', 'input']);

  const FONTS = {
    serif: '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif',
    rounded: '"Zen Maru Gothic", "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif',
    gothic: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif',
  };

  const ROLE_LABELS = { button: 'ボタン', link: 'リンク', heading: '見出し', text: '文章', image: '画像', input: '入力欄', block: 'エリア' };

  // ---------------------------------------------------------------- 数値の整形
  const round = (n, d = 0) => {
    const p = Math.pow(10, d);
    return Math.round(n * p) / p;
  };
  const px = (n) => `${round(n)}px`;
  const sizeUp = (n, f) => SIZE_SCALE.find((s) => s >= n * f && s > n) || Math.ceil(n * f);
  const sizeDown = (n, f) => [...SIZE_SCALE].reverse().find((s) => s <= n * f && s < n) || Math.max(10, Math.floor(n * f));

  function boxValue(t, r, b, l) {
    if (t === r && r === b && b === l) return px(t);
    if (t === b && r === l) return `${px(t)} ${px(r)}`;
    return `${px(t)} ${px(r)} ${px(b)} ${px(l)}`;
  }

  function lineHeightRatio(s) {
    if (!s.lineHeight || !s.fontSize) return null;
    return s.lineHeight / s.fontSize;
  }

  function colorOf(str) {
    return (C && C.parse(str)) || { r: 0, g: 0, b: 0, a: 1 };
  }

  function contrastOf(s) {
    const bg = colorOf(s.background);
    const fg = C.blend(colorOf(s.color), bg);
    return { fg, bg, ratio: C.contrast(fg, bg) };
  }

  // ---------------------------------------------------------------- 修正案の部品
  function p(intent, css, label, from, to, reason, extra) {
    return Object.assign({ intent, css, label, from: String(from), to: String(to), reason, showValues: true }, extra);
  }

  const make = {
    fontSize(intent, s, factor, reason) {
      if (!s.fontSize) return null;
      const to = factor >= 1 ? sizeUp(s.fontSize, factor) : sizeDown(s.fontSize, factor);
      if (to === round(s.fontSize)) return null;
      return p(intent, 'font-size', '文字サイズ', px(s.fontSize), px(to), reason);
    },
    fontSizeAtLeast(intent, s, min, reason) {
      if (!s.fontSize || s.fontSize >= min) return null;
      return p(intent, 'font-size', '文字サイズ', px(s.fontSize), px(min), reason);
    },
    weight(intent, s, to, reason) {
      if (!s.fontWeight || s.fontWeight === to) return null;
      return p(intent, 'font-weight', '文字の太さ', s.fontWeight, to, reason);
    },
    lineHeight(intent, s, ratio, reason) {
      const cur = lineHeightRatio(s);
      if (cur && Math.abs(cur - ratio) < 0.05) return null;
      return p(intent, 'line-height', '行の間隔', cur ? round(cur, 2) : 'normal', ratio, reason);
    },
    letterSpacing(intent, s, em, reason) {
      const cur = s.fontSize ? (s.letterSpacing || 0) / s.fontSize : 0;
      if (Math.abs(cur - em) < 0.005) return null;
      return p(intent, 'letter-spacing', '文字の間隔', cur ? `${round(cur, 3)}em` : '0', em ? `${em}em` : '0', reason);
    },
    contrastUp(intent, s, target, reason) {
      const { fg, bg, ratio } = contrastOf(s);
      if (ratio >= target) return null;
      const next = C.ensureContrast(fg, bg, target);
      const after = C.contrast(next, bg);
      if (after > ratio + 0.2) {
        return p(intent, 'color', '文字の色', C.toHex(fg), C.toHex(next), reason, {
          note: `コントラスト比 ${round(ratio, 1)} → ${round(after, 1)}`,
          showValues: false,
        });
      }
      // 文字色がすでに白（黒）で改善できない → 要素自身に背景色があれば、背景を濃く（淡く）する
      if (!s.ownBackground) return null;
      const nextBg = C.ensureContrast(bg, fg, target);
      const afterBg = C.contrast(fg, nextBg);
      if (afterBg <= ratio + 0.2) return null;
      return p(intent, 'background-color', '背景色', C.toHex(bg), C.toHex(nextBg), '背景の色を濃くして、文字をはっきり見せます', {
        note: `コントラスト比 ${round(ratio, 1)} → ${round(afterBg, 1)}`,
        showValues: false,
      });
    },
    contrastDown(intent, s, target, reason) {
      const { fg, bg, ratio } = contrastOf(s);
      if (ratio <= target + 0.3) return null;
      const next = C.softenContrast(fg, bg, target);
      return p(intent, 'color', '文字の色', C.toHex(fg), C.toHex(next), reason, {
        note: `コントラスト比 ${round(ratio, 1)} → ${round(C.contrast(next, bg), 1)}`,
        showValues: false,
      });
    },
    padding(intent, s, factor, reason, min) {
      let [t, r, b, l] = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map((v) => v || 0);
      if (!t && !r && !b && !l) {
        if (!min) return null;
        [t, r, b, l] = min;
      } else {
        [t, r, b, l] = [t, r, b, l].map((v) => Math.round(v * factor));
        if (min) [t, r, b, l] = [t, r, b, l].map((v, i) => Math.max(v, min[i]));
      }
      const from = boxValue(s.paddingTop || 0, s.paddingRight || 0, s.paddingBottom || 0, s.paddingLeft || 0);
      const to = boxValue(t, r, b, l);
      if (from === to) return null;
      return p(intent, 'padding', '内側の余白', from, to, reason);
    },
    marginY(intent, s, factor, reason, min) {
      const t0 = s.marginTop || 0;
      const b0 = s.marginBottom || 0;
      let t = Math.round(t0 * factor);
      let b = Math.round(b0 * factor);
      if (min) {
        t = Math.max(t, min);
        b = Math.max(b, min);
      }
      if (t === t0 && b === b0) return null;
      return [
        p(intent, 'margin-top', '上の余白', px(t0), px(t), reason),
        p(intent, 'margin-bottom', '下の余白', px(b0), px(b), reason, { hideInClient: true }),
      ];
    },
    radius(intent, s, to, reason) {
      if ((s.borderRadius || 0) === to) return null;
      return p(intent, 'border-radius', '角の丸み', px(s.borderRadius || 0), px(to), reason);
    },
    shadow(intent, s, to, reason) {
      if ((s.boxShadow || 'none') === to) return null;
      return p(intent, 'box-shadow', '影', s.boxShadow || 'none', to, reason, { showValues: false });
    },
    font(intent, s, family, kind, reason) {
      const cur = String(s.fontFamily || '').toLowerCase();
      if (kind === 'serif' && /mincho|明朝|serif(?!-)/.test(cur) && !/sans-serif/.test(cur.replace(/"[^"]*"/g, ''))) return null;
      if (kind === 'rounded' && /maru|丸|rounded/.test(cur)) return null;
      return p(intent, 'font-family', '書体', s.fontFamily || '（既定）', family, reason, { showValues: false });
    },
    width(intent, info, factor, reason) {
      const w = info.rect && info.rect.width;
      if (!w) return null;
      return p(intent, 'width', '幅', px(w), px(w * factor), reason);
    },
  };

  // ---------------------------------------------------------------- 要望の解釈（上にあるものほど優先）
  const INTENTS = [
    {
      id: 'bold',
      label: '太く',
      chip: null,
      re: /太く|太字|ボールド|bold/i,
      build: (s) => [make.weight('bold', s, 700, '文字を太くします')],
    },
    {
      id: 'thin',
      label: '細く',
      re: /細く|細め|細字/,
      build: (s) => [make.weight('thin', s, 400, '文字を細くして、軽やかな印象にします')],
    },
    {
      id: 'lineSpacing',
      label: '行間',
      re: /行間|行と行/,
      build: (s, info, fb) => {
        const tighter = /詰め|狭く|狭め|詰ま(?:っていい|らせ)|空きすぎ|広すぎ/.test(fb);
        return [make.lineHeight('lineSpacing', s, tighter ? 1.5 : 1.9, tighter ? '行の間隔を詰めて、まとまりを出します' : '行の間隔を広げて、読みやすくします')];
      },
    },
    {
      id: 'letterSpacing',
      label: '文字間',
      re: /文字間|字間|文字と文字/,
      build: (s, info, fb) => {
        const tighter = /詰め|狭く|狭め|空きすぎ|広すぎ/.test(fb);
        return [make.letterSpacing('letterSpacing', s, tighter ? 0 : 0.08, tighter ? '文字の間隔を詰めます' : '文字の間隔を広げて、ゆったり見せます')];
      },
    },
    {
      id: 'darker',
      label: 'はっきり',
      re: /濃く|はっきり|くっきり|見えにく|薄くて|薄すぎ/,
      build: (s) => [make.contrastUp('darker', s, 7, '背景との色の差を大きくして、はっきり見えるようにします')],
    },
    {
      id: 'lighter',
      label: '淡く',
      re: /薄く(?:して|したい)|淡く|やさしい色|優しい色|濃すぎ|黒すぎ/,
      build: (s) => [make.contrastDown('lighter', s, 4.5, '色を少し淡くします（読みやすさの基準は保ちます）')],
    },
    {
      id: 'align',
      label: '揃える',
      re: /揃[っえわ]|ずれ|ズレ|ガタガタ|バラバラ|整列|中央|真ん中|センター|左寄せ|右寄せ/,
      build: (s, info, fb) => {
        let to = null;
        if (/中央|真ん中|センター/.test(fb)) to = 'center';
        else if (/右/.test(fb)) to = 'right';
        else if (/左/.test(fb)) to = 'left';
        if (!to) return [];
        if (s.textAlign === to || (to === 'left' && s.textAlign === 'start')) return [];
        const names = { center: '中央', left: '左', right: '右' };
        return [p('align', 'text-align', '揃え位置', s.textAlign || 'start', to, `文字を${names[to]}揃えにします`)];
      },
      note: (s, info, fb) => (/中央|真ん中|センター|左|右/.test(fb) ? null : '周りの要素と端（基準線）を揃えます。どの要素に合わせるか、デザイナーと確認してください。'),
    },
    {
      id: 'smaller',
      label: '小さく',
      re: /小さく(?:して|したい|する|お願い|でき)|小さめに|大きすぎ|でか(?:すぎ|い)|デカ(?:すぎ|い)|縮め/,
      build: (s, info) => {
        if (info.role === 'image' || info.role === 'block') return [make.width('smaller', info, 0.85, '表示サイズを少し小さくします')];
        const out = [make.fontSize('smaller', s, 0.85, '文字を一回り小さくします')];
        if (info.role === 'button') out.push(make.padding('smaller', s, 0.85, 'ボタンを少し小さくします'));
        return out;
      },
    },
    {
      id: 'bigger',
      label: '大きく',
      re: /大きく|大きめ|小さ(?:い|すぎ|くて)|拡大/,
      build: (s, info) => {
        if (info.role === 'image' || info.role === 'block') return [make.width('bigger', info, 1.2, '表示サイズを一回り大きくします')];
        const out = [make.fontSize('bigger', s, 1.2, '文字を一回り大きくします')];
        if (info.role === 'button') out.push(make.padding('bigger', s, 1.2, 'ボタンを一回り大きくします'));
        return out;
      },
    },
    {
      id: 'clickable',
      label: '押しやすく',
      chip: '押しやすくしてほしい',
      re: /押しやす|押しにく|押しづら|タップしにく|タップしづら|クリックしにく|押せるか|ボタンっぽ|ボタンに見え|押したくなる|リンクと分か|リンクだと分か/,
      build: (s, info) => {
        const out = [];
        if (info.role === 'link' && !/underline/.test(s.textDecorationLine || '')) {
          out.push(p('clickable', 'text-decoration', '下線', s.textDecorationLine || 'none', 'underline', '下線を付けて、リンクだと分かるようにします', { showValues: false }));
        }
        if (info.role === 'button' || info.role === 'link') {
          if (info.rect && info.rect.height < 44) out.push(p('clickable', 'min-height', '高さ（最小）', px(info.rect.height), '48px', '指でタップしやすい高さ（48px）にします'));
          if (info.role === 'button') {
            out.push(make.padding('clickable', s, 1, '内側の余白を広げて、押せる範囲を大きくします', [12, 24, 12, 24]));
            if (!s.boxShadow || s.boxShadow === 'none') out.push(make.shadow('clickable', s, '0 4px 12px rgba(0, 0, 0, 0.15)', '軽い影を付けて、ボタンだと分かりやすくします'));
          }
        }
        return out;
      },
      note: () => 'マウスを乗せたとき（:hover）や押したときの見た目の変化も付けると、押せることが伝わりやすくなります。',
    },
    {
      id: 'subdue',
      label: '控えめに',
      chip: '主張が強すぎる',
      re: /目立ちすぎ|主張が強|うるさ|派手|強すぎ|くどい|ギラギラ|圧が|控えめ|落ち着かせ|悪目立ち|目障り/,
      build: (s, info) => {
        const out = [];
        if (s.fontWeight >= 600) out.push(make.weight('subdue', s, 500, '文字の太さを抑えます'));
        if (TEXTY.has(info.role)) out.push(make.fontSize('subdue', s, 0.9, '文字を少し小さくします'));
        out.push(make.contrastDown('subdue', s, Math.max(4.5, contrastOf(s).ratio * 0.65), '色の差を少し弱めて、主張を抑えます（読みやすさの基準は保ちます）'));
        if (s.boxShadow && s.boxShadow !== 'none') out.push(make.shadow('subdue', s, 'none', '影をなくして、すっきりさせます'));
        return out;
      },
    },
    {
      id: 'emphasize',
      label: '目立たせる',
      chip: 'もっと目立たせたい',
      re: /目立た(?:せ|な)|目立つ|パッと|ぱっと|強調|インパクト|弱い|弱く|埋もれ|地味|存在感|アピール|印象に残|目を引|目に留|メリハリ|際立|インパクト/,
      build: (s, info) => {
        const out = [];
        if (TEXTY.has(info.role)) {
          out.push(make.fontSize('emphasize', s, 1.25, '文字を一回り大きくして、視線が集まるようにします'));
          if (s.fontWeight < 700) out.push(make.weight('emphasize', s, 700, '文字を太くして、存在感を出します'));
          out.push(make.contrastUp('emphasize', s, 7, '背景との色の差を大きくして、はっきり見えるようにします'));
        }
        if (info.role === 'button') {
          out.push(make.padding('emphasize', s, 1.25, 'ボタンをひと回り大きくして、押したくなる印象にします', [14, 28, 14, 28]));
          if (!s.boxShadow || s.boxShadow === 'none') out.push(make.shadow('emphasize', s, '0 6px 16px rgba(0, 0, 0, 0.18)', '影で浮き上がらせて、目に留まりやすくします'));
        }
        if (info.role !== 'text' && info.role !== 'link') out.push(make.marginY('emphasize', s, 1.5, '周りの余白を広げて、際立たせます', 24));
        return out;
      },
      note: (s, info) => (info.role === 'image' ? '画像そのものを明るくする・寄りのトリミングにする、といった差し替えも効果的です。' : null),
    },
    {
      id: 'readability',
      label: '読みやすく',
      chip: '読みにくい',
      re: /読みにく|読みづら|読めない|見づら|見にく|ぎっしり|文字が多|疲れる|追いにく/,
      build: (s, info) => {
        const out = [];
        if (info.role === 'text' || info.role === 'link') out.push(make.fontSizeAtLeast('readability', s, 16, '文字の大きさを、読みやすい16px以上にします'));
        else if (s.fontSize < 14) out.push(make.fontSizeAtLeast('readability', s, 14, '文字の大きさを14px以上にします'));
        const lh = lineHeightRatio(s);
        if (info.role === 'text' && (!lh || lh < 1.7)) out.push(make.lineHeight('readability', s, 1.8, '行の間隔を広げて、目で追いやすくします'));
        const ls = s.fontSize ? (s.letterSpacing || 0) / s.fontSize : 0;
        if (info.role === 'text' && ls < 0.02) out.push(make.letterSpacing('readability', s, 0.04, '文字の間隔をわずかに広げます'));
        out.push(make.contrastUp('readability', s, s.fontSize >= 24 ? 4.5 : 7, '背景との色の差を大きくして、読みやすくします'));
        if (info.role === 'text' && info.rect && info.rect.width > 720) {
          out.push(p('readability', 'max-width', '1行の長さ（最大幅）', px(info.rect.width), '40em', '1行の長さを短くして、読み疲れを減らします'));
        }
        return out;
      },
    },
    {
      id: 'cramped',
      label: 'ゆとり',
      chip: '窮屈に感じる',
      re: /窮屈|狭い|狭苦|詰ま|ゆとり|ゆったり|息苦し|ごちゃごちゃ|ごちゃつ|余白が(?:ない|少な|足り)|余白を(?:もっと|広|増)|ぎゅうぎゅう/,
      build: (s, info) => {
        const out = [];
        if (info.role === 'block' || info.role === 'button') out.push(make.padding('cramped', s, 1.5, '内側の余白を広げて、ゆとりを持たせます', info.role === 'button' ? [12, 24, 12, 24] : [24, 24, 24, 24]));
        out.push(make.marginY('cramped', s, 1.5, '周りとの間隔を広げます', 16));
        const lh = lineHeightRatio(s);
        if ((info.role === 'text' || info.role === 'heading') && (!lh || lh < 1.7)) out.push(make.lineHeight('cramped', s, 1.8, '行の間隔を広げます'));
        return out;
      },
    },
    {
      id: 'sparse',
      label: '引き締める',
      chip: '間延びしている',
      re: /寂し|さみし|間延び|スカスカ|すかすか|空きすぎ|余白が多|余白が広|広すぎ|散漫|まとまりがな/,
      build: (s) => {
        const out = [];
        if (Math.max(s.paddingTop || 0, s.paddingLeft || 0) > 8) out.push(make.padding('sparse', s, 0.7, '内側の余白を詰めて、まとまりを出します'));
        if (Math.max(s.marginTop || 0, s.marginBottom || 0) > 8) out.push(make.marginY('sparse', s, 0.7, '周りとの間隔を詰めます'));
        return out;
      },
      note: () => '要素を詰めるだけでなく、写真やアイコンを足して「にぎやかさ」を出す方法もあります。',
    },
    {
      id: 'luxury',
      label: '上品・高級感',
      chip: '高級感がほしい',
      re: /高級|上品|洗練|エレガント|おしゃれ|オシャレ|大人っぽ|落ち着いた|品の?ある|品がな|安っぽ|ラグジュアリ/,
      build: (s, info) => {
        const out = [];
        if (TEXTY.has(info.role)) {
          out.push(make.letterSpacing('luxury', s, 0.08, '文字の間隔を広げ、ゆったりと上品な印象にします'));
          out.push(make.font('luxury', s, FONTS.serif, 'serif', '明朝体にして、落ち着いた高級感を出します'));
          if (s.fontWeight >= 600 && info.role !== 'heading') out.push(make.weight('luxury', s, 500, '文字を少し細くして、繊細な印象にします'));
          if (info.role === 'text') out.push(make.lineHeight('luxury', s, 1.9, '行の間隔を広げて、ゆとりを出します'));
        }
        if (info.role === 'button') out.push(make.radius('luxury', s, 2, '角をシャープにして、引き締まった印象にします'));
        if (info.role === 'block' || info.role === 'button') out.push(make.padding('luxury', s, 1.3, '余白を広げて、ゆったり見せます'));
        return out;
      },
    },
    {
      id: 'friendly',
      label: '親しみやすく',
      chip: '親しみやすくしたい',
      re: /親しみ|かわい|可愛|カワイ|やわらか|柔らか|ポップ|明るい感じ|元気|カジュアル|堅すぎ|硬すぎ|とっつきにく/,
      build: (s, info) => {
        const out = [];
        if (info.role === 'button') out.push(make.radius('friendly', s, 999, '角を丸くして、やわらかい印象にします'));
        else if (info.role === 'block' || info.role === 'image') out.push(make.radius('friendly', s, 16, '角を丸くして、やわらかい印象にします'));
        if (TEXTY.has(info.role)) out.push(make.font('friendly', s, FONTS.rounded, 'rounded', '丸みのある書体にして、親しみやすくします'));
        return out;
      },
    },
    {
      id: 'trust',
      label: '信頼感',
      chip: '信頼感を出したい',
      re: /信頼|堅実|しっかりし|誠実|安心感|ビジネスっぽ|きちんと|ちゃんとし|チャラ|軽すぎ/,
      build: (s, info) => {
        const out = [];
        const cur = String(s.fontFamily || '').toLowerCase();
        if (TEXTY.has(info.role) && /mincho|明朝|maru|丸|rounded|cursive|fantasy/.test(cur)) {
          out.push(p('trust', 'font-family', '書体', s.fontFamily, FONTS.gothic, '癖のないゴシック体にして、誠実な印象にします', { showValues: false }));
        }
        if ((s.borderRadius || 0) > 8) out.push(make.radius('trust', s, 4, '角の丸みを抑えて、きちんとした印象にします'));
        if (info.role === 'heading' && s.fontWeight < 600) out.push(make.weight('trust', s, 700, '見出しを太くして、しっかりした印象にします'));
        return out;
      },
    },
    {
      id: 'modern',
      label: '今っぽく',
      chip: '古い感じがする',
      re: /古い|古臭|古くさ|ダサ|だサ|垢抜け|あか抜け|今っぽ|今風|モダン|野暮った|昭和|時代遅れ/,
      build: (s, info) => {
        const out = [];
        if ((info.role === 'button' || info.role === 'block') && !(s.borderRadius > 0)) out.push(make.radius('modern', s, 8, '角に少し丸みを付けて、今どきの印象にします'));
        if (s.boxShadow && s.boxShadow !== 'none' && /,|\d{2,}px/.test(s.boxShadow)) out.push(make.shadow('modern', s, '0 2px 8px rgba(0, 0, 0, 0.08)', '強い影を、薄く自然な影にします'));
        if (s.textShadow && s.textShadow !== 'none') out.push(p('modern', 'text-shadow', '文字の影', s.textShadow, 'none', '文字の影をなくして、すっきりさせます', { showValues: false }));
        if (info.role === 'text') out.push(make.lineHeight('modern', s, 1.8, '行の間隔を広げて、軽やかにします'));
        if (TEXTY.has(info.role)) out.push(make.letterSpacing('modern', s, 0.02, '文字の間隔をわずかに整えます'));
        return out;
      },
      note: () => 'グラデーションや立体的な装飾を控え、色数を2〜3色に絞ると、より今っぽい印象になります。',
    },
    {
      id: 'mobile',
      label: 'スマホ',
      re: /スマホ|SP|携帯|モバイル|iPhone|Android/i,
      build: () => [],
      note: () => 'スマホ表示（画面幅767px以下）でも同じ問題が起きていないか確認してください。スマホの本文は16px以上が目安です。',
    },
  ];

  /** よく使う要望（ボタンで入力できるもの） */
  const CHIPS = [
    'もっと目立たせたい',
    '読みにくい',
    '窮屈に感じる',
    '間延びしている',
    '高級感がほしい',
    '親しみやすくしたい',
    '押しやすくしてほしい',
    '古い感じがする',
    '主張が強すぎる',
    'もう少し大きく',
    'もう少し小さく',
    '真ん中に揃えて',
  ];

  function analyze(feedback, info) {
    const fb = String(feedback || '');
    const s = (info && info.styles) || {};
    const matched = INTENTS.filter((it) => it.re.test(fb));
    const proposals = [];
    const seen = new Set();
    const notes = [];
    for (const it of matched) {
      const built = it.build(s, info || {}, fb).flat().filter(Boolean);
      for (const prop of built) {
        if (seen.has(prop.css)) continue;
        seen.add(prop.css);
        proposals.push(Object.assign({ id: `${it.id}:${prop.css}`, apply: true }, prop));
      }
      const note = it.note && it.note(s, info || {}, fb);
      if (note) notes.push(note);
    }
    return {
      intents: matched.map((it) => ({ id: it.id, label: it.label })),
      proposals,
      notes,
    };
  }

  // ---------------------------------------------------------------- 書き出し
  function targetLabel(info) {
    const role = ROLE_LABELS[info.role] || '要素';
    const text = info.text ? `「${clip(info.text, 24)}」` : '';
    return `${role}${text}`;
  }

  function clip(s, n) {
    const a = Array.from(String(s || ''));
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  }

  function cssBlock(selector, proposals) {
    const lines = proposals.map((x) => `  ${x.css}: ${x.to};`);
    return `${selector || '.target'} {\n${lines.join('\n')}\n}`;
  }

  function devReport(ctx) {
    const { info, feedback, intents, proposals, notes } = ctx;
    const list = proposals.filter((x) => x.apply);
    const out = [];
    out.push(`## 修正依頼：${targetLabel(info)}`);
    out.push('');
    out.push(`- ページ：${ctx.title ? `${ctx.title} ` : ''}${ctx.url || ''}`);
    out.push(`- 対象：\`${info.selector}\``);
    out.push(`- 先方の要望：「${feedback}」`);
    if (intents && intents.length) out.push(`- 解釈：${intents.map((i) => i.label).join('・')}`);
    if (info.viewport) out.push(`- 確認した画面幅：${info.viewport.width}px`);
    out.push('');
    if (list.length) {
      out.push('| 項目 | 現在 | 変更後 |');
      out.push('| --- | --- | --- |');
      for (const x of list) out.push(`| ${x.label}（${x.css}） | ${x.from} | ${x.to}${x.note ? `（${x.note}）` : ''} |`);
      out.push('');
      out.push('```css');
      out.push(cssBlock(info.selector, list));
      out.push('```');
    } else {
      out.push('（具体的な修正案はありません）');
    }
    if (notes && notes.length) {
      out.push('');
      for (const n of notes) out.push(`※ ${n}`);
    }
    return out.join('\n');
  }

  function clientReport(ctx) {
    const { feedback, proposals, notes } = ctx;
    const list = proposals.filter((x) => x.apply && !x.hideInClient);
    const out = [];
    out.push(`「${feedback}」とのご要望について、${targetLabel(ctx.info)}を次のように調整いたします。`);
    out.push('');
    const reasons = new Set();
    for (const x of list) {
      const line = x.showValues ? `${x.reason}（${x.from} → ${x.to}）` : x.reason;
      if (reasons.has(x.reason)) continue;
      reasons.add(x.reason);
      out.push(`・${line}`);
    }
    if (!list.length) out.push('・具体的な調整内容は、改めてご相談させてください。');
    if (notes && notes.length) {
      out.push('');
      for (const n of notes) out.push(`※ ${n}`);
    }
    out.push('');
    out.push('プレビューをご確認のうえ、問題なければこの内容で修正を進めます。');
    if (ctx.signature) out.push(ctx.signature);
    return out.join('\n');
  }

  // ---------------------------------------------------------------- 専門用語 → やさしい言葉
  const GLOSSARY = [
    ['font-size', '文字の大きさ'],
    ['font-weight', '文字の太さ'],
    ['font-family', '書体'],
    ['line-height', '行の間隔'],
    ['letter-spacing', '文字の間隔'],
    ['padding', '内側の余白'],
    ['margin', '外側の余白'],
    ['border-radius', '角の丸み'],
    ['box-shadow', '影'],
    ['text-shadow', '文字の影'],
    ['z-index', '重なりの順番'],
    ['opacity', '透明度'],
    ['max-width', '最大の幅'],
    ['hover', 'マウスを乗せたとき'],
    ['レスポンシブ', '画面の幅に合わせて表示を切り替える作り'],
    ['ブレイクポイント', '表示を切り替える画面幅の境目'],
    ['ビューポート', '画面に表示される範囲'],
    ['viewport', '画面に表示される範囲'],
    ['ファーストビュー', 'ページを開いて最初に見える範囲'],
    ['CLS', '表示中にレイアウトがずれる度合い'],
    ['LCP', 'メインの内容が表示されるまでの時間'],
    ['FCP', '最初に何かが表示されるまでの時間'],
    ['INP', '操作してから画面が反応するまでの時間'],
    ['Core Web Vitals', 'Googleが重視する表示速度などの指標'],
    ['alt', '画像の代わりに読み上げられる説明文'],
    ['OGP', 'SNSでシェアされたときに表示されるタイトルや画像'],
    ['meta description', '検索結果に表示される説明文'],
    ['canonical', '正式なページのURLの指定'],
    ['noindex', '検索結果に表示させない設定'],
    ['SEO', '検索結果で見つけてもらうための対策'],
    ['SSL', '通信を暗号化して安全にする仕組み'],
    ['HTTPS', '暗号化された安全な通信'],
    ['CDN', '画像などを速く届けるための配信の仕組み'],
    ['キャッシュ', 'ブラウザが一時的に保存しているデータ'],
    ['スーパーリロード', '一時保存を使わずにページを読み込み直す操作'],
    ['リダイレクト', '別のURLへ自動で転送すること'],
    ['404', 'ページが見つからない状態'],
    ['ドメイン', 'サイトの住所にあたる名前（example.co.jp など）'],
    ['DNS', 'ドメインとサーバーを結びつける仕組み'],
    ['サーバー', 'サイトのデータを置いて配信するコンピューター'],
    ['ステージング', '公開前に確認するためのテスト環境'],
    ['本番環境', '一般の方が見る公開中の環境'],
    ['デプロイ', '修正を公開環境に反映すること'],
    ['CMS', 'サイトを更新するための管理画面'],
    ['WordPress', 'よく使われるサイト更新用のシステム'],
    ['プラグイン', 'あとから追加できる機能'],
    ['API', 'システム同士をつなぐ窓口'],
    ['JavaScript', 'ページに動きや機能を付けるプログラム'],
    ['CSS', 'ページの見た目（色・大きさ・配置）を決める指定'],
    ['HTML', 'ページの文章や構造を記述するデータ'],
    ['Webフォント', 'インターネットから読み込んで表示する書体'],
    ['パララックス', 'スクロールに合わせて奥行きが出る動き'],
    ['カルーセル', '横に切り替わって表示される画像や枠'],
    ['スライダー', '自動で切り替わる画像の表示'],
    ['モーダル', '画面の上に重なって表示される小さな窓'],
    ['ハンバーガーメニュー', '三本線のアイコンで開くメニュー'],
    ['アコーディオン', 'クリックすると開閉する表示'],
    ['CTA', '問い合わせや申し込みへ誘導するボタン'],
    ['コンバージョン', '問い合わせや購入などの成果'],
    ['CVR', '訪問者のうち成果につながった割合'],
    ['CV', '問い合わせや購入などの成果'],
    ['UI', '画面の見た目や操作部分'],
    ['UX', '使ったときの体験・使い心地'],
    ['ワイヤーフレーム', '画面の配置を決める設計図'],
    ['デザインカンプ', '完成イメージの見本'],
    ['コーディング', 'デザインをもとにページを組み立てる作業'],
    ['実装', '機能やページを実際に作り込むこと'],
    ['GA4', 'Googleのアクセス解析ツール'],
    ['GTM', '計測タグをまとめて管理するツール'],
    ['ヒートマップ', 'よく見られている場所を色で示す分析'],
    ['A/Bテスト', '2つの案を出し分けて効果を比べる方法'],
    ['コントラスト比', '文字と背景の色の差'],
    ['アクセシビリティ', '年齢や障害の有無に関わらず使いやすいこと'],
    ['ブラウザ', 'ChromeやSafariなど、サイトを見るためのソフト'],
    ['px', 'ピクセル（画面上の大きさの単位）'],
    ['rem', '基準の文字サイズに対する倍率'],
    ['em', 'その場の文字サイズに対する倍率'],
    ['ローディング', '読み込み中の表示'],
    ['遅延読み込み', '画面に近づいてから画像を読み込む工夫'],
    ['lazy load', '画面に近づいてから画像を読み込む工夫'],
    ['ファビコン', 'ブラウザのタブに表示される小さなアイコン'],
    ['パンくずリスト', '今いるページの位置を示す道順の表示'],
    ['フッター', 'ページの一番下の共通部分'],
    ['ヘッダー', 'ページの一番上の共通部分'],
  ];

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }

  const GLOSSARY_RE = GLOSSARY.map(([term, plain]) => {
    const ascii = /^[\x00-\x7f]+$/.test(term);
    const body = escapeRe(term);
    return { term, plain, re: new RegExp(ascii ? `(?<![A-Za-z0-9-])${body}(?![A-Za-z0-9-])` : body, ascii ? 'gi' : 'g') };
  }).sort((a, b) => b.term.length - a.term.length);

  /** 専門用語を「やさしい言葉（専門用語）」に置き換える。同じ用語は2回目以降やさしい言葉だけにする */
  function easyJapanese(text) {
    const src = String(text || '');
    const hits = [];
    for (const g of GLOSSARY_RE) {
      g.re.lastIndex = 0;
      let m;
      while ((m = g.re.exec(src))) {
        const s = m.index;
        const e = s + m[0].length;
        if (hits.some((h) => s < h.e && e > h.s)) continue;
        hits.push({ s, e, word: m[0], g });
      }
    }
    hits.sort((a, b) => a.s - b.s);
    const used = new Set();
    let out = '';
    let pos = 0;
    for (const h of hits) {
      out += src.slice(pos, h.s);
      const first = !used.has(h.g.term);
      used.add(h.g.term);
      out += first ? `${h.g.plain}（${h.word}）` : h.g.plain;
      pos = h.e;
    }
    out += src.slice(pos);
    const terms = [...used].map((term) => {
      const g = GLOSSARY_RE.find((x) => x.term === term);
      return { term, plain: g.plain };
    });
    return { text: out, terms };
  }

  FT.rules = { INTENTS, CHIPS, ROLE_LABELS, FONTS, analyze, devReport, clientReport, easyJapanese, targetLabel, cssBlock, sizeUp, sizeDown };
  if (typeof module === 'object' && module.exports) module.exports = FT.rules;
})(typeof globalThis !== 'undefined' ? globalThis : this);
