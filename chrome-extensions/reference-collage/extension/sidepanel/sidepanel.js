/*
 * 参考サイト・コラージュ：サイドパネル
 */
(() => {
  'use strict';
  const { ui, bridge: B, panel } = window.WDT;
  const { $, h, snack, busy } = ui;
  const W = window.RC.wire;
  const DB = window.RC.db;

  B.configure({ files: ['shared/page.js', 'shared/picker.js', 'lib/classify.js', 'content/content.js'] });

  const state = { boards: [], boardId: null, items: [], views: new Map(), shots: new Map(), dragId: null };

  // ================================================================ ボード
  async function loadBoards(selectId) {
    state.boards = await DB.ensureBoard();
    const stored = (await chrome.storage.local.get('collage.board'))['collage.board'];
    const want = selectId || state.boardId || stored;
    state.boardId = state.boards.some((b) => b.id === want) ? want : state.boards[state.boards.length - 1].id;
    await chrome.storage.local.set({ 'collage.board': state.boardId });
    const sel = $('boardSel');
    sel.textContent = '';
    for (const b of state.boards) sel.append(h('option', { value: b.id }, b.name));
    sel.value = state.boardId;
    $('boardDelete').disabled = false;
    await loadItems();
  }

  async function loadItems() {
    state.items = await DB.items(state.boardId);
    state.shots = new Map();
    for (const it of state.items) state.shots.set(it.id, await DB.getShot(it.id));
    render();
  }

  function currentBoard() {
    return state.boards.find((b) => b.id === state.boardId) || { name: '構成案' };
  }

  // ================================================================ 摘む
  async function pick() {
    if (!panel.usable()) return;
    const done = busy($('pickBtn'), 'ページ上でセクションをクリック…');
    $('pickCancel').hidden = false;
    try {
      const res = await B.call(panel.tabId, 'pickSection');
      if (res.cancelled) return;
      const sec = res.section;
      if (!sec.nodes.length) snack('中身を読み取れませんでした（画像1枚だけのセクションなどは「画像」として記録します）', 4000);
      const item = {
        id: ui.uid('sec'),
        boardId: state.boardId,
        order: state.items.length ? Math.max(...state.items.map((i) => i.order)) + 1 : 0,
        kind: sec.kind,
        kindAuto: sec.kind,
        memo: '',
        source: sec.source,
        size: sec.size,
        nodes: sec.nodes,
        stats: sec.stats,
        createdAt: Date.now(),
      };
      await DB.putItem(item);
      if ($('withShot').checked) await capture(item.id);
      snack(`「${W.KINDS[item.kind]}」として追加しました`);
      await loadItems();
      const last = document.querySelector('.item:last-child');
      if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      snack(B.friendlyError(e), 5000);
    } finally {
      $('pickCancel').hidden = true;
      done();
    }
  }

  async function capture(id) {
    try {
      const cap = await B.call(panel.tabId, 'prepareCapture');
      if (!cap) return;
      const dataUrl = await B.captureTab(panel.tabId, { format: 'jpeg', quality: 82 });
      const cropped = await B.cropImage(dataUrl, cap.rect, cap.dpr, 1000);
      await DB.putShot(id, cropped);
    } catch (e) {
      snack('スクリーンショットは保存できませんでした（ワイヤーは保存済みです）', 4000);
    } finally {
      B.callIfLoaded(panel.tabId, 'endCapture').catch(() => {});
    }
  }

  // ================================================================ 一覧
  function svgNode(markup) {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    return document.importNode(doc.documentElement, true);
  }

  async function move(id, delta) {
    const i = state.items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.items.length) return;
    const list = state.items.slice();
    [list[i], list[j]] = [list[j], list[i]];
    await saveOrder(list);
  }

  async function saveOrder(list) {
    list.forEach((it, k) => (it.order = k));
    await DB.putItems(list);
    state.items = list;
    render();
  }

  function itemEl(it, i) {
    const view = state.views.get(it.id) || 'wire';
    const shot = state.shots.get(it.id);
    const kindSel = h('select', { class: 'kind-select', 'aria-label': 'セクションの種類' });
    for (const [k, label] of Object.entries(W.KINDS)) kindSel.append(h('option', { value: k }, label + (k === it.kindAuto ? '（自動）' : '')));
    kindSel.value = it.kind;
    kindSel.addEventListener('change', async () => {
      it.kind = kindSel.value;
      await DB.putItem(it);
    });

    const memo = h('textarea', { class: 'memo', rows: '2', placeholder: 'メモ：例）実績の数字はうちも3つ並べたい' });
    memo.value = it.memo || '';
    memo.addEventListener(
      'input',
      ui.debounce(async () => {
        it.memo = memo.value;
        await DB.putItem(it);
      }, 400)
    );

    const body = h('div', { class: 'item-body' });
    if (shot) {
      body.append(
        h(
          'div',
          { class: 'seg view-seg', role: 'radiogroup', 'aria-label': '表示' },
          h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(view === 'wire'), onclick: () => { state.views.set(it.id, 'wire'); render(); } }, 'ワイヤー'),
          h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(view === 'shot'), onclick: () => { state.views.set(it.id, 'shot'); render(); } }, '参考スクショ')
        )
      );
    }
    if (view === 'shot' && shot) body.append(h('img', { class: 'shot', src: shot, alt: '参考サイトのスクリーンショット' }));
    else body.append(h('div', { class: 'wire-wrap' }, h('div', { class: 'wire' }, svgNode(W.toSvg(it, { width: 340 })))));
    const desc = W.describe(it);
    body.append(
      h(
        'div',
        { class: 'item-meta' },
        desc ? h('span', null, desc) : null,
        it.source && it.source.host ? h('a', { href: it.source.url, target: '_blank', rel: 'noopener', title: it.source.title || it.source.url }, `参考：${it.source.host}`) : null
      ),
      memo
    );

    const li = h(
      'li',
      { class: 'item', 'data-id': it.id },
      h(
        'div',
        { class: 'item-head' },
        h('span', { class: 'handle', draggable: 'true', title: 'ドラッグで並べ替え' }, '⋮⋮'),
        h('span', { class: 'item-no' }, String(i + 1).padStart(2, '0')),
        kindSel,
        h('button', { class: 'icon-btn', type: 'button', title: '上へ', disabled: i === 0, onclick: () => move(it.id, -1) }, '↑'),
        h('button', { class: 'icon-btn', type: 'button', title: '下へ', disabled: i === state.items.length - 1, onclick: () => move(it.id, 1) }, '↓'),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          title: '削除',
          onclick: async () => {
            await DB.deleteItem(it.id);
            snack('削除しました');
            await loadItems();
          },
        }, '✕')
      ),
      body
    );

    // ドラッグで並べ替え
    const handle = li.querySelector('.handle');
    handle.addEventListener('dragstart', (e) => {
      state.dragId = it.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', it.id);
    });
    handle.addEventListener('dragend', () => {
      state.dragId = null;
      li.classList.remove('dragging');
      document.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
    });
    li.addEventListener('dragover', (e) => {
      if (!state.dragId || state.dragId === it.id) return;
      e.preventDefault();
      document.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
      li.classList.add('drop-before');
    });
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      const fromId = state.dragId || e.dataTransfer.getData('text/plain');
      if (!fromId || fromId === it.id) return;
      const list = state.items.filter((x) => x.id !== fromId);
      const moving = state.items.find((x) => x.id === fromId);
      list.splice(list.findIndex((x) => x.id === it.id), 0, moving);
      await saveOrder(list);
    });
    return li;
  }

  function render() {
    const ol = $('items');
    ol.textContent = '';
    state.items.forEach((it, i) => ol.append(itemEl(it, i)));
    $('empty').hidden = state.items.length > 0;
    $('exportCard').hidden = state.items.length === 0;
  }

  // ================================================================ 書き出し
  async function openBoard() {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`board/board.html?board=${encodeURIComponent(state.boardId)}`) });
  }

  // ================================================================ 初期化
  function bind() {
    $('pickBtn').addEventListener('click', pick);
    $('pickCancel').addEventListener('click', () => B.callIfLoaded(panel.tabId, 'cancelPick').catch(() => {}));
    $('boardSel').addEventListener('change', async () => {
      state.boardId = $('boardSel').value;
      await chrome.storage.local.set({ 'collage.board': state.boardId });
      await loadItems();
    });
    $('boardNew').addEventListener('click', async () => {
      const b = await DB.putBoard({ id: ui.uid('board'), name: `ボード ${state.boards.length + 1}`, createdAt: Date.now() });
      await loadBoards(b.id);
      $('renameRow').hidden = false;
      $('boardName').value = b.name;
      $('boardName').select();
    });
    $('boardRename').addEventListener('click', () => {
      $('renameRow').hidden = !$('renameRow').hidden;
      $('boardName').value = currentBoard().name;
      $('boardName').focus();
    });
    const saveName = async () => {
      const name = $('boardName').value.trim();
      if (!name) return;
      await DB.putBoard({ ...currentBoard(), name });
      $('renameRow').hidden = true;
      await loadBoards(state.boardId);
    };
    $('renameSave').addEventListener('click', saveName);
    $('boardName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveName();
    });
    $('boardDelete').addEventListener('click', () => ($('deleteConfirm').hidden = false));
    $('deleteNo').addEventListener('click', () => ($('deleteConfirm').hidden = true));
    $('deleteYes').addEventListener('click', async () => {
      await DB.deleteBoard(state.boardId);
      $('deleteConfirm').hidden = true;
      state.boardId = null;
      await loadBoards();
      snack('ボードを削除しました');
    });
    $('openBoard').addEventListener('click', openBoard);
    $('copyMd').addEventListener('click', () => ui.copyText(W.toMarkdown(state.items, { title: currentBoard().name }), '構成案をコピーしました'));
    $('saveSvg').addEventListener('click', () => ui.download(`${currentBoard().name}.svg`, W.boardSvg(state.items, { title: currentBoard().name }), 'image/svg+xml'));

    const updateTarget = () => {
      $('targetUrl').textContent = panel.label();
      $('targetUrl').title = panel.url;
      $('unavailable').hidden = panel.usable() || !panel.url;
      $('pickBtn').disabled = !panel.usable();
    };
    panel.on('target', updateTarget);
    panel.on('reload', updateTarget);
    // ワイヤーフレーム画面で並べ替えたときなど
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'collage-changed') loadItems();
    });
  }

  async function init() {
    bind();
    await loadBoards();
    await panel.init();
  }

  init().catch((e) => snack(B.friendlyError(e), 6000));
})();
