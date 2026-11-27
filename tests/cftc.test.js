// CFTC 每周持仓：代理取数（server/cftc.js：解析、缓存、失败时用存着的）和纯计算（core/context.js 的 cotState / cotText）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCftc, parseRows, CODE } = require('../server/cftc');
const { loadCore } = require('./load-core');

const get = loadCore(Date.UTC(2026, 10, 27, 12));
const [cotState, cotText, cotNum, cotNet] = ['cotState', 'cotText', 'cotNum', 'cotNet'].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
const W = 7 * 864e5,
  T0 = Date.UTC(2026, 10, 17);
/* 接口那样的一行 */
const api = (date, long, short, oi = 400000) => ({
  report_date_as_yyyy_mm_dd: date + 'T00:00:00.000',
  market_and_exchange_names: 'GOLD - COMMODITY EXCHANGE INC.',
  contract_units: '(CONTRACTS OF 100 TROY OUNCES)',
  open_interest_all: String(oi),
  m_money_positions_long_all: String(long),
  m_money_positions_short_all: String(short),
});

test('parseRows：接口的字符串转成数，按日期从旧到新；日期或数字不对的丢掉，同一天只留一条', () => {
  const rows = parseRows(
    [
      api('2026-11-17', 121994, 19052, 407834),
      api('2026-11-10', 127406, 15065),
      { report_date_as_yyyy_mm_dd: 'x' },
      api('2026-11-03', 'abc', 1),
      api('2026-11-10', 1, 2),
      null && 0,
    ].filter(Boolean)
  );
  assert.deepEqual(rows, [
    { ts: Date.UTC(2026, 10, 10), oi: 400000, long: 1, short: 2 },
    { ts: Date.UTC(2026, 10, 17), oi: 407834, long: 121994, short: 19052 },
  ]);
  assert.deepEqual(parseRows({ error: 'x' }), []);
  assert.deepEqual(
    [CODE.test('088691'), CODE.test('13874A'), CODE.test('88691'), CODE.test('088691;x')],
    [true, true, false, false]
  );
});

test('createCftc：取一次存下来，6 小时内不再取；失败时回存着的并带原因，10 分钟后才再试；代码不对、一期都没有时报错', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-cftc-'));
  let t = Date.UTC(2026, 10, 27, 12),
    fail = false;
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (fail) return { ok: false, status: 503, text: async () => '' };
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([api('2026-11-17', 121994, 19052, 407834), api('2026-11-10', 127406, 15065, 404725)]),
    };
  };
  const mk = () => createCftc({ dir, fetchImpl, now: () => t, base: 'https://cftc.test/x.json', warn: () => {} });
  try {
    const c = mk(),
      a = await c.get('088691');
    assert.deepEqual(
      [a.code, a.name, a.rows.length, a.rows[1].long, a.err],
      ['088691', 'GOLD - COMMODITY EXCHANGE INC.', 2, 121994, undefined]
    );
    const u = new URL(calls[0]);
    assert.deepEqual(
      [u.origin + u.pathname, u.searchParams.get('cftc_contract_market_code'), u.searchParams.get('$limit')],
      ['https://cftc.test/x.json', '088691', '110']
    );
    t += 5 * 36e5;
    await c.get('088691');
    assert.equal(calls.length, 1); // 还在 6 小时内
    /* 过了 6 小时、上游坏了：回存着的，带原因；10 分钟内不重试 */
    fail = true;
    t += 2 * 36e5;
    const b = await c.get('088691');
    assert.deepEqual([b.rows.length, b.err, calls.length], [2, 'CFTC 返回 503', 2]);
    t += 5 * 60e3;
    assert.equal((await c.get('088691')).err, 'CFTC 返回 503');
    assert.equal(calls.length, 2);
    /* 重启以后从文件里读回来；上游好了，原因去掉 */
    fail = false;
    t += 10 * 60e3;
    const d = await mk().get('088691');
    assert.deepEqual([d.rows.length, d.err, calls.length], [2, undefined, 3]);
    /* 没存过又取不到；代码不对 */
    fail = true;
    await assert.rejects(c.get('133741'), /CFTC 返回 503/);
    await assert.rejects(c.get('gold'), /6 位/);
    assert.equal(calls.length, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cotState：这一期的净多、前一期、在之前 52 期里排在哪；期数不够时不排', () => {
  /* 60 期：净多从 1000 一路加到 60000，最后一期掉到第 30.5 位 */
  const rows = Array.from({ length: 60 }, (_, i) => ({
    ts: T0 - (59 - i) * W,
    oi: 400000,
    long: 100000 + (i + 1) * 1000,
    short: 100000,
  }));
  rows[59] = { ts: T0, oi: 407834, long: 100000 + 30500, short: 100000 };
  const v = plain(cotState(rows));
  assert.deepEqual([v.ts, v.long, v.short, v.net, v.oi], [T0, 130500, 100000, 30500, 407834]);
  assert.deepEqual(v.prev, { ts: T0 - W, long: 159000, short: 100000, net: 59000 });
  /* 之前 52 期是第 8 … 59 期（净多 8000 … 59000），其中 8000 … 30000 这 23 期比它少 */
  assert.deepEqual([v.n, v.below, v.pct], [52, 23, 44]);
  const few = plain(cotState(rows.slice(-6)));
  assert.deepEqual([few.n, few.pct, few.prev.net], [5, null, 59000]);
  const one = plain(cotState(rows.slice(-1)));
  assert.deepEqual([one.prev, one.n, one.pct], [null, 0, null]);
  assert.equal(cotState([]), null);
});

test('cotNum / cotNet / cotText：千分位；净多、净空、相等；一句话里只有数，没有判断', () => {
  assert.deepEqual(
    [cotNum(102942), cotNum(-5000), cotNum(999), cotNum(1234567.4)],
    ['102,942', '5,000', '999', '1,234,567']
  );
  assert.deepEqual([cotNet(102942), cotNet(-5000), cotNet(0)], ['净多 102,942 手', '净空 5,000 手', '多空相等']);
  const v = {
      ts: T0,
      long: 121994,
      short: 19052,
      net: 102942,
      oi: 407834,
      prev: { ts: T0 - W, long: 127406, short: 15065, net: 112341 },
      n: 52,
      below: 20,
      pct: 38,
    },
    s = cotText(v, { name: '黄金期货' });
  assert.equal(
    s,
    '截至 11 月 17 日（周二）：管理基金在黄金期货上净多 102,942 手（多 121,994、空 19,052），前一期是净多 112,341 手；之前 52 期里有 38% 比这一期低。'
  );
  assert.doesNotMatch(s, /看涨|看跌|会涨|会跌|建议|拥挤|见顶|见底|利好|利空|应该/);
  assert.match(cotText({ ...v, below: 52, pct: 100 }, { name: '黄金期货' }), /；是之前 52 期里最高的。$/);
  assert.match(cotText({ ...v, below: 0, pct: 0 }, { name: '黄金期货' }), /；是之前 52 期里最低的。$/);
  assert.equal(
    cotText({ ...v, net: -5000, prev: null, n: 3, pct: null }, { name: '白银期货' }),
    '截至 11 月 17 日（周二）：管理基金在白银期货上净空 5,000 手（多 121,994、空 19,052）。'
  );
});
