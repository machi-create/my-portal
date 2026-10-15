// node --test chrome-extensions/time-autolog/test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../extension/lib/rules.js');
const L = require('../extension/lib/log.js');
const T = require('../extension/lib/track.js');
const RP = require('../extension/lib/report.js');
const PAL = require('../extension/lib/palette.js');

const at = (hm, key = '2026-10-15') => {
  const [h, m] = hm.split(':').map(Number);
  return L.dayStart(key) + (h * 60 + m) * 60000;
};
const page = (url, title = '') => ({ ...R.pageOf(url), title });

const projects = [
  { id: 'a', name: 'A社リニューアル', color: 0, rules: 'a-sha.co.jp\ntest.example.net/a-sha/   # テスト環境\ntitle:【A社】' },
  { id: 'b', name: 'B社LP', color: 1, rules: 'figma.com/*/KEYB\nabc.backlog.jp/*/BLP\nlocalhost:3000' },
  { id: 'n', name: '社内', color: 2, rules: 'docs.google.com\nmail.google.com' },
];

test('ルール：ドメイン（サブドメイン・www・ポート・日本語ドメイン）', () => {
  const c = R.compile(projects);
  assert.equal(c(page('https://www.a-sha.co.jp/')), 'a');
  assert.equal(c(page('https://stg.a-sha.co.jp/news/')), 'a', 'サブドメインも含む');
  assert.equal(c(page('https://not-a-sha.co.jp/')), null, '似た名前の別ドメインは含まない');
  assert.equal(c(page('http://localhost:3000/lp/')), 'b');
  assert.equal(c(page('http://localhost:8080/')), null, 'ポートを書いたら、そのポートだけ');
  const jp = R.compile([{ id: 'j', name: 'J', rules: '例え.jp' }]);
  assert.equal(jp(page('https://www.例え.jp/')), 'j');
  assert.equal(R.compile([{ id: 'x', rules: 'localhost' }])(page('http://localhost:5173/')), 'x', 'ポートを書かなければ、どのポートでも');
});

test('ルール：URL（*）・タイトル・優先順位・コメント', () => {
  const c = R.compile(projects);
  assert.equal(c(page('https://test.example.net/a-sha/top.html')), 'a');
  assert.equal(c(page('https://test.example.net/other/')), null);
  assert.equal(c(page('https://www.figma.com/design/KEYB/LP-Design?node-id=1')), 'b');
  assert.equal(c(page('https://www.figma.com/file/KEYB/LP')), 'b', 'file/design どちらのURLでも');
  assert.equal(c(page('https://abc.backlog.jp/view/BLP-12')), 'b');
  assert.equal(c(page('https://abc.backlog.jp/projects/BLP')), 'b');
  // docs.google.com は「社内」だが、タイトルに【A社】があれば A社（タイトルのルールが優先）
  assert.equal(c(page('https://docs.google.com/document/d/xyz/edit', '社内メモ - Google ドキュメント')), 'n');
  assert.equal(c(page('https://docs.google.com/document/d/abc/edit', '【A社】要件定義書 - Google ドキュメント')), 'a');
  // タイトルは全角・半角、大文字・小文字を区別しない
  assert.equal(R.compile([{ id: 't', rules: 'title:ａｂｃ' }])(page('https://x.jp/', 'ABC案件')), 't');
  assert.deepEqual(R.parseRules('# メモだけ\n\n  \nexample.com # 本番'), [R.parseLine('example.com')]);
  assert.equal(R.parseRules('https://www.example.com/path/?q=1#top')[0].raw, 'www.example.com/path/');
  assert.equal(R.describe('title:A社'), 'タイトルに「A社」を含むページ');
});

test('記録しないサイト', () => {
  const ex = R.compileExclude('youtube.com\nmail.google.com/mail/u/1/\ntitle:プライベート');
  assert.ok(ex(page('https://www.youtube.com/watch?v=1')));
  assert.ok(ex(page('https://mail.google.com/mail/u/1/')));
  assert.ok(!ex(page('https://mail.google.com/mail/u/0/')));
  assert.ok(ex(page('https://example.com/', 'プライベートな予定')));
  assert.ok(!R.compileExclude('')(page('https://example.com/')));
});

test('振り分けの提案：共有サービスは「ファイル・課題」単位で提案する', () => {
  const s = (url, title) => R.suggest(page(url, title));
  assert.deepEqual(s('https://docs.google.com/spreadsheets/u/1/d/SHEET1/edit', '(2) 工数表 - Google スプレッドシート'), { rule: 'docs.google.com/*/d/SHEET1', label: '工数表 - Google スプレッドシート', kind: 'page' });
  assert.equal(s('https://www.figma.com/design/KEY9/Name').rule, 'figma.com/*/KEY9');
  assert.equal(s('https://abc.backlog.jp/view/WEB-301').rule, 'abc.backlog.jp/*/WEB');
  assert.equal(s('https://abc.backlog.jp/view/WEB-301').label, 'WEB（abc.backlog.jp）');
  assert.equal(s('https://github.com/org/repo/pull/3').rule, 'github.com/org/repo');
  assert.equal(s('https://app.slack.com/client/T01/C02', '#a社-案件').rule, 'app.slack.com/client/T01/C02');
  assert.deepEqual(s('https://www.client.co.jp/about/', '会社概要'), { rule: 'client.co.jp', label: 'client.co.jp', kind: 'site' });
  // 提案したルールで、元のページが振り分けられる
  for (const url of ['https://docs.google.com/document/d/D1/edit', 'https://www.figma.com/design/K/x', 'https://abc.backlog.jp/view/WEB-1', 'https://www.client.co.jp/x']) {
    const p = page(url);
    assert.equal(R.compile([{ id: 'z', rules: R.suggest(p).rule }])(p), 'z', url);
  }
  assert.equal(R.addRule('a.jp', 'b.jp'), 'a.jp\nb.jp');
  assert.equal(R.addRule('a.jp\nb.jp\n', 'b.jp'), 'a.jp\nb.jp\n', '同じルールは追加しない');
});

test('記録：同じページはつなげ、日付をまたぐと分ける', () => {
  const list = [];
  const p = { host: 'a-sha.co.jp', path: '/', title: 'トップ' };
  L.append(list, { ...p, s: at('10:00'), e: at('10:01') });
  L.append(list, { ...p, s: at('10:01'), e: at('10:02') });
  assert.equal(list.length, 1);
  assert.equal(list[0].e, at('10:02'));
  L.append(list, { ...p, title: '会社概要', s: at('10:02'), e: at('10:03') });
  L.append(list, { ...p, s: at('10:03'), e: at('10:04') });
  assert.equal(list.length, 3, '別のページをはさんだら、つなげない');
  L.append(list, { ...p, s: at('10:04'), e: at('10:04') + 500 });
  assert.equal(list.length, 3, '1秒未満は記録しない');
  const parts = L.splitByDay({ ...p, s: at('23:58'), e: at('23:58') + 5 * 60000 });
  assert.deepEqual(parts.map((x) => x.key), ['2026-10-15', '2026-10-16']);
  assert.equal(parts[0].seg.e - parts[0].seg.s, 2 * 60000);
  assert.equal(L.cleanTitle('(3) 受信トレイ (12) - me@example.com - Gmail'), '受信トレイ - me@example.com - Gmail');
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
});

test('記録：スリープなどでハートビートが途切れたら、途切れる前までにする', () => {
  const cur = { s: at('10:00'), beat: at('10:05') };
  assert.equal(L.closeAt(cur, at('10:06')), at('10:06'));
  assert.equal(L.closeAt(cur, at('11:30')), at('10:06'), '1時間後に戻っても、その間は数えない');
});

test('いま記録するか：休止・前面・音・シークレット・除外', () => {
  const tab = { id: 1, url: 'https://a-sha.co.jp/', title: 'トップ', audible: false, incognito: false };
  const base = { paused: false, idleState: 'active', chromeFocused: true, tab, settings: { exclude: 'youtube.com' } };
  assert.equal(T.decide(base).state, 'recording');
  assert.equal(T.decide({ ...base, paused: true }).state, 'paused');
  assert.equal(T.decide({ ...base, idleState: 'idle' }).state, 'idle');
  assert.equal(T.decide({ ...base, idleState: 'idle', tab: { ...tab, audible: true } }).state, 'recording', '会議など音が出ているタブは続ける');
  assert.equal(T.decide({ ...base, idleState: 'idle', tab: { ...tab, audible: true }, settings: { keepAudible: false } }).state, 'idle');
  assert.equal(T.decide({ ...base, idleState: 'locked', tab: { ...tab, audible: true } }).state, 'idle', '画面ロックは必ず止める');
  assert.equal(T.decide({ ...base, chromeFocused: false }).state, 'away');
  assert.equal(T.decide({ ...base, chromeFocused: false, settings: { recordUnfocused: true } }).state, 'recording');
  assert.equal(T.decide({ ...base, tab: { ...tab, incognito: true } }).state, 'private');
  assert.equal(T.decide({ ...base, tab: { ...tab, url: 'chrome://newtab/' } }).state, 'other');
  assert.equal(T.decide({ ...base, tab: { ...tab, url: 'https://www.youtube.com/watch?v=1' } }).state, 'excluded');
  const d = T.decide({ ...base, tab: { ...tab, url: 'https://a-sha.co.jp/news/?id=3#top', title: '(2) お知らせ' } });
  assert.deepEqual([d.host, d.path, d.title], ['a-sha.co.jp', '/news/', 'お知らせ'], 'クエリ・#・通知件数は記録しない');
});

const daySegs = () => [
  { s: at('09:00'), e: at('09:40'), host: 'www.a-sha.co.jp', path: '/', title: 'A社 トップ' },
  { s: at('09:41'), e: at('10:00'), host: 'docs.google.com', path: '/document/d/abc/edit', title: '【A社】要件定義書 - Google ドキュメント' },
  { s: at('10:00'), e: at('10:30'), host: 'www.figma.com', path: '/design/KEYB/LP', title: 'LP – Figma' },
  { s: at('10:30'), e: at('10:45'), host: 'news.example.jp', path: '/', title: 'ニュース' },
  { s: at('10:45'), e: at('11:00'), host: 'www.figma.com', path: '/design/OTHER/x', title: '別案件 – Figma' },
  { s: at('13:00'), e: at('14:00'), host: 'mail.google.com', path: '/mail/u/0/', title: '受信トレイ - Gmail' },
  { s: at('13:30'), e: at('14:00'), manual: true, pid: 'a', memo: 'A社 定例MTG' },
];

test('1日の集計：手入力が優先され、重なる自動記録は差し引く', () => {
  const st = RP.day(daySegs(), projects);
  const ms = (id) => (st.projects.find((p) => p.id === id) || {}).ms;
  assert.equal(ms('a'), (40 + 19 + 30) * 60000, 'A社 = サイト40分＋要件定義19分＋MTG30分');
  assert.equal(ms('b'), 30 * 60000);
  assert.equal(ms('n'), 30 * 60000, 'Gmail は MTG と重なる30分を差し引く');
  assert.equal(st.unassigned, 30 * 60000);
  assert.equal(st.total, st.assigned + st.unassigned);
  assert.equal(st.projects[0].id, 'a', '長い順');
  assert.deepEqual(st.unassignedGroups.map((g) => g.rule), ['news.example.jp', 'figma.com/*/OTHER']);
  assert.equal(st.unassignedGroups[1].label, '別案件 – Figma');
  assert.ok(st.projects[0].pages.some((p) => p.label === '手入力：A社 定例MTG'));
});

test('1日の集計：手で振り分け直した区間・未分類に固定した区間', () => {
  const segs = daySegs();
  L.assign(segs, [at('10:30')], 'b');
  L.assign(segs, [at('09:00')], L.NONE);
  const st = RP.day(segs, projects);
  assert.equal(st.projects.find((p) => p.id === 'b').ms, 45 * 60000);
  assert.equal(st.projects.find((p) => p.id === 'a').ms, 49 * 60000);
  // 削除したプロジェクトの pid は、ルールでの判定に戻る
  const st2 = RP.day(daySegs().map((x) => ({ ...x, pid: x.manual ? x.pid : 'deleted' })), projects);
  assert.equal(st2.projects.find((p) => p.id === 'b').ms, 30 * 60000);
});

test('作業のまとまり（一覧）とタイムライン', () => {
  const st = RP.day(daySegs(), projects);
  // A社 9:00–10:00（1分の切れ目はつなげる）→ B社 → 未分類（ニュース・別案件 Figma）→ 社内 → 手入力
  assert.deepEqual(
    st.blocks.map((b) => [RP.clock(b.s), RP.clock(b.e), b.p]),
    [
      ['09:00', '10:00', 'a'],
      ['10:00', '10:30', 'b'],
      ['10:30', '11:00', null],
      ['13:00', '13:30', 'n'],
      ['13:30', '14:00', 'a'],
    ],
  );
  assert.deepEqual(st.blocks[0].refs, [at('09:00'), at('09:41')]);
  assert.ok(st.blocks[4].manual);
  assert.equal(st.runs.length, 5);
  assert.equal(RP.clock(st.first), '09:00');
  assert.equal(RP.clock(st.last), '14:00');
});

test('時間の表示と丸め', () => {
  assert.equal(RP.fmt(65 * 60000), '1:05');
  assert.equal(RP.fmt(65 * 60000, 'h'), '1.08h');
  assert.equal(RP.fmt(68 * 60000, 'h', 15), '1.25h');
  assert.equal(RP.fmt(52 * 60000, 'hm', 30), '1:00');
  assert.equal(RP.fmtLong(20 * 1000), '1分未満');
  assert.equal(RP.fmtLong(125 * 60000), '2時間5分');
  assert.equal(RP.dateLabel('2026-10-15'), '10月15日（木）');
});

test('日報：丸め・メモ・主なページ・省略の注記', () => {
  const segs = [...daySegs(), { s: at('15:00'), e: at('15:05'), host: 'localhost:3000', path: '/', title: 'LP 開発' }];
  const st = RP.day(segs, projects);
  const text = RP.reportText(st, { key: '2026-10-15', mode: 'h', unit: 15, details: true, memos: { a: 'デザイン確認\n要件定義の修正' } });
  const lines = text.split('\n');
  // A社 89分→1.50h、B社 35分→0.50h、社内 30分→0.50h、合計 2.50h
  assert.equal(lines[0], '【10月15日（木）の工数】合計 2.50h');
  assert.equal(lines[1], '■ A社リニューアル　1.50h');
  assert.deepEqual(lines.slice(2, 4), ['　デザイン確認', '　要件定義の修正']);
  assert.match(lines[4], /^　・A社 トップ（0:40）$/);
  assert.ok(text.includes('■ B社LP　0.50h'));
  assert.ok(!text.includes('未分類'));
  const withUn = RP.reportText(st, { key: '2026-10-15', unassigned: true });
  assert.match(withUn, /■ 未分類　0:30/);
  assert.match(withUn, /合計 3:04/, '丸めなし：A社89分＋B社35分＋社内30分＋未分類30分＝184分');
  const tiny = RP.day([{ s: at('09:00'), e: at('09:05'), host: 'a-sha.co.jp', path: '/', title: '' }, { s: at('10:00'), e: at('11:00'), host: 'figma.com', path: '/design/KEYB/', title: '' }], projects);
  assert.match(RP.reportText(tiny, { key: '2026-10-15', unit: 15 }), /※ 15分単位で丸めると0になるため省略：A社リニューアル（5分）/);
  assert.equal(RP.reportText(RP.day([], projects), { key: '2026-10-15' }), '【10月15日（木）の工数】記録がありません');
});

test('期間：週は月曜始まり、月は1日から末日', () => {
  assert.deepEqual(RP.periodRange('thisWeek', '2026-10-15'), { from: '2026-10-12', to: '2026-10-18', keys: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'] });
  assert.equal(RP.periodRange('thisWeek', '2026-10-18').from, '2026-10-12', '日曜日はその週の最後');
  assert.equal(RP.periodRange('lastWeek', '2026-10-15').from, '2026-10-05');
  const m = RP.periodRange('lastMonth', '2026-03-10');
  assert.equal(m.from, '2026-02-01');
  assert.equal(m.to, '2026-02-28');
  assert.equal(RP.periodRange('thisMonth', '2026-10-15').keys.length, 31);
});

test('期間の集計とCSV', () => {
  const keys = ['2026-10-15', '2026-10-16'];
  const stats = {
    '2026-10-15': RP.day(daySegs(), projects),
    '2026-10-16': RP.day([{ s: at('09:00', '2026-10-16'), e: at('10:00', '2026-10-16'), host: 'figma.com', path: '/file/KEYB/x', title: 'LP' }], projects),
  };
  const per = RP.period(keys, stats, projects);
  assert.equal(per.projects[0].id, 'b', 'B社 30分＋60分');
  assert.equal(per.projects[0].ms, 90 * 60000);
  assert.equal(per.projects[0].days, 2);
  assert.equal(per.activeDays, 2);
  assert.equal(per.days[1].by.b, 60 * 60000);
  const sum = RP.csvSummary(keys, stats, { '2026-10-15': { a: 'MTG' } });
  assert.deepEqual(sum[0], ['日付', '曜日', 'プロジェクト', '時間', '時間（h）', '分', 'メモ']);
  assert.deepEqual(sum[1], ['2026-10-15', '木', 'A社リニューアル', '1:29', '1.48', 89, 'MTG']);
  assert.ok(sum.some((r) => r[2] === '未分類' && r[5] === 30));
  const det = RP.csvDetail(keys, stats, projects);
  assert.deepEqual(det[1].slice(0, 7), ['2026-10-15', '09:00', '09:40', '40.0', 'A社リニューアル', '自動', 'www.a-sha.co.jp']);
  assert.ok(det.some((r) => r[5] === '手入力' && r[9] === 'A社 定例MTG'));
});

test('色：まだ使われていない色から順に', () => {
  assert.equal(PAL.nextColor([]), 0);
  assert.equal(PAL.nextColor([{ color: 0 }, { color: 2 }]), 1);
  assert.equal(PAL.nextColor(Array.from({ length: 8 }, (_, i) => ({ color: i }))), 0);
});

test('設定の共有：同じプロジェクトにはルールを足し、ないものは追加する', () => {
  const mine = { projects: [{ id: 'a', name: 'A社リニューアル', color: 0, rules: 'a-sha.co.jp' }], exclude: 'youtube.com' };
  const file = T.exportSettings({
    projects: [
      { id: 'other-id', name: 'A社リニューアル', color: 3, rules: 'a-sha.co.jp\ntitle:A社' },
      { id: 'b', name: 'B社LP', color: 1, rules: 'b-sha.jp' },
      { id: 'c', name: '  ', rules: 'x.jp' },
    ],
    exclude: 'youtube.com\namazon.co.jp',
  });
  let n = 0;
  const { settings, added, updated } = T.mergeSettings(mine, file, () => `new${++n}`, PAL.nextColor);
  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.equal(settings.projects.length, 2, '名前のないものは読み込まない');
  assert.equal(settings.projects[0].rules, 'a-sha.co.jp\ntitle:A社', '同じ名前のプロジェクトにルールを足す（重複なし）');
  assert.equal(settings.projects[0].color, 0, '自分の色はそのまま');
  assert.deepEqual(settings.projects[1], { id: 'b', name: 'B社LP', color: 1, rules: 'b-sha.jp' });
  assert.equal(settings.exclude, 'youtube.com\namazon.co.jp');
  assert.equal(mine.projects[0].rules, 'a-sha.co.jp', '元の設定は書き換えない');
  assert.throws(() => T.mergeSettings(mine, { projects: [] }, () => 'x', PAL.nextColor), /設定ファイルではありません/);
});

test('URLルールの * は、いくつ書いても一瞬で判定できる', () => {
  assert.ok(R.globPrefix('/*/d/abc', '/document/u/1/d/abc/edit'));
  assert.ok(R.globPrefix('/view/abc-', '/view/abc-12'));
  assert.ok(!R.globPrefix('/view/abc-', '/view/xyz-12'));
  assert.ok(R.globPrefix('/a*c', '/abbbc/x'));
  assert.ok(!R.globPrefix('/a*c', '/abbb'));
  const rule = R.parseLine(`example.com/${'*a'.repeat(30)}z`);
  const t0 = Date.now();
  assert.equal(R.compile([{ id: 'x', rules: rule.raw }])({ host: 'example.com', path: '/' + 'a'.repeat(5000), title: '' }), null);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0}ms`);
});

test('操作がなくても、裏で会議の音が出ていれば会議のタブを記録する', () => {
  const tab = { id: 1, url: 'https://docs.google.com/document/d/x/edit', title: '資料', audible: false };
  const meet = { id: 2, url: 'https://meet.google.com/abc-defg-hij', title: 'Meet', audible: true };
  const base = { paused: false, idleState: 'idle', chromeFocused: true, tab, settings: {} };
  assert.equal(T.decide(base).state, 'idle');
  const d = T.decide({ ...base, audibleTab: meet });
  assert.equal(d.state, 'recording');
  assert.equal(d.host, 'meet.google.com');
  assert.equal(T.decide({ ...base, idleState: 'active', audibleTab: meet }).host, 'docs.google.com', '操作しているときは見ているタブ');
  assert.equal(T.decide({ ...base, audibleTab: meet, settings: { keepAudible: false } }).state, 'idle');
});
