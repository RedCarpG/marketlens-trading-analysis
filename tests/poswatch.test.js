// 代理的持仓看守（server/poswatch.js）：没交过开关时不取数不说话；止损 / 止盈到价只说一次、重启不重复、隔太久不补说；
// 新开的一笔对照守则说一声（已有的、开了很久的、别的品种的不说）；交给 Cirra 的话里没有金额
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPosWatch, parsePos, FRESH } = require('../server/poswatch');
const { loadCore } = require('./load-core');

const H = 36e5,
  MIN = 60e3,
  T0 = Date.UTC(2026, 9, 26, 12),
  POLL = 60e3;
const get = loadCore(T0 + 1000);

/* 1 小时K线：在 100~110 之间来回，最后一根是还没收盘的 */
function series() {
  const out = [];
  for (let i = 0; i < 200; i++) {
    const c = 105 + 5 * Math.sin(i / 6);
    out.push({ timestamp: T0 - (200 - i) * H, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 0 });
  }
  out.push({ timestamp: T0, open: 105, high: 105, low: 105, close: 105, volume: 0 });
  return out;
}
const ATR = get('ctx')('1h', series()).a.a;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pos-')), 'poswatch.json');
const pos = (id, o = {}) => ({
  id,
  instrumentId: 18,
  isBuy: true,
  openTs: T0 - 5 * H,
  openRate: 105,
  units: 3,
  amount: 900,
  sl: 0,
  tp: 0,
  pnl: -12.5,
  curRate: 105,
  ...o,
});

function rig({ file = tmp(), clock = { t: T0 + MIN }, running = true, rules = { on: { nostop: 1 } }, prefs } = {}) {
  const said = [],
    calls = { pos: 0, candles: [], closed: 0 },
    box = { open: [], running, rules };
  const w = createPosWatch({
    list: [{ name: '黄金 GOLD', symbol: 'GOLD', dp: 2, ccy: ['USD'] }],
    positions: async () => (calls.pos++, box.open),
    closed: async () => (calls.closed++, []),
    resolve: async s => ({ GOLD: 18 })[s],
    candles: async (s, tf) => (calls.candles.push(tf), tf == '1h' ? series() : []),
    calendar: async () => ({ events: [] }),
    rules: () => box.rules,
    cirra: { status: async () => ({ running: box.running }), send: async b => (said.push(b), { ok: true }) },
    file,
    pollMs: POLL,
    get: loadCore(T0 + 1000),
    now: () => clock.t,
    warn: () => {},
  });
  if (prefs) w.setPrefs(prefs);
  /* 走一轮，钟往前拨一分钟 */
  const step = async () => {
    await w.tick();
    clock.t += POLL;
  };
  return { w, said, calls, box, clock, file, step };
}

test('parsePos：两套密钥都有才看，不填是黄金；off 不看；自己写的条目，写错的跳过', () => {
  assert.deepEqual(parsePos(undefined, { keys: true, tkeys: true }), [
    { name: '黄金 GOLD', symbol: 'GOLD', dp: 2, ccy: ['USD'] },
  ]);
  assert.deepEqual(
    [
      parsePos('', { keys: true, tkeys: false }),
      parsePos('', { keys: false, tkeys: true }),
      parsePos(' OFF ', { keys: true, tkeys: true }),
    ],
    [[], [], []]
  );
  const warn = [];
  assert.deepEqual(
    parsePos('欧元|EURUSD|5|eur, usd;坏的|有 空格;金|GOLD', { keys: true, tkeys: true, warn: m => warn.push(m) }),
    [
      { name: '欧元', symbol: 'EURUSD', dp: 5, ccy: ['EUR', 'USD'] },
      { name: '金', symbol: 'GOLD', dp: 2, ccy: ['USD'] },
    ]
  );
  assert.equal(warn.length, 1);
});

test('slCheck / slText：进入 0.5 个 ATR 说一次，离开 1 个 ATR 才重新布防；远端的默认止损不看；金额只在页面那半句里', () => {
  const [slCheck, slText] = ['slCheck', 'slText'].map(get),
    arm = {},
    p = { id: 7, sl: 100, tp: 120, openRate: 105, isBuy: true, units: 3 },
    /* 核心库在另一个环境里跑，数组要转一下才能和这边的比 */
    at = px =>
      JSON.parse(JSON.stringify(slCheck([p, { id: 8, sl: 1, tp: 0 }], px, 2, arm).map(h => [h.p.id, h.n, h.v])));
  assert.deepEqual(at(105), []); // 第一次见：建立基准
  assert.deepEqual(at(100.9), [[7, '止损', 100]]);
  assert.deepEqual(at(100.5), []); // 还在里面，不重复
  assert.deepEqual(at(101.5), []); // 没离开够 1 个 ATR
  assert.deepEqual(at(100.8), []);
  assert.deepEqual(at(102.1), []); // 离开了，重新布防
  assert.deepEqual(at(100.6), [[7, '止损', 100]]);
  assert.deepEqual(at(119.2), [[7, '止盈', 120]]);
  const h = { p, n: '止损', v: 100, d: 0.9 },
    s = slText(h, { sym: 'GOLD', name: '黄金 GOLD', px: 100.9, x: 2, extra: '触及约 -$15.00' });
  assert.equal(s.text, 'GOLD 价格 100.90 接近我的止损 100.00（相距 0.5 ATR，触及约 -$15.00）');
  assert.equal(s.say, '黄金 GOLD 离你的止损 100.00 只差 0.5 个 ATR');
  assert.deepEqual(
    [s.kind, s.ck, slText({ ...h, n: '止盈' }, { sym: 'GOLD', name: '金', px: 1, x: 2 }).ck],
    ['dn', 'dn', 'up']
  );
  assert.equal(
    slText(h, { sym: 'GOLD', name: '金', px: 100.9, x: 2 }).text,
    'GOLD 价格 100.90 接近我的止损 100.00（相距 0.5 ATR）'
  );
});

test('页面没交过开关：不取持仓、不取K线、不说话；Cirra 没开时也不取', async () => {
  const a = rig();
  a.box.open = [pos(1, { sl: 104.9, curRate: 105 })];
  await a.step();
  await a.step();
  assert.deepEqual([a.calls.pos, a.calls.candles.length, a.said.length], [0, 0, 0]);
  assert.deepEqual(a.w.status(), { on: true, symbols: ['GOLD'], prefs: { sl: 0, ck: 0 }, last: null, err: null });
  const b = rig({ running: false, prefs: { sl: 1, ck: 1 } });
  b.box.open = [pos(1)];
  await b.step();
  assert.deepEqual([b.calls.pos, b.said.length], [0, 0]);
});

test('止损 / 止盈：第一次见只建基准；走近说一次（用持仓里的现价、1 小时的 ATR）；话里没有金额；ATR 一小时内不重取', async () => {
  const r = rig({ prefs: { sl: 1, ck: 0 } });
  r.box.open = [pos(7, { sl: 100, tp: 110, curRate: 105 })];
  await r.step();
  assert.equal(r.said.length, 0);
  r.box.open = [pos(7, { sl: 100, tp: 110, curRate: 100 + ATR * 0.3 })];
  await r.step();
  await r.step();
  assert.deepEqual(r.said, [{ text: '黄金 GOLD 离你的止损 100.00 只差 0.3 个 ATR', emotion: 'worried', kind: 'dn' }]);
  r.box.open = [pos(7, { sl: 100, tp: 110, curRate: 110 - ATR * 0.4 })]; // 同时离开止损够远、走近止盈
  await r.step();
  assert.deepEqual(r.said[1], { text: '黄金 GOLD 离你的止盈 110.00 只差 0.4 个 ATR', emotion: 'happy', kind: 'up' });
  r.box.open = [pos(7, { sl: 100, tp: 110, curRate: 100 + ATR * 0.2 })];
  await r.step();
  assert.equal(r.said.length, 3);
  for (const s of r.said) assert.doesNotMatch(s.text, /\$|900|12\.5|盈亏|手|units/);
  assert.deepEqual(r.calls.candles, ['1h']);
  assert.deepEqual(r.w.status().last.text, r.said[2].text);
  /* 没设止损止盈的持仓：连K线都不取 */
  const n = rig({ prefs: { sl: 1, ck: 0 } });
  n.box.open = [pos(9)];
  await n.step();
  assert.deepEqual([n.calls.pos, n.calls.candles.length], [1, 0]);
});

test('重启不重复；隔太久（代理或她关过）重新建基准，不补说；刚把止损 / 止盈打开时也重新建基准', async () => {
  const a = rig({ prefs: { sl: 1, ck: 0 } }),
    near = [pos(7, { sl: 100, curRate: 100 + ATR * 0.3 })];
  a.box.open = [pos(7, { sl: 100, curRate: 105 })];
  await a.step();
  a.box.open = near;
  await a.step();
  assert.equal(a.said.length, 1);
  /* 重启：同一个状态文件，价格还在里面 */
  const b = rig({ file: a.file, clock: a.clock });
  b.box.open = near;
  await b.step();
  assert.equal(b.said.length, 0);
  assert.deepEqual(b.w.status().prefs, { sl: 1, ck: 0 }); // 开关也是存着的
  /* 离开够远以后停了十分钟，回来时价格已经在里面：只建基准 */
  b.box.open = [pos(7, { sl: 100, curRate: 105 })];
  await b.step();
  b.clock.t += 10 * MIN;
  b.box.open = near;
  await b.step();
  assert.equal(b.said.length, 0);
  /* 关掉再打开：布防状态清掉 */
  const c = rig({ prefs: { sl: 1, ck: 0 } });
  c.box.open = [pos(7, { sl: 100, curRate: 105 })];
  await c.step();
  c.w.setPrefs({ sl: 0, ck: 1 });
  c.box.open = near;
  await c.step();
  c.w.setPrefs({ sl: 1, ck: 1 });
  await c.step();
  assert.equal(c.said.length, 0);
});

test('新开的一笔：已有的不说；之后多出来的对照守则说一声；开了很久的、别的品种的、没勾守则的不说', async () => {
  const r = rig({ prefs: { sl: 0, ck: 1 } });
  r.box.open = [pos(1)];
  await r.step();
  assert.equal(r.said.length, 0); // 第一次见到这个品种：只记下
  r.box.open = [pos(1), pos(2, { openTs: r.clock.t - MIN, isBuy: false })];
  await r.step();
  assert.deepEqual(r.said, [
    { text: '你新开的黄金 GOLD空单，有 1 条守则没守：开仓要设止损。', emotion: 'worried', kind: 'ck' },
  ]);
  assert.deepEqual([...new Set(r.calls.candles)].sort(), ['15m', '1M', '1d', '1h', '1w', '4h'].sort());
  await r.step();
  assert.equal(r.said.length, 1); // 说过的不再说
  /* 设了止损的那一笔：守住了 */
  r.box.open.push(pos(3, { openTs: r.clock.t - MIN, sl: 103 }));
  await r.step();
  assert.deepEqual(r.said[1], { text: '你新开的黄金 GOLD多单，1 条守则都守住了。', emotion: 'happy', kind: 'cko' });
  /* 开了超过半小时才看到的、别的品种的 */
  r.box.open.push(pos(4, { openTs: r.clock.t - FRESH - MIN }), pos(5, { openTs: r.clock.t - MIN, instrumentId: 99 }));
  await r.step();
  assert.equal(r.said.length, 2);
  /* 没勾守则：不重算、不说 */
  const n = rig({ prefs: { sl: 0, ck: 1 }, rules: null });
  n.box.open = [pos(1)];
  await n.step();
  n.box.open = [pos(1), pos(2, { openTs: n.clock.t - MIN })];
  await n.step();
  assert.deepEqual([n.said.length, n.calls.candles.length], [0, 0]);
});

test('体检没开时新开的也记下：之后再打开不会把旧的说一遍', async () => {
  const r = rig({ prefs: { sl: 1, ck: 0 } });
  r.box.open = [pos(1)];
  await r.step();
  r.box.open = [pos(1), pos(2, { openTs: r.clock.t - MIN })];
  await r.step();
  r.w.setPrefs({ sl: 1, ck: 1 });
  await r.step();
  assert.equal(r.said.length, 0);
});
