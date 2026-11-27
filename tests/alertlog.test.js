// core/alertlog.js：我画的预警线（整理、加线、到价判定、句子）、预警记录（整理、封顶）、价位类预警之后怎样了
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');

const get = loadCore();
const [ML_MAX, AL_MAX, AL_TY, normLines, addLine, lineCheck, lineText, alTyOf, normLog, logAdd, lvOutcome, outcomeText, outcomeStats] = [
  'ML_MAX',
  'AL_MAX',
  'AL_TY',
  'normLines',
  'addLine',
  'lineCheck',
  'lineText',
  'alTyOf',
  'normLog',
  'logAdd',
  'lvOutcome',
  'outcomeText',
  'outcomeStats',
].map(get);
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

test('预警记录：类型从交给 Cirra 的类型推出来；整理、按时间新的在前、封顶', () => {
  assert.deepEqual(['lv', 'sc', 'scx', 'dn', 'up', 'ev', 'ck', 'cko', 'test', undefined].map(alTyOf), ['lv', 'sc', 'sc', 'sl', 'sl', 'ev', 'ck', 'ck', 'ot', 'ot']);
  for (const k of ['lv', 'ml', 'sc', 'sl', 'ck', 'ev', 'ot']) assert.ok(AL_TY[k], k);
  const rec = { id: 'a1', t: 1000, sym: 'GC', tf: '1h', ty: 'lv', kind: 'lv', text: 'GC 1h 价格 2650.10 到达支撑 2650.00', px: 2650.1, dp: 2, src: 'demo', lp: 2650, atr: 5, bt: 900 };
  let log = logAdd([], rec);
  assert.deepEqual(plain(log), [rec]);
  /* 没有价位的类型不带 lp / atr / bt；认不出的类型归到其他；多余的字段不留 */
  log = logAdd(log, { t: 2000, sym: 'GC', tf: '1h', ty: 'ev', kind: 'ev', text: '14:30 USD CPI 即将公布', px: 2651, dp: 2, src: 'demo', lp: 1, secret: 'x' });
  assert.deepEqual(plain(log[0]), { id: '2000', t: 2000, sym: 'GC', tf: '1h', ty: 'ev', kind: 'ev', text: '14:30 USD CPI 即将公布', px: 2651, dp: 2, src: 'demo' });
  assert.equal(plain(logAdd([], { t: 1, text: 'x', ty: '???', kind: '<b>' }))[0].ty, 'ot');
  assert.equal(plain(logAdd([], { t: 1, text: 'x', ty: '???', kind: '<b>' }))[0].kind, 'lv');
  /* 没有文字、没有时间的不记 */
  assert.equal(logAdd(log, { t: 3000, text: '' }), log);
  assert.equal(logAdd(log, { text: 'x' }), log);
  /* 文字截到 400 字 */
  assert.equal(logAdd([], { t: 1, text: '长'.repeat(900) })[0].text.length, 400);
  /* 封顶：新的在前，最旧的丢掉 */
  let big = [];
  for (let i = 0; i < AL_MAX + 5; i++) big = logAdd(big, { t: i, text: 'n' + i });
  assert.equal(big.length, AL_MAX);
  assert.equal(big[0].text, 'n' + (AL_MAX + 4));
  assert.equal(big[AL_MAX - 1].text, 'n5');
  /* 读回来：坏的丢掉、重新排序；存过的结论留着，乱写的结论不留 */
  const back = normLog([{ t: 5, text: 'a' }, null, 'x', { t: 9, text: 'b', ...rec, id: 'k', o: 'bounce', ok: 3 }, { ...rec, id: 'z', t: 7, o: 'moon' }]);
  assert.deepEqual(plain(back.map(r => [r.id, r.t, r.o || null, r.ok ?? null])), [['k', 1000, 'bounce', 3], ['z', 7, null, null], ['5', 5, null, null]]);
  assert.deepEqual(plain(normLog('oops')), []);
});

test('lvOutcome：之后 10 根内先反弹 ≥1 ATR、先突破 ≥1 ATR、还是未定（BACKTEST 第 5 节 D）', () => {
  /* 价位 100，ATR 2：往上到 102 / 往下到 98 算走出 1 个 ATR。预警在第 0 根，当时价格 100.2（从上面来，价位是支撑） */
  const r = { lp: 100, atr: 2, px: 100.2, bt: T0 },
    flat = i => bar(i, 100.9, 99.2),
    run = (bars, rec = r, n) => plain(lvOutcome(rec, bars, n));
  /* 第 3 根最高到 102.1：反弹 */
  assert.deepEqual(run([flat(0), flat(1), flat(2), bar(3, 102.1, 100.5), bar(4, 90, 80)]), { st: 'bounce', k: 3, dir: 1 });
  /* 第 2 根最低到 97.9：突破（跌破支撑） */
  assert.deepEqual(run([flat(0), flat(1), bar(2, 100, 97.9), bar(3, 110, 100)]), { st: 'break', k: 2, dir: -1 });
  /* 正好到 1 个 ATR 也算 */
  assert.equal(run([flat(0), bar(1, 102, 100)]).st, 'bounce');
  assert.equal(run([flat(0), bar(1, 101.99, 98.01)]).st, 'wait');
  /* 从下面来（价位是阻力）：往下走是反弹，往上穿是突破 */
  const res = { lp: 100, atr: 2, px: 99.8, bt: T0 };
  assert.deepEqual(run([flat(0), bar(1, 100.5, 97.5)], res), { st: 'bounce', k: 1, dir: -1 });
  assert.deepEqual(run([flat(0), bar(1, 102.5, 99.5)], res), { st: 'break', k: 1, dir: 1 });
  /* 正好在价位上算从上面来 */
  assert.equal(run([flat(0), bar(1, 102.5, 99.5)], { ...r, px: 100 }).st, 'bounce');
  /* 预警那一根自己不算：那根里价格先到过 103 是预警之前的事 */
  assert.deepEqual(run([bar(0, 103, 99.9), flat(1)]), { st: 'wait', k: 1 });
  /* 同一根里上下都走出 1 个 ATR：分不出先后，未定 */
  assert.deepEqual(run([flat(0), flat(1), bar(2, 103, 97)]), { st: 'open', k: 2, both: 1 });
  /* 10 根走完两边都没到：未定；只走了 9 根：还在看 */
  const eleven = Array.from({ length: 11 }, (_, i) => flat(i));
  assert.deepEqual(run(eleven), { st: 'open', k: 10 });
  assert.deepEqual(run(eleven.slice(0, 10)), { st: 'wait', k: 9 });
  /* 第 11 根才到的不算（只看 10 根） */
  assert.deepEqual(run([...eleven, bar(11, 105, 100)]), { st: 'open', k: 10 });
  /* 根数可以换 */
  assert.deepEqual(run(eleven, r, 3), { st: 'open', k: 3 });
  /* 预警所在的那根还没收盘（不在已收盘的K线里）：还在看，过了 0 根 */
  assert.deepEqual(run([bar(-2, 101, 99), bar(-1, 101, 99)]), { st: 'wait', k: 0 });
  /* 对不上：比最早一根还早、找不到那一根、当时的价格离那一根太远（换了数据、模拟行情重新生成过） */
  assert.equal(lvOutcome(r, [flat(1), flat(2)]), null);
  assert.equal(lvOutcome({ ...r, bt: T0 + 1 }, [flat(0), flat(1)]), null);
  assert.equal(lvOutcome(r, [bar(0, 120, 110), bar(1, 130, 90)]), null);
  /* 离高低点 0.25 个 ATR 以内还认（实时报价和历史K线略有出入） */
  assert.equal(lvOutcome({ ...r, px: 100.2 }, [bar(0, 99.8, 99), bar(1, 99.5, 99)]).st, 'wait');
  /* 不是价位类的记录、没有K线 */
  assert.equal(lvOutcome({ t: 1, text: 'x', px: 100 }, [flat(0)]), null);
  assert.equal(lvOutcome(r, []), null);
  assert.equal(lvOutcome(null, [flat(0)]), null);
});

test('outcomeText / outcomeStats：结论写成一句；价位类记录各有几条', () => {
  const sup = { lp: 100, atr: 2, px: 100.2, bt: T0 },
    res = { lp: 100, atr: 2, px: 99.8, bt: T0 };
  assert.equal(outcomeText(sup, { st: 'bounce', k: 3 }), '之后第 3 根：向上反弹了 1 个 ATR 以上（被挡回）');
  assert.equal(outcomeText(sup, { st: 'break', k: 2 }), '之后第 2 根：向下跌破了 1 个 ATR 以上（穿过去了）');
  assert.equal(outcomeText(res, { st: 'bounce', k: 1 }), '之后第 1 根：向下回落了 1 个 ATR 以上（被挡回）');
  assert.equal(outcomeText(res, { st: 'break', k: 4 }), '之后第 4 根：向上突破了 1 个 ATR 以上（穿过去了）');
  assert.equal(outcomeText(sup, { st: 'open', k: 10 }), '之后 10 根里，往回走和穿过去都没到 1 个 ATR（未定）');
  assert.equal(outcomeText(sup, { st: 'open', k: 2, both: 1 }), '之后第 2 根里上下都走出了 1 个 ATR，分不出先后（未定）');
  assert.equal(outcomeText(sup, { st: 'wait', k: 4 }), '之后：过了 4 根，两边都还没走出 1 个 ATR，看满 10 根再说');
  assert.equal(outcomeText(sup, { st: 'wait', k: 0 }), '之后：等后面的K线收盘再看');
  /* 存下来的结论（记录里的 o / ok / ob）写出来和当场算的一样 */
  assert.equal(outcomeText({ ...res, o: 'break', ok: 4 }, { st: 'break', k: 4, both: undefined }), outcomeText(res, { st: 'break', k: 4, dir: 1 }));
  assert.equal(outcomeText(sup, null), '');
  for (const st of ['bounce', 'break', 'open', 'wait']) assert.doesNotMatch(outcomeText(sup, { st, k: 1 }), /建议|会涨|会跌|应该/);
  const log = [
    { ...sup, o: 'bounce' },
    { ...sup, o: 'bounce' },
    { ...res, o: 'break' },
    { ...sup, o: 'open' },
    { ...sup },
    { t: 1, text: '事件', ty: 'ev' },
  ];
  assert.deepEqual(plain(outcomeStats(log)), { n: 5, bounce: 2, brk: 1, open: 1, none: 1 });
  assert.deepEqual(plain(outcomeStats([])), { n: 0, bounce: 0, brk: 0, open: 0, none: 0 });
});
