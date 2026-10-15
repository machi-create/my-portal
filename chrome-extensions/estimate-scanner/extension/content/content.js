/*
 * 見積もり逆算スキャナー：ページ側の処理（いま開いているページの HTML・リンク・見た目の情報を集める）
 */
(() => {
  'use strict';
  const WDT = (globalThis.WDT = globalThis.WDT || {});
  if (WDT.api) return;

  function sameSiteLinks() {
    const out = new Set();
    const host = location.hostname.replace(/^www\./, '');
    for (const a of document.querySelectorAll('a[href]')) {
      try {
        const u = new URL(a.getAttribute('href'), document.baseURI);
        if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) continue;
        u.hash = '';
        if (/\.(?:jpe?g|png|gif|webp|svg|zip|mp4)$/i.test(u.pathname)) continue;
        out.add(u.href);
        if (out.size >= 1500) break;
      } catch (e) {
        /* 不正なURLは無視 */
      }
    }
    return [...out];
  }

  function animatedCount() {
    let n = 0;
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    const limit = Math.min(all.length, 4000);
    for (let i = 0; i < limit; i++) {
      const cs = getComputedStyle(all[i]);
      if (cs.animationName && cs.animationName !== 'none') n++;
    }
    return n;
  }

  WDT.api = {
    analyze() {
      const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      return {
        url: location.href,
        origin: location.origin,
        title: document.title,
        html: document.documentElement.outerHTML.slice(0, 1500000),
        links: sameSiteLinks(),
        dom: {
          screens: Math.round((docH / Math.max(1, innerHeight)) * 10) / 10,
          images: document.images.length,
          animated: animatedCount(),
        },
      };
    },
    clear() {
      return true;
    },
  };
})();
