/* 摆动高低点、前高前低、多周期关键价位（纯计算） */
/* 摆动高低点：左右各 k 根已收盘K线都更低/更高才确认 */
/* 还要求摆幅：拐点前 10 根内至少走出 1 ATR、之后至少 0.5 ATR（之后的K线可能还不够 10 根），过滤小波动 */
/* hi/lo 为价格（按时间先后），hs/ls 同时带时间，供“前高/前低”使用 */
function pivots(b, k = 2, atr = 0) {
  const hs = [],
    ls = [],
    n = b.length,
    amp = (i, h, s, e) => {
      let m = h ? Infinity : -Infinity;
      for (let j = Math.max(0, s); j < Math.min(n, e); j++) m = h ? Math.min(m, b[j].low) : Math.max(m, b[j].high);
      return h ? b[i].high - m : m - b[i].low;
    };
  for (let i = k; i < n - k; i++) {
    let h = 1,
      l = 1;
    for (let j = i - k; j <= i + k; j++) {
      if (j == i) continue;
      if (b[j].high >= b[i].high) h = 0;
      if (b[j].low <= b[i].low) l = 0;
    }
    if (h && amp(i, 1, i - 10, i) >= atr && amp(i, 1, i + 1, i + 11) >= atr * 0.5)
      hs.push({ p: b[i].high, ts: b[i].timestamp });
    if (l && amp(i, 0, i - 10, i) >= atr && amp(i, 0, i + 1, i + 11) >= atr * 0.5)
      ls.push({ p: b[i].low, ts: b[i].timestamp });
  }
  const H = hs.slice(-30),
    L = ls.slice(-30);
  return { hi: H.map(q => q.p), lo: L.map(q => q.p), hs: H, ls: L };
}
/* 某周期相对最新价 px 的前高/前低：时间上最近的、仍在 px 上方的摆动高点 / 下方的摆动低点；
   hiB/loB 为比它更近、但已被价格突破/跌破的那个（说明刚破位） */
function prevHL(z, px) {
  const r = {};
  if (!z || !z.pv) return r;
  const H = z.pv.hs,
    L = z.pv.ls;
  for (let i = H.length - 1; i >= 0; i--) {
    if (H[i].p > px) {
      r.hi = H[i];
      break;
    }
    if (!r.hiB) r.hiB = H[i];
  }
  for (let i = L.length - 1; i >= 0; i--) {
    if (L[i].p < px) {
      r.lo = L[i];
      break;
    }
    if (!r.loB) r.loB = L[i];
  }
  return r;
}
/* 多周期关键价位：本周期及更大周期的摆动高低点，只取 [lo,hi] 范围内的，相距 0.5 ATR 以内的合并为一个价位；
   代表价取其中周期最大的点，w 为各点周期权重之和（被多个周期/多次确认的价位更重要） */
const TFW = { '15m': 1, '1h': 2, '4h': 3, '1d': 4, '1w': 5, '1M': 6 };
function levels(T, C, c, x, lo, hi) {
  const ps = [];
  TFS.slice(TFS.indexOf(T)).forEach(k => {
    const z = C[k];
    if (z && z.a)
      z.pv.hi.concat(z.pv.lo).forEach(p => {
        if (p >= lo && p <= hi) ps.push({ p, k });
      });
  });
  ps.sort((a, b) => a.p - b.p);
  const cl = [];
  /* 合并以每组第一个点为基准（组宽不超过 0.5 ATR），避免相邻价位链式串成一大片；
   touch：本周期最近 150 根中在该价位被挡回的次数——影线触及 0.25 ATR 内但收盘在另一侧，相隔不足 3 根的算同一次 */
  const rb = (C[T] && C[T].rb) || [],
    tol = x * 0.25,
    react = p => {
      let n = 0,
        li = -9;
      rb.forEach((k, i) => {
        if ((Math.abs(k.high - p) <= tol && k.close < p) || (Math.abs(k.low - p) <= tol && k.close > p)) {
          if (i - li >= 3) n++;
          li = i;
        }
      });
      return n;
    };
  for (const q of ps) {
    const g = cl[cl.length - 1];
    if (g && q.p - g.first <= x * 0.5) g.m.push(q);
    else cl.push({ m: [q], first: q.p });
  }
  return cl.map(g => {
    const top = g.m.reduce((a, b) =>
      TFW[b.k] > TFW[a.k] || (TFW[b.k] == TFW[a.k] && Math.abs(b.p - c) < Math.abs(a.p - c)) ? b : a
    );
    return {
      p: top.p,
      top: top.k,
      tfs: [...new Set(g.m.map(q => q.k))].sort((a, b) => TFW[b] - TFW[a]),
      w: g.m.reduce((s, q) => s + TFW[q.k], 0),
      side: top.p > c ? -1 : 1,
      touch: react(top.p),
      zlo: g.m[0].p,
      zhi: g.m[g.m.length - 1].p,
    };
  });
}
/* 关键价位：多个周期共振，或被测试 3 次以上，或来自比当前更大的周期 */
const isKey = (l, T) => l.tfs.length > 1 || l.touch >= 3 || TFW[l.top] > TFW[T];
/* 图上与面板展示的主要价位：每侧按距离取最多 3 个关键价位，彼此至少相隔 0.75 ATR；
   若其中没有更大周期的价位，用 4 ATR 内最近的一个替换最远的那个 */
function mainLv(L, c, x, T) {
  const pick = s => {
    const a = L.filter(l => l.side == s).sort((u, v) => Math.abs(u.p - c) - Math.abs(v.p - c)),
      out = [];
    for (const l of a) {
      if (out.length >= 3) break;
      if (isKey(l, T) && !out.some(o => Math.abs(o.p - l.p) < x * 0.75)) out.push(l);
    }
    if (!out.some(o => TFW[o.top] > TFW[T])) {
      const h = a.find(l => TFW[l.top] > TFW[T] && !out.includes(l) && Math.abs(l.p - c) <= 4 * x);
      if (h) {
        if (out.length >= 3) out.pop();
        out.push(h);
      }
    }
    return out;
  };
  return { sup: pick(1), res: pick(-1) };
}
