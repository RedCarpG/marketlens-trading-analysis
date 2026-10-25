// 核心规则的单元测试：时间网格、已收盘判断、摆动点、前高前低、关键价位合并与判定、价格行为情景触发
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const H = 36e5;
const bar = (t, o, h, l, c) => ({ timestamp: t, open: o, high: h, low: l, close: c, volume: 0 });
/* vm 里创建的数组原型与这里不同，严格深比较会因原型不同而失败，先转成普通 JSON 值再比 */
const plain = x => JSON.parse(JSON.stringify(x));

test('bkt / nxt：周线从周一 00:00 UTC 起，月线跨年', () => {
  const get = loadCore();
  const bkt = get('bkt'),
    nxt = get('nxt');
  const wed = Date.UTC(2026, 9, 21, 15); // 2026-10-21 周三
  assert.equal(new Date(bkt('1w', wed)).toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(new Date(bkt('1M', wed)).toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(new Date(nxt('1M', Date.UTC(2026, 11, 1))).toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(nxt('1h', Date.UTC(2026, 0, 1)), Date.UTC(2026, 0, 1, 1));
});

test('closed：最后一根未收盘时去掉，已收盘时保留', () => {
  const t0 = Date.UTC(2026, 0, 1, 10);
  const bs = [bar(t0, 1, 1, 1, 1), bar(t0 + H, 1, 1, 1, 1)];
  assert.equal(loadCore(t0 + H + 1)('closed')('1h', bs).length, 1);
  assert.equal(loadCore(t0 + 2 * H)('closed')('1h', bs).length, 2);
});

test('pivots：V 形低点被确认，摆幅不足 1 ATR 的小波动被过滤', () => {
  const get = loadCore();
  const pivots = get('pivots');
  const v = [110, 108, 106, 104, 102, 100, 102, 104, 106, 108, 110].map((p, i) => bar(i * H, p, p + 0.5, p - 0.5, p));
  assert.deepEqual(plain(pivots(v, 2, 3).lo), [99.5]);
  assert.deepEqual(plain(pivots(v, 2, 50).lo), []);
});

test('prevHL：取时间上最近、仍在现价下方的低点，并记下刚被跌破的那个', () => {
  const prevHL = loadCore()('prevHL');
  const z = {
    pv: {
      hs: [],
      ls: [
        { p: 95, ts: 1 },
        { p: 102, ts: 2 },
      ],
    },
  };
  const r = prevHL(z, 100);
  assert.equal(r.lo.p, 95);
  assert.equal(r.loB.p, 102);
});

test('levels / isKey：0.5 ATR 内的摆动点合并，代表价取周期更大的点；多周期共振即为关键价位', () => {
  const get = loadCore();
  const levels = get('levels'),
    isKey = get('isKey');
  const C = {
    '1h': { a: {}, pv: { hi: [], lo: [100.2] }, rb: [] },
    '1d': { a: {}, pv: { hi: [], lo: [100] }, rb: [] },
  };
  const L = levels('1h', C, 105, 2, 90, 120);
  assert.equal(L.length, 1);
  assert.equal(L[0].p, 100);
  assert.equal(L[0].top, '1d');
  assert.deepEqual(plain(L[0].tfs), ['1d', '1h']);
  assert.equal(L[0].side, 1);
  assert.equal(isKey(L[0], '1h'), true);
});

test('scenarios：支撑处出现长下影 → 支撑反弹做多，止损 < 入场 < 目标', () => {
  const scenarios = loadCore()('scenarios');
  const rb = [];
  for (let i = 0; i < 30; i++) rb.push(bar(i * H, 103, 104, 102.5, 103.5));
  rb.push(bar(30 * H, 101.2, 101.6, 100.1, 101.5)); // 触及 100 支撑后收回，下影约占 73%
  const t = { rb, a: { a: 2 } };
  const L = [
    { p: 100, top: '1d', tfs: ['1d', '1w'], touch: 3, side: 1 },
    { p: 110, top: '1d', tfs: ['1d', '1w'], touch: 3, side: -1 },
  ];
  const cards = scenarios('1h', t, L, 101.5);
  const g = cards.flatMap(c => c.trigs)[0];
  assert.ok(g, '应有触发');
  assert.equal(g.kind, '支撑反弹');
  assert.equal(g.dir, 1);
  assert.equal(g.state, '已触发');
  assert.ok(g.stop < g.entry && g.entry < g.tgt);
  assert.equal(g.tgt, 110);
});

test('scenarios 收紧选项：loose=0 去掉强阳收回；htf=1 只认大周期价位；cool 冷却期内的重复触及不算新触发', () => {
  const get = loadCore(),
    scenarios = get('scenarios'),
    DEF = { loose: 1, htf: 0, cool: 0 }; // 收紧前的规则，逐项打开收紧选项
  const base = () => Array.from({ length: 30 }, (_, i) => bar(i * H, 103, 104, 102.5, 103.5));
  const L = top => [
    { p: 100, top, tfs: [top], touch: 3, side: 1 },
    { p: 110, top, tfs: [top], touch: 3, side: -1 },
  ];
  const trig = (rb, lv, opt) =>
    scenarios('1h', { rb, a: { a: 2 } }, lv, rb[rb.length - 1].close, opt).flatMap(c => c.trigs)[0];
  /* 强阳收回：触及支撑，下影只占 15%，收在上部 */
  const strong = base().concat(bar(30 * H, 100.3, 102, 100, 101.9));
  assert.equal(trig(strong, L('1d'), DEF).shape, '强阳收回');
  assert.equal(trig(strong, L('1d'), { ...DEF, loose: 0 }), undefined);
  assert.equal(trig(strong, L('1d')), undefined); // 页面默认（SC_DEF）已去掉宽松形态
  /* 长下影在 1h 自己的价位上：htf=1 时不算，换成日线价位则算 */
  const wick = base().concat(bar(30 * H, 101.2, 101.6, 100.1, 101.5));
  assert.equal(trig(wick, L('1h'), { ...DEF, htf: 1 }), undefined);
  assert.equal(trig(wick, L('1d'), { ...DEF, htf: 1 }).shape, '长下影');
  const offs = top =>
    scenarios('1h', { rb: wick, a: { a: 2 } }, L(top), 101.5, { ...DEF, htf: 1 }).flatMap(c => c.alt.map(o => !!o.off));
  assert.ok(offs('1h').length && offs('1h').every(Boolean)); // 本周期价位：条件情景标为不会触发
  assert.ok(offs('1d').every(o => !o));
  /* 3 根前已在同一支撑出现长下影：不冷却时最新一根是新触发；冷却 10 根时仍显示 3 根前那次 */
  const twice = base();
  twice[27] = bar(27 * H, 101.2, 101.6, 100.1, 101.5);
  twice.push(bar(30 * H, 101.2, 101.6, 100.1, 101.5));
  assert.equal(trig(twice, L('1d'), DEF).ago, 0);
  assert.equal(trig(twice, L('1d'), { ...DEF, cool: 10 }).ago, 3);
  assert.equal(trig(twice, L('1d'), { ...DEF, cool: 2 }).ago, 0);
  /* 移动止损：3 根前触发后最高到 104（基础K线高点），回撤 2×ATR 2 = 100，高于初始止损 99.5 */
  assert.equal(trig(twice, L('1d'), { ...DEF, cool: 10, trail: 2 }).trail, 100);
  assert.equal(trig(twice, L('1d'), DEF).trail, undefined);
});

test('trendOf：均线、摆动结构、快均线三种方向判断', () => {
  const trendOf = loadCore()('trendOf');
  const pv = (h, l) => ({ hs: h.map(p => ({ p })), ls: l.map(p => ({ p })) });
  const a = c => ({ c, e2: 100, e5: 95 });
  assert.equal(trendOf('ema', [], a(101), pv([], [])), 1);
  assert.equal(trendOf('ema', [], a(94), pv([], [])), 0); // EMA20 仍在 EMA50 上方但收盘跌破 EMA50：震荡
  assert.equal(trendOf('struct', [], a(100), pv([100, 105], [90, 95])), 1); // 高点、低点都抬高
  assert.equal(trendOf('struct', [], a(94), pv([100, 105], [90, 95])), 0); // 跌破最近低点
  assert.equal(trendOf('struct', [], a(96), pv([105, 100], [95, 90])), -1);
  assert.equal(trendOf('struct', [], a(96), pv([105], [95, 90])), 0); // 摆动点不足两个
  const up = Array.from({ length: 30 }, (_, i) => ({ close: 90 + i }));
  assert.equal(trendOf('fast', up, { c: 119, e2: 110 }, pv([], [])), 1);
});

test('analyze：不足 60 根返回 null', () => {
  const analyze = loadCore()('analyze');
  assert.equal(analyze(Array.from({ length: 59 }, (_, i) => bar(i * H, 1, 1, 1, 1))), null);
});
