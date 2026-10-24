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

test('analyze：不足 60 根返回 null', () => {
  const analyze = loadCore()('analyze');
  assert.equal(analyze(Array.from({ length: 59 }, (_, i) => bar(i * H, 1, 1, 1, 1))), null);
});
