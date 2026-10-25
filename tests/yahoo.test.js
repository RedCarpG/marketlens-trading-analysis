// Yahoo 数据服务（server/yahoo.js）：解析、清洗、日线日期归一、日内对齐与周线/月线聚合；不联网
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, aggregate, KEY } = require('../server/yahoo');

const S = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 1000;
const chart = (ts, rows) => ({
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 4000, regularMarketTime: ts[ts.length - 1] },
        timestamp: ts,
        indicators: {
          quote: [
            {
              open: rows.map(r => r[0]),
              high: rows.map(r => r[1]),
              low: rows.map(r => r[2]),
              close: rows.map(r => r[3]),
              volume: rows.map(r => r[4]),
            },
          ],
        },
      },
    ],
  },
});

test('parse 日线：纽约午夜归到当日 00:00 UTC；缺值行去掉；高低价包住开收', () => {
  const { bars } = parse(
    chart(
      [S(2026, 1, 5, 5), S(2026, 1, 6, 5), S(2026, 1, 7, 5)],
      [
        [10, 11, 9, 10.5, 100],
        [null, null, null, null, null],
        [10.5, 10.4, 10.6, 10.8, null], // 高低价不含开收
      ]
    ),
    '1d'
  );
  assert.deepEqual(
    bars.map(b => [b.timestamp, b.high, b.low, b.volume]),
    [
      [Date.UTC(2026, 0, 5), 11, 9, 100],
      [Date.UTC(2026, 0, 7), 10.8, 10.5, 0],
    ]
  );
});

test('日内对齐：最后一行的时间是最后成交时刻（20:59），并进 20:45 那根', () => {
  const { bars } = parse(
    chart(
      [S(2026, 10, 23, 20, 30), S(2026, 10, 23, 20, 45), S(2026, 10, 23, 20, 59)],
      [
        [100, 101, 99, 100.5, 5],
        [100.5, 102, 100, 101, 7],
        [101, 103, 100.8, 102.5, 2],
      ]
    ),
    '15m'
  );
  const out = aggregate(bars, KEY['15m']);
  assert.deepEqual(
    out.map(b => [b.timestamp, b.open, b.high, b.low, b.close, b.volume]),
    [
      [Date.UTC(2026, 9, 23, 20, 30), 100, 101, 99, 100.5, 5],
      [Date.UTC(2026, 9, 23, 20, 45), 100.5, 103, 100, 102.5, 9],
    ]
  );
});

test('周线从周一、月线从 1 日、4h 按 UTC 4 小时聚合', () => {
  assert.equal(KEY['1w'](Date.UTC(2026, 9, 25)), Date.UTC(2026, 9, 19)); // 周日 → 本周一
  assert.equal(KEY['1w'](Date.UTC(2026, 9, 19)), Date.UTC(2026, 9, 19));
  assert.equal(KEY['1M'](Date.UTC(2026, 9, 25, 13)), Date.UTC(2026, 9, 1));
  assert.equal(KEY['4h'](Date.UTC(2026, 9, 23, 23)), Date.UTC(2026, 9, 23, 20));
});
