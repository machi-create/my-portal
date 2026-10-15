/*
 * ペルソナ憑依モード：サイドパネル
 */
(() => {
  'use strict';
  const { ui, bridge: B, panel, ai } = window.WDT;
  const { $, h, snack } = ui;
  const PS = window.PM.personas;

  B.configure({ files: ['shared/page.js', 'shared/color.js', 'lib/personas.js', 'content/content.js'], css: ['content/content.css'] });

  const SEV = { error: ['danger', '要改善'], warn: ['warn', '注意'], info: ['info', '情報'], good: ['ok', 'OK'] };
  const state = { persona: null, raw: null, findings: [], hand: 'right', aiStatus: 'unsupported', aiLines: null };

  const persona = () => PS.PERSONAS.find((p) => p.id === state.persona);

  // ================================================================ ペルソナの選択
  function renderPicker() {
    const box = $('personas');
    box.textContent = '';
    for (const p of PS.PERSONAS) {
      box.append(
        h('button', {
          class: 'persona',
          type: 'button',
          role: 'radio',
          'aria-checked': String(p.id === state.persona),
          title: p.name,
          onclick: () => select(p.id),
        }, h('b', null, p.short), h('span', null, p.desc))
      );
    }
  }

  async function select(id) {
    state.persona = id;
    state.aiLines = null;
    renderPicker();
    const p = persona();
    $('active').hidden = false;
    $('empty').hidden = true;
    $('pName').textContent = p.name;
    $('pDesc').textContent = p.desc;
    const e = p.effects;
    const desc = [e.blur && `ぼかし${e.blur}px`, e.cvd && `色覚${e.cvd.toUpperCase()}型の見え方`, e.sepia && 'レンズの黄ばみ', e.contrast && e.contrast !== 1 && 'コントラスト低下', e.thumb && '親指の届く範囲'].filter(Boolean).join('・');
    $('effectRow').hidden = !desc;
    $('effectDesc').textContent = desc ? `（${desc}）` : '';
    $('zoomRow').hidden = !p.zoom;
    $('handRow').hidden = !e.thumb;
    const notes = [];
    if (e.thumb && panel.usable()) notes.push('スマホの画面幅で確認すると正確です（デベロッパーツールのデバイスモードなど）。');
    if (id === 'slow') notes.push('実際の遅さは、デベロッパーツールの「ネットワーク」で通信速度を「低速 4G」などに制限して確認できます。');
    $('personaNote').hidden = !notes.length;
    $('personaNote').textContent = notes.join(' ');
    await apply();
  }

  async function apply() {
    if (!state.persona || !panel.usable()) return;
    const p = persona();
    try {
      await syncZoom();
      await B.call(panel.tabId, 'applyEffects', $('effectOn').checked ? { ...p.effects, hand: state.hand } : { thumb: p.effects.thumb, hand: state.hand });
      await measure();
    } catch (e) {
      snack(B.friendlyError(e), 5000);
    }
  }

  async function syncZoom() {
    const p = persona();
    const want = p && p.zoom && $('zoomOn').checked;
    const key = `zoom:${panel.tabId}`;
    const saved = (await chrome.storage.session.get(key))[key];
    if (want && saved == null) {
      const cur = await chrome.tabs.getZoom(panel.tabId);
      await chrome.storage.session.set({ [key]: cur });
      await chrome.tabs.setZoom(panel.tabId, cur * 1.25);
      await new Promise((r) => setTimeout(r, 300));
    } else if (!want && saved != null) {
      await chrome.tabs.setZoom(panel.tabId, saved);
      await chrome.storage.session.remove(key);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async function measure() {
    state.raw = await B.call(panel.tabId, 'measure');
    state.findings = PS.findings(state.persona, state.raw);
    render();
  }

  async function stop() {
    state.persona = null;
    renderPicker();
    $('active').hidden = true;
    $('empty').hidden = false;
    $('zoomOn').checked = false;
    if (panel.tabId != null) {
      await syncZoom().catch(() => {});
      await B.callIfLoaded(panel.tabId, 'clear').catch(() => {});
    }
  }

  // ================================================================ 表示
  function render() {
    const lines = state.aiLines || PS.narrate(state.persona, state.findings);
    const voice = $('voice');
    voice.textContent = '';
    for (const l of lines) voice.append(h('li', { class: state.aiLines ? 'ai' : '' }, l));
    $('aiVoice').hidden = state.aiStatus !== 'available';

    const issues = state.findings.filter((f) => f.severity !== 'good');
    $('findingCount').textContent = issues.length ? `${issues.length}件` : 'なし';
    const ul = $('findings');
    ul.textContent = '';
    for (const f of state.findings) {
      const [cls, label] = SEV[f.severity];
      const items = h('ul', { class: 'finding-items' });
      f.items.slice(0, 6).forEach((it) => {
        const clickable = !!(it.refId || it.find);
        const li = h('li', { class: clickable ? 'clickable' : null, tabindex: clickable ? '0' : null, role: clickable ? 'button' : null }, it.text);
        if (clickable) {
          const go = async () => {
            try {
              if (it.refId) {
                const r = await B.call(panel.tabId, 'focus', { refId: it.refId });
                if (!r.ok) snack('ページが変わったため見つかりません。「測り直す」を押してください');
                else if (r.hidden) snack('非表示の要素です');
              } else {
                const r = await B.call(panel.tabId, 'findText', { term: it.find });
                if (!r.found) snack('ページ内で見つかりませんでした');
              }
            } catch (e) {
              snack(B.friendlyError(e));
            }
          };
          li.addEventListener('click', go);
          li.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              go();
            }
          });
        }
        items.append(li);
      });
      if (f.items.length > 6) items.append(h('li', { class: 'muted' }, `ほか${f.items.length - 6}件`));
      const refIds = f.items.map((x) => x.refId).filter(Boolean);
      ul.append(
        h(
          'li',
          { class: `finding ${f.severity}` },
          h(
            'div',
            {
              class: 'finding-head',
              title: refIds.length ? 'クリックで、ページ上の該当箇所に枠を表示' : null,
              onclick: () => refIds.length && B.call(panel.tabId, 'mark', { refIds }).catch(() => {}),
            },
            h('span', { class: `pill ${cls}` }, label),
            h('span', { class: 'finding-title' }, f.title)
          ),
          f.detail ? h('p', { class: 'finding-detail' }, f.detail) : null,
          f.items.length ? items : null
        )
      );
    }
  }

  function report() {
    const p = persona();
    const out = [`【${p.name}になって見たとき】${state.raw.title || ''}`, state.raw.url, ''];
    for (const l of state.aiLines || PS.narrate(state.persona, state.findings)) out.push(`「${l}」`);
    out.push('');
    for (const f of state.findings.filter((x) => x.severity !== 'good')) {
      out.push(`■ ${SEV[f.severity][1]}：${f.title}`);
      if (f.detail) out.push(`  ${f.detail}`);
      for (const it of f.items.slice(0, 5)) out.push(`  - ${it.text}`);
    }
    return out.join('\n');
  }

  async function aiVoice() {
    const p = persona();
    const done = ui.busy($('aiVoice'), '考えています…');
    try {
      const facts = state.findings.filter((f) => f.severity !== 'good').map((f) => `- ${f.title}`).join('\n') || '- 特に問題は見つかりませんでした';
      const system = `あなたは「${p.name}」です。${p.desc}\nWebページを使ってみて困ったことを、その人の口調で、1行ずつ3〜5行のひとりごとにしてください。事実は次の検出結果だけを使い、新しい問題を作らないでください。行頭に記号は付けないでください。`;
      const text = await ai.prompt(system, `ページ：${state.raw.title}\n検出結果：\n${facts}`);
      state.aiLines = String(text).split(/\r?\n/).map((s) => s.replace(/^[-・*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 5);
      render();
    } catch (e) {
      snack('AIで実況できませんでした', 4000);
    } finally {
      done();
    }
  }

  // ================================================================ 初期化
  function bind() {
    renderPicker();
    $('stopBtn').addEventListener('click', stop);
    $('effectOn').addEventListener('change', apply);
    $('zoomOn').addEventListener('change', apply);
    for (const b of document.querySelectorAll('[data-hand]')) {
      b.addEventListener('click', () => {
        state.hand = b.dataset.hand;
        for (const x of document.querySelectorAll('[data-hand]')) x.setAttribute('aria-checked', String(x === b));
        apply();
      });
    }
    $('remeasure').addEventListener('click', () => measure().catch((e) => snack(B.friendlyError(e))));
    $('copyReport').addEventListener('click', () => state.raw && ui.copyText(report(), '結果をコピーしました'));
    $('aiVoice').addEventListener('click', aiVoice);
    const onTarget = () => {
      $('targetUrl').textContent = panel.label();
      $('targetUrl').title = panel.url;
      $('unavailable').hidden = panel.usable() || !panel.url;
      if (state.persona) setTimeout(apply, 300);
    };
    panel.on('target', onTarget);
    panel.on('reload', onTarget);
  }

  async function init() {
    bind();
    await panel.init();
    ai.mountStatus($('aiStatus'), (st) => {
      state.aiStatus = st;
      if (state.persona && state.raw) render();
    });
  }

  init().catch((e) => snack(B.friendlyError(e), 6000));
})();
