// 代理自己播报经济日历给 Cirra（server/announce.js）：公布前 30 / 5 分钟、BLS 新数、早报、启动基准、她没开时不看日历、配置解析。
// 时间都用本机时区构造（new Date(年, 月, 日, 时, 分)），在任何时区跑都一样。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAnnouncer, announceConfig, briefingText } = require('../server/announce');

const L = (d, h, m) => new Date(2026, 10, d, h, m).getTime(); // 2026 年 11 月，本机时间
const T = L(6, 14, 30);
const ev = (ts, title, zh, o = {}) => ({ id: title + ts, ts, ccy: 'USD', imp: 3, title, zh, src: 'ff', ...o });
const EVENTS = [
  ev(T, 'Non-Farm Employment Change', '非农就业人数', { forecast: '50K', rel: 'empsit' }),
  ev(T, 'Unemployment Rate', '失业率', { forecast: '4.3%', rel: 'empsit' }),
  ev(T, 'German Prelim CPI m/m', '德国 CPI', { ccy: 'EUR' }),
  ev(T, 'Unemployment Claims', '初请失业金人数', { imp: 2 }),
  ev(L(6, 20, 0), 'FOMC Statement', 'FOMC 声明', { rel: 'fomc' }),
];
const SRC = [{ ok: true }, { ok: true }];
const item = (k, ref, val, dp = 1, unit = '%') => ({ k, ref, val, prev: val, dp, unit });
function setup({
  cal = () => ({ events: EVENTS, sources: SRC, data: { items: [] } }),
  present = true,
  ok = true,
  ...o
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-ann-')),
    said = [],
    calls = { cal: 0 },
    env = { t: 0, ok, present },
    mk = () =>
      createAnnouncer({
        calendar: async () => (calls.cal++, cal()),
        cirra: { present: () => env.present, send: async m => (env.ok && said.push(m), { ok: env.ok }) },
        file: path.join(dir, 'cirra.json'),
        now: () => env.t,
        briefing: '',
        ...o,
      });
  return { dir, said, calls, env, mk, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('公布前 30 / 5 分钟各说一次，同一时间合成一句；只看相关货币的高影响事件', async () => {
  const s = setup(),
    a = s.mk();
  try {
    for (const m of [40, 29, 20, 4, 3]) {
      s.env.t = T - m * 60e3;
      await a.tick();
    }
    assert.deepEqual(s.said, [
      { text: '非农就业人数、失业率还有 29 分钟公布，非农就业人数 预期 50K，失业率 预期 4.3%', kind: 'ev' },
      { text: '非农就业人数、失业率还有 4 分钟公布，非农就业人数 预期 50K，失业率 预期 4.3%', kind: 'ev' },
    ]);
  } finally {
    s.done();
  }
});

test('代理启动时已在 30 分钟内：不补说 30 分钟那次，5 分钟照常；多个货币时带货币名', async () => {
  const s = setup({ ccy: ['USD', 'EUR'] }),
    a = s.mk();
  try {
    for (const m of [20, 4]) {
      s.env.t = T - m * 60e3;
      await a.tick();
    }
    assert.deepEqual(
      s.said.map(x => x.text),
      ['非农就业人数、失业率还有 4 分钟公布，非农就业人数 预期 50K，失业率 预期 4.3%', '欧元 德国 CPI还有 4 分钟公布']
    );
  } finally {
    s.done();
  }
});

test('Cirra 没开：不看日历、不说；她开了以后从那时起建立基准', async () => {
  const s = setup({ present: false }),
    a = s.mk();
  try {
    s.env.t = T - 40 * 60e3;
    await a.tick();
    assert.equal(s.calls.cal, 0);
    s.env.present = true;
    s.env.t = T - 29 * 60e3;
    await a.tick(); // 第一次看到就已在 30 分钟内：基准，不说
    s.env.t = T - 4 * 60e3;
    await a.tick();
    assert.equal(s.said.length, 1);
    assert.match(s.said[0].text, /还有 4 分钟/);
  } finally {
    s.done();
  }
});

test('BLS 新数：第一次只记下月份；换了月份说一次，重启不重复；她没开时 12 小时内补说', async () => {
  let items = [item('nfp', '2026-09', 180, 0, 'K'), item('unemp', '2026-09', 4.3), item('cpi', '2026-09', 3.0)],
    at = 0;
  const s = setup({ cal: () => ({ events: [], sources: SRC, data: { items, at } }) });
  try {
    s.env.t = L(6, 13, 0);
    await s.mk().tick();
    assert.equal(s.said.length, 0);
    items = [item('nfp', '2026-10', -23, 0, 'K'), item('unemp', '2026-10', 4.4), item('cpi', '2026-09', 3.0)];
    at = s.env.t = L(6, 13, 40);
    const a = s.mk(); // 新实例：从 var/cirra.json 读回 9 月
    await a.tick();
    await a.tick();
    assert.deepEqual(s.said, [{ text: 'BLS 公布了：10 月非农减少 2.3 万，失业率 4.4%', kind: 'ev' }]);
    await s.mk().tick(); // 重启
    assert.equal(s.said.length, 1);
    /* CPI 出新数时她正好关了（发送失败）：下一轮补说；数据已超过 12 小时就不再说 */
    items = [...items.slice(0, 2), item('cpi', '2026-10', 2.9), item('core', '2026-10', 3.1)];
    s.env.ok = false;
    await a.tick();
    s.env.ok = true;
    await a.tick();
    assert.equal(s.said.at(-1).text, 'BLS 公布了：10 月 CPI 年率 2.9%，核心 3.1%');
    items = [...items.slice(0, 2), item('cpi', '2026-11', 2.8)];
    s.env.t = at + 13 * 36e5;
    s.env.ok = false;
    await a.tick();
    s.env.ok = true;
    await a.tick();
    assert.equal(s.said.length, 2);
  } finally {
    s.done();
  }
});

test('早报：到点后说一次今天还没公布的事件，第二天再说；没说出去下一轮再试', async () => {
  const s = setup({ briefing: '07:00' }),
    a = s.mk();
  try {
    s.env.t = L(6, 6, 59);
    await a.tick();
    assert.equal(s.said.length, 0);
    s.env.ok = false;
    s.env.t = L(6, 7, 1);
    await a.tick();
    s.env.ok = true;
    s.env.t = L(6, 7, 2);
    await a.tick();
    await a.tick();
    assert.deepEqual(s.said, [
      { text: '今天有 2 个重要事件：14:30 非农就业人数、失业率；20:00 FOMC 声明', kind: 'brief' },
    ]);
    s.env.t = L(7, 8, 0);
    await a.tick();
    assert.equal(s.said.at(-1).text, '今天的日程里没有美元的高影响事件。');
    assert.equal(s.said.length, 2);
  } finally {
    s.done();
  }
});

test('briefingText：日历没取到照实说；都公布了；不说“没有风险”', () => {
  const r = { events: EVENTS, sources: SRC };
  assert.equal(briefingText(null, L(6, 7, 0), ['USD']), '今天的经济日历没取到，重要事件要自己留意一下。');
  assert.equal(
    briefingText({ ...r, sources: [{ ok: false }, { ok: false }] }, L(6, 7, 0), ['USD']),
    '今天的经济日历没取到，重要事件要自己留意一下。'
  );
  assert.equal(briefingText(r, L(6, 21, 0), ['USD']), '今天美元的重要事件都已经公布了。');
  assert.equal(briefingText(r, L(6, 15, 0), ['USD']), '今天有 1 个重要事件：20:00 FOMC 声明');
  for (const t of [L(5, 7, 0), L(6, 7, 0), L(6, 21, 0)]) assert.doesNotMatch(briefingText(r, t, ['USD']), /风险/);
});

test('announceConfig：默认关（新版 Cirra 自己看日历）、USD、07:00；1 开、多个货币、留空不播早报、时间写错当作不播', () => {
  assert.deepEqual(announceConfig({}), { on: false, ccy: ['USD'], briefing: '07:00' });
  assert.equal(announceConfig({ CIRRA_EVENTS: '0' }).on, false);
  assert.equal(announceConfig({ CIRRA_EVENTS: '' }).on, false);
  assert.equal(announceConfig({ CIRRA_EVENTS: '1' }).on, true);
  assert.equal(announceConfig({ CIRRA_EVENTS: 'on' }).on, true);
  assert.deepEqual(announceConfig({ CIRRA_EVENTS: '1', CIRRA_CCY: 'usd, eur', CIRRA_BRIEFING: '7:30' }), {
    on: true,
    ccy: ['USD', 'EUR'],
    briefing: '07:30',
  });
  assert.equal(announceConfig({ CIRRA_BRIEFING: '' }).briefing, '');
  assert.equal(announceConfig({ CIRRA_BRIEFING: '25:00' }).briefing, '');
  assert.deepEqual(announceConfig({ CIRRA_CCY: '!!' }).ccy, ['USD']);
});
