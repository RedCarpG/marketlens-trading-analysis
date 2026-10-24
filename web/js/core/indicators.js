/* 指标计算与单周期信号、评分（纯计算） */
/* ===== 指标与信号 ===== */
const ema = (a, n) => {
  const k = 2 / (n + 1);
  let p;
  return a.map((v, i) => (p = i ? v * k + p * (1 - k) : v));
};
const sma = (a, n) => a.map((_, i) => (i < n - 1 ? null : a.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n));
const rsi = (c, n = 14) => {
  let g = 0,
    l = 0;
  return c.map((v, i) => {
    if (!i) return null;
    const d = v - c[i - 1],
      u = Math.max(d, 0),
      m = Math.max(-d, 0);
    if (i <= n) {
      g += u;
      l += m;
      if (i < n) return null;
      g /= n;
      l /= n;
    } else {
      g = (g * (n - 1) + u) / n;
      l = (l * (n - 1) + m) / n;
    }
    return l ? 100 - 100 / (1 + g / l) : 100;
  });
};
/* 最近 100 根全为 0 视为数据源不提供成交量 */
const hasVol = b => b.slice(-100).some(x => x.volume > 0);
function analyze(b) {
  const n = b.length;
  if (n < 60) return null;
  const C = b.map(x => x.close),
    H = b.map(x => x.high),
    L = b.map(x => x.low),
    V = b.map(x => x.volume),
    e20 = ema(C, 20),
    e50 = ema(C, 50),
    e12 = ema(C, 12),
    e26 = ema(C, 26),
    dif = e12.map((v, i) => v - e26[i]),
    dea = ema(dif, 9),
    hs = dif.map((v, i) => v - dea[i]),
    rs = rsi(C),
    tr = b.map((x, i) =>
      i ? Math.max(x.high - x.low, Math.abs(x.high - C[i - 1]), Math.abs(x.low - C[i - 1])) : x.high - x.low
    ),
    atr = sma(tr, 14),
    m = sma(C, 20),
    vm = sma(V, 20),
    sd = C.map((_, i) =>
      i < 19 ? 0 : Math.sqrt(C.slice(i - 19, i + 1).reduce((s, x) => s + (x - m[i]) ** 2, 0) / 20)
    ),
    sigs = [],
    add = (i, d, t) => sigs.push({ i, ts: b[i].timestamp, dir: d, t });
  for (let i = 51; i < n; i++) {
    const x = b[i],
      p = b[i - 1],
      bd = Math.abs(x.close - x.open),
      lo = Math.min(x.open, x.close) - x.low,
      up = x.high - Math.max(x.open, x.close);
    if (e20[i - 1] <= e50[i - 1] && e20[i] > e50[i]) add(i, 1, 'EMA20 上穿 EMA50（金叉）');
    if (e20[i - 1] >= e50[i - 1] && e20[i] < e50[i]) add(i, -1, 'EMA20 下穿 EMA50（死叉）');
    if (hs[i - 1] <= 0 && hs[i] > 0) add(i, 1, 'MACD 柱由负转正');
    if (hs[i - 1] >= 0 && hs[i] < 0) add(i, -1, 'MACD 柱由正转负');
    if (rs[i - 1] < 30 && rs[i] >= 30) add(i, 1, 'RSI 自超卖区回升');
    if (rs[i - 1] > 70 && rs[i] <= 70) add(i, -1, 'RSI 自超买区回落');
    if (p.close < p.open && x.close > x.open && x.close >= p.open && x.open <= p.close) add(i, 1, '看涨吞没');
    if (p.close > p.open && x.close < x.open && x.open >= p.close && x.close <= p.open) add(i, -1, '看跌吞没');
    if (bd > 0 && lo >= 2 * bd && up <= bd * 0.6 && C[i - 3] > x.close) add(i, 1, '锤子线（下影长）');
    if (bd > 0 && up >= 2 * bd && lo <= bd * 0.6 && C[i - 3] < x.close) add(i, -1, '射击之星（上影长）');
    if (C[i - 1] <= m[i - 1] + 2 * sd[i - 1] && x.close > m[i] + 2 * sd[i]) add(i, 1, '收盘突破布林上轨');
    if (C[i - 1] >= m[i - 1] - 2 * sd[i - 1] && x.close < m[i] - 2 * sd[i]) add(i, -1, '收盘跌破布林下轨');
  }
  const i = n - 1;
  let s = 50;
  s += e20[i] > e50[i] ? 10 : -10;
  s += C[i] > e50[i] ? 5 : -5;
  s += hs[i] > 0 ? 8 : -8;
  s += hs[i] > hs[i - 1] ? 4 : -4;
  s += rs[i] > 55 ? 4 : rs[i] < 45 ? -4 : 0;
  if (rs[i] > 75) s -= 6;
  if (rs[i] < 25) s += 6;
  s += Math.max(
    -18,
    Math.min(
      18,
      sigs.filter(g => g.i >= n - 5).reduce((a, g) => a + g.dir * 6, 0)
    )
  );
  const hv = hasVol(b);
  if (hv && V[i] > vm[i] * 1.5) s += C[i] > b[i].open ? 4 : -4; // 无成交量的数据源（如 eToro CFD）不计放量项
  s = Math.round(Math.max(0, Math.min(100, s)));
  return {
    sigs,
    s,
    hv,
    dir: s >= 65 ? 1 : s <= 35 ? -1 : 0,
    c: C[i],
    a: atr[i],
    rsi: rs[i],
    hi: Math.max(...H.slice(-20)),
    lo: Math.min(...L.slice(-20)),
    e2: e20[i],
    e5: e50[i],
  };
}
