// 长周期历史导入：清洗、日期归一、周线/月线聚合
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, clean, csv, yahooDay } = require('../tools/import-history');

const D = (y, m, d) => Date.UTC(y, m - 1, d);
const bar = (ts, o, h, l, c, v = 1) => ({ timestamp: ts, open: o, high: h, low: l, close: c, volume: v });

test('clean：去掉缺值和非正价格，高低价包住开收，同一时间留最后一条，按时间排序', () => {
  const out = clean([
    bar(D(2026, 1, 6), 10, 11, 9, 10.5),
    bar(D(2026, 1, 5), 10, 9.8, 9.9, 10.2), // 高低价不含开收（部分期货历史有这种行）
    bar(D(2026, 1, 7), null, 11, 9, 10),
    bar(D(2026, 1, 8), 10, 11, 0, 10),
    bar(D(2026, 1, 6), 20, 21, 19, 20.5, NaN),
  ]);
  assert.deepEqual(
    out.map(b => [b.timestamp, b.open, b.high, b.low, b.close, b.volume]),
    [
      [D(2026, 1, 5), 10, 10.2, 9.9, 10.2, 1],
      [D(2026, 1, 6), 20, 21, 19, 20.5, 0],
    ]
  );
});

test('yahooDay：纽约午夜（夏令时 04:00、冬令时 05:00 UTC）和盘中时刻都归到当天 00:00 UTC', () => {
  assert.equal(yahooDay(Date.UTC(2013, 8, 19, 4) / 1000), D(2013, 9, 19));
  assert.equal(yahooDay(Date.UTC(2008, 0, 2, 5) / 1000), D(2008, 1, 2));
  assert.equal(yahooDay(Date.UTC(2026, 9, 23, 13, 30) / 1000), D(2026, 10, 23));
});

test('aggregate：周线从周一开始、月线从 1 日开始；开取第一根、收取最后一根、高低取极值、量相加', () => {
  const daily = [
    bar(D(2026, 1, 29), 1, 5, 1, 4), // 周四
    bar(D(2026, 1, 30), 4, 6, 3, 5), // 周五
    bar(D(2026, 2, 2), 5, 7, 2, 6), // 下周一，跨月
    bar(D(2026, 2, 3), 6, 8, 5, 7),
  ];
  const w = aggregate(daily, '1w');
  assert.deepEqual(
    w.map(b => [b.timestamp, b.open, b.high, b.low, b.close, b.volume]),
    [
      [D(2026, 1, 26), 1, 6, 1, 5, 2],
      [D(2026, 2, 2), 5, 8, 2, 7, 2],
    ]
  );
  const m = aggregate(daily, '1M');
  assert.deepEqual(
    m.map(b => [b.timestamp, b.open, b.high, b.low, b.close]),
    [
      [D(2026, 1, 1), 1, 6, 1, 5],
      [D(2026, 2, 1), 5, 8, 2, 7],
    ]
  );
  assert.equal(daily[0].high, 5); // 不改动输入
});

test('csv：跳过表头；YYYY-MM-DD、秒/毫秒时间戳都归到当天 00:00 UTC；量可缺省', () => {
  const t = Date.UTC(2026, 0, 6, 15, 30);
  const out = csv(
    [
      'Date,Open,High,Low,Close,Volume',
      '2026-01-05,10,11,9,10.5,100',
      `${t / 1000};10;12;9;11`,
      `${t + 864e5}\t11\t12\t10\t11.5\t7`,
    ].join('\r\n')
  )['1d'];
  assert.deepEqual(
    out.map(b => [b.timestamp, b.close, b.volume]),
    [
      [D(2026, 1, 5), 10.5, 100],
      [D(2026, 1, 6), 11, 0],
      [D(2026, 1, 7), 11.5, 7],
    ]
  );
});
