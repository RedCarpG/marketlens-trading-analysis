// core/alertlog.js：我画的预警线（整理、加线、到价判定、句子）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const get = loadCore();
const [ML_MAX, normLines, addLine, lineCheck, lineText] = ['ML_MAX', 'normLines', 'addLine', 'lineCheck', 'lineText'].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
const H = 36e5,
  T0 = Date.UTC(2026, 10, 2, 8);
const bar = (i, hi, lo) => ({ timestamp: T0 + i * H, open: (hi + lo) / 2, high: hi, low: lo, close: (hi + lo) / 2, volume: 0 });

test('我画的线：加线按品种小数位取整，同价、非正数、满了都不加；整理存下来的', () => {
  let r = addLine([], '2650.004', 1, 2);
  assert.deepEqual(plain(r), { lines: [{ id: '2650.00', p: 2650, t: 1 }], added: { id: '2650.00', p: 2650, t: 1 } });
  r = addLine(r.lines, 2700.5, 2, 2);
  /* 按价格从高到低 */
  assert.deepEqual(plain(r.lines.map(l => l.id)), ['2700.50', '2650.00']);
  assert.match(addLine(r.lines, 2650.001, 3, 2).reason, /2650\.00 已经有一条线了/);
  assert.equal(addLine(r.lines, 2650.001, 3, 2).lines, r.lines);
  for (const bad of ['', 'abc', 0, -5, NaN, Infinity, 0.001]) assert.match(addLine([], bad, 3, 2).reason, /大于 0/, String(bad));
  /* 外汇五位小数 */
  assert.equal(addLine([], 1.084567, 1, 5).added.id, '1.08457');
  let full = [];
  for (let i = 0; i < ML_MAX; i++) full = addLine(full, 100 + i, i, 2).lines;
  assert.equal(full.length, ML_MAX);
  assert.match(addLine(full, 999, 1, 2).reason, /最多 20 条/);
  /* 存下来的东西被改坏了：只留认得出的 */
  assert.deepEqual(plain(normLines([{ id: '5.00', p: 5, t: 9 }, { id: '5.00', p: 5 }, { id: 'x', p: -1 }, { p: 3 }, null, 'a', { id: '7.00', p: 7 }])), [
    { id: '7.00', p: 7, t: 0 },
    { id: '5.00', p: 5, t: 9 },
  ]);
  assert.deepEqual(plain(normLines(null)), []);
  assert.deepEqual(plain(normLines({ a: 1 })), []);
});

test('lineCheck：进入 ±0.15 ATR 提醒一次，离开 0.5 ATR 后再到才再提醒；第一次见到已经在线上的不提醒', () => {
  const lines = addLine(addLine([], 100, 1).lines, 110, 2).lines,
    arm = {},
    at = px => plain(lineCheck(lines, px, 10, arm).map(l => l.p));
  /* 第一次：价格 100.5 已经在 100 那条线上（0.05 ATR）——只建立基准 */
  assert.deepEqual(at(100.5), []);
  assert.deepEqual(at(100.2), []);
  /* 走到 110 附近（差 1 = 0.1 ATR）：响 */
  assert.deepEqual(at(109), [110]);
  assert.deepEqual(at(110.5), []);
  /* 离开不到 0.5 ATR 又回来：不响 */
  assert.deepEqual(at(106), []);
  assert.deepEqual(at(110), []);
  /* 离开 0.5 ATR 以上（104.9 离 110 有 5.1，离 100 有 4.9——100 那条还没重新布防） */
  assert.deepEqual(at(104.9), []);
  assert.deepEqual(at(110), [110]);
  /* 100 那条：离开到 105 以上已经布防，回到 101.5（0.15 ATR 整）响 */
  assert.deepEqual(at(101.5), [100]);
  /* 新加的线第一次见到时离得远：布防，到了就响 */
  const more = addLine(lines, 120, 3).lines;
  assert.deepEqual(plain(lineCheck(more, 101.5, 10, arm)), []);
  assert.deepEqual(plain(lineCheck(more, 119, 10, arm).map(l => l.id)), ['120.00']);
  /* 布防状态按线的 id 记，和关键价位的不混 */
  assert.deepEqual(Object.keys(arm).sort(), ['ml|100.00', 'ml|110.00', 'ml|120.00']);
});

test('lineText：弹窗一句、给 Cirra 念的一句，交给她时归到关键价位；话里只有事实', () => {
  const s = plain(lineText({ id: '2650.00', p: 2650 }, { sym: 'GC', name: '黄金期货 GC', T: '1h', px: 2651.234, dp: 2 }));
  assert.deepEqual(s, { text: 'GC 1h 价格 2651.23 到了我画的线 2650.00', say: '黄金期货 GC 到了你画的线 2650.00 附近', kind: 'ml', ck: 'lv' });
  assert.doesNotMatch(s.text + s.say, /建议|买|卖|会涨|会跌/);
});
