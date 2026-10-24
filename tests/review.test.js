// 交易复盘：只用开仓前已收盘的K线、结果与直接调用 analyzeMTF 一致、标签合法；汇总分组与结论
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const NOW = Date.UTC(2026, 9, 23, 13, 7, 0);

test('reviewTrade：只用开仓前已收盘的K线，顺逆势与 analyzeMTF 的结论一致', () => {
  const get = loadCore(NOW);
  const [TFS, demoAll, reviewTrade, ctx, analyzeMTF, nxt] = [
    'TFS',
    'demoAll',
    'reviewTrade',
    'ctx',
    'analyzeMTF',
    'nxt',
  ].map(get);
  const all = demoAll({ sym: 'GC', base: 2650 });
  const b = all['1h'][all['1h'].length - 50]; // 约两天前的一根 1h K线中间开仓
  const t = {
    isBuy: true,
    openTs: b.timestamp + 30 * 60e3,
    openRate: b.close,
    closeTs: b.timestamp + 5 * 36e5,
    closeRate: b.close + 3,
    netProfit: 3,
    sl: b.close - 6,
    units: 1,
  };
  const r = reviewTrade(t, all);
  assert.equal(r.ok, true);
  assert.equal(r.tf, '1h');
  // 手工按同样的截断方式重算，结论必须相同（复盘不能“偷看”开仓之后的K线）
  const Cx = {};
  for (const k of TFS) {
    const bs = all[k].filter(x => nxt(k, x.timestamp) <= t.openTs).slice(-600);
    if (bs.length) Cx[k] = ctx(k, bs);
  }
  const m = analyzeMTF('1h', Cx, t.openRate);
  assert.equal(r.want, m.want);
  assert.equal(r.align, m.want ? (m.want === 1 ? 1 : -1) : 0);
  assert.ok(['good', 'mid', 'bad'].includes(r.pos));
  assert.equal(r.stop, r.slAtr < 0.5 ? 'tight' : r.slAtr > 3 ? 'wide' : 'ok');
  assert.ok(Math.abs(r.r - 0.5) < 1e-9); // 赚 3、止损距离 6 → 0.5R
  assert.equal(r.holdH, 4.5);
  assert.equal(r.win, true);
});

test('reviewTrade：开仓前历史不足时返回 ok=false', () => {
  const reviewTrade = loadCore(NOW)('reviewTrade');
  const r = reviewTrade({ isBuy: false, openTs: 0, openRate: 1, sl: 0 }, { '1h': [], '4h': [], '1d': [] });
  assert.equal(r.ok, false);
});

test('summarizeReviews：分组统计与“亏损最集中的一组”结论', () => {
  const summarize = loadCore(NOW)('summarizeReviews');
  const mk = (align, pos, stop, net, holdH) => ({
    ok: true,
    win: net > 0,
    align,
    pos,
    stop,
    sc: null,
    holdH,
    t: { netProfit: net },
  });
  const s = summarize([
    mk(-1, 'mid', 'none', -500, 60),
    mk(-1, 'bad', 'none', -300, 50),
    mk(1, 'good', 'ok', 200, 10),
    mk(1, 'good', 'ok', 100, 8),
    { ok: false },
  ]);
  assert.equal(s.n, 4);
  assert.equal(s.win, 2);
  assert.equal(s.net, -500);
  const against = s.groups.align.find(g => g.key === '-1');
  assert.deepEqual([against.n, against.win, against.net], [2, 0, -800]);
  assert.match(s.insights[0], /逆大周期|未设止损/); // 净亏 -800 的组（逆大周期 与 未设止损 并列）排在第一条
  assert.ok(s.insights.some(x => x.includes('亏损单平均持仓')));
  assert.ok(s.insights.some(x => x.includes('2 笔没有设置有效止损')));
});
