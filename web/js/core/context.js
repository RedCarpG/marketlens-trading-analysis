/* 情境（纯计算）：波动状态——现在的 ATR 在过去一年里排在什么位置；交易时段——按 UTC 划分亚洲 / 欧洲 / 美国，各时段平常的波幅。
   只给事实，不下结论 */
/* ===== 交易时段 =====
   UTC 小时，含起点不含终点。复盘按开仓时间分组（review.js）、图上的时段底色（marks.js）、面板里的波幅都用这一份 */
const SESS = [
  { k: 'asia', n: '亚洲时段', s: '亚洲', from: 0, to: 7 },
  { k: 'eu', n: '欧洲时段', s: '欧洲', from: 7, to: 13 },
  { k: 'us', n: '美国时段', s: '美国', from: 13, to: 21 },
  { k: 'late', n: '美国收盘后', s: '收盘后', from: 21, to: 24 },
];
/* 某一时刻属于哪个时段 */
const sessOf = ts => {
  const h = new Date(ts).getUTCHours();
  return SESS.find(s => h < s.to).k;
};
/* 图上标出、面板里算波幅的只有前三个：收盘后那三个小时成交少，很多品种没有K线 */
const SESS_MAIN = SESS.filter(s => s.k != 'late');
/* 能在图上画时段底色的周期：K线的起点要落在整点上、一根不跨两个时段。
   4 小时K线从 0、4、8… 点起，4–8 点那根跨着 7 点，12–16 点那根跨着 13 点，对不齐，所以不画 */
const SESS_TFS = ['15m', '1h'];
/* 把K线按“同一个 UTC 日的同一个时段”分成一段一段：[{ k 时段, d 第几个 UTC 日, a 第一根的下标, b 最后一根的下标 }]，不含收盘后 */
function sessBands(b) {
  const out = [];
  let g = null;
  b.forEach((x, i) => {
    const k = sessOf(x.timestamp),
      d = Math.floor(x.timestamp / 864e5);
    if (g && g.k == k && g.d == d) g.b = i;
    else {
      g = { k, d, a: i, b: i };
      if (k != 'late') out.push(g);
    }
  });
  return out;
}
/* 各时段平常的波幅：每个 UTC 日的每个时段里，最高价减最低价；再对各天取平均。
   b：已收盘的 15 分钟或 1 小时K线（升序）。K线不到应有的一半的时段不算（半日市、数据缺口）；
   最后一段还没走到时段结束的也不算（还在走的时段波幅偏小）。
   返回 { from 最早一根的时间, days 覆盖了几个 UTC 日, rows: [{ k, n 算了几天, avg 平均高低差 }] }；一个时段一天都没有时 avg 为 null */
function sessStats(b, tf) {
  const step = STEP[tf],
    by = {},
    bands = sessBands(b),
    days = new Set();
  bands.forEach((g, i) => {
    const s = SESS.find(q => q.k == g.k),
      n = g.b - g.a + 1,
      end = g.d * 864e5 + s.to * 36e5;
    if (n < ((s.to - s.from) * 36e5) / step / 2) return;
    if (i == bands.length - 1 && b[g.b].timestamp + step < end) return;
    let hi = -Infinity,
      lo = Infinity;
    for (let j = g.a; j <= g.b; j++) {
      if (b[j].high > hi) hi = b[j].high;
      if (b[j].low < lo) lo = b[j].low;
    }
    (by[g.k] = by[g.k] || []).push(hi - lo);
    days.add(g.d);
  });
  return {
    from: b.length ? b[0].timestamp : null,
    days: days.size,
    rows: SESS_MAIN.map(s => {
      const a = by[s.k] || [];
      return { k: s.k, n: a.length, avg: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null };
    }),
  };
}

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
