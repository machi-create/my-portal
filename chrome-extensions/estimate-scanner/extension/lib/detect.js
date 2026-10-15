/*
 * 見積もり逆算スキャナー：HTML から技術・機能を見つける
 *   ES.detect.fromHtml(html) → { tech: [...], features: {...} }
 *   ES.detect.parseSitemap(xml) → { urls: [...], sitemaps: [...] }
 *   ES.detect.sitemapsFromRobots(text) → [...]
 */
(function (root) {
  'use strict';
  const ES = (root.ES = root.ES || {});

  const TECH = [
    ['WordPress', /wp-content\/|wp-includes\/|\/wp-json\//i],
    ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
    ['Wix', /static\.wixstatic\.com|wix-warmup-data/i],
    ['STUDIO', /studio\.design|storage\.googleapis\.com\/studio-|content="STUDIO"/i],
    ['Jimdo', /jimdo/i],
    ['Squarespace', /squarespace/i],
    ['Webflow', /data-wf-site|webflow\.(?:js|com)/i],
    ['HubSpot', /js\.hs-scripts\.com|hs-sites\.com|hubspot/i],
    ['Movable Type', /mt-static|Movable Type/i],
    ['a-blog cms', /a-blog cms/i],
    ['EC-CUBE', /ec-cube|eccube/i],
    ['BASE', /thebase\.in|base\.shop|baseec/i],
    ['STORES', /stores\.jp/i],
    ['MakeShop', /makeshop/i],
    ['Next.js', /\/_next\/static|__NEXT_DATA__/],
    ['Nuxt', /\/_nuxt\/|__NUXT__/],
    ['Gatsby', /___gatsby/],
    ['Astro', /astro-island|\/_astro\//],
    ['React', /data-reactroot|react(?:-dom)?(?:\.production)?(?:\.min)?\.js/i],
    ['Vue', /data-v-[0-9a-f]{8}|vue(?:\.runtime)?(?:\.global)?(?:\.min)?\.js/i],
    ['jQuery', /jquery(?:[-.]\d[\d.]*)?(?:\.min)?\.js/i],
    ['Bootstrap', /bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)/i],
    ['Tailwind CSS', /tailwind|class="[^"]*\b(?:sm|md|lg|xl):[a-z-]+/],
    ['GSAP', /gsap|ScrollTrigger|TweenMax/i],
  ];

  const FEATURE_RE = {
    search: /type=["']?search|name=["']?(?:s|q|keyword|search)["'\s>]|role=["']search/i,
    login: /ログイン|マイページ|会員登録|新規登録|sign\s?in|log\s?in/i,
    cart: /カートに入れる|ショッピングカート|カートを見る|add[-_ ]to[-_ ]cart|\/cart\b|basket/i,
    map: /google\.[a-z.]+\/maps|maps\.google|maps\.googleapis|openstreetmap|mapbox/i,
    video: /youtube(?:-nocookie)?\.com\/embed|player\.vimeo\.com|<video[\s>]/i,
    slider: /swiper|slick-|splide|owl-carousel|glide__|flickity|keen-slider/i,
    scrollAnim: /data-aos|\bwow\b|scrolltrigger|data-scroll|js-fade|fade-?in|inview|is-inview|data-animate|animate__/i,
    parallax: /parallax|rellax|simpleparallax|locomotive-scroll/i,
    lottie: /lottie|bodymovin/i,
    webgl: /three(?:\.module)?(?:\.min)?\.js|webgl|pixi(?:\.min)?\.js/i,
    modal: /modal|lightbox|fancybox|luminous|glightbox|micromodal/i,
    tabs: /role=["']tablist/i,
    accordion: /<details[\s>]|accordion/i,
    sns: /twitter-tweet|instagram-media|platform\.twitter\.com|connect\.facebook\.net|tiktok-embed/i,
    chat: /zendesk|intercom|chatplus|channel\.io|tawk\.to|karakuri|zeals/i,
  };

  const ANIMATION_LABELS = { slider: 'スライダー', scrollAnim: 'スクロール連動の動き', parallax: 'パララックス', lottie: 'Lottieアニメーション', webgl: '3D・WebGL表現' };

  function countForms(html) {
    const forms = [];
    const re = /<form\b[\s\S]*?<\/form>/gi;
    let m;
    while ((m = re.exec(html))) {
      const body = m[0];
      if (/role=["']search|type=["']search/i.test(body)) continue;
      const fields = (body.match(/<(?:input(?![^>]*type=["']?(?:hidden|submit|button|image|reset)\b)|textarea|select)\b/gi) || []).length;
      if (fields >= 2) forms.push({ fields, upload: /type=["']?file/i.test(body) });
    }
    return forms;
  }

  function langsOf(html) {
    const langs = new Set();
    for (const m of html.matchAll(/hreflang=["']([a-zA-Z-]{2,10})["']/g)) {
      const l = m[1].toLowerCase();
      if (l !== 'x-default') langs.add(l.split('-')[0]);
    }
    const htmlLang = (html.match(/<html[^>]*\slang=["']([a-zA-Z-]+)["']/i) || [])[1];
    if (htmlLang) langs.add(htmlLang.toLowerCase().split('-')[0]);
    // 言語切り替えのリンク（/en/ など）
    for (const m of html.matchAll(/href=["'][^"']*\/(en|zh|zh-cn|zh-tw|cn|tw|ko|kr|fr|de|es|th|vi)\/["']/gi)) {
      const l = m[1].toLowerCase();
      langs.add({ cn: 'zh', tw: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', kr: 'ko' }[l] || l);
    }
    return [...langs];
  }

  function fromHtml(html) {
    html = String(html || '');
    const tech = [];
    for (const [name, re] of TECH) if (re.test(html)) tech.push(name);
    const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']/i);
    if (gen) {
      const g = gen[1].trim();
      if (!tech.some((t) => g.toLowerCase().includes(t.toLowerCase()))) tech.push(g.replace(/\s+[\d.]+$/, ''));
    }
    const features = {};
    for (const [k, re] of Object.entries(FEATURE_RE)) features[k] = re.test(html);
    features.forms = countForms(html);
    features.langs = langsOf(html);
    return { tech, features };
  }

  /** 複数ページの検出結果をまとめる */
  function merge(results) {
    const tech = new Set();
    const features = {};
    const forms = [];
    const langs = new Set();
    for (const r of results) {
      if (!r) continue;
      r.tech.forEach((t) => tech.add(t));
      for (const [k, v] of Object.entries(r.features)) {
        if (k === 'forms') forms.push(...v.map((f) => ({ ...f, url: r.url || '' })));
        else if (k === 'langs') v.forEach((l) => langs.add(l));
        else features[k] = features[k] || v;
      }
    }
    // 同じフォームが全ページに出ている（ヘッダーの資料請求など）場合は1つと数える
    const uniq = [];
    for (const f of forms) if (!uniq.some((u) => u.fields === f.fields && u.upload === f.upload)) uniq.push(f);
    features.forms = uniq;
    features.langs = [...langs];
    features.animations = Object.keys(ANIMATION_LABELS).filter((k) => features[k]);
    return { tech: [...tech], features };
  }

  function decodeXml(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
  }

  function parseSitemap(xml) {
    xml = String(xml || '');
    const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeXml(m[1]));
    if (/<sitemapindex[\s>]/i.test(xml)) return { urls: [], sitemaps: locs };
    return { urls: locs, sitemaps: [] };
  }

  function sitemapsFromRobots(text) {
    return [...String(text || '').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  }

  ES.detect = { TECH, ANIMATION_LABELS, fromHtml, merge, countForms, langsOf, parseSitemap, sitemapsFromRobots };
  if (typeof module === 'object' && module.exports) module.exports = ES.detect;
})(typeof globalThis !== 'undefined' ? globalThis : this);
