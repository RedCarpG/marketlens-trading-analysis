// core/rules.js：我的守则与开仓体检；core/review.js 新加的 走到过哪（最深浮亏 / 最高浮盈）、星期和时段
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const NOW = Date.UTC(2026, 9, 23, 13, 7, 0);
const get = loadCore(NOW);
const [RULE_DEFS, normRules, activeRules, checkRules, checkSay, ruleStats, reviewTrade, summarizeReviews, demoAll, nxt] = [
  'RULE_DEFS',
  'normRules',
  'activeRules',
  'checkRules',
  'checkSay',
  'ruleStats',
  'reviewTrade',
  'summarizeReviews',
  'demoAll',
  'nxt',
].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
const H = 36e5,
  T0 = Date.UTC(2026, 9, 20, 14, 0);
/* 一笔复盘结果的最小样子（checkRules 只看这些字段） */
const rv = (over = {}, t = {}) => ({
  ok: true,
  dir: 1,
  align: 1,
  want: 1,
  slAtr: 1.5,
  pos: 'mid',
  sup: { d: 2 },
  res: { d: 2 },
  win: null,
  ...over,
  t: { id: 'a', isBuy: true, openTs: T0, openRate: 100, sl: 98, ...t },
});
const all = id => normRules({ on: Object.fromEntries(RULE_DEFS.map(d => [d.id, id == null || d.id == id ? 1 : 0])) });
const one = (id, r, x, n) => {
  const rules = all(id);
  if (n != null) rules.n[id] = n;
  return plain(checkRules(r, rules, x).items[0]);
};

test('normRules：默认都不勾；数夹在范围里；自己写的压成一行、截短、最多 10 条', () => {
  const d = plain(normRules(null));
  assert.deepEqual(Object.values(d.on), plain(RULE_DEFS.map(() => 0)));
  assert.deepEqual(d.n, { wide: 3, event: 2, stack: 1 });
  assert.deepEqual(d.custom, []);
  const r = plain(
    normRules({
      on: { range: true, nope: 1 },
      n: { wide: 99, event: 'x', stack: 0 },
      custom: ['  不在睡前\n开仓 ', '', null, 'x'.repeat(200), ...Array(20).fill('多')],
    })
  );
  assert.equal(r.on.range, 1);
  assert.equal(r.on.nope, undefined);
  assert.deepEqual(r.n, { wide: 10, event: 2, stack: 1 });
  assert.equal(r.custom[0], '不在睡前 开仓');
  assert.equal(r.custom[1].length, 60);
  assert.equal(r.custom.length, 10);
  assert.deepEqual(plain(activeRules(normRules({ on: { wide: 1 }, n: { wide: 2.5 } }))), [{ id: 'wide', n: 2.5, text: '止损不超过 2.5 个 ATR' }]);
});

test('大周期：震荡、逆势各一条；顺势两条都守住', () => {
  assert.equal(one('range', rv({ align: 0, want: 0 })).ok, false);
  assert.equal(one('range', rv({ align: -1, want: -1 })).ok, true);
  assert.deepEqual(one('counter', rv({ align: -1, want: -1 })), { id: 'counter', text: '不逆着大周期开仓', note: '大周期偏空，这笔是反着做的', ok: false });
  assert.equal(one('counter', rv({ align: 0, want: 0 })).ok, true);
  assert.equal(one('counter', rv()).ok, true);
});

test('止损：没设（或远端默认）算没守；宽度超过设的数算没守，没设止损时宽度判断不了', () => {
  assert.equal(one('nostop', rv()).ok, true);
  assert.equal(one('nostop', rv({}, { sl: 0 })).ok, false);
  assert.equal(one('nostop', rv({}, { sl: 50 })).ok, false); // 离开仓价 50%：eToro 的默认远端止损
  assert.deepEqual([one('wide', rv({ slAtr: 3.01 })).ok, one('wide', rv({ slAtr: 3 })).ok], [false, true]);
  assert.equal(one('wide', rv({ slAtr: 3.01 })).note, '止损在 3.0 个 ATR 外');
  assert.equal(one('wide', rv({ slAtr: 2.2 }), {}, 2).ok, false);
  assert.deepEqual(one('wide', rv({ slAtr: null })), { id: 'wide', text: '止损不超过 3 个 ATR', note: '没设止损，量不了宽度', ok: null });
});

test('入场位置：顶着反向的关键价位算没守，说清差多远', () => {
  assert.equal(one('against', rv({ pos: 'bad', res: { d: 0.3 } })).note, '上方 0.3 个 ATR 就是阻力');
  assert.equal(one('against', rv({ pos: 'bad', dir: -1, sup: { d: 0.2 } }, { isBuy: false })).note, '下方 0.2 个 ATR 就是支撑');
  assert.equal(one('against', rv({ pos: 'good' })).ok, true);
  assert.equal(one('against', rv({ pos: 'mid' })).ok, true);
});

test('重要数据：前后 N 小时内算没守；别的货币、低影响不算；日历没覆盖到的判断不了', () => {
  const ev = (h, o = {}) => ({ ts: T0 + h * H, imp: 3, ccy: 'USD', zh: '非农就业', ...o }),
    old = ev(-24 * 30);
  assert.equal(one('event', rv(), { events: [old, ev(1.5)] }).note, '非农就业还有 1.5 小时公布');
  assert.equal(one('event', rv(), { events: [old, ev(-0.5)] }).note, '非农就业刚公布 0.5 小时');
  assert.equal(one('event', rv(), { events: [old, ev(2.5)] }).ok, true);
  assert.equal(one('event', rv(), { events: [old, ev(2.5)] }, 3).ok, false);
  assert.equal(one('event', rv(), { events: [old, ev(1, { ccy: 'EUR' }), ev(1, { imp: 2 })] }).ok, true);
  assert.equal(one('event', rv(), { events: [old, ev(1, { ccy: 'EUR' })], ccy: ['EUR'] }).ok, false);
  assert.deepEqual([one('event', rv(), {}).ok, one('event', rv(), { events: [ev(1)] }).ok], [null, null]);
  assert.equal(one('event', rv(), { events: [ev(1)] }).note, '那时的经济日历没有记录');
});

test('同时持仓：开仓那一刻还开着的别的单子算上', () => {
  const trades = [
    { id: 'a', openTs: T0 },
    { id: 'b', openTs: T0 - H, closeTs: T0 + H }, // 当时还开着
    { id: 'c', openTs: T0 - 5 * H, closeTs: T0 - H }, // 已经平了
    { id: 'd', openTs: T0 + H }, // 之后才开
    { id: 'e', openTs: T0 - 2 * H }, // 持仓中
  ];
  assert.deepEqual(one('stack', rv(), { trades }), { id: 'stack', text: '同一品种同时最多 1 笔', note: '开仓时已经有 2 笔', ok: false });
  assert.equal(one('stack', rv(), { trades }, 3).ok, true);
  assert.equal(one('stack', rv(), {}).ok, true);
});

test('开仓前K线不够：要重算当时分析的几条判断不了，止损、数据、同时持仓照样判断', () => {
  const res = plain(checkRules(rv({ ok: false, reason: 'x' }, { sl: 0 }), all(), { events: [{ ts: T0 - 100 * H, imp: 3, ccy: 'USD' }] }));
  assert.deepEqual(
    res.items.map(i => [i.id, i.ok]),
    [['range', null], ['counter', null], ['nostop', false], ['wide', null], ['against', null], ['event', true], ['stack', true]]
  );
  assert.deepEqual([res.broke, res.kept, res.unknown], [1, 2, 4]);
});

test('checkSay：有没守的说哪几条（给 Cirra 的那句不带括号里的补充）；都守住也说一声；没勾守则不说', () => {
  const bad = checkSay('黄金 GOLD', true, checkRules(rv({ align: 0, want: 0, pos: 'bad', res: { d: 0.3 } }), all()));
  assert.equal(bad.text, '新开的黄金 GOLD多单：2 条守则没守——大周期震荡时不开仓（开仓时大周期震荡）；不顶着关键价位开仓（做多顶着阻力、做空贴着支撑）（上方 0.3 个 ATR 就是阻力）');
  assert.equal(bad.say, '你新开的黄金 GOLD多单，有 2 条守则没守：大周期震荡时不开仓；不顶着关键价位开仓。');
  assert.deepEqual([bad.kind, bad.ck], ['dn', 'ck']);
  assert.doesNotMatch(bad.say, /\$|美元|盈亏/);
  const good = checkSay('黄金 GOLD', false, checkRules(rv({}, { isBuy: false }), all('nostop')));
  assert.deepEqual([good.say, good.ck], ['你新开的黄金 GOLD空单，1 条守则都守住了。', 'cko']);
  assert.equal(checkSay('x', true, checkRules(rv({ slAtr: null }), all('wide'))), null); // 只有判断不了的
  assert.equal(checkSay('x', true, checkRules(rv(), normRules({}))), null);
  const mixed = checkSay('x', true, checkRules(rv({ ok: false }), all()));
  /* K线不够：四条判断不了；没有日历，数据那条也判断不了；止损、同时持仓两条守住 */
  assert.match(mixed.say, /2 条守则都守住了，另有 5 条判断不了。$/);
});

test('ruleStats：每条守则没守 / 守住各几笔、赢几笔、净盈亏；持仓中的不算', () => {
  const rules = all('range'),
    row = (over, netProfit) => {
      const r = rv({ win: netProfit == null ? null : netProfit > 0, ...over }, { netProfit });
      return { rv: r, res: checkRules(r, rules) };
    },
    st = plain(ruleStats([row({ align: 0 }, -50), row({ align: 0 }, 20), row({ align: 1 }, 80), row({ align: 0 }, null), row({ ok: false }, -5)], rules));
  assert.deepEqual(st, [
    { id: 'range', text: '大周期震荡时不开仓', broke: { n: 2, win: 1, net: -30 }, kept: { n: 1, win: 1, net: 80 }, unknown: 1 },
  ]);
});

test('reviewTrade：走到过哪（最深浮亏、最高浮盈，按 ATR）、星期、时段；汇总里有星期和时段的分组', () => {
  const data = demoAll({ sym: 'GC', base: 2650 }),
    b = data['1h'],
    i = b.length - 60,
    j = b.length - 30,
    t = { id: 't', isBuy: true, openTs: b[i].timestamp + 10 * 60e3, openRate: b[i].close, closeTs: b[j].timestamp + 60e3, closeRate: b[j].close, netProfit: 12, sl: 0, units: 1 },
    r = reviewTrade(t, data),
    span = b.filter(k => nxt('1h', k.timestamp) > t.openTs && k.timestamp <= t.closeTs),
    lo = Math.min(...span.map(k => k.low)),
    hi = Math.max(...span.map(k => k.high));
  assert.equal(r.tf, '1h');
  assert.equal(span.length, 31);
  assert.ok(Math.abs(r.mae - Math.max(0, t.openRate - lo) / r.atr) < 1e-9);
  assert.ok(Math.abs(r.mfe - Math.max(0, hi - t.openRate) / r.atr) < 1e-9);
  /* 做空时反过来 */
  const s = reviewTrade({ ...t, isBuy: false }, data);
  assert.ok(Math.abs(s.mae - Math.max(0, hi - t.openRate) / s.atr) < 1e-9);
  assert.ok(Math.abs(s.mfe - r.mae) < 1e-9);
  const d = new Date(t.openTs);
  assert.equal(r.dow, d.getUTCDay());
  assert.equal(r.sess, d.getUTCHours() < 7 ? 'asia' : d.getUTCHours() < 13 ? 'eu' : d.getUTCHours() < 21 ? 'us' : 'late');
  const sum = plain(summarizeReviews([r, reviewTrade({ ...t, id: 'u', netProfit: -30 }, data)]));
  assert.deepEqual(sum.groups.dow.map(g => [g.n, g.net]), [[2, -18]]);
  assert.deepEqual(sum.groups.sess.map(g => g.n), [2]);
  assert.equal(sum.path.losers, 1);
  assert.ok(Math.abs(sum.path.lossMfe - r.mfe) < 1e-9);
});

test('汇总的“值得注意”：亏损单里曾经浮盈 1 个 ATR 以上的有 2 笔才说；星期和时段不进“值得注意”', () => {
  const mk = (netProfit, mfe, over = {}) => ({ ok: true, win: netProfit > 0, align: 1, pos: 'mid', stop: 'ok', sc: null, holdH: 5, mae: 0.5, mfe, dow: 2, sess: 'us', t: { netProfit }, ...over }),
    sum = summarizeReviews([mk(-10, 1.4), mk(-20, 2), mk(-5, 0.3), mk(30, 3)]);
  assert.ok(sum.insights.includes('3 笔亏损单里有 2 笔曾经浮盈超过 1 个 ATR，后来亏着平的'));
  assert.ok(!sum.insights.some(s => /周二|美国时段/.test(s)));
  assert.ok(!summarizeReviews([mk(-10, 1.4), mk(-20, 0.2)]).insights.some(s => /曾经浮盈/.test(s)));
});
