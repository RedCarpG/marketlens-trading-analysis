/* 情境（纯计算）：波动状态——现在的 ATR 在过去一年里排在什么位置。只给事实，不下结论 */
/* ===== 波动状态 =====
   当前 ATR(14) 在过去一年的 ATR 里排在什么位置。b：已收盘K线（升序）。
   ATR 的算法和 analyze 一样（真实波幅的 14 根简单平均）。拿最新一根的 ATR 和它之前一年内每一根的 ATR 比，数有几根比它小。
   数据不到一年就用已有的：full 为假，days 是实际比了多少天。能比的不到 VOL_MIN 根时返回 null。
   返回 { atr, n 比了几根, below 其中几根比它小, pct 百分比（取整）, full, days, from 最早那根的时间 } */
const VOL_WIN = 365 * 864e5,
  VOL_MIN = 10;
function volState(b, n = 14) {
  const i = b.length - 1;
  if (i < n - 1 + VOL_MIN) return null;
  const tr = b.map((x, j) =>
      j ? Math.max(x.high - x.low, Math.abs(x.high - b[j - 1].close), Math.abs(x.low - b[j - 1].close)) : x.high - x.low
    ),
    at = sma(tr, n),
    cut = b[i].timestamp - VOL_WIN;
  let j = n - 1;
  while (b[j].timestamp < cut) j++;
  let below = 0;
  for (let q = j; q < i; q++) if (at[q] < at[i]) below++;
  const cnt = i - j;
  if (cnt < VOL_MIN) return null;
  return {
    atr: at[i],
    n: cnt,
    below,
    pct: Math.round((below / cnt) * 100),
    /* 窗口里最早那根离一年前不到 7 天（周末、假日），或者更早还有K线，都算够一年 */
    full: j > n - 1 || b[j].timestamp - cut <= 7 * 864e5,
    days: Math.round((b[i].timestamp - b[j].timestamp) / 864e5),
    from: b[j].timestamp,
  };
}
/* 写成一句事实，例如“日线 ATR 105.14，过去一年里比 82% 的时候大”。
   不到一年写“已有的 N 天 / N 个月里”；能比的不到 20 根时不写百分比，写“N 根里有 M 根比它小”；全都比它小 / 没有比它小的直接说最大 / 最小 */
function volText(v, { T, dp = 2 }) {
  const span = v.full ? '过去一年' : `已有的 ${v.days >= 60 ? Math.round(v.days / 30) + ' 个月' : v.days + ' 天'}`,
    head = `${TFN[T]} ATR ${v.atr.toFixed(dp)}，`;
  if (v.below == v.n) return `${head}是${span}里最大的`;
  if (!v.below) return `${head}是${span}里最小的`;
  if (v.n < 20) return `${head}${span}的 ${v.n} 根里有 ${v.below} 根比它小`;
  return `${head}${span}里比 ${Math.max(1, Math.min(99, v.pct))}% 的时候大`;
}
