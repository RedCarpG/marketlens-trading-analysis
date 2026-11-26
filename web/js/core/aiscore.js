/* AI 分析的前瞻打分（纯计算，docs/AI.md §6）：每条记录（server/ailog.js）按分析之后走出来的已收盘K线打分。
   从分析时那根K线的下一根起，第 5 / 20 根收盘相对分析时价格的变化，按 ATR 计、乘以方向（偏多 +1、偏空 −1）：正的说明方向对了。
   “观望”和找不到倾向的不算方向，单独计数。AI 的判断只能这样前瞻地检验，样本少时不下结论 */
const AI_H = [5, 20];
function scoreAi(rec, bars, tf) {
  const dir = rec.bias == '偏多' ? 1 : rec.bias == '偏空' ? -1 : 0,
    from = rec.barTime != null ? nxt(tf, rec.barTime) : rec.at,
    i0 = bars.findIndex(b => b.timestamp >= from),
    out = { id: rec.id, dir, at: rec.at };
  for (const h of AI_H) {
    const b = i0 < 0 ? null : bars[i0 + h - 1];
    if (!b || nxt(tf, b.timestamp) > Date.now() || !(rec.atr > 0)) {
      out[h] = null;
      continue;
    }
    const move = (b.close - rec.price) / rec.atr;
    out[h] = {
      move: +move.toFixed(2),
      signed: dir ? +(move * dir).toFixed(2) : null,
      hit: dir ? move * dir > 0 : null,
    };
  }
  return out;
}
/* 汇总某个持有期：有方向且已能打分的笔数、方向对的笔数、平均（按方向）移动与粗略 95% 区间（10 笔以上才给） */
function aiStats(scored, h) {
  const xs = scored.filter(s => s.dir && s[h]).map(s => s[h].signed),
    n = xs.length,
    mean = n ? xs.reduce((a, b) => a + b, 0) / n : null,
    sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : null;
  return {
    h,
    n,
    hits: xs.filter(x => x > 0).length,
    mean: mean == null ? null : +mean.toFixed(2),
    ci:
      n >= 10
        ? [+(mean - (1.96 * sd) / Math.sqrt(n)).toFixed(2), +(mean + (1.96 * sd) / Math.sqrt(n)).toFixed(2)]
        : null,
    neutral: scored.filter(s => !s.dir).length,
    pending: scored.filter(s => s.dir && !s[h]).length,
  };
}
