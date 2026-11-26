// core/summary.js：analyzeCandles（从K线直接得到分析）和 describeState（压成几句只有事实的话）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const NOW = Date.UTC(2026, 9, 23, 13, 7, 0);
const get = loadCore(NOW);
const [TFS, demoAll, ctx, analyzeMTF, isKey, analyzeCandles, describeState] = [
  'TFS',
  'demoAll',
  'ctx',
  'analyzeMTF',
  'isKey',
  'analyzeCandles',
  'describeState',
].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
const all = demoAll({ sym: 'GC', base: 2650 });

test('analyzeCandles 和手工拼 ctx + analyzeMTF 的结果一样；最新价默认取最后一根收盘', () => {
  for (const tf of ['1h', '1d', '1M']) {
    const C = {};
    for (const k of TFS.slice(TFS.indexOf(tf))) C[k] = ctx(k, all[k]);
    const px = all[tf].at(-1).close,
      r = analyzeCandles(tf, all);
    assert.equal(r.px, px);
    assert.deepEqual(Object.keys(r.C), plain(TFS.slice(TFS.indexOf(tf)))); // TFS 是 vm 里的数组，转成这边的再比
    assert.deepEqual(plain(r.m), plain(analyzeMTF(tf, C, px)), tf);
  }
  /* 给了最新价就用它划分支撑和阻力 */
  const px = all['1h'].at(-1).close * 1.01,
    r = analyzeCandles('1h', all, px);
  assert.equal(r.px, px);
  assert.ok(r.m.L.every(l => (l.side > 0 ? l.p <= px : l.p > px)));
});

test('analyzeCandles：只给本周期也能算；周期不认识抛错；K线不够时 m 为 null', () => {
  const one = analyzeCandles('4h', { '4h': all['4h'] });
  assert.deepEqual(Object.keys(one.C), ['4h']);
  assert.ok(one.m);
  assert.throws(() => analyzeCandles('2h', all), /周期须为/);
  const few = analyzeCandles('1d', { '1d': all['1d'].slice(-5) });
  assert.equal(few.m, null);
  assert.equal(analyzeCandles('1d', {}).px, null);
});

test('describeState：现价、各周期方向、最近的关键支撑和阻力，数字对得上', () => {
  const a = analyzeCandles('1h', all),
    d = describeState({ ...a, name: '黄金 GC' }),
    px = a.px,
    x = a.m.t.a.a,
    key = a.m.L.filter(l => isKey(l, '1h')),
    below = key.filter(l => l.p <= px).sort((u, v) => v.p - u.p)[0],
    above = key.filter(l => l.p > px).sort((u, v) => u.p - v.p)[0];
  assert.equal(d.text, d.lines.join(''));
  assert.ok(d.lines[0].startsWith(`黄金 GC 现价 ${px.toFixed(2)}`));
  /* 方向从大周期到本周期，和 ctx 的 bias 一致 */
  assert.deepEqual(
    plain(d.facts.trend.map(t => [t.tf, t.bias])),
    ['1M', '1w', '1d', '4h', '1h'].map(k => [k, a.C[k].bias])
  );
  assert.match(d.lines[1], /^各周期方向（按均线）：月线(偏多|偏空|震荡).*，1 小时(偏多|偏空|震荡)/);
  /* 支撑在现价下方、阻力在上方，是离得最近的关键价位，距离按 ATR 计 */
  for (const [f, l] of [
    [d.facts.support, below],
    [d.facts.resistance, above],
  ]) {
    if (!l) {
      assert.equal(f, null);
      continue;
    }
    assert.equal(f.price, l.p);
    assert.equal(f.atr, +(Math.abs(l.p - px) / x).toFixed(1));
    assert.ok(d.text.includes(l.p.toFixed(2)));
  }
  assert.ok(below || above, '模拟数据里至少该有一侧有关键价位');
  assert.equal(d.facts.atr, x);
  assert.equal(d.facts.asof, a.m.t.asof);
  assert.ok(d.lines[3].includes(x.toFixed(2)));
});

test('describeState：只说事实，不带评分、结论、情景和买卖用语', () => {
  for (const tf of TFS) {
    const d = describeState({ ...analyzeCandles(tf, all), name: '黄金 GC' });
    assert.doesNotMatch(d.text, /做多|做空|买入|卖出|建议|入场|止损|目标|评分|已触发|观望|看涨|看跌/, tf);
  }
});

test('describeState：就在价位上时说“就在……附近”；没有价位时照实说；K线不够时说没有分析', () => {
  const a = analyzeCandles('1h', all),
    lv = a.m.L.filter(l => isKey(l, '1h'))[0];
  /* 把现价挪到一个关键价位上（重新分析，价位的上下方跟着变） */
  const on = analyzeCandles('1h', all, lv.p),
    d = describeState({ ...on, name: '黄金 GC' });
  assert.match(d.text, new RegExp(`现价就在支撑 ${lv.p.toFixed(2)} 附近`));
  assert.equal(d.facts.support.atr, 0);
  /* 没有关键价位 */
  const none = describeState({ ...a, m: { ...a.m, L: [] }, name: '黄金 GC' });
  assert.match(none.text, /下方没有算出关键支撑；上方没有算出关键阻力/);
  assert.deepEqual([none.facts.support, none.facts.resistance], [null, null]);
  /* K线不够 */
  const few = describeState({ ...analyzeCandles('1d', { '1d': all['1d'].slice(-5) }), name: '黄金 GC' });
  assert.match(few.text, /^黄金 GC 日线已收盘的K线不够/);
  assert.equal(few.facts.atr, null);
});

test('describeState：小数位按 dp', () => {
  const eur = demoAll({ sym: 'EURUSD', base: 1.08 }),
    d = describeState({ ...analyzeCandles('1d', eur), name: '欧元/美元', dp: 5 });
  assert.match(d.lines[0], /现价 1\.\d{5}。$/);
});
