/*
 * 参考サイト・コラージュ：保存（IndexedDB）
 * スクリーンショットは容量が大きいので、拡張機能専用の IndexedDB に保存します。
 *   boards: { id, name, createdAt }
 *   items:  { id, boardId, order, kind, kindAuto, memo, source, size, nodes, stats, createdAt }
 *   shots:  { id, dataUrl }
 */
(function (root) {
  'use strict';
  const RC = (root.RC = root.RC || {});

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('reference-collage', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' }).createIndex('boardId', 'boardId');
        if (!db.objectStoreNames.contains('shots')) db.createObjectStore('shots', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(store, mode);
          const s = t.objectStore(store);
          let result;
          Promise.resolve(fn(s)).then((r) => (result = r));
          t.oncomplete = () => resolve(result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  const req2p = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  async function boards() {
    const list = await tx('boards', 'readonly', (s) => req2p(s.getAll()));
    return (list || []).sort((a, b) => a.createdAt - b.createdAt);
  }

  async function ensureBoard() {
    const list = await boards();
    if (list.length) return list;
    const b = { id: `board_${Date.now().toString(36)}`, name: '新しいボード', createdAt: Date.now() };
    await tx('boards', 'readwrite', (s) => s.put(b));
    return [b];
  }

  async function putBoard(b) {
    await tx('boards', 'readwrite', (s) => s.put(b));
    return b;
  }

  async function deleteBoard(id) {
    const list = await items(id);
    await tx('items', 'readwrite', (s) => list.forEach((it) => s.delete(it.id)));
    await tx('shots', 'readwrite', (s) => list.forEach((it) => s.delete(it.id)));
    await tx('boards', 'readwrite', (s) => s.delete(id));
  }

  async function items(boardId) {
    const list = await tx('items', 'readonly', (s) => req2p(s.index('boardId').getAll(boardId)));
    return (list || []).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  async function putItem(item) {
    await tx('items', 'readwrite', (s) => s.put(item));
    return item;
  }

  async function putItems(list) {
    await tx('items', 'readwrite', (s) => list.forEach((it) => s.put(it)));
  }

  async function deleteItem(id) {
    await tx('items', 'readwrite', (s) => s.delete(id));
    await tx('shots', 'readwrite', (s) => s.delete(id));
  }

  async function putShot(id, dataUrl) {
    await tx('shots', 'readwrite', (s) => s.put({ id, dataUrl }));
  }

  async function getShot(id) {
    const r = await tx('shots', 'readonly', (s) => req2p(s.get(id)));
    return r ? r.dataUrl : null;
  }

  RC.db = { open, boards, ensureBoard, putBoard, deleteBoard, items, putItem, putItems, deleteItem, putShot, getShot };
})(typeof globalThis !== 'undefined' ? globalThis : this);
