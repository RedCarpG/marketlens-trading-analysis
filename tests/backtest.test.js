// 回测引擎：不偷看未来、模拟成交规则、统计函数、随机游走上的空白对照
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const NOW = Date.UTC(2026, 9, 23, 13, 7, 0);
const get = loadCore(NOW);
const [btRun, btReport, btSim, btCount, wilson, spearman, bkt, nxt, demoAll, btPage] = [
  'btRun',
  'btReport',
  'btSim',
  'btCount',
  'wilson',
  'spearman',
  'bkt',
  'nxt',
  'demoAll',
  'btPage',
].map(get);
const plain = x => JSON.parse(JSON.stringify(x));

/* 纯随机游走日线（无漂移），周线、月线由日线聚合 */
function randomWalk(seed, n) {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647,
    g = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(6.2832 * r()),
    d = [],
    t0 = Date.UTC(2015, 0, 5);
  let p = 2000;
  for (let i = 0; i < n; i++) {
    const o = p,
      c = p * Math.exp(g() * 0.01);
    d.push({
      timestamp: t0 + i * 864e5,
      open: o,
      high: Math.max(o, c) * (1 + Math.abs(g()) * 0.004),
      low: Math.min(o, c) * (1 - Math.abs(g()) * 0.004),
      close: c,
      volume: 0,
    });
    p = c;
  }
  const agg = tf => {
    const out = [];
    for (const b of d) {
      const k = bkt(tf, b.timestamp),
        x = out[out.length - 1];
      if (x && x.timestamp === k) {
        x.high = Math.max(x.high, b.high);
        x.low = Math.min(x.low, b.low);
        x.close = b.close;
      } else out.push({ ...b, timestamp: k });
    }
    return out;
  };
  return { '1d': d, '1w': agg('1w'), '1M': agg('1M') };
}

test('不偷看未来：截断在某一天之后，此前每一步的评分、信号、情景都与全量数据完全相同', () => {
  const all = demoAll({ sym: 'GC', base: 2650 }),
    B = all['1d'],
    k = B.length - 120,
    tCut = nxt('1d', B[k].timestamp),
    cutAll = Object.fromEntries(
      Object.entries(all).map(([tf, bs]) => [tf, bs.filter(b => nxt(tf, b.timestamp) <= tCut)])
    );
  const full = plain(btRun(all, { tf: '1d' })),
    part = plain(btRun(cutAll, { tf: '1d' }));
  assert.ok(part.steps.length > 100);
  const upto = a => a.filter(e => e.i <= k);
  assert.deepEqual(upto(full.steps), part.steps);
  assert.deepEqual(upto(full.sigs), part.sigs);
  assert.deepEqual(upto(full.trades), part.trades);
});

test('from/to 只限定入场时间段：区间内每一步与全量回放相同；区间后的K线照常用来结算', () => {
  const all = demoAll({ sym: 'GC', base: 2650 }),
    B = all['1d'],
    [a, b] = [B.length - 400, B.length - 250],
    o = { tf: '1d', from: B[a].timestamp, to: B[b].timestamp };
  const full = plain(btRun(all, { tf: '1d' })),
    part = btRun(all, o),
    inR = x => x.filter(e => e.i >= a && e.i <= b);
  assert.ok(part.steps.length > 100);
  assert.deepEqual(inR(full.steps), plain(part.steps));
  assert.deepEqual(inR(full.sigs), plain(part.sigs));
  assert.deepEqual(inR(full.trades), plain(part.trades));
  const rep = btReport(all, part);
  assert.ok(rep.sce.all.all.n > 0);
  assert.equal(rep.sce.all.all.open, 0); // 区间末尾附近开的仓也用之后的K线结算完
});

test('btCount：只数已收盘的K线', () => {
  const bs = [0, 1, 2, 3].map(i => ({ timestamp: Date.UTC(2026, 0, 5 + i) }));
  assert.equal(btCount(bs, '1d', Date.UTC(2026, 0, 7)), 2); // 1 月 5、6 日两根已收盘，7 日刚开盘
  assert.equal(btCount(bs, '1d', Date.UTC(2026, 0, 9)), 4);
  assert.equal(btCount(bs, '1d', Date.UTC(2026, 0, 5)), 0);
});

test('模拟成交：同一根K线止损和目标都触及按先止损；跳空按开盘价；超时按收盘；数据不够为 open；点差计入 R', () => {
  const bar = (o, h, l, c, d) => ({ timestamp: Date.UTC(2026, 0, 1 + d), open: o, high: h, low: l, close: c });
  const o = { maxHold: 3, spread: 0, fee: 0 },
    tr = { i: 0, dir: 1, entry: 100, stop: 95, tgt: 110 },
    B0 = bar(98, 101, 97, 100, 0);
  assert.deepEqual(plain(btSim([B0, bar(101, 111, 94, 105, 1)], tr, o)).res, 'stop');
  assert.equal(btSim([B0, bar(101, 111, 94, 105, 1)], tr, o).R, -1);
  const gap = btSim([B0, bar(93, 96, 92, 94, 1)], tr, o);
  assert.equal(gap.res, 'stop');
  assert.ok(Math.abs(gap.R + 1.4) < 1e-9); // 开盘 93 越过止损 95，按 93 成交
  const win = btSim([B0, bar(101, 110.5, 99, 108, 1)], tr, o);
  assert.equal(win.res, 'target');
  assert.equal(win.R, 2);
  const flat = [B0, bar(100, 102, 98, 101, 1), bar(101, 103, 99, 102, 2), bar(102, 104, 100, 103, 3)];
  const to = btSim(flat, tr, o);
  assert.equal(to.res, 'timeout');
  assert.ok(Math.abs(to.R - 0.6) < 1e-9);
  assert.equal(btSim(flat.slice(0, 3), tr, o).res, 'open');
  const sp = btSim([B0, bar(101, 110.5, 99, 108, 1)], tr, { ...o, spread: 0.5 });
  assert.ok(Math.abs(sp.R - 1.9) < 1e-9);
  const pc = btSim([B0, bar(101, 110.5, 99, 108, 1)], tr, { ...o, spreadPct: 0.1, carry: 36.5 });
  assert.ok(Math.abs(pc.R - 1.96) < 1e-9); // 往返 0.1% + 年化 36.5% 持有 1 天 = 0.2 价格单位，风险 5
  const sh = btSim([B0, bar(99, 101, 89, 90, 1)], { i: 0, dir: -1, entry: 100, stop: 105, tgt: 90 }, o);
  assert.equal(sh.res, 'target');
  assert.equal(sh.R, 2);
});

test('出场规则：目标改为 N 倍风险、浮盈 1R 后保本、移动止损、持仓上限；保本和移动止损从下一根起生效', () => {
  const bar = (o, h, l, c, d) => ({ timestamp: Date.UTC(2026, 0, 1 + d), open: o, high: h, low: l, close: c });
  const o = { maxHold: 50, spread: 0, fee: 0 },
    tr = { i: 0, dir: 1, entry: 100, stop: 95, tgt: 110, atr: 2 },
    B0 = bar(98, 101, 97, 100, 0);
  const t1 = btSim([B0, bar(101, 105.5, 99, 104, 1)], tr, { ...o, exit: { tgtR: 1 } });
  assert.equal(t1.res, 'target');
  assert.equal(t1.R, 1);
  const be = btSim([B0, bar(101, 106, 99, 104, 1), bar(101, 102, 99.5, 101, 2)], tr, { ...o, exit: { be: 1 } });
  assert.equal(be.res, 'trail'); // 第 1 根浮盈过 1R（且当根低点 99 未到 100），第 2 根回到入场价出场
  assert.equal(be.R, 0);
  const tl = btSim([B0, bar(101, 110, 101, 109, 1), bar(108, 108, 105, 106, 2)], tr, {
    ...o,
    exit: { tgtR: 0, trail: 2 },
  });
  assert.equal(tl.res, 'trail'); // 最高 110 − 2×ATR 2 = 106
  assert.ok(Math.abs(tl.R - 1.2) < 1e-9);
  const hd = btSim([B0, bar(100, 102, 98, 101, 1), bar(101, 103, 99, 102, 2)], tr, {
    ...o,
    exit: { tgtR: 0, hold: 2 },
  });
  assert.equal(hd.res, 'timeout');
  assert.ok(Math.abs(hd.R - 0.4) < 1e-9);
});

test('btPage（页面回测面板）：结果能在线程间传递（不含函数），与 btReport 一致，交易附出场时间', () => {
  const all = demoAll({ sym: 'GC', base: 2650 }),
    cost = get('BT_COSTS').gold,
    r = btPage({ all, opts: { tf: '1d' }, cost }, () => {}),
    run = btRun(all, { tf: '1d' }),
    rep = btReport(all, { ...run, opts: { ...run.opts, ...cost } });
  assert.doesNotThrow(() => structuredClone(r));
  assert.equal(r.sce.all.all.n, rep.sce.all.all.n);
  assert.ok(Math.abs(r.sce.all.all.mean - rep.sce.all.all.mean) < 1e-12);
  assert.ok(r.gross.mean > r.sce.all.all.mean); // 计入成本后更低
  const t = r.list.find(x => x.exitI != null);
  assert.equal(t.exitTs, all['1d'][t.exitI].timestamp);
});

test('统计：Wilson 区间与秩相关', () => {
  const w = wilson(5, 10);
  assert.ok(Math.abs(w.lo - 0.2366) < 1e-3 && Math.abs(w.hi - 0.7634) < 1e-3);
  assert.equal(wilson(0, 0), null);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
});

test('空白对照：纯随机游走上，情景平均 R 的 95% 区间包含 0，信号收益与基准接近', () => {
  for (const seed of [11, 33]) {
    const all = randomWalk(seed, 1600),
      rep = btReport(all, btRun(all, { tf: '1d' })),
      a = rep.sce.all.all;
    assert.ok(a.n > 200, `情景笔数 ${a.n}`);
    assert.ok(a.lo < 0 && a.hi > 0, `平均 R 区间 [${a.lo}, ${a.hi}]`);
    const s = rep.sig.reduce(
      (t, r) => ({ n: t.n + r.h[5].all.n, sum: t.sum + (r.h[5].all.mean || 0) * r.h[5].all.n }),
      {
        n: 0,
        sum: 0,
      }
    );
    assert.ok(Math.abs(s.sum / s.n) < 0.15, `信号 5 根平均 ${s.sum / s.n}`);
  }
});
