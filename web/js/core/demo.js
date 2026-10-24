/* 模拟行情生成（纯计算） */
const rng = s => () => {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gs = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(6.2832 * r());
/* 模拟数据：先生成约 12 年的 15m 路径，再聚合出各周期，保证大小周期价格一致；快慢两层漂移让大周期也有趋势 */
const DEMO = {};
function demoAll(it) {
  if (DEMO[it.sym]) return DEMO[it.sym];
  const r = rng([...it.sym].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)),
    sg = 0.0009,
    N = 12 * 365 * 96,
    end = bkt('15m', Date.now()),
    t0 = end - (N - 1) * 9e5,
    agg = {},
    keep = {};
  TFS.forEach(k => {
    agg[k] = [];
    keep[k] = k == '1w' || k == '1M' ? 0 : end - 600 * STEP[k];
  });
  let lp = 0,
    df = 0,
    ds = 0;
  for (let i = 0; i < N; i++) {
    if (i % 60 == 0) df = gs(r) * sg * 0.09;
    if (i % 5760 == 0) ds = gs(r) * sg * 0.015;
    const ts = t0 + i * 9e5,
      o = Math.exp(lp),
      c = Math.exp((lp += df + ds + gs(r) * sg)),
      h = Math.max(o, c) * (1 + Math.abs(gs(r)) * sg * 0.6),
      l = Math.min(o, c) * (1 - Math.abs(gs(r)) * sg * 0.6),
      v = Math.round(50 + r() * 120 * (1 + Math.abs(c - o) / o / sg));
    for (const k of TFS) {
      if (ts < keep[k]) continue;
      const a = agg[k],
        b = bkt(k, ts),
        x = a[a.length - 1];
      if (x && x.timestamp === b) {
        if (h > x.high) x.high = h;
        if (l < x.low) x.low = l;
        x.close = c;
        x.volume += v;
      } else a.push({ timestamp: b, open: o, high: h, low: l, close: c, volume: v });
    }
  }
  const f = it.base / agg['15m'][agg['15m'].length - 1].close;
  TFS.forEach(k => {
    agg[k] = agg[k]
      .slice(-500)
      .map(x => ({ ...x, open: x.open * f, high: x.high * f, low: x.low * f, close: x.close * f }));
  });
  return (DEMO[it.sym] = agg);
}
