// core/context.js：波动状态（ATR 在过去一年里排在哪）、交易时段（划分、图上的分段、各时段平常的波幅）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const get = loadCore(Date.UTC(2026, 10, 26, 12));
const [SESS, SESS_TFS, sessOf, sessBands, sessStats, volState, volText, RV_SESS, analyze, demoAll] = [
  'SESS',
  'SESS_TFS',
  'sessOf',
  'sessBands',
  'sessStats',
  'volState',
  'volText',
  'RV_SESS',
  'analyze',
  'demoAll',
].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
const H = 36e5,
  D = 864e5,
  D0 = Date.UTC(2026, 9, 19); // 周一 00:00 UTC
const bar = (t, hi, lo, c = (hi + lo) / 2) => ({ timestamp: t, open: c, high: hi, low: lo, close: c, volume: 0 });
/* 日线：每根高低差为 r(i)，收盘不动（真实波幅就等于高低差） */
const daily = (n, r, t0 = D0 - n * D) => Array.from({ length: n }, (_, i) => bar(t0 + i * D, 100 + r(i) / 2, 100 - r(i) / 2, 100));

test('时段划分：UTC 0–7 亚洲、7–13 欧洲、13–21 美国、其余收盘后；复盘的分组用的是同一份', () => {
  const at = h => sessOf(D0 + h * H);
  assert.deepEqual([0, 6, 7, 12, 13, 20, 21, 23].map(at), ['asia', 'asia', 'eu', 'eu', 'us', 'us', 'late', 'late']);
  assert.equal(sessOf(D0 + 7 * H - 1), 'asia');
  assert.deepEqual(plain(SESS.map(s => [s.k, s.from, s.to])), [['asia', 0, 7], ['eu', 7, 13], ['us', 13, 21], ['late', 21, 24]]);
  assert.deepEqual(plain(RV_SESS), { asia: '亚洲时段', eu: '欧洲时段', us: '美国时段', late: '美国收盘后' });
  /* 4 小时K线跨着 7 点和 13 点，不在能画的周期里 */
  assert.deepEqual(plain(SESS_TFS), ['15m', '1h']);
});

test('sessBands：同一天同一时段连成一段，不含收盘后；隔了周末的不连在一起', () => {
  /* 周一全天 24 根 1 小时，周二只有 0–2 点三根 */
  const b = [...Array.from({ length: 24 }, (_, i) => bar(D0 + i * H, 2, 1)), ...[0, 1, 2].map(i => bar(D0 + D + i * H, 2, 1))];
  assert.deepEqual(plain(sessBands(b)).map(g => [g.k, g.a, g.b]), [['asia', 0, 6], ['eu', 7, 12], ['us', 13, 20], ['asia', 24, 26]]);
  /* 周五的亚洲时段和下周一的亚洲时段挨着（中间没有K线）也分开 */
  const c = [bar(D0 + 4 * D + 5 * H, 2, 1), bar(D0 + 7 * D + 1 * H, 2, 1)];
  assert.deepEqual(plain(sessBands(c)).map(g => [g.k, g.a, g.b]), [['asia', 0, 0], ['asia', 1, 1]]);
  assert.deepEqual(plain(sessBands([])), []);
});

test('sessStats：每个时段里最高减最低，再对各天取平均；K线不到一半的、还没走完的最后一段不算', () => {
  const day = (d, asia, eu, us, upto = 21) =>
    Array.from({ length: upto }, (_, h) => {
      const r = h < 7 ? asia : h < 13 ? eu : us;
      /* 每个时段只有一根走到全幅，其余很窄：时段的波幅是整段的最高减最低，不是单根的平均 */
      return h == 3 || h == 9 || h == 15 ? bar(D0 + d * D + h * H, 100 + r, 100) : bar(D0 + d * D + h * H, 100.1, 100);
    });
  const b = [...day(0, 4, 6, 10), ...day(1, 6, 8, 20), ...day(2, 5, 7, 99, 16)];
  const s = plain(sessStats(b, '1h'));
  assert.equal(s.from, D0);
  assert.equal(s.days, 3);
  /* 第三天的美国时段只走了 3 根（不到 8 根的一半，而且还没到 21 点）：不算 */
  assert.deepEqual(s.rows, [
    { k: 'asia', n: 3, avg: 5 },
    { k: 'eu', n: 3, avg: 7 },
    { k: 'us', n: 2, avg: 15 },
  ]);
  /* 最后一段K线够一半、但还没走到时段结束：也不算（还在走的时段波幅偏小） */
  const live = [...day(0, 4, 6, 10), ...day(1, 6, 8, 50, 19)];
  assert.deepEqual(plain(sessStats(live, '1h')).rows[2], { k: 'us', n: 1, avg: 10 });
  /* 15 分钟K线：一个时段的根数按周期算（亚洲 28 根），结果一样 */
  const q = [];
  for (let i = 0; i < 21 * 4; i++) q.push(bar(D0 + i * 9e5, i == 2 ? 103 : 100.1, 100));
  assert.deepEqual(plain(sessStats(q, '15m')).rows.map(r => [r.n, r.avg && +r.avg.toFixed(2)]), [[1, 3], [1, 0.1], [1, 0.1]]);
  /* 没有K线 */
  assert.deepEqual(plain(sessStats([], '1h')), { from: null, days: 0, rows: [{ k: 'asia', n: 0, avg: null }, { k: 'eu', n: 0, avg: null }, { k: 'us', n: 0, avg: null }] });
});

test('volState：和 analyze 的 ATR 是同一个数；数过去一年里有几根的 ATR 比现在小', () => {
  /* 500 根日线，波幅从 1 线性涨到 5.99：ATR 一路变大，最新一根是一年里最大的 */
  const up = daily(500, i => 1 + i * 0.01),
    v = volState(up);
  assert.ok(Math.abs(v.atr - analyze(up).a) < 1e-12);
  assert.equal(v.full, true);
  assert.equal(v.days, 365);
  assert.equal(v.n, 365);
  assert.equal(v.below, 365);
  assert.equal(v.from, up[up.length - 1].timestamp - 365 * D);
  assert.equal(volText(v, { T: '1d', dp: 2 }), `日线 ATR ${v.atr.toFixed(2)}，是过去一年里最大的`);
  /* 一路变小：最小 */
  const dn = volState(daily(500, i => 6 - i * 0.01));
  assert.equal(dn.below, 0);
  assert.match(volText(dn, { T: '1d' }), /，是过去一年里最小的$/);
  /* 前 420 根波幅 2，最后 80 根里前 66 根波幅 4、最后 14 根波幅 3：现在的 ATR 是 3。
     一年内的 365 根里，ATR 还是 2 的有 285 根（比 3 小），其余 80 根在 2 到 4 之间爬升、再回落 */
  const mix = daily(500, i => (i < 420 ? 2 : i < 486 ? 4 : 3)),
    m = volState(mix);
  assert.equal(m.atr, 3);
  assert.equal(m.n, 365);
  /* 逐根数一遍：窗口是最新一根之前的 365 根 */
  const tr = mix.map(x => x.high - x.low),
    atr = i => tr.slice(i - 13, i + 1).reduce((a, b) => a + b, 0) / 14,
    want = Array.from({ length: 365 }, (_, k) => atr(499 - 365 + k)).filter(a => a < 3).length;
  assert.equal(m.below, want);
  assert.equal(m.pct, Math.round((want / 365) * 100));
  assert.equal(volText(m, { T: '1d', dp: 2 }), `日线 ATR 3.00，过去一年里比 ${m.pct}% 的时候大`);
});

test('volState：数据不到一年就用已有的并照实说；太少时不给', () => {
  /* 100 根 1 小时K线：只有 4 天多 */
  const b = Array.from({ length: 100 }, (_, i) => bar(D0 + i * H, 100 + 1 + (i % 7) * 0.1, 100, 100)),
    v = volState(b);
  assert.equal(v.full, false);
  assert.equal(v.n, 86); // 第 14 根起才有 ATR，最新一根不和自己比
  assert.equal(v.days, 4);
  assert.match(volText(v, { T: '1h', dp: 2 }), /^1 小时 ATR \d+\.\d\d，(已有的 4 天里比 \d+% 的时候大|是已有的 4 天里最[大小]的)$/);
  /* 两个月以上按月说 */
  assert.match(volText(volState(daily(120, i => 1 + (i % 5))), { T: '1d' }), /已有的 4 个月里/);
  /* 月线：一年只有 12 根，不写百分比，写根数 */
  const mo = Array.from({ length: 40 }, (_, i) => bar(Date.UTC(2023, i, 1), 100 + 2 + (i % 3), 100, 100)),
    mv = volState(mo);
  assert.equal(mv.full, true);
  assert.equal(mv.n, 12);
  assert.equal(volText(mv, { T: '1M', dp: 2 }), `月线 ATR ${mv.atr.toFixed(2)}，过去一年的 12 根里有 ${mv.below} 根比它小`);
  /* 能比的不到 10 根 */
  assert.equal(volState(daily(20, () => 1)), null);
  assert.equal(volState([]), null);
  /* 百分比不写 0% 和 100%（那两种情况说“最小”“最大”），四舍五入到头的收回 1–99 */
  assert.match(volText({ atr: 1, n: 400, below: 399, pct: 100, full: true, days: 365 }, { T: '1d' }), /比 99% 的时候大$/);
  assert.match(volText({ atr: 1, n: 400, below: 1, pct: 0, full: true, days: 365 }, { T: '1d' }), /比 1% 的时候大$/);
});

test('模拟行情上：各周期都说得出一句，话里没有判断', () => {
  const all = demoAll({ sym: 'GC', base: 2650 }),
    closed = get('closed');
  for (const tf of ['15m', '1h', '4h', '1d', '1w', '1M']) {
    const v = volState(closed(tf, all[tf]));
    assert.ok(v, tf);
    const s = volText(v, { T: tf, dp: 2 });
    assert.match(s, / ATR \d+\.\d\d，/);
    assert.doesNotMatch(s, /建议|适合|不宜|应该|会涨|会跌/);
  }
  const s = sessStats(closed('1h', all['1h']), '1h');
  assert.ok(s.days >= 15 && s.rows.every(r => r.n >= 10 && r.avg > 0));
});
