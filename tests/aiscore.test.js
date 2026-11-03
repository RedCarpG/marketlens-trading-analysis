// AI 分析留痕与前瞻打分：server/ailog.js（记录、读回、倾向解析、meta 清洗）与 web/js/core/aiscore.js（按之后的已收盘K线打分、汇总）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAiLog, parseBias, cleanMeta } = require('../server/ailog');
const { loadCore } = require('./load-core');

const H = 36e5,
  T0 = Date.UTC(2026, 10, 2, 0, 0);
const NOW = T0 + 40 * H;
const get = loadCore(NOW);
const [scoreAi, aiStats] = ['scoreAi', 'aiStats'].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
/* 1h K线：从 T0 起，收盘价 100 + i */
const BARS = Array.from({ length: 41 }, (_, i) => ({
  timestamp: T0 + i * H,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
}));

test('parseBias：认“倾向：偏多 / 偏空 / 观望”，带编号、粗体也行；没写返回 null', () => {
  assert.equal(parseBias('1. 一句话总结：……\n2. 倾向：偏多。依据：……'), '偏多');
  assert.equal(parseBias('**倾向**：**偏空**'), '偏空');
  assert.equal(parseBias('2. 倾向: 观望（等非农）'), '观望');
  assert.equal(parseBias('我觉得会涨'), null);
});

test('cleanMeta：只收认得的字段，缺品种 / 周期 / 价格时不记', () => {
  const TFS = ['15m', '1h', '4h', '1d', '1w', '1M'];
  assert.deepEqual(
    cleanMeta({ sym: 'GOLD', src: 'etoro', tf: '1h', price: 4010.5, atr: 12.3, barTime: T0, evil: '<x>' }, TFS),
    {
      sym: 'GOLD',
      src: 'etoro',
      tf: '1h',
      price: 4010.5,
      atr: 12.3,
      barTime: T0,
    }
  );
  assert.equal(cleanMeta({ sym: 'GOLD', tf: '2h', price: 1 }, TFS), null);
  assert.equal(cleanMeta({ sym: 'GOLD', tf: '1h' }, TFS), null);
  assert.equal(cleanMeta(null, TFS), null);
});

test('createAiLog：追加、按品种和周期读回，坏行跳过，最多 limit 条', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-ai-'));
  try {
    const log = createAiLog(dir);
    assert.deepEqual(log.list(), []);
    log.append({ id: 'a', sym: 'GOLD', tf: '1h' });
    fs.appendFileSync(log.file, '{坏行\n');
    log.append({ id: 'b', sym: 'BTCUSDT', tf: '1h' });
    log.append({ id: 'c', sym: 'GOLD', tf: '1d' });
    assert.deepEqual(
      log.list({ sym: 'GOLD' }).map(r => r.id),
      ['a', 'c']
    );
    assert.deepEqual(
      log.list({ tf: '1h' }).map(r => r.id),
      ['a', 'b']
    );
    assert.deepEqual(
      log.list({ limit: 1 }).map(r => r.id),
      ['c']
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scoreAi：从分析那根的下一根起数，第 5 / 20 根收盘按方向计 ATR；还没走出来的待定', () => {
  /* 分析在第 10 根（T0+10h）里，价格 110，ATR 2：第 11 根起数，第 5 根是第 15 根（收 115），第 20 根是第 30 根（收 130） */
  const rec = { id: 'x', at: T0 + 10.5 * H, price: 110, atr: 2, barTime: T0 + 10 * H, bias: '偏多' };
  assert.deepEqual(plain(scoreAi(rec, BARS, '1h')), {
    id: 'x',
    dir: 1,
    at: rec.at,
    5: { move: 2.5, signed: 2.5, hit: true },
    20: { move: 10, signed: 10, hit: true },
  });
  const short = plain(scoreAi({ ...rec, bias: '偏空' }, BARS, '1h'));
  assert.deepEqual([short[5].signed, short[5].hit], [-2.5, false]);
  /* 第 25 根分析：第 5 根是第 30 根（已收盘），第 20 根是第 45 根（还没有）→ 待定 */
  const late = plain(scoreAi({ ...rec, barTime: T0 + 25 * H, price: 125 }, BARS, '1h'));
  assert.deepEqual([late[5].move, late[20]], [2.5, null]);
  /* 观望：记移动，不算方向 */
  const flat = plain(scoreAi({ ...rec, bias: '观望' }, BARS, '1h'));
  assert.deepEqual([flat.dir, flat[5].signed, flat[5].hit], [0, null, null]);
  /* 没有 ATR：不打分 */
  assert.equal(plain(scoreAi({ ...rec, atr: null }, BARS, '1h'))[5], null);
});

test('aiStats：只算有方向且已能打分的；10 笔以上才给区间', () => {
  const s = [
    { dir: 1, 5: { signed: 1 } },
    { dir: -1, 5: { signed: -0.5 } },
    { dir: 0, 5: { signed: null } },
    { dir: 1, 5: null },
  ];
  assert.deepEqual(plain(aiStats(s, 5)), { h: 5, n: 2, hits: 1, mean: 0.25, ci: null, neutral: 1, pending: 1 });
  const many = Array.from({ length: 12 }, (_, i) => ({ dir: 1, 20: { signed: i % 2 ? 1 : -0.5 } }));
  const st = plain(aiStats(many, 20));
  assert.equal(st.n, 12);
  assert.equal(st.mean, 0.25);
  assert.ok(st.ci[0] < st.mean && st.mean < st.ci[1]);
});
