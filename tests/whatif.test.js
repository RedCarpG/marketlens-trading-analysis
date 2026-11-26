// 复盘里的“如果”（core/review.js 的 whatIf）和每周一页（core/rules.js 的 weekly）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const NOW = Date.UTC(2026, 9, 23, 13, 7, 0);
const get = loadCore(NOW);
const [whatIf, WHATIF, weekly, bkt, checkRules, normRules] = ['whatIf', 'WHATIF', 'weekly', 'bkt', 'checkRules', 'normRules'].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
const H = 36e5,
  T0 = Date.UTC(2026, 8, 1);
/* 一段自己造的 1 小时K线：价格按 path 走，每根高低各多 0.5 */
const bars = path => path.map((c, i) => ({ timestamp: T0 + i * H, open: i ? path[i - 1] : c, high: Math.max(c, i ? path[i - 1] : c) + 0.5, low: Math.min(c, i ? path[i - 1] : c) - 0.5, close: c }));
/* 复盘结果的最小样子：在第 i 根里开仓，做多，ATR = 2 */
const rv = (i, t = {}, over = {}) => ({ ok: true, win: true, tf: '1h', dir: 1, atr: 2, slAtr: 1, ...over, t: { openTs: T0 + i * H + 60e3, openRate: 100, sl: 98, closeRate: 101, ...t } });

test('whatIf：同一笔入场，三种出场各自的 R；实际那笔按同样口径算', () => {
  /* 涨到 110 再跌回：移动止损（回撤 2 个 ATR = 4）在 106 走；2 倍风险（104）先到；拿满 10 根按那根收盘 */
  const B = bars([100, 100, 102, 104, 106, 108, 110, 108, 105, 103, 101, 100, 99, 98, 97]),
    out = plain(whatIf([rv(1)], { '1h': B }));
  assert.deepEqual(out.map(o => o.id), ['trail2', 'hold10', 'r2']);
  const by = Object.fromEntries(out.map(o => [o.id, o]));
  for (const o of out) assert.deepEqual([o.n, o.pending, o.assumed, o.actual], [1, 0, 0, 0.5]);
  assert.equal(by.r2.alt, 2); // 104 = 入场 + 2 × 风险 2
  /* 最高到 110.5（含上影），移动止损在 106.5，下一根开盘 108 之后跌破 → 106.5 成交：(106.5 − 100) / 2 */
  assert.equal(by.trail2.alt, 3.25);
  assert.equal(by.hold10.alt, (B[11].close - 100) / 2);
  assert.deepEqual([by.r2.better, by.trail2.better, by.hold10.better], [1, 1, 0]);
});

test('whatIf：先打到你设的止损就是 −1R；没设止损的按 2 个 ATR 当风险并计数；做空反过来', () => {
  const down = bars([100, 100, 99, 97, 95, 94, 93, 92, 91, 90, 89, 88, 87]),
    stopped = plain(whatIf([rv(1, { closeRate: 97 }, { win: false })], { '1h': down }));
  for (const o of stopped) assert.equal(o.alt, -1);
  assert.equal(stopped[0].actual, -1.5);
  const none = plain(whatIf([rv(1, { sl: 0, closeRate: 97 }, { win: false, slAtr: null })], { '1h': down }));
  /* 风险 4：实际 −3 / 4。拿满 10 根的那种在 96 止损 = −1R；移动止损跟着开仓后那根的高点 100.5 上移到 96.5，所以是 −3.5 / 4 */
  const n = Object.fromEntries(none.map(o => [o.id, o]));
  assert.deepEqual([n.hold10.assumed, n.hold10.alt, n.hold10.actual], [1, -1, -0.75]);
  assert.equal(n.trail2.alt, -0.875);
  const short = plain(whatIf([rv(1, { sl: 102, closeRate: 99 }, { dir: -1 })], { '1h': down }));
  const r2 = short.find(o => o.id == 'r2');
  assert.deepEqual([r2.alt, r2.actual], [2, 0.5]);
  /* 一路跌下去没有回撤：移动止损到数据结束还没被打到，算还没走完 */
  assert.deepEqual([short[0].id, short[0].n, short[0].pending], ['trail2', 0, 1]);
});

test('whatIf：K线不够走完的算还没走完；持仓中、复盘不成的不算；没有交易时都是空的', () => {
  const B = bars([100, 100, 101, 102, 103]),
    out = plain(whatIf([rv(1), rv(1, {}, { win: null }), rv(1, {}, { ok: false })], { '1h': B }));
  assert.deepEqual(out.map(o => [o.n, o.pending, o.alt]), [[0, 1, null], [0, 1, null], [0, 1, null]]);
  assert.deepEqual(plain(whatIf([], { '1h': B })).map(o => o.n), [0, 0, 0]);
  assert.equal(WHATIF.length, 3);
});

test('weekly：开仓、守则、日记算在开仓那一周，盈亏算在平仓那一周；没有交易的周不列', () => {
  const W = 6048e5,
    wk = bkt('1w', NOW),
    rules = normRules({ on: { nostop: 1, range: 1 } }),
    row = (id, openTs, closeTs, netProfit, over = {}, t = {}) => {
      const r = { ok: true, dir: 1, align: 1, want: 1, slAtr: 1, pos: 'mid', win: netProfit == null ? null : netProfit > 0, ...over, t: { id, isBuy: true, openTs, openRate: 100, sl: 98, closeTs, netProfit, ...t } };
      return { rv: r, res: checkRules(r, rules) };
    },
    rows = [
      row('a', wk + H, wk + 5 * H, 40),
      row('b', wk + 2 * H, wk + 6 * H, -90, { align: 0, want: 0 }, { sl: 0 }),
      row('c', wk - 2 * W + H, wk + 7 * H, -10), // 两周前开、这周平
      row('d', wk + 3 * H, null, null, { align: 0, want: 0 }), // 持仓中
    ],
    notes = { b: { why: '看到新闻就追进去了', tags: ['追单', '新闻驱动'] }, a: { why: '', tags: ['计划内', '追单'] } },
    out = plain(weekly(rows, t => notes[t.id] || null, 6, NOW));
  assert.deepEqual(out.map(w => w.from), [wk, wk - 2 * W]);
  const [now, old] = out;
  assert.deepEqual([now.opened, now.closed, now.win, now.net], [3, 3, 1, -60]);
  assert.deepEqual([now.broke, now.brokeTop], [3, { text: '大周期震荡时不开仓', n: 2 }]);
  assert.deepEqual([now.notes, now.tags], [2, ['追单', '计划内', '新闻驱动']]);
  assert.equal(now.lesson, '「大周期震荡时不开仓」这周没守 2 次');
  assert.deepEqual([old.opened, old.closed, old.broke, old.lesson], [1, 0, 0, '开的每一笔都守住了守则']);
});

test('weekly：没有哪条守则没守两次时，记亏得最多的那一笔和当时写的理由；什么都没有就不写', () => {
  const wk = bkt('1w', NOW),
    rules = normRules({ on: { nostop: 1 } }),
    row = (id, netProfit, t = {}) => {
      const r = { ok: true, dir: 1, align: 1, slAtr: 1, pos: 'mid', win: netProfit > 0, t: { id, isBuy: true, openTs: wk + H, openRate: 100, sl: 98, closeTs: wk + 2 * H, netProfit, ...t } };
      return { rv: r, res: checkRules(r, rules) };
    };
  const a = weekly([row('a', -5), row('b', -80, { sl: 0 })], t => (t.id == 'b' ? { why: '想\n扳回来' + '啊'.repeat(60), tags: [] } : null), 2, NOW)[0];
  assert.match(a.lesson, /^亏得最多的一笔没守：开仓要设止损；当时写的是“想 扳回来啊+”$/);
  assert.ok([...a.lesson.match(/“(.*)”/)[1]].length <= 40);
  assert.equal(weekly([row('a', -5)], () => null, 2, NOW)[0].lesson, '亏得最多的一笔守则都守住了');
  assert.equal(weekly([row('a', 5)], () => null, 2, NOW)[0].lesson, '开的每一笔都守住了守则');
  /* 只没守一次、这周也没有亏的：说是哪条 */
  assert.equal(weekly([row('a', 5, { sl: 0 })], () => null, 2, NOW)[0].lesson, '没守的：开仓要设止损');
  /* 没有勾守则、也没亏 */
  const bare = { rv: { ok: true, win: true, t: { id: 'x', openTs: wk + H, closeTs: wk + 2 * H, netProfit: 3 } }, res: checkRules({ ok: true, t: { openTs: wk + H, openRate: 1 } }, normRules({})) };
  assert.equal(weekly([bare], () => null, 2, NOW)[0].lesson, '');
  assert.deepEqual(plain(weekly([], () => null, 3, NOW)), []);
});
