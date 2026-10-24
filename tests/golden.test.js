// 回归测试：用拆分前的单文件版本在固定时间、模拟数据下算出的结果（fixtures/golden-demo.json）作为标准答案，
// 现在的 core/ 代码必须逐字段一致。核心算法有意改动时，需要重新生成标准答案。
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load-core');
const golden = require('./fixtures/golden-demo.json');

const NOW = Date.UTC(2026, 9, 23, 13, 7, 0); // 与生成标准答案时相同
const ITEMS = {
  GC: { sym: 'GC', base: 2650 },
  AAPL: { sym: 'AAPL', base: 230 },
  EURUSD: { sym: 'EURUSD', base: 1.08 },
};

test('core 输出与拆分前的标准答案一致（3 个模拟品种 × 6 个周期）', () => {
  const get = loadCore(NOW);
  const [TFS, demoAll, ctx, analyzeMTF, mainLv, prevHL] = [
    'TFS',
    'demoAll',
    'ctx',
    'analyzeMTF',
    'mainLv',
    'prevHL',
  ].map(get);
  for (const sym of Object.keys(golden)) {
    const all = demoAll(ITEMS[sym]),
      C = {};
    for (const k of TFS) C[k] = ctx(k, all[k]);
    for (const k of TFS) {
      const now = all[k][all[k].length - 1].close,
        m = analyzeMTF(k, C, now);
      const out = m && {
        n: all[k].length,
        first: all[k][0],
        last: all[k][all[k].length - 1],
        s: m.s,
        adj: m.adj,
        raw: m.raw,
        v: m.v,
        st: m.st,
        conf: m.conf,
        chain: m.chain,
        why: m.why,
        want: m.want,
        score: m.t.a.s,
        bias: m.t.bias,
        sigs: m.t.a.sigs.slice(-12),
        pv: m.t.pv,
        L: m.L,
        sc: m.sc,
        ml: mainLv(m.L, now, m.t.a.a, k),
        phl: TFS.map(t => prevHL(C[t], now)),
      };
      assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), golden[sym][k], `${sym} ${k}`);
    }
  }
});
