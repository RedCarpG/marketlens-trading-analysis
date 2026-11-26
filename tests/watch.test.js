// 代理常驻预警：Cirra 没开时不取数、首轮只建立基准、到价只说一次并带来源和类型、重启不重复、隔太久不补说
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWatch, parseWatch } = require('../server/watch');
const { loadCore } = require('./load-core');

const H = 36e5,
  T0 = Date.UTC(2026, 9, 26, 12),
  TFS = ['15m', '1h', '4h', '1d', '1w', '1M'];
const POLL = 300e3;

/* 只有 1h 和 1d 有K线：1h 在 100~110 之间来回，留下摆动点；最后一根收盘价 px */
function series(px) {
  const out = [];
  for (let i = 0; i < 200; i++) {
    const c = 105 + 5 * Math.sin(i / 6);
    out.push({ timestamp: T0 - (200 - i) * H, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 0 });
  }
  out.push({ timestamp: T0, open: px, high: px, low: px, close: px, volume: 0 });
  return out;
}
function rig({ running = true, file, clock }) {
  const said = [],
    calls = [],
    box = { px: 105, running };
  const w = createWatch({
    list: [{ name: '黄金 GOLD', src: 'yahoo', symbol: 'GC=F', tf: '1h', dp: 2 }],
    candles: async (src, s, tf) => {
      calls.push(tf);
      return tf == '1h' ? series(box.px) : [];
    },
    cirra: {
      status: async () => ({ running: box.running }),
      send: async b => (said.push(b), { ok: true }),
    },
    file,
    pollMs: POLL,
    get: loadCore(T0 + 1000),
    now: () => clock.t,
    warn: () => {},
  });
  return { w, said, calls, box };
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'watch-')), 'watch.json');
/* 找一个规则认定的关键价位，价格放到它上面就该提醒 */
function keyLevel() {
  const get = loadCore(T0 + 1000),
    C = { '1h': get('ctx')('1h', series(105)) };
  const m = get('analyzeMTF')('1h', C, 105);
  return m.L.filter(l => get('isKey')(l, '1h'))[0].p;
}

test('parseWatch：不填看黄金，off 不看，错的条目跳过', () => {
  assert.equal(parseWatch('', { keys: true, tfs: TFS })[0].src, 'etoro');
  assert.equal(parseWatch(undefined, { keys: false, tfs: TFS })[0].symbol, 'GC=F');
  assert.deepEqual(parseWatch('off', { keys: true, tfs: TFS }), []);
  const warn = [];
  const r = parseWatch('比特币|yahoo|BTC-USD|4h|1;坏的|binance|X|1h;金|etoro|GOLD|1h', {
    keys: false,
    tfs: TFS,
    warn: m => warn.push(m),
  });
  assert.deepEqual(r, [{ name: '比特币', src: 'yahoo', symbol: 'BTC-USD', tf: '4h', dp: 1 }]);
  assert.equal(warn.length, 2);
});

test('Cirra 没开时不取数', async () => {
  const clock = { t: T0 },
    { w, calls, said } = rig({ running: false, file: tmp(), clock });
  await w.tick();
  assert.deepEqual([calls, said], [[], []]);
});

test('首轮只建立基准；到价说一次，带 kind（source 由 cirra.js 统一加）；没离开不重复；大周期只在新K线时重取', async () => {
  const clock = { t: T0 },
    p = keyLevel(),
    { w, said, calls, box } = rig({ file: tmp(), clock });
  box.px = p; // 一开始就在价位上：作为基准，不说
  await w.tick();
  assert.equal(said.length, 0);
  const n = calls.length;
  box.px = p + 20; // 离开，重新布防
  clock.t += POLL;
  await w.tick();
  assert.equal(calls.length, n + 1); // 只取了本周期
  box.px = p; // 回到价位
  clock.t += POLL;
  await w.tick();
  const lv = said.filter(b => b.kind == 'lv');
  assert.equal(lv.length, 1);
  assert.match(lv[0].text, /^黄金 GOLD 到了/);
  clock.t += POLL;
  await w.tick();
  assert.equal(said.filter(b => b.kind == 'lv').length, 1);
});

test('重启不重复；隔太久重新建立基准，不补说', async () => {
  const clock = { t: T0 },
    p = keyLevel(),
    file = tmp();
  const a = rig({ file, clock });
  a.box.px = p + 20;
  await a.w.tick();
  a.box.px = p;
  clock.t += POLL;
  await a.w.tick();
  assert.equal(a.said.filter(b => b.kind == 'lv').length, 1);
  /* 重启后仍在价位上：不再说 */
  const b = rig({ file, clock });
  b.box.px = p;
  clock.t += POLL;
  await b.w.tick();
  assert.equal(b.said.filter(x => x.kind == 'lv').length, 0);
  /* 重新布防后停了很久，回来时已在价位上：不补说 */
  b.box.px = p + 20;
  clock.t += POLL;
  await b.w.tick();
  const c = rig({ file, clock });
  c.box.px = p;
  clock.t += POLL * 4;
  await c.w.tick();
  assert.equal(c.said.length, 0);
});

test('alText：情景和价位的句子与表情类型', () => {
  const alText = loadCore()('alText');
  const g = { kind: '支撑反弹', dir: 1, entry: 101.5, stop: 99.5, tgt: 110, rr: 4.25, state: '已触发' };
  const a = { sym: 'GOLD', name: '黄金 GOLD', T: '1d', px: 101.5, dp: 2 };
  assert.deepEqual(plain(alText({ type: 'sc', g }, a)), {
    text: 'GOLD 1d 情景触发：支撑反弹做多，入场 101.50 / 止损 99.50 / 目标 110.00（1:4.3）',
    say: '黄金 GOLD 日线出现支撑反弹做多，入场 101.50，止损 99.50',
    kind: 'sc',
    ck: 'sc',
  });
  assert.equal(alText({ type: 'scx', g: { ...g, state: '失效（跌破止损）' } }, a).ck, 'scx');
  assert.equal(alText({ type: 'scx', g: { ...g, state: '失效（跌破止损）' } }, a).say, '黄金 GOLD 日线那个支撑反弹做多失效了');
});
const plain = x => JSON.parse(JSON.stringify(x));
