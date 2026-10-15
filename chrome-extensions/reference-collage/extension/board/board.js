/*
 * 参考サイト・コラージュ：ワイヤーフレーム画面（ボード全体）
 */
(() => {
  'use strict';
  const { ui } = window.WDT;
  const { $, h, snack } = ui;
  const W = window.RC.wire;
  const DB = window.RC.db;

  const params = new URLSearchParams(location.search);
  const state = { boards: [], boardId: params.get('board'), items: [], shots: new Map() };

  const opts = () => ({ shot: $('optShot').checked, text: $('optText').checked, memo: $('optMemo').checked });

  function svgNode(markup) {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    return document.importNode(doc.documentElement, true);
  }

  function boardName() {
    return (state.boards.find((b) => b.id === state.boardId) || { name: '構成案' }).name;
  }

  async function load() {
    state.boards = await DB.ensureBoard();
    if (!state.boards.some((b) => b.id === state.boardId)) state.boardId = state.boards[state.boards.length - 1].id;
    const sel = $('boardSel');
    sel.textContent = '';
    for (const b of state.boards) sel.append(h('option', { value: b.id }, b.name));
    sel.value = state.boardId;
    state.items = await DB.items(state.boardId);
    state.shots = new Map();
    for (const it of state.items) state.shots.set(it.id, await DB.getShot(it.id));
    render();
  }

  function render() {
    const o = opts();
    document.title = `${boardName()}｜ワイヤーフレーム`;
    $('title').textContent = boardName();
    const hosts = [...new Set(state.items.map((i) => i.source && i.source.host).filter(Boolean))];
    $('summary').textContent = state.items.length ? `${state.items.length}セクション ・ 参考サイト：${hosts.join('、')}` : '';
    const ol = $('sections');
    ol.textContent = '';
    $('empty').hidden = state.items.length > 0;
    state.items.forEach((it, i) => {
      const info = h(
        'div',
        { class: 'section-info' },
        h('div', { class: 'section-no' }, String(i + 1).padStart(2, '0')),
        h('div', { class: 'section-kind' }, W.KINDS[it.kind] || it.kind),
        h('div', { class: 'section-desc' }, W.describe(it)),
        it.source ? h('div', { class: 'section-source' }, '参考：', h('a', { href: it.source.url, target: '_blank', rel: 'noopener' }, it.source.host)) : null,
        o.memo && it.memo ? h('div', { class: 'section-memo' }, it.memo) : null
      );
      const wire = h('div', { class: 'wire' }, svgNode(W.toSvg(it, { width: 960, text: o.text })));
      const li = h('li', { class: `section${o.shot ? ' with-shot' : ''}` }, info, wire);
      if (o.shot) {
        const shot = state.shots.get(it.id);
        li.append(h('div', { class: 'shot' }, shot ? h('img', { src: shot, alt: `${it.source ? it.source.host : ''} のスクリーンショット` }) : h('div', { class: 'shot-none' }, 'スクリーンショットなし')));
      }
      ol.append(li);
    });
  }

  function boardSvg() {
    const o = opts();
    return W.boardSvg(state.items.map((it) => (o.memo ? it : { ...it, memo: '' })), { title: boardName(), text: o.text });
  }

  async function savePng() {
    const svg = boardSvg();
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => ui.download(`${boardName()}.png`, blob), 'image/png');
  }

  $('boardSel').addEventListener('change', async () => {
    state.boardId = $('boardSel').value;
    history.replaceState(null, '', `?board=${encodeURIComponent(state.boardId)}`);
    await load();
  });
  for (const id of ['optShot', 'optText', 'optMemo']) $(id).addEventListener('change', render);
  $('copyMd').addEventListener('click', () => ui.copyText(W.toMarkdown(state.items, { title: boardName() }), '構成案をコピーしました'));
  $('saveSvg').addEventListener('click', () => ui.download(`${boardName()}.svg`, boardSvg(), 'image/svg+xml'));
  $('savePng').addEventListener('click', () => savePng().catch(() => snack('PNGを作れませんでした')));
  $('print').addEventListener('click', () => print());

  load().catch((e) => snack(String(e && e.message ? e.message : e), 6000));
})();
