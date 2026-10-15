/*
 * 見積もり逆算スキャナー：サイドパネル
 */
(() => {
  'use strict';
  const { ui, bridge: B, panel } = window.WDT;
  const { $, h, snack, busy } = ui;
  const D = window.ES.detect;
  const E = window.ES.estimate;

  B.configure({ files: ['content/content.js'] });

  const MAX_SITEMAP_URLS = 10000;
  const MAX_SAMPLES = 12;

  const state = { analysis: null, prices: { ...E.DEFAULT_PRICES }, overrides: {}, origin: null };

  // ================================================================ 通信
  async function fetchText(url, timeout = 9000) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { credentials: 'include', redirect: 'follow', cache: 'no-store', signal: ac.signal });
      if (!res.ok) return { ok: false, status: res.status, text: '', type: '' };
      const type = res.headers.get('content-type') || '';
      return { ok: true, status: res.status, text: await res.text(), type, finalUrl: res.url };
    } catch (e) {
      return { ok: false, status: 0, text: '', type: '' };
    } finally {
      clearTimeout(timer);
    }
  }

  function sameSite(u, origin) {
    try {
      const a = new URL(u).hostname.replace(/^www\./, '');
      const b = new URL(origin).hostname.replace(/^www\./, '');
      return a === b;
    } catch (e) {
      return false;
    }
  }

  async function readSitemaps(origin, onProgress) {
    const robots = await fetchText(`${origin}/robots.txt`, 6000);
    let queue = robots.ok ? D.sitemapsFromRobots(robots.text) : [];
    const fromRobots = queue.length > 0;
    if (!queue.length) queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
    const seen = new Set();
    const urls = new Set();
    let read = 0;
    while (queue.length && seen.size < 40 && urls.size < MAX_SITEMAP_URLS) {
      const sm = queue.shift();
      if (seen.has(sm)) continue;
      seen.add(sm);
      const res = await fetchText(sm);
      if (!res.ok || !/<(?:urlset|sitemapindex)[\s>]/i.test(res.text)) continue;
      read++;
      const parsed = D.parseSitemap(res.text);
      queue.push(...parsed.sitemaps.filter((s) => !seen.has(s)));
      for (const u of parsed.urls) if (sameSite(u, origin)) urls.add(u);
      onProgress(`${read}ファイル・${urls.size}件`);
      // sitemap.xml が見つかったら、ほかの候補は読まない
      if (!fromRobots && read === 1 && !parsed.sitemaps.length) break;
    }
    return { urls: [...urls].slice(0, MAX_SITEMAP_URLS), files: read };
  }

  /** sitemap が無いときは、トップのリンクと、その先のページのリンクを集める */
  async function crawlLinks(origin, links, onProgress) {
    const urls = new Set(links.filter((u) => sameSite(u, origin)));
    const targets = [...urls].slice(0, 20);
    let done = 0;
    await pool(targets, 4, async (u) => {
      const res = await fetchText(u, 7000);
      done++;
      onProgress(`${done}/${targets.length}ページ`);
      if (!res.ok || !/html/i.test(res.type)) return;
      for (const m of res.text.matchAll(/href=["']([^"'#]+)["']/gi)) {
        try {
          const abs = new URL(m[1], u);
          abs.hash = '';
          if (/^https?:$/.test(abs.protocol) && sameSite(abs.href, origin) && !/\.(?:jpe?g|png|gif|webp|svg|css|js|zip|mp4)(?:\?|$)/i.test(abs.pathname)) urls.add(abs.href);
        } catch (e) {
          /* 不正なURLは無視 */
        }
      }
    });
    return [...urls];
  }

  async function pool(items, size, fn) {
    const queue = items.slice();
    await Promise.all(
      Array.from({ length: Math.min(size, queue.length) }, async () => {
        while (queue.length) await fn(queue.shift());
      })
    );
  }

  function pickSamples(groups, urls, currentUrl) {
    const byPath = (prefix) => urls.filter((u) => {
      try {
        return new URL(u).pathname.startsWith(prefix);
      } catch (e) {
        return false;
      }
    });
    const picked = [];
    const push = (u) => {
      if (u && !picked.includes(u) && u.split('#')[0] !== currentUrl.split('#')[0]) picked.push(u);
    };
    // お問い合わせ系は必ず見る（フォームがあることが多い）
    for (const u of urls) if (/contact|inquiry|toiawase|otoiawase|form|entry|request|reserve|yoyaku/i.test(u)) push(u);
    for (const c of groups.collections) {
      const list = byPath(c.path);
      push(list.find((u) => new URL(u).pathname !== c.path));
      push(list.find((u) => new URL(u).pathname === c.path));
    }
    for (const g of groups.pages) push(byPath(g.path)[0]);
    return picked.slice(0, MAX_SAMPLES);
  }

  // ================================================================ 解析
  const STEPS = [
    ['page', 'このページを解析'],
    ['sitemap', 'サイトマップ（ページ数）'],
    ['samples', '下層ページの確認'],
  ];

  function setStep(id, status, detail) {
    const li = document.querySelector(`#steps [data-step="${id}"]`);
    if (!li) return;
    li.className = status;
    li.querySelector('.st').textContent = { wait: '・', run: '…', done: '✓', fail: '!' }[status];
    if (detail != null) li.querySelector('.detail').textContent = detail;
  }

  async function scan() {
    if (!panel.usable()) return;
    const done = busy($('scanBtn'), '解析中…');
    const steps = $('steps');
    steps.hidden = false;
    steps.textContent = '';
    for (const [id, label] of STEPS) steps.append(h('li', { 'data-step': id, class: 'wait' }, h('span', { class: 'st' }, '・'), label, h('span', { class: 'detail' })));
    try {
      setStep('page', 'run');
      const page = await B.call(panel.tabId, 'analyze');
      const current = { url: page.url, ...D.fromHtml(page.html) };
      setStep('page', 'done', current.tech.slice(0, 3).join('・') || '');

      setStep('sitemap', 'run');
      const sm = await readSitemaps(page.origin, (d) => setStep('sitemap', 'run', d));
      let urls = sm.urls;
      let source = 'sitemap';
      if (!urls.length) {
        source = 'links';
        setStep('sitemap', 'run', 'sitemap.xml が無いため、リンクをたどっています');
        urls = await crawlLinks(page.origin, [page.url, ...page.links], (d) => setStep('sitemap', 'run', `リンクをたどっています ${d}`));
      }
      const groups = E.groupUrls(urls.length ? urls : [page.url]);
      setStep('sitemap', source === 'sitemap' ? 'done' : 'fail', source === 'sitemap' ? `${groups.total}ページ` : `sitemap.xml なし・リンクから${groups.total}ページ`);

      const samples = [];
      if ($('optSamples').checked) {
        const targets = pickSamples(groups, urls, page.url);
        setStep('samples', 'run', `0/${targets.length}`);
        let n = 0;
        await pool(targets, 4, async (u) => {
          const res = await fetchText(u);
          n++;
          setStep('samples', 'run', `${n}/${targets.length}`);
          samples.push(res.ok && /html/i.test(res.type) ? { url: u, ok: true, ...D.fromHtml(res.text) } : { url: u, ok: false, status: res.status });
        });
        setStep('samples', 'done', `${samples.filter((s) => s.ok).length}ページ`);
      } else setStep('samples', 'done', '省略');

      const merged = D.merge([current, ...samples.filter((s) => s.ok)]);
      state.analysis = {
        url: page.url,
        origin: page.origin,
        title: page.title,
        analyzedAt: Date.now(),
        dom: page.dom,
        pages: { total: groups.total, source, groups, templates: E.templates(groups), sitemapFiles: sm.files },
        tech: merged.tech,
        features: merged.features,
        samples: samples.map((s) => ({ url: s.url, ok: s.ok, status: s.status || 200, forms: s.ok ? s.features.forms.length : 0 })),
      };
      state.origin = page.origin;
      state.overrides = {};
      await chrome.storage.local.set({ [`est:${page.origin}`]: { analysis: state.analysis, overrides: {} } });
      renderAnalysis();
      renderEstimate();
    } catch (e) {
      snack(B.friendlyError(e), 6000);
    } finally {
      done();
    }
  }

  // ---------------------------------------------------------------- 表示
  function renderAnalysis() {
    const a = state.analysis;
    $('result').hidden = !a;
    $('scanEmpty').hidden = !!a;
    if (!a) return;
    const t = a.pages.templates;
    const f = a.features;
    const tiles = $('tiles');
    tiles.textContent = '';
    for (const [v, label] of [
      [`${a.pages.total}`, 'ページ'],
      [`${t.total}`, 'テンプレート'],
      [`${f.forms.length}`, 'フォーム'],
      [`${Math.max(1, f.langs.length)}`, '言語'],
    ]) tiles.append(h('div', { class: 'tile' }, h('b', null, v), h('span', null, label)));

    $('pagesSource').textContent = a.pages.source === 'sitemap' ? `sitemap.xml（${a.pages.sitemapFiles}ファイル）から` : 'sitemap.xml が無いため、リンクから推定';
    const cl = $('collections');
    cl.textContent = '';
    if (!a.pages.groups.collections.length) cl.append(h('li', { class: 'none' }, '見つかりませんでした'));
    for (const c of a.pages.groups.collections) cl.append(h('li', null, h('span', { class: 'pill accent' }, c.label), h('span', { class: 'path' }, c.path), h('span', { class: 'count' }, `${c.count}件`)));
    const pl = $('pages');
    pl.textContent = '';
    pl.append(h('li', null, h('span', { class: 'path' }, '/'), h('span', { class: 'muted small' }, 'トップページ'), h('span', { class: 'count' }, '1')));
    for (const g of a.pages.groups.pages.slice(0, 30)) pl.append(h('li', null, h('span', { class: 'path' }, g.path), h('span', { class: 'count' }, `${g.count}ページ`)));
    if (a.pages.groups.pages.length > 30) pl.append(h('li', { class: 'none' }, `ほか${a.pages.groups.pages.length - 30}グループ`));

    const tech = $('tech');
    tech.textContent = '';
    if (!a.tech.length) tech.append(h('span', { class: 'muted small' }, '特定できませんでした'));
    for (const x of a.tech) tech.append(h('span', { class: 'chip' }, x));

    const items = [
      [f.forms.length > 0, 'フォーム', f.forms.length ? `${f.forms.length}件` : ''],
      [f.langs.length > 1, '多言語', f.langs.length > 1 ? f.langs.join('・') : ''],
      [f.search, 'サイト内検索'],
      [f.login, '会員・ログイン'],
      [f.cart, 'カート・EC'],
      [f.map, '地図'],
      [f.video, '動画'],
      [f.slider, 'スライダー'],
      [f.scrollAnim, 'スクロール連動'],
      [f.parallax, 'パララックス'],
      [f.lottie, 'Lottie'],
      [f.webgl, '3D・WebGL'],
      [f.modal, 'モーダル'],
      [f.tabs, 'タブ切り替え'],
      [f.accordion, 'アコーディオン'],
      [f.sns, 'SNS埋め込み'],
      [f.chat, 'チャット'],
    ];
    const ul = $('features');
    ul.textContent = '';
    for (const [on, label, val] of items) ul.append(h('li', { class: on ? '' : 'off' }, h('span', { class: 'mark' }, on ? '✓' : '—'), label, val ? h('span', { class: 'val' }, val) : null));

    $('sampleCount').textContent = String(a.samples.length);
    const sl = $('samples');
    sl.textContent = '';
    for (const s of a.samples) sl.append(h('li', { class: s.ok ? '' : 'ng' }, `${s.ok ? '✓' : `×(${s.status})`} ${s.url.replace(a.origin, '')}${s.forms ? `（フォーム${s.forms}）` : ''}`));
  }

  function estimate() {
    return E.build(state.analysis, state.prices, state.overrides);
  }

  async function saveOverrides() {
    if (state.origin) await chrome.storage.local.set({ [`est:${state.origin}`]: { analysis: state.analysis, overrides: state.overrides } });
  }

  function renderEstimate() {
    const a = state.analysis;
    $('estBox').hidden = !a;
    $('estEmpty').hidden = !!a;
    if (!a) return;
    const est = estimate();
    $('total').textContent = `${E.fmt(est.total)}円`;
    $('range').textContent = `目安 ${E.fmt(est.low)}〜${E.fmt(est.high)}円`;
    $('quoteNote').hidden = !est.quotes.length;
    $('quoteNote').textContent = `※ ${est.quotes.join('・')} は金額に含めていません（要個別見積もり）`;
    const ul = $('lines');
    ul.textContent = '';
    for (const l of est.lines) {
      const cb = h('input', { type: 'checkbox', 'aria-label': l.label });
      cb.checked = l.enabled;
      cb.addEventListener('change', async () => {
        state.overrides[l.id] = { ...(state.overrides[l.id] || {}), enabled: cb.checked };
        await saveOverrides();
        renderEstimate();
      });
      const li = h(
        'li',
        { class: `line${l.enabled ? '' : ' off'}${l.quote ? ' quote' : ''}` },
        cb,
        h('span', { class: 'line-label' }, l.label),
        h('span', { class: 'line-amount' }, l.quote ? '要見積もり' : `${E.fmt(l.amount)}円`)
      );
      if (!l.quote && l.id !== 'direction') {
        const qty = h('input', { type: 'number', min: '0', step: '1', 'aria-label': `${l.label}の数量`, value: String(l.qty) });
        qty.addEventListener(
          'change',
          ui.debounce(async () => {
            state.overrides[l.id] = { ...(state.overrides[l.id] || {}), qty: Math.max(0, Number(qty.value) || 0) };
            await saveOverrides();
            renderEstimate();
          }, 150)
        );
        li.append(h('div', { class: 'line-qty' }, qty, `${l.unitLabel} × ${E.fmt(l.unit)}円`));
      }
      li.append(h('div', { class: 'line-basis' }, l.basis));
      ul.append(li);
    }
  }

  // ================================================================ 単価
  function renderPrices() {
    const box = $('prices');
    box.textContent = '';
    for (const [key, [label, note]] of Object.entries(E.PRICE_LABELS)) {
      const input = h('input', { type: 'number', min: '0', step: /Rate$/.test(key) ? '1' : '1000', value: String(state.prices[key]), 'aria-label': label });
      input.addEventListener('input', ui.debounce(async () => {
        state.prices[key] = Math.max(0, Number(input.value) || 0);
        await chrome.storage.sync.set({ prices: state.prices });
        $('priceSaved').textContent = '✓ 保存しました';
        setTimeout(() => ($('priceSaved').textContent = ''), 1500);
        renderEstimate();
      }, 300));
      box.append(h('label', { class: 'price-row' }, h('span', null, label), h('small', null, note), input));
    }
  }

  // ================================================================ 初期化
  let selectTab = () => {};

  async function loadForOrigin() {
    let origin = null;
    try {
      origin = new URL(panel.url).origin;
    } catch (e) {
      origin = null;
    }
    if (origin === state.origin) return;
    state.origin = origin;
    const saved = origin ? (await chrome.storage.local.get(`est:${origin}`))[`est:${origin}`] : null;
    state.analysis = saved ? saved.analysis : null;
    state.overrides = saved ? saved.overrides || {} : {};
    renderAnalysis();
    renderEstimate();
    $('steps').hidden = true;
  }

  function bind() {
    selectTab = ui.setupTabs('est.tab');
    $('scanBtn').addEventListener('click', scan);
    $('toEstimate').addEventListener('click', () => selectTab('tab-est'));
    $('resetOverrides').addEventListener('click', async () => {
      state.overrides = {};
      await saveOverrides();
      renderEstimate();
    });
    $('copyTsv').addEventListener('click', () => ui.copyText(E.toTsv(estimate()), 'コピーしました。Excel・スプレッドシートにそのまま貼り付けできます'));
    $('copyMd').addEventListener('click', () => ui.copyText(E.toMarkdown(estimate(), state.analysis), 'Markdownでコピーしました'));
    $('resetPrices').addEventListener('click', async () => {
      state.prices = { ...E.DEFAULT_PRICES };
      await chrome.storage.sync.set({ prices: state.prices });
      renderPrices();
      renderEstimate();
    });
    const updateTarget = () => {
      $('targetUrl').textContent = panel.label();
      $('targetUrl').title = panel.url;
      $('unavailable').hidden = panel.usable() || !panel.url;
      $('scanBtn').disabled = !panel.usable();
      loadForOrigin();
    };
    panel.on('target', updateTarget);
    panel.on('reload', updateTarget);
  }

  async function init() {
    bind();
    const stored = await chrome.storage.sync.get('prices');
    state.prices = { ...E.DEFAULT_PRICES, ...(stored.prices || {}) };
    renderPrices();
    await panel.init();
  }

  init().catch((e) => snack(B.friendlyError(e), 6000));
})();
