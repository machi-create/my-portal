/*
 * 工数オートログ：プロジェクトへの振り分けルール
 *
 *   example.co.jp            このドメイン（サブドメインも含む）
 *   backlog.jp/view/ABC-     このURLで始まるページ（* は任意の文字）
 *   title:A社                ページタイトルに「A社」を含む
 *   # から後ろはメモ（無視されます）
 *
 * 複数のルールに当てはまるときは、タイトル → URL → ドメインの順に、より細かいルールを優先します。
 */
(function (root) {
  'use strict';
  const TA = (root.TA = root.TA || {});

  const norm = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase();

  function asciiHost(host) {
    try {
      return new URL('http://' + host).host;
    } catch (e) {
      return String(host).toLowerCase();
    }
  }

  /** 記録するページの情報（http/https 以外は null）。? と # 以降は記録しない */
  function pageOf(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { host: u.host, path: u.pathname || '/' };
  }

  function parseLine(line) {
    let s = String(line).replace(/(^|\s)#.*$/, '').trim();
    if (!s) return null;
    const t = s.match(/^(?:title|タイトル)\s*[:：]\s*(.+)$/i);
    if (t) {
      const text = t[1].trim();
      const value = norm(text);
      return value ? { type: 'title', value, text, raw: s, score: 3000 + value.length } : null;
    }
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[?#].*$/, '').replace(/^\*\./, '');
    const slash = s.indexOf('/');
    const hostPart = slash < 0 ? s : s.slice(0, slash);
    const pathPart = slash < 0 ? '' : s.slice(slash);
    if (!hostPart || /\s/.test(hostPart)) return null;
    const host = asciiHost(hostPart).replace(/^www\./, '');
    const withPort = /:\d+$/.test(host);
    if (!pathPart.replace(/\/+$/, '')) return { type: 'host', host, withPort, raw: s, score: 1000 + host.length };
    return { type: 'path', host, withPort, pattern: pathPart.toLowerCase().replace(/\*+/g, '*'), raw: s, score: 2000 + host.length + pathPart.length };
  }

  function parseRules(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(parseLine)
      .filter(Boolean);
  }

  /**
   * パスの前方一致（* は任意の文字）。正規表現を使わず、* がいくつあっても長さに比例した時間で判定する
   */
  function globPrefix(pattern, text) {
    const p = `${pattern}*`;
    const t = String(text || '').toLowerCase();
    let i = 0;
    let j = 0;
    let star = -1;
    let mark = 0;
    while (j < t.length) {
      if (i < p.length && p[i] === '*') {
        star = i++;
        mark = j;
      } else if (i < p.length && p[i] === t[j]) {
        i++;
        j++;
      } else if (star >= 0) {
        i = star + 1;
        j = ++mark;
      } else return false;
    }
    while (i < p.length && p[i] === '*') i++;
    return i === p.length;
  }

  function hostMatches(rule, host) {
    const h = String(host || '').toLowerCase();
    const target = rule.withPort ? h : h.replace(/:\d+$/, '');
    return target === rule.host || target.endsWith('.' + rule.host);
  }

  function matches(rule, page, titleNorm) {
    if (rule.type === 'title') return titleNorm.includes(rule.value);
    if (!hostMatches(rule, page.host)) return false;
    return rule.type === 'host' || globPrefix(rule.pattern, page.path || '/');
  }

  /** プロジェクト一覧から「ページ → プロジェクトID」の判定関数を作る */
  function compile(projects) {
    const list = (projects || []).map((p) => ({ id: p.id, rules: parseRules(p.rules) }));
    return function classify(page) {
      if (!page || page.manual || !page.host) return null;
      const titleNorm = norm(page.title);
      let best = null;
      let bestScore = 0;
      for (const p of list) {
        for (const r of p.rules) {
          if (r.score > bestScore && matches(r, page, titleNorm)) {
            best = p.id;
            bestScore = r.score;
          }
        }
      }
      return best;
    };
  }

  /** 「記録しないサイト」の判定関数 */
  function compileExclude(text) {
    const rules = parseRules(text);
    return (page) => {
      if (!page || !rules.length) return false;
      const titleNorm = norm(page.title);
      return rules.some((r) => matches(r, page, titleNorm));
    };
  }

  /**
   * 未分類のページから、振り分け用のルールを提案する。
   * Googleドキュメント・Figma・Backlog など、1つのサイトに複数の案件が混ざるサービスは「そのファイル・課題」単位で提案する。
   */
  function suggest(page) {
    const host = String(page.host || '').toLowerCase().replace(/^www\./, '');
    const hn = host.replace(/:\d+$/, '');
    const seg = String(page.path || '/').split('/').filter(Boolean);
    const title = cleanLabel(page.title);
    const byPage = (rule) => ({ rule, label: title || rule, kind: 'page' });
    const at = (name) => seg.indexOf(name);

    if (hn === 'docs.google.com' && at('d') >= 0 && seg[at('d') + 1]) return byPage(`${host}/*/d/${seg[at('d') + 1]}`);
    if (hn === 'drive.google.com') {
      if (at('folders') >= 0 && seg[at('folders') + 1]) return byPage(`${host}/*/folders/${seg[at('folders') + 1]}`);
      if (at('d') >= 0 && seg[at('d') + 1]) return byPage(`${host}/file/d/${seg[at('d') + 1]}`);
    }
    if ((hn === 'figma.com' || hn.endsWith('.figma.com')) && ['file', 'design', 'proto', 'board', 'slides', 'deck', 'make'].includes(seg[0]) && seg[1]) {
      return byPage(`figma.com/*/${seg[1]}`);
    }
    if (['github.com', 'gitlab.com', 'bitbucket.org'].includes(hn) && seg[0] && seg[1]) return byPage(`${host}/${seg[0]}/${seg[1]}`);
    if (/(^|\.)(backlog\.jp|backlog\.com|backlogtool\.com)$/.test(hn)) {
      let key = null;
      if (seg[0] === 'view' && seg[1]) key = (seg[1].match(/^([A-Z0-9_]+)-\d+$/) || [])[1] || null;
      else if (seg[1] && /^[A-Z0-9_]+$/.test(seg[1])) key = seg[1];
      if (key) return { rule: `${host}/*/${key}`, label: `${key}（${host}）`, kind: 'page' };
    }
    if (hn === 'app.slack.com' && seg[0] === 'client' && seg[2]) return byPage(`${host}/client/${seg[1]}/${seg[2]}`);
    if ((hn === 'notion.so' || hn.endsWith('.notion.site')) && seg.length) {
      const id = (seg[seg.length - 1].match(/([0-9a-f]{32})$/i) || [])[1];
      if (id) return byPage(`${host}/*${id}`);
    }
    if (hn === 'miro.com' && seg[0] === 'app' && seg[1] === 'board' && seg[2]) return byPage(`${host}/app/board/${seg[2]}`);
    if (hn === 'canva.com' && seg[0] === 'design' && seg[1]) return byPage(`${host}/design/${seg[1]}`);
    return { rule: host, label: host, kind: 'site' };
  }

  /** タイトルから通知件数などを除いて、表示用にする */
  function cleanLabel(title) {
    return String(title || '')
      .replace(/^\(\d+\+?\)\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** ルールの文字列を、人が読める説明にする */
  function describe(line) {
    const r = parseLine(line);
    if (!r) return '';
    if (r.type === 'title') return `タイトルに「${r.text}」を含むページ`;
    if (r.type === 'host') return `${r.host}（サブドメインも含む）`;
    return `${r.raw} で始まるページ`;
  }

  /** ルールの文字列に、同じ行がなければ追加する */
  function addRule(text, rule) {
    const lines = String(text || '').split(/\r?\n/);
    if (lines.some((l) => l.trim() === rule.trim())) return text;
    const body = lines.join('\n').replace(/\s+$/, '');
    return body ? `${body}\n${rule}` : rule;
  }

  TA.rules = { norm, pageOf, parseLine, parseRules, compile, compileExclude, suggest, cleanLabel, describe, addRule, hostMatches, globPrefix };
  if (typeof module === 'object' && module.exports) module.exports = TA.rules;
})(typeof globalThis !== 'undefined' ? globalThis : this);
