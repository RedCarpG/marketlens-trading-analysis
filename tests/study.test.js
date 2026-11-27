// core/study.js：关键价位统计（lvStudy / lvReport / lvText）和事件研究（evStudy / evReport / evText）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const NOW = Date.UTC(2026, 9, 23, 13, 7, 0);
const get = loadCore(NOW);
const [lvStudy, lvReport, lvText, evStudy, evReport, evText, demoAll, bkt] = [
  'lvStudy',
  'lvReport',
  'lvText',
  'evStudy',
  'evReport',
  'evText',
  'demoAll',
  'bkt',
].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
const H = 36e5,
  D = 864e5;

/* 固定种子、没有漂移的随机游走日线，再合成周线和月线 */
function walk(n, seed = 11) {
  let s = seed;
  const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5,
    t0 = Date.UTC(2015, 0, 5),
    d = [];
  let p = 1000;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = Math.max(50, p + r() * 20);
    d.push({
      timestamp: t0 + i * D,
      open: o,
      high: Math.max(o, p) + Math.abs(r()) * 6,
      low: Math.min(o, p) - Math.abs(r()) * 6,
      close: p,
      volume: 1,
    });
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

test('lvStudy：三类线都记得到；每条记录的字段齐全；结果只有 被挡回 / 穿过去 / 未定', () => {
  const all = walk(900),
    st = lvStudy(all, { tf: '1d' }),
    kinds = new Set(st.touches.map(t => t.kind));
  assert.deepEqual([...kinds].sort(), ['grid', 'key', 'plain']);
  assert.ok(st.steps > 600);
  for (const t of st.touches) {
    assert.ok(['bounce', 'break', 'open'].includes(t.st));
    assert.ok(t.atr > 0 && Math.abs(t.px - t.lp) <= t.atr * 0.25 + 1e-9, '触及时价格在线的 0.25 个 ATR 以内');
    assert.equal(t.side, t.px >= t.lp ? 1 : -1);
    assert.equal(t.ts, all['1d'][t.i].timestamp);
    if (t.kind != 'grid') assert.ok(t.top && t.tfs >= 1 && t.touch >= 0);
  }
});

test('lvStudy 不偷看未来：后面还有数据和数据到此为止，早先的触及完全一样', () => {
  const all = walk(900),
    cut = 600,
    short = {
      '1d': all['1d'].slice(0, cut),
      '1w': all['1w'].filter(b => b.timestamp <= all['1d'][cut - 1].timestamp),
      '1M': all['1M'].filter(b => b.timestamp <= all['1d'][cut - 1].timestamp),
    },
    full = lvStudy(all, { tf: '1d' }).touches.filter(t => t.i + 10 < cut),
    part = lvStudy(short, { tf: '1d' }).touches.filter(t => t.i + 10 < cut);
  assert.ok(part.length > 20);
  assert.deepEqual(plain(part), plain(full));
});

test('空白对照：随机游走上，关键价位并不比随便一条线更能挡（差距在误差范围内）', () => {
  const rep = lvReport(lvStudy(walk(2500, 5), { tf: '1d' })),
    [key, , grid] = rep.kinds;
  assert.ok(key.n >= 100 && grid.n >= 100, `样本够：${key.n} / ${grid.n}`);
  assert.equal(rep.edge.sure, false);
  /* 这个比较方法自己带着几个百分点的偏差（随机游走上关键价位反而低 8 个点左右）：真实数据上的差距要明显超过这个量级才算数 */
  assert.ok(Math.abs(rep.edge.diff) < 0.12, `差 ${rep.edge.diff.toFixed(3)}`);
  /* 关键价位很密：同时有十几条，大半的时间收盘价就在某一条的触及范围里 */
  assert.ok(rep.keys > 8 && rep.atKey > 0.4, `${rep.keys.toFixed(1)} 条，${rep.atKey.toFixed(2)}`);
  /* 价格是走过来碰到线的，随便一条线也是被挡回的略多，但不会离一半太远 */
  assert.ok(grid.rate > 0.4 && grid.rate < 0.7, `对照线 ${grid.rate.toFixed(3)}`);
});

test('lvReport / lvText：比例只在分出结果的里面算，带区间；次数少的标出来；两种比较的说法', () => {
  const mk = (kind, st, n, extra = {}) =>
      Array.from({ length: n }, () => ({ kind, st, side: 1, top: '1w', tfs: 2, touch: 3, ...extra })),
    study = {
      tf: '1d',
      opts: { n: 10 },
      steps: 500,
      touches: [
        ...mk('key', 'bounce', 70),
        ...mk('key', 'break', 30),
        ...mk('key', 'open', 20),
        ...mk('grid', 'bounce', 50),
        ...mk('grid', 'break', 50),
        ...mk('plain', 'bounce', 5, { top: '1d', tfs: 1, touch: 0 }),
      ],
    },
    rep = plain(lvReport(study)),
    [key, pl, grid] = rep.kinds;
  assert.deepEqual([key.n, key.bounce, key.brk, key.open, key.rate, key.thin], [120, 70, 30, 20, 0.7, false]);
  assert.ok(key.lo < 0.7 && key.hi > 0.7 && key.lo > 0.6);
  assert.deepEqual([pl.n, pl.rate, pl.thin], [5, 1, true]);
  assert.equal(grid.rate, 0.5);
  assert.deepEqual([+rep.edge.diff.toFixed(2), rep.edge.sure], [0.2, true]);
  assert.deepEqual(
    rep.groups.touch.map(g => [g.id, g.n]),
    [['t3', 120]]
  );
  assert.deepEqual(
    rep.groups.top.map(g => g.id),
    ['htf']
  );
  assert.equal(
    lvText(rep),
    '过去 120 次走到关键价位，之后 10 根内分出结果的 100 次里被挡回 70%，比随便一条线（50%）高，差距超出了误差范围。'
  );
  const close = plain(
    lvReport({
      ...study,
      touches: [
        ...mk('key', 'bounce', 11),
        ...mk('key', 'break', 9),
        ...mk('grid', 'bounce', 50),
        ...mk('grid', 'break', 50),
      ],
    })
  );
  assert.equal(
    lvText(close),
    '过去 20 次走到关键价位，之后 10 根内分出结果的 20 次里被挡回 55%，随便一条线是 50%，两者的差距在误差范围内。次数不到 30，只当记录看。'
  );
  assert.equal(lvText(plain(lvReport({ ...study, touches: [] }))), '这段数据里关键价位被碰到的次数太少，没有统计。');
  assert.doesNotMatch(lvText(rep), /建议|应该|会涨|会跌|买|卖/);
});

/* ===== 事件研究 ===== */
/* 60 天的 1 小时K线：平常每根高低差 2；指定的几根改成别的 */
function hours(days, special = {}) {
  const t0 = Date.UTC(2026, 0, 5),
    out = [];
  for (let i = 0; i < days * 24; i++) {
    const ts = t0 + i * H,
      s = special[ts] || {},
      o = 100,
      rng = s.range ?? 2;
    out.push({ timestamp: ts, open: o, high: o + rng / 2, low: o - rng / 2, close: o + (s.move ?? 0) });
  }
  return { t0, bars: out };
}

test('evStudy：公布所在那根和下一根的波幅，对照是之前各天同一时刻的中位数；涨跌看第二根收盘减第一根开盘', () => {
  const t0 = Date.UTC(2026, 0, 5),
    ev = t0 + 40 * D + 13 * H + 30 * 60e3, // 第 41 天 13:30
    { bars } = hours(60, { [t0 + 40 * D + 13 * H]: { range: 10 }, [t0 + 40 * D + 14 * H]: { range: 6, move: 3 } }),
    rows = plain(evStudy(bars, [{ ts: ev, rel: 'empsit', imp: 3, zh: '非农就业报告' }]));
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].rel, rows[0].name, rows[0].range, rows[0].base, rows[0].ratio, rows[0].move],
    ['empsit', '非农就业报告', 10, 2, 5, 3]
  );
  assert.deepEqual([rows[0].dayRange, rows[0].dayBase, rows[0].dayRatio], [10, 2, 5]);
});

test('evStudy：只算认得的三类、高影响、有时间的；同一次公布的几条只算一次；缺K线、对照天数不够的跳过；有别的事件的日子不当对照', () => {
  const t0 = Date.UTC(2026, 0, 5),
    at = (d, h) => t0 + d * D + h * H,
    { bars } = hours(60, { [at(40, 13)]: { range: 10 }, [at(39, 13)]: { range: 50 } }),
    e = (ts, o = {}) => ({ ts, rel: 'cpi', imp: 3, title: 'CPI', ...o });
  /* 前一天同一时刻也有重要事件（波幅 50）：不能进对照，否则中位数不变也要确认它被排除 */
  const rows = evStudy(bars, [
    e(at(40, 13)),
    e(at(40, 13), { title: 'Core CPI' }),
    e(at(39, 13), { rel: 'gdp' }),
    e(at(40, 13), { rel: 'pce' }),
    e(at(41, 13), { imp: 2 }),
    e(null),
    e(at(5, 13)),
    e(at(70, 13)),
  ]);
  assert.deepEqual(
    plain(rows).map(r => [r.rel, r.ts, r.range, r.base]),
    [['cpi', at(40, 13), 10, 2]]
  );
  /* 休市：公布那一根后面隔了很久才有下一根 */
  const gap = bars.filter(b => b.timestamp !== at(40, 14));
  assert.equal(evStudy(gap, [e(at(40, 13))]).length, 0);
});

test('evReport / evText：按类型取中位数，涨跌各几次；次数少的标出来；话里没有预测', () => {
  const row = (rel, range, ratio, move, dayRatio = 2) => ({ ts: 1, rel, range, ratio, move, dayRatio }),
    rep = plain(
      evReport([row('empsit', 20, 2, 5), row('empsit', 30, 3, -4), row('empsit', 40, 6, 1), row('cpi', 10, 1.5, -2)])
    );
  assert.deepEqual(
    rep.map(r => r.rel),
    ['empsit', 'cpi']
  );
  assert.deepEqual(
    [rep[0].n, rep[0].range, rep[0].ratio, rep[0].min, rep[0].max, rep[0].up, rep[0].down, rep[0].thin],
    [3, 30, 3, 2, 6, 2, 1, true]
  );
  assert.equal(
    evText(rep[0]),
    '过去 3 次非农公布后一小时左右，波幅的中位数是 30.00，是平常同一时刻的 3.0 倍（最小 2.0 倍，最大 6.0 倍）；之后 2 次是涨的、1 次是跌的。次数少，只当记录看。'
  );
  assert.doesNotMatch(evText(rep[0]), /建议|应该|会涨|会跌|买|卖|利好|利空/);
  assert.equal(evText(null), '');
  const many = evReport(Array.from({ length: 9 }, () => row('fomc', 12, 2, 1)));
  assert.equal(many[0].thin, false);
  assert.match(evText(many[0], 1), /^过去 9 次FOMC 利率决议公布后一小时左右，波幅的中位数是 12\.0，/);
});

test('模拟数据上跑一遍关键价位统计：有结果，写得出一句话', () => {
  const rep = lvReport(lvStudy(demoAll({ sym: 'GC', base: 2650 }), { tf: '1d' }));
  assert.ok(rep.kinds[0].n > 0);
  assert.match(lvText(rep), /^过去 \d+ 次走到关键价位/);
});
